import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Principal } from './api.ts';
import { t, type MessageKey } from './i18n.ts';
import { ErrorBox, Field, type Item } from './ItemMaster.tsx';

/**
 * Opening balance batches (M3; PRD §38, ADR-0007). The server and database enforce every
 * permission, scope, state rule and the maker-checker control; the flags here only hide
 * controls. Nothing here changes stock until an approved batch is posted.
 */

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED';

interface Batch {
  id: number;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  cutoffAt: string;
  description: string | null;
  sourceEvidenceRef: string | null;
  status: Status;
  rowVersion: number;
  createdByUserId: number;
  createdByName: string | null;
  submittedByUserId: number | null;
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalReference: string | null;
  postedByName: string | null;
  postedAt: string | null;
  transactionId: string | null;
  lineCount?: number;
  lines?: Line[];
}
interface Line {
  id: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  baseUomCode: string;
  quantity: string;
  locationCode: string | null;
  conditionCode: string;
  conditionName: string;
  batchRef: string | null;
  expiryDate: string | null;
  serialRef: string | null;
  sourceLineRef: string | null;
}
interface Warehouse { id: number; code: string; name: string; isActive: boolean }
interface Location { id: number; code: string; name: string; isActive: boolean }
interface ConditionCode { code: string; name: string; isActive: boolean }
interface Reconciliation {
  result: 'MATCHED' | 'MISMATCH' | 'NOT_POSTED';
  lineCount: number;
  ledgerEntryCount: number;
  lines: Array<{ lineNo: number; itemCode: string; batchQuantity: string; ledgerQuantity: string | null; contraQuantity: string | null; matched: boolean }>;
}

