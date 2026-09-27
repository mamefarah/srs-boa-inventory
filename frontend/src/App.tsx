import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Principal } from './api.ts';
import { authConfigured, signInWithGoogle, signOutUser, watchUser } from './auth.ts';
import { t, type MessageKey } from './i18n.ts';
import { ItemsView, ReferenceView } from './ItemMaster.tsx';
import { OpeningBalancesView } from './OpeningBalance.tsx';
import { ReceiptsView } from './Receipts.tsx';

type Session =
  | { state: 'loading' }
  | { state: 'signedOut' }
  | { state: 'blocked'; code: string; requestId?: string }
  | { state: 'ready'; principal: Principal };

type TabId = 'stock' | 'items' | 'reference' | 'opening' | 'receipts' | 'warehouses' | 'policies' | 'audit';

// Navigation hints only. The server enforces every permission and scope independently.
const TABS: Array<{ id: TabId; label: MessageKey; permissions: string[] }> = [
  { id: 'stock', label: 'tabStock', permissions: ['READ_STOCK'] },
  { id: 'items', label: 'tabItems', permissions: ['READ_ITEMS'] },
  { id: 'reference', label: 'tabReference', permissions: ['READ_ITEMS'] },
  { id: 'opening', label: 'tabOpening', permissions: ['READ_OPENING_BALANCE', 'PREPARE_OPENING_BALANCE', 'APPROVE_OPENING_BALANCE', 'POST_OPENING_BALANCE'] },
  { id: 'receipts', label: 'tabReceipts', permissions: ['READ_RECEIPTS', 'PREPARE_RECEIPTS', 'RECEIVE_RECEIPTS', 'INSPECT_RECEIPTS', 'RETURN_REJECTED_STOCK'] },
  { id: 'warehouses', label: 'tabWarehouses', permissions: ['READ_WAREHOUSES'] },
  { id: 'policies', label: 'tabPolicies', permissions: ['READ_POLICIES'] },
  { id: 'audit', label: 'tabAudit', permissions: ['READ_AUDIT'] },
];

export function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' });

  useEffect(
    () =>
      watchUser(async (user) => {
        if (!user) {
          setSession({ state: 'signedOut' });
          return;
        }
        try {
          await api('/auth/sync', { method: 'POST' });
          const me = await api<{ principal: Principal }>('/me');
          setSession({ state: 'ready', principal: me.principal });
        } catch (err) {
          const e = err instanceof ApiError ? err : new ApiError(0, 'NETWORK', String(err));
          setSession({ state: 'blocked', code: e.code, requestId: e.requestId });
        }
      }),
    [],
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <strong>{t('appName')}</strong>
          <span className="subtitle">{t('appSubtitle')}</span>
        </div>
        {session.state !== 'signedOut' && session.state !== 'loading' && (
          <button type="button" className="btn secondary" onClick={() => void signOutUser()}>
            {t('signOut')}
          </button>
        )}
      </header>
      <main className="content">
        <SessionView session={session} />
      </main>
    </div>
  );
}

function SessionView({ session }: { session: Session }) {
  if (!authConfigured) return <Notice kind="danger">{t('configMissing')}</Notice>;
  switch (session.state) {
    case 'loading':
      return <p role="status">{t('loading')}</p>;
    case 'signedOut':
      return (
        <div className="centered">
          <button type="button" className="btn primary" onClick={() => void signInWithGoogle()}>
            {t('signIn')}
          </button>
        </div>
      );
    case 'blocked':
      if (session.code === 'ACCOUNT_INACTIVE') {
        return (
          <Notice kind="warning" title={t('inactiveTitle')}>
            {t('inactiveBody')}
          </Notice>
        );
      }
      if (session.code === 'PROFILE_NOT_PROVISIONED') return <Notice kind="warning">{t('notProvisioned')}</Notice>;
      return (
        <Notice kind="danger">
          {t('error')} {session.code} {session.requestId ?? ''}
        </Notice>
      );
    case 'ready':
      return <Workspace principal={session.principal} />;
  }
}

function Workspace({ principal }: { principal: Principal }) {
  const tabs = TABS.filter((tab) => tab.permissions.some((p) => principal.permissions.includes(p)));
  const [active, setActive] = useState<TabId | undefined>(tabs[0]?.id);
  return (
    <>
      <section className="identity" aria-label={t('signedInAs')}>
        <div>
          {t('signedInAs')}: <strong>{principal.displayName ?? principal.email}</strong>
        </div>
        <div>
          {t('roles')}: {principal.roles.join(', ') || '—'}
        </div>
        <div>
          {t('scope')}:{' '}
          {principal.hasGlobalWarehouseScope ? t('scopeAll') : principal.warehouseIds.length ? principal.warehouseIds.join(', ') : t('scopeNone')}
        </div>
      </section>
      {tabs.length === 0 ? (
        <Notice kind="info">{t('noAccess')}</Notice>
      ) : (
        <>
          <nav className="tabs" aria-label="Sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === active ? 'tab active' : 'tab'}
                aria-current={tab.id === active ? 'page' : undefined}
                onClick={() => setActive(tab.id)}
              >
                {t(tab.label)}
              </button>
            ))}
          </nav>
          {active === 'stock' && <StockView />}
          {active === 'items' && <ItemsView canManage={principal.permissions.includes('MANAGE_ITEMS')} />}
          {active === 'reference' && <ReferenceView canManage={principal.permissions.includes('MANAGE_MASTER_REFERENCE')} />}
          {active === 'opening' && <OpeningBalancesView principal={principal} />}
          {active === 'receipts' && <ReceiptsView principal={principal} />}
          {active === 'warehouses' && <WarehousesView canManageAccess={principal.permissions.includes('MANAGE_WAREHOUSE_ACCESS')} />}
          {active === 'policies' && <PoliciesView />}
          {active === 'audit' && <AuditView />}
        </>
      )}
    </>
  );
}

