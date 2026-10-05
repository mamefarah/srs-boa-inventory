import { useEffect, useState } from 'react';
import { api, ApiError, type Principal } from './api.ts';
import { t } from './i18n.ts';
import { ErrorBox, Field, type Item } from './ItemMaster.tsx';

/**
 * Stock card (bin card): read-only, ledger-derived history of one item in one warehouse with a running
 * balance computed by the database (PRD §19; UX_PATTERNS §1). No control here can change stock.
 */
interface Warehouse { id: number; code: string; name: string; isActive: boolean }
interface CardRow {
  entryId: number;
  transactionType: string;
  businessDocumentType: string | null;
  businessDocumentId: string | null;
  effectiveAt: string;
  conditionCode: string;
  batchRef: string | null;
  expiryDate: string | null;
  reversalOfTransactionId: string | null;
  signedQuantity: string;
  runningBalance: string;
}

const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e)));

export function StockCardView({ principal }: { principal: Principal }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Item[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [rows, setRows] = useState<CardRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api<{ data: Warehouse[] }>('/warehouses')
      .then((r) => {
        const active = r.data.filter((w) => w.isActive);
        setWarehouses(active);
        // A single-warehouse user keeps the active warehouse visible and preselected (UX_PATTERNS §12).
        if (active.length === 1 && !principal.hasGlobalWarehouseScope) setWarehouseId(String(active[0]!.id));
      })
      .catch((e) => setError(asError(e)));
  }, [principal.hasGlobalWarehouseScope]);

  useEffect(() => {
    setRows(null);
    if (!warehouseId || !item) return;
    api<{ data: CardRow[] }>(`/stock/card?${new URLSearchParams({ warehouseId, itemId: String(item.id), limit: '500' })}`)
      .then((r) => {
        setRows(r.data);
        setError(null);
      })
      .catch((e) => setError(asError(e)));
  }, [warehouseId, item]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    try {
      const r = await api<{ data: Item[] }>(`/items?${new URLSearchParams({ q, limit: '10' })}`);
      setMatches(r.data);
    } catch (e) {
      setError(asError(e));
    }
  };

  return (
    <section>
      <h2>{t('scTitle')}</h2>
      <p className="hint">{t('scIntro')}</p>
      <ErrorBox error={error} />
      <Field label="warehouse">
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">—</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {w.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="toolbar">
        <input aria-label={t('scSearch')} placeholder={t('scSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn secondary" onClick={() => void search()}>
          {t('search')}
        </button>
      </div>
      {matches.length > 0 && (
        <Field label="item">
          <select value={item?.id ?? ''} onChange={(e) => setItem(matches.find((m) => m.id === Number(e.target.value)) ?? null)}>
            <option value="">—</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.itemCode} · {m.name} ({m.baseUomCode})
              </option>
            ))}
          </select>
        </Field>
      )}
      {item && <h3>{`${item.itemCode} · ${item.name} (${item.baseUomCode})`}</h3>}
      {rows && rows.length === 0 && <p>{t('empty')}</p>}
      {rows && rows.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th scope="col">{t('scWhen')}</th>
              <th scope="col">{t('scMovement')}</th>
              <th scope="col">{t('scDocument')}</th>
              <th scope="col">{t('condition')}</th>
              <th scope="col">{t('issQuantity')}</th>
              <th scope="col">{t('scRunning')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entryId}>
                <td data-label={t('scWhen')}>{new Date(r.effectiveAt).toLocaleString()}</td>
                <td data-label={t('scMovement')}>
                  {r.transactionType}
                  {r.reversalOfTransactionId ? ' ↩' : ''}
                </td>
                <td data-label={t('scDocument')}>{[r.businessDocumentType, r.businessDocumentId].filter(Boolean).join(' ') || '—'}</td>
                <td data-label={t('condition')}>
                  {r.conditionCode}
                  {r.batchRef ? ` · ${r.batchRef}` : ''}
                  {r.expiryDate ? ` · ${r.expiryDate}` : ''}
                </td>
                <td data-label={t('issQuantity')}>
                  <span className="qty">{r.signedQuantity.startsWith('-') ? r.signedQuantity : `+${r.signedQuantity}`}</span>
                </td>
                <td data-label={t('scRunning')}>
                  <span className="qty">{r.runningBalance}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