// Each state has its own label, icon and explanation (never colour alone).
const STATUS: Record<Status, { icon: string; label: MessageKey; help: MessageKey }> = {
  DRAFT: { icon: '✎', label: 'obStatusDraft', help: 'obHelpDraft' },
  SUBMITTED: { icon: '⏳', label: 'obStatusSubmitted', help: 'obHelpSubmitted' },
  APPROVED: { icon: '✔', label: 'obStatusApproved', help: 'obHelpApproved' },
  POSTED: { icon: '🔒', label: 'obStatusPosted', help: 'obHelpPosted' },
  CANCELLED: { icon: '✖', label: 'obStatusCancelled', help: 'obHelpCancelled' },
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`}>
      <span aria-hidden="true">{STATUS[status].icon}</span> {t(STATUS[status].label)}
    </span>
  );
}

const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e)));
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const batchNo = (id: number) => `OB-${String(id).padStart(6, '0')}`;

export function OpeningBalancesView({ principal }: { principal: Principal }) {
  const can = {
    prepare: principal.permissions.includes('PREPARE_OPENING_BALANCE'),
    approve: principal.permissions.includes('APPROVE_OPENING_BALANCE'),
    post: principal.permissions.includes('POST_OPENING_BALANCE'),
  };
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  if (openId === 'new') return <NewBatchForm onDone={(id) => setOpenId(id ?? null)} />;
  if (openId !== null) return <BatchDetail id={openId} principal={principal} can={can} onClose={() => setOpenId(null)} />;
  return <BatchList canPrepare={can.prepare} onOpen={setOpenId} />;
}

function BatchList({ canPrepare, onOpen }: { canPrepare: boolean; onOpen: (id: number | 'new') => void }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Batch[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    api<{ data: Batch[] }>(`/opening-balances?${params}`)
      .then((r) => {
        setRows(r.data);
        setError(null);
      })
      .catch((e) => setError(asError(e)));
  }, [status]);
  useEffect(load, [load]);

  return (
    <section>
      <p className="hint">{t('obIntro')}</p>
      <div className="toolbar">
        <select aria-label={t('status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('obAllStatuses')}</option>
          {(Object.keys(STATUS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {t(STATUS[s].label)}
            </option>
          ))}
        </select>
        {canPrepare && (
          <button type="button" className="btn primary" onClick={() => onOpen('new')}>
            {t('obNewBatch')}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {rows && rows.length === 0 && <p>{t('empty')}</p>}
      {rows && rows.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th scope="col">{t('obBatch')}</th>
              <th scope="col">{t('warehouse')}</th>
              <th scope="col">{t('obCutoff')}</th>
              <th scope="col">{t('status')}</th>
              <th scope="col">{t('obLines')}</th>
              <th scope="col">{t('obPreparedBy')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td data-label={t('obBatch')}>
                  <button type="button" className="linklike" onClick={() => onOpen(b.id)}>
                    {batchNo(b.id)}
                  </button>
                </td>
                <td data-label={t('warehouse')}>{b.warehouseCode}</td>
                <td data-label={t('obCutoff')}>{fmt(b.cutoffAt)}</td>
                <td data-label={t('status')}>
                  <StatusBadge status={b.status} />
                </td>
                <td data-label={t('obLines')}>{b.lineCount ?? 0}</td>
                <td data-label={t('obPreparedBy')}>{b.createdByName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewBatchForm({ onDone }: { onDone: (id?: number) => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [f, setF] = useState({ warehouseId: '', cutoffAt: '', sourceEvidenceRef: '', description: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ data: Warehouse[] }>('/warehouses')
      .then((r) => setWarehouses(r.data.filter((w) => w.isActive)))
      .catch((e) => setError(asError(e)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ data: Batch }>('/opening-balances', {
        method: 'POST',
        body: {
          warehouseId: Number(f.warehouseId),
          // datetime-local is local wall time; send an explicit UTC instant.
          cutoffAt: new Date(f.cutoffAt).toISOString(),
          sourceEvidenceRef: f.sourceEvidenceRef,
          description: f.description,
        },
      });
      onDone(r.data.id);
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h2>{t('obNewBatch')}</h2>
      <p className="hint">{t('noStockEffectDraft')}</p>
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        <Field label="warehouse">
          <select required value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
            <option value="">—</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="obCutoff">
          <input type="datetime-local" required value={f.cutoffAt} onChange={(e) => setF({ ...f, cutoffAt: e.target.value })} />
        </Field>
        <Field label="obSourceEvidence">
          <input maxLength={300} value={f.sourceEvidenceRef} onChange={(e) => setF({ ...f, sourceEvidenceRef: e.target.value })} />
        </Field>
        <Field label="description">
          <textarea maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </fieldset>
      <div className="toolbar">
        <button type="submit" className="btn primary" disabled={busy}>
          {t('save')}
        </button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

type Can = { prepare: boolean; approve: boolean; post: boolean };

function BatchDetail({ id, principal, can, onClose }: { id: number; principal: Principal; can: Can; onClose: () => void }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [approvalReference, setApprovalReference] = useState('');
  const [evidence, setEvidence] = useState('');
  // One key per posting attempt, reused on retry so a lost response can never post twice.
  const [postKey, setPostKey] = useState(() => crypto.randomUUID());
  const [recon, setRecon] = useState<Reconciliation | null>(null);

  const load = useCallback(() => {
    api<{ data: Batch }>(`/opening-balances/${id}`)
      .then((r) => {
        setBatch(r.data);
        setEvidence(r.data.sourceEvidenceRef ?? '');
        setError(null);
        if (r.data.status === 'POSTED') {
          api<{ data: Reconciliation }>(`/opening-balances/${id}/reconciliation`)
            .then((x) => setRecon(x.data))
            .catch((e) => setError(asError(e)));
        }
      })
      .catch((e) => setError(asError(e)));
  }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setReason('');
      load();
    } catch (err) {
      setError(asError(err));
      // A stale version means someone else changed the batch: show the current state.
      if (err instanceof ApiError && err.code === 'STALE_VERSION') load();
    } finally {
      setBusy(false);
    }
  };

  if (!batch) return error ? <ErrorBox error={error} /> : <p role="status">{t('loading')}</p>;
  const draft = batch.status === 'DRAFT';
  const isMaker = batch.createdByUserId === principal.userId || batch.submittedByUserId === principal.userId;
  const call = (action: string, body: object) =>
    act(() => api(`/opening-balances/${id}/${action}`, { method: 'POST', body: { rowVersion: batch.rowVersion, ...body } }));

  return (
    <section>
      <div className="toolbar">
        <button type="button" className="btn secondary" onClick={onClose}>
          ← {t('obBackToList')}
        </button>
      </div>
      <h2>
        {batchNo(batch.id)} · {batch.warehouseCode} <StatusBadge status={batch.status} />
      </h2>
      <div className={`notice ${batch.status === 'POSTED' ? 'info' : batch.status === 'CANCELLED' ? 'danger' : 'warning'}`} role="status">
        <span aria-hidden="true">{STATUS[batch.status].icon}</span>
        <div>{t(STATUS[batch.status].help)}</div>
      </div>
      <ErrorBox error={error} />

      <dl className="facts">
        <dt>{t('obCutoff')}</dt>
        <dd>{fmt(batch.cutoffAt)}</dd>
        <dt>{t('obSourceEvidence')}</dt>
        <dd>{batch.sourceEvidenceRef ?? '—'}</dd>
        <dt>{t('obPreparedBy')}</dt>
        <dd>{batch.createdByName ?? '—'}</dd>
        <dt>{t('obSubmittedBy')}</dt>
        <dd>{batch.submittedByName ? `${batch.submittedByName} · ${fmt(batch.submittedAt)}` : '—'}</dd>
        <dt>{t('obApprovedBy')}</dt>
        <dd>{batch.approvedByName ? `${batch.approvedByName} · ${fmt(batch.approvedAt)} · ${batch.approvalReference}` : '—'}</dd>
        <dt>{t('obPostedBy')}</dt>
        <dd>{batch.postedByName ? `${batch.postedByName} · ${fmt(batch.postedAt)}` : '—'}</dd>
      </dl>

      {draft && can.prepare && (
        <div className="toolbar">
          <label className="field grow">
            <span>{t('obSourceEvidence')}</span>
            <input maxLength={300} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={busy || evidence === (batch.sourceEvidenceRef ?? '')}
            onClick={() => void act(() => api(`/opening-balances/${id}`, { method: 'PATCH', body: { rowVersion: batch.rowVersion, sourceEvidenceRef: evidence } }))}
          >
            {t('save')}
          </button>
        </div>
      )}

      <h3>{t('obLines')}</h3>
      <LinesTable batch={batch} editable={draft && can.prepare} busy={busy} onRemove={(lineId) => void act(() => api(`/opening-balances/${id}/lines/${lineId}`, { method: 'DELETE' }))} />
      {draft && can.prepare && (
        <>
          <AddLineForm batch={batch} onAdded={load} />
          <ImportLines batch={batch} onImported={load} />
        </>
      )}

      {batch.status === 'POSTED' && recon && <ReconciliationView recon={recon} />}

      {batch.status !== 'POSTED' && batch.status !== 'CANCELLED' && (
        <div className="form">
          <h3>{t('obActions')}</h3>
          {batch.status === 'SUBMITTED' && can.approve && (
            <>
              {isMaker && <p className="notice warning">{t('obMakerCheckerHint')}</p>}
              <Field label="obApprovalReference">
                <input maxLength={200} value={approvalReference} onChange={(e) => setApprovalReference(e.target.value)} />
              </Field>
              <p className="hint">{t('obApprovalAuthorityNote')}</p>
            </>
          )}
          <Field label="reason">
            <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="toolbar">
            {draft && can.prepare && (
              <button type="button" className="btn primary" disabled={busy || !batch.lines?.length} onClick={() => void call('submit', { reason: reason || undefined })}>
                {t('obSubmit')}
              </button>
            )}
            {batch.status === 'SUBMITTED' && can.approve && (
              <button type="button" className="btn primary" disabled={busy || isMaker || approvalReference.trim().length < 3} onClick={() => void call('approve', { approvalReference, reason: reason || undefined })}>
                {t('obApprove')}
              </button>
            )}
            {batch.status === 'APPROVED' && can.post && (
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t('obPostConfirm'))) return;
                  void act(async () => {
                    await api(`/opening-balances/${id}/post`, { method: 'POST', body: { rowVersion: batch.rowVersion }, headers: { 'Idempotency-Key': postKey } });
                    setPostKey(crypto.randomUUID());
                  });
                }}
              >
                {t('obPost')}
              </button>
            )}
            {(batch.status === 'SUBMITTED' || batch.status === 'APPROVED') && can.approve && (
              <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void call('return', { reason })}>
                {t('obReturn')}
              </button>
            )}
            {(draft ? can.prepare || can.approve : can.approve) && (
              <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void call('cancel', { reason })}>
                {t('obCancelBatch')}
              </button>
            )}
          </div>
          <p className="hint">{t('obReasonHint')}</p>
        </div>
      )}
    </section>
  );
}

function LinesTable({ batch, editable, busy, onRemove }: { batch: Batch; editable: boolean; busy: boolean; onRemove: (lineId: number) => void }) {
  const lines = batch.lines ?? [];
  if (lines.length === 0) return <p>{t('obNoLines')}</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{t('item')}</th>
          <th scope="col">{t('quantity')}</th>
          <th scope="col">{t('location')}</th>
          <th scope="col">{t('condition')}</th>
          <th scope="col">{t('obTracking')}</th>
          <th scope="col">{t('obSourceLine')}</th>
          {editable && <th scope="col">{t('obLineActions')}</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td data-label="#">{l.lineNo}</td>
            <td data-label={t('item')}>
              {l.itemCode} · {l.itemName}
            </td>
            <td data-label={t('quantity')}>
              <span className="qty">{l.quantity}</span> {l.baseUomCode}
            </td>
            <td data-label={t('location')}>{l.locationCode ?? '—'}</td>
            <td data-label={t('condition')}>{l.conditionName}</td>
            <td data-label={t('obTracking')}>{[l.batchRef, l.expiryDate, l.serialRef].filter(Boolean).join(' · ') || '—'}</td>
            <td data-label={t('obSourceLine')}>{l.sourceLineRef ?? '—'}</td>
            {editable && (
              <td data-label={t('obLineActions')}>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => onRemove(l.id)}>
                  {t('obRemove')}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface LineForm {
  itemQuery: string;
  item: Item | null;
  quantity: string;
  locationId: string;
  conditionCode: string;
  batchRef: string;
  expiryDate: string;
  serialRef: string;
  sourceLineRef: string;
}
const emptyLine = (): LineForm => ({ itemQuery: '', item: null, quantity: '', locationId: '', conditionCode: 'USABLE', batchRef: '', expiryDate: '', serialRef: '', sourceLineRef: '' });

function useLookups(warehouseId: number) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [conditions, setConditions] = useState<ConditionCode[]>([]);
  useEffect(() => {
    void api<{ data: Location[] }>(`/warehouses/${warehouseId}/locations`).then((r) => setLocations(r.data.filter((l) => l.isActive))).catch(() => setLocations([]));
    void api<{ data: ConditionCode[] }>('/condition-codes').then((r) => setConditions(r.data.filter((c) => c.isActive))).catch(() => setConditions([]));
  }, [warehouseId]);
  return { locations, conditions };
}

function AddLineForm({ batch, onAdded }: { batch: Batch; onAdded: () => void }) {
  const { locations, conditions } = useLookups(batch.warehouseId);
  // Entered values are preserved across validation errors (UX rule).
  const [f, setF] = useState<LineForm>(emptyLine);
  const [matches, setMatches] = useState<Item[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const q = f.itemQuery.trim();
    if (!q) return;
    try {
      const r = await api<{ data: Item[] }>(`/items?${new URLSearchParams({ q, active: 'true', limit: '10' })}`);
      setMatches(r.data);
    } catch (err) {
      setError(asError(err));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.item) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/opening-balances/${batch.id}/lines`, {
        method: 'POST',
        body: {
          itemId: f.item.id,
          quantity: f.quantity.trim(),
          warehouseLocationId: f.locationId ? Number(f.locationId) : null,
          conditionCode: f.conditionCode,
          batchRef: f.batchRef || null,
          expiryDate: f.expiryDate || null,
          serialRef: f.serialRef || null,
          sourceLineRef: f.sourceLineRef || null,
        },
      });
      setF(emptyLine());
      setMatches([]);
      onAdded();
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h3>{t('obAddLine')}</h3>
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        <div className="toolbar">
          <input aria-label={t('obFindItem')} placeholder={t('obFindItem')} value={f.itemQuery} onChange={(e) => setF({ ...f, itemQuery: e.target.value })} />
          <button type="button" className="btn secondary" onClick={() => void search()}>
            {t('search')}
          </button>
        </div>
        {matches.length > 0 && (
          <Field label="item">
            <select
              required
              value={f.item?.id ?? ''}
              onChange={(e) => setF({ ...f, item: matches.find((m) => m.id === Number(e.target.value)) ?? null })}
            >
              <option value="">—</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.itemCode} · {m.name} ({m.baseUomCode})
                </option>
              ))}
            </select>
          </Field>
        )}
        {f.item && (
          <p className="hint">
            {t('obBaseUomIs')} {f.item.baseUomCode}
          </p>
        )}
        <Field label="quantity">
          <input required inputMode="decimal" autoComplete="off" pattern="[0-9]+([.][0-9]{1,6})?" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </Field>
        <Field label="location">
          <select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
            <option value="">{t('none')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="condition">
          <select value={f.conditionCode} onChange={(e) => setF({ ...f, conditionCode: e.target.value })}>
            {conditions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {f.item?.isBatchTracked && (
          <Field label="obBatchRef">
            <input required maxLength={100} value={f.batchRef} onChange={(e) => setF({ ...f, batchRef: e.target.value })} />
          </Field>
        )}
        {f.item?.isExpiryTracked && (
          <Field label="obExpiryDate">
            <input type="date" required value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} />
          </Field>
        )}
        {f.item?.isSerialTracked && (
          <Field label="obSerialRef">
            <input required maxLength={100} value={f.serialRef} onChange={(e) => setF({ ...f, serialRef: e.target.value })} />
          </Field>
        )}
        <Field label="obSourceLine">
          <input maxLength={200} value={f.sourceLineRef} onChange={(e) => setF({ ...f, sourceLineRef: e.target.value })} />
        </Field>
      </fieldset>
      <button type="submit" className="btn primary" disabled={busy || !f.item}>
        {t('obAddLine')}
      </button>
    </form>
  );
}