function useApi<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const load = useCallback(() => {
    setState({ loading: true });
    api<T>(path)
      .then((data) => setState({ data, loading: false }))
      .catch((error) => setState({ error: error instanceof ApiError ? error : new ApiError(0, 'NETWORK', String(error)), loading: false }));
  }, [path]);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

type Column<R> = { key: string; label: MessageKey; render: (r: R) => ReactNode };

/** Table on wide screens; labelled cards on phones (same facts, no horizontal scroll). */
function DataView<R>({ path, columns, note }: { path: string; columns: Column<R>[]; note?: MessageKey }) {
  const { data, error, loading, reload } = useApi<{ data: R[] }>(path);
  if (loading) return <p role="status">{t('loading')}</p>;
  if (error)
    return (
      <Notice kind="danger">
        {t('error')} {error.code} {error.requestId ?? ''}{' '}
        <button type="button" className="btn secondary" onClick={reload}>
          {t('retry')}
        </button>
      </Notice>
    );
  const rows = data?.data ?? [];
  return (
    <section>
      {note && <Notice kind="info">{t(note)}</Notice>}
      {rows.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {t(c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} data-label={t(c.label)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type StockRow = { warehouseCode: string; itemCode: string; itemName: string; baseUomCode: string; conditionCode: string; warehouseLocationId: number | null; onHandQuantity: string };
const StockView = () => (
  <DataView<StockRow>
    path="/stock"
    note="stockNote"
    columns={[
      { key: 'wh', label: 'warehouse', render: (r) => r.warehouseCode },
      { key: 'item', label: 'item', render: (r) => `${r.itemCode} — ${r.itemName}` },
      { key: 'cond', label: 'condition', render: (r) => <span className="badge">{r.conditionCode}</span> },
      { key: 'loc', label: 'location', render: (r) => r.warehouseLocationId ?? '—' },
      { key: 'qty', label: 'onHand', render: (r) => <span className="qty">{`${r.onHandQuantity} ${r.baseUomCode}`}</span> },
    ]}
  />
);

type WarehouseRow = { code: string; name: string; isActive: boolean };
// SYSTEM_ADMIN (MANAGE_WAREHOUSE_ACCESS) can never hold warehouse scope (INV-029; ADR-0004
// H2 forbids combining access-administration with WAREHOUSE_SCOPE_ALL), so it reads the
// unscoped admin directory instead of the scope-filtered operational endpoint.
const WarehousesView = ({ canManageAccess }: { canManageAccess: boolean }) => (
  <DataView<WarehouseRow>
    path={canManageAccess ? '/admin/warehouses' : '/warehouses'}
    columns={[
      { key: 'code', label: 'code', render: (r) => r.code },
      { key: 'name', label: 'name', render: (r) => r.name },
      { key: 'st', label: 'status', render: (r) => <span className="badge">{r.isActive ? t('active') : t('inactive')}</span> },
    ]}
  />
);

type PolicyRow = { policyKey: string; version: number; status: string; evidenceStatus: string; blockerRef: string | null };
const PoliciesView = () => (
  <DataView<PolicyRow>
    path="/policies"
    columns={[
      { key: 'key', label: 'policy', render: (r) => r.policyKey },
      { key: 'v', label: 'version', render: (r) => r.version },
      { key: 'st', label: 'status', render: (r) => <span className="badge">{r.status}</span> },
      { key: 'ev', label: 'evidence', render: (r) => <span className="badge">{r.evidenceStatus}</span> },
      { key: 'hb', label: 'blocker', render: (r) => r.blockerRef ?? '—' },
    ]}
  />
);

type AuditRow = { occurredAt: string; action: string; result: string; entityType: string; entityId: string | null };
const AuditView = () => (
  <DataView<AuditRow>
    path="/audits"
    columns={[
      { key: 'when', label: 'when', render: (r) => new Date(r.occurredAt).toLocaleString() },
      { key: 'action', label: 'action', render: (r) => r.action },
      { key: 'result', label: 'result', render: (r) => <span className="badge">{r.result}</span> },
      { key: 'entity', label: 'entity', render: (r) => `${r.entityType}${r.entityId ? ` #${r.entityId}` : ''}` },
    ]}
  />
);

function Notice({ kind, title, children }: { kind: 'info' | 'warning' | 'danger'; title?: string; children: ReactNode }) {
  const icon = kind === 'danger' ? '⛔' : kind === 'warning' ? '⚠' : 'ℹ';
  return (
    <div className={`notice ${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      <span aria-hidden="true">{icon}</span>
      <div>
        {title && <strong className="notice-title">{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
