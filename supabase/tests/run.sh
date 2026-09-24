#!/usr/bin/env bash
# Applies the real migrations (plus test-only auth/seed scaffolding) to a scratch local
# PostgreSQL database, runs the RLS/security test suite, then drops the scratch database.
#
# Requires a local PostgreSQL server reachable as the `postgres` superuser (or a role
# with equivalent privileges) via PGHOST/PGPORT/PGUSER/PGPASSWORD, and Node.js with
# supabase/tests/node_modules installed (`npm install` in this directory).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DB_NAME="boa_ims_rls_test_$$"
PSQL_SUPERUSER="${PSQL_SUPERUSER:-postgres}"
# If the current OS user cannot authenticate to PostgreSQL directly (e.g. running as
# root against a peer-authenticated local server), run psql/createdb/dropdb as the
# postgres OS user via sudo instead.
AS_SUPERUSER=()
if [ "$(id -un)" != "$PSQL_SUPERUSER" ] && command -v sudo >/dev/null 2>&1; then
  AS_SUPERUSER=(sudo -u "$PSQL_SUPERUSER")
fi

cleanup() {
  "${AS_SUPERUSER[@]}" dropdb --if-exists "$DB_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Creating scratch database $DB_NAME"
"${AS_SUPERUSER[@]}" createdb "$DB_NAME"

echo "==> Applying test-only auth stub"
"${AS_SUPERUSER[@]}" psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$SCRIPT_DIR/support/auth_stub.sql"

echo "==> Applying migrations"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  echo "    - $(basename "$f")"
  "${AS_SUPERUSER[@]}" psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$f"
done

echo "==> Applying test seed data"
"${AS_SUPERUSER[@]}" psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$SCRIPT_DIR/support/seed.sql"

echo "==> Running RLS/security tests"
# Connect over TCP with password auth (rather than the unix-socket peer auth used above
# for schema setup) so this works regardless of which OS user runs the test suite.
: "${TEST_DB_PASSWORD:?Set TEST_DB_PASSWORD to the local postgres role password}"
TEST_DATABASE_URL="postgresql://${PSQL_SUPERUSER}:${TEST_DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}" \
  npm --prefix "$SCRIPT_DIR" test