/** Minimal CSV parsing (comma-separated, optional double quotes). */
function parseCsv(textValue: string): string[][] {
  const rows: string[][] = [];
  for (const raw of textValue.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quoted) {
        if (ch === '"' && raw[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

const CSV_COLUMNS = ['itemCode', 'quantity', 'locationCode', 'conditionCode', 'batchRef', 'expiryDate', 'serialRef', 'sourceLineRef'] as const;

function ImportLines({ batch, onImported }: { batch: Batch; onImported: () => void }) {
  const { locations } = useLookups(batch.warehouseId);
  const [csv, setCsv] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const rows = parseCsv(csv);
      const header = rows[0]?.map((h) => h.trim());
      if (!header || CSV_COLUMNS.some((c, i) => header[i] !== c)) {
        throw new ApiError(400, 'CSV_HEADER', `${t('obCsvHeader')} ${CSV_COLUMNS.join(',')}`);
      }
      const lines = [];
      for (const [n, cells] of rows.slice(1).entries()) {
        const v = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, cells[i] ?? '']));
        const found = await api<{ data: Item[] }>(`/items?${new URLSearchParams({ q: v.itemCode, active: 'true', limit: '20' })}`);
        const hit = found.data.find((i) => i.itemCode.toUpperCase() === v.itemCode.toUpperCase());
        if (!hit) throw new ApiError(400, 'CSV_ITEM', `Row ${n + 1}: ${t('obCsvUnknownItem')} ${v.itemCode}`);
        const loc = v.locationCode ? locations.find((l) => l.code.toUpperCase() === v.locationCode.toUpperCase()) : undefined;
        if (v.locationCode && !loc) throw new ApiError(400, 'CSV_LOCATION', `Row ${n + 1}: ${t('obCsvUnknownLocation')} ${v.locationCode}`);
        lines.push({
          itemId: hit.id,
          quantity: v.quantity,
          warehouseLocationId: loc?.id ?? null,
          conditionCode: v.conditionCode || 'USABLE',
          batchRef: v.batchRef || null,
          expiryDate: v.expiryDate || null,
          serialRef: v.serialRef || null,
          sourceLineRef: v.sourceLineRef || null,
        });
      }
      if (lines.length === 0) throw new ApiError(400, 'CSV_EMPTY', t('obCsvEmpty'));
      await api(`/opening-balances/${batch.id}/lines/import`, { method: 'POST', body: { lines } });
      setDone(lines.length);
      setCsv('');
      onImported();
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <h3>{t('obImport')}</h3>
      <p className="hint">
        {t('obImportHint')} <code>{CSV_COLUMNS.join(',')}</code>
      </p>
      <ErrorBox error={error} />
      {done !== null && (
        <p className="notice info" role="status">
          {t('obImported')} {done}
        </p>
      )}
      <label className="field">
        <span>{t('obCsv')}</span>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} />
      </label>
      <button type="button" className="btn secondary" disabled={busy || !csv.trim()} onClick={() => void run()}>
        {t('obImport')}
      </button>
    </div>
  );
}

