#!/usr/bin/env bash
# Content-based secret scan over tracked files (used locally and in CI).
set -euo pipefail
bad_files="$(git ls-files | grep -E '(^|/)(\.env($|\.)|.*\.(pem|key|p12|pfx|jks|keystore)$)' | grep -v -E '(^|/)\.env\.example$' || true)"
if [ -n "$bad_files" ]; then
  echo "Blocked sensitive-style tracked files:"; echo "$bad_files"; exit 1
fi
patterns='(-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|"private_key"[[:space:]]*:|"type"[[:space:]]*:[[:space:]]*"service_account"|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|service_role[^A-Za-z0-9]{0,8}[=:][^[:space:]]{10,}|postgres(ql)?://[^:/[:space:]]+:[^@/[:space:]]+@)'
if git grep --untracked -I -n -E "$patterns" -- . ':!*.md' ':!.env.example' ':!scripts/secret-scan.sh' ':!package-lock.json'; then
  echo "Potential secret material detected. Review and rotate if real."; exit 1
fi
echo "secret-scan: no findings"