function ReconciliationView({ recon }: { recon: Reconciliation }) {
  const ok = recon.result === 'MATCHED';
  return (
    <section>
      <h3>{t('obReconciliation')}</h3>
      <div className={`notice ${ok ? 'info' : 'danger'}`} role={ok ? 'status' : 'alert'}>
        <span aria-hidden="true">{ok ? '✔' : '⛔'}</span>
        <div>
          <strong className="notice-title">{ok ? t('obMatched') : t('obMismatch')}</strong>
          {t('obReconSummary')} {recon.lineCount} / {recon.ledgerEntryCount}
        </div>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{t('item')}</th>
            <th scope="col">{t('obBatchQty')}</th>
            <th scope="col">{t('obLedgerQty')}</th>
            <th scope="col">{t('obContraQty')}</th>
            <th scope="col">{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {recon.lines.map((l) => (
            <tr key={l.lineNo}>
              <td data-label="#">{l.lineNo}</td>
              <td data-label={t('item')}>{l.itemCode}</td>
              <td data-label={t('obBatchQty')} className="qty">{l.batchQuantity}</td>
              <td data-label={t('obLedgerQty')} className="qty">{l.ledgerQuantity ?? '—'}</td>
              <td data-label={t('obContraQty')} className="qty">{l.contraQuantity ?? '—'}</td>
              <td data-label={t('status')}>{l.matched ? `✔ ${t('obMatched')}` : `⛔ ${t('obMismatch')}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
