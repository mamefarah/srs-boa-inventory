import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Principal } from './api.ts';
import { t, type MessageKey } from './i18n.ts';
import { ErrorBox, Field, type Item } from './ItemMaster.tsx';

/**
 * M5 requisitions (PRD §23; WORKFLOWS.md §4). The server and database enforce every
 * permission, scope, maker-checker and available-to-promise rule; the flags here only
 * hide controls. No physical stock moves here — deciding may only reserve a commitment.
 */

type Status = 'DRAFT' | 'SUBMITTED' | 'DECIDED' | 'CANCELLED';
type DecisionOutcome = 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | null;

interface Commitment {
  quantityBaseUom: string;
  quantityFulfilled: string;
  status: 'ACTIVE' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';
}
interface Line {
  id: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  baseUomCode: string;
  requestedQuantity: string;
  approvedQuantity: string | null;
  locationCode: string | null;
  notes: string | null;
  commitment: Commitment | null;
}
interface Requisition {
  id: number;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  purpose: string;
  intendedRecipient: string | null;
  sourceEvidenceRef: string | null;
  status: Status;
  rowVersion: number;
  createdByUserId: number;
  createdByName: string | null;
  submittedByUserId: number | null;
  submittedByName: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionOutcome: DecisionOutcome;
  approvalReference: string | null;
  decisionNotes: string | null;
  cancelledAt: string | null;
  lineCount?: number;
  lines?: Line[];
}
interface Warehouse { id: number; code: string; name: string; isActive: boolean }
interface Location { id: number; code: string; name: string; isActive: boolean }

const STATUS: Record<Status, { icon: string; label: MessageKey; help: MessageKey }> = {
  DRAFT: { icon: '✎', label: 'reqStatusDraft', help: 'reqHelpDraft' },
  SUBMITTED: { icon: '⏳', label: 'reqStatusSubmitted', help: 'reqHelpSubmitted' },
  DECIDED: { icon: '✔', label: 'reqStatusDecided', help: 'reqHelpDecided' },
  CANCELLED: { icon: '✖', label: 'reqStatusCancelled', help: 'reqHelpCancelled' },
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
const reqNo = (id: number) => `REQ-${String(id).padStart(6, '0')}`;

export function RequisitionsView({ principal }: { principal: Principal }) {
  const can = { prepare: principal.permissions.includes('PREPARE_REQUISITIONS'), approve: principal.permissions.includes('APPROVE_REQUISITIONS') };
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  if (openId === 'new') return <NewRequisitionForm onDone={(id) => setOpenId(id ?? null)} />;
  if (openId !== null) return <RequisitionDetail id={openId} principal={principal} can={can} onClose={() => setOpenId(null)} />;
  return <RequisitionList canPrepare={can.prepare} onOpen={setOpenId} />;
}

function RequisitionList({ canPrepare, onOpen }: { canPrepare: boolean; onOpen: (id: number | 'new') => void }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Requisition[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    api<{ data: Requisition[] }>(`/requisitions?${params}`)
      .then((r) => {
        setRows(r.data);
        setError(null);
      })
      .catch((e) => setError(asError(e)));
  }, [status]);
  useEffect(load, [load]);

  return (
    <section>
      <p className="hint">{t('reqIntro')}</p>
      <div className="toolbar">
        <select aria-label={t('status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('reqAllStatuses')}</option>
          {(Object.keys(STATUS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {t(STATUS[s].label)}
            </option>
          ))}
        </select>
        {canPrepare && (
          <button type="button" className="btn primary" onClick={() => onOpen('new')}>
            {t('reqNew')}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {rows && rows.length === 0 && <p>{t('empty')}</p>}
      {rows && rows.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th scope="col">{t('reqNumber')}</th>
              <th scope="col">{t('warehouse')}</th>
              <th scope="col">{t('reqPurpose')}</th>
              <th scope="col">{t('status')}</th>
              <th scope="col">{t('obLines')}</th>
              <th scope="col">{t('obPreparedBy')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label={t('reqNumber')}>
                  <button type="button" className="linklike" onClick={() => onOpen(r.id)}>
                    {reqNo(r.id)}
                  </button>
                </td>
                <td data-label={t('warehouse')}>{r.warehouseCode}</td>
                <td data-label={t('reqPurpose')}>{r.purpose}</td>
                <td data-label={t('status')}>
                  <StatusBadge status={r.status} />
                </td>
                <td data-label={t('obLines')}>{r.lineCount ?? 0}</td>
                <td data-label={t('obPreparedBy')}>{r.createdByName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewRequisitionForm({ onDone }: { onDone: (id?: number) => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [f, setF] = useState({ warehouseId: '', purpose: '', intendedRecipient: '', sourceEvidenceRef: '' });
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
      const r = await api<{ data: Requisition }>('/requisitions', {
        method: 'POST',
        body: {
          warehouseId: Number(f.warehouseId),
          purpose: f.purpose,
          intendedRecipient: f.intendedRecipient || undefined,
          sourceEvidenceRef: f.sourceEvidenceRef || undefined,
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
      <h2>{t('reqNew')}</h2>
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
        <Field label="reqPurpose">
          <input required maxLength={500} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
        </Field>
        <Field label="reqIntendedRecipient">
          <input maxLength={300} value={f.intendedRecipient} onChange={(e) => setF({ ...f, intendedRecipient: e.target.value })} />
        </Field>
        <Field label="obSourceEvidence">
          <input maxLength={300} value={f.sourceEvidenceRef} onChange={(e) => setF({ ...f, sourceEvidenceRef: e.target.value })} />
        </Field>
        <p className="hint">{t('reqEvidenceRequiredAtSubmit')}</p>
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

type Can = { prepare: boolean; approve: boolean };

function RequisitionDetail({ id, principal, can, onClose }: { id: number; principal: Principal; can: Can; onClose: () => void }) {
  const [req, setReq] = useState<Requisition | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');

  const load = useCallback(() => {
    api<{ data: Requisition }>(`/requisitions/${id}`)
      .then((r) => {
        setReq(r.data);
        setEvidence(r.data.sourceEvidenceRef ?? '');
        setError(null);
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
      if (err instanceof ApiError && err.code === 'STALE_VERSION') load();
    } finally {
      setBusy(false);
    }
  };

  if (!req) return error ? <ErrorBox error={error} /> : <p role="status">{t('loading')}</p>;
  const draft = req.status === 'DRAFT';
  const isMaker = req.createdByUserId === principal.userId || req.submittedByUserId === principal.userId;
  const call = (action: string, body: object) => act(() => api(`/requisitions/${id}/${action}`, { method: 'POST', body: { rowVersion: req.rowVersion, ...body } }));

  return (
    <section>
      <div className="toolbar">
        <button type="button" className="btn secondary" onClick={onClose}>
          ← {t('obBackToList')}
        </button>
      </div>
      <h2>
        {reqNo(req.id)} · {req.warehouseCode} <StatusBadge status={req.status} />
      </h2>
      <div className={`notice ${req.status === 'DECIDED' ? 'info' : req.status === 'CANCELLED' ? 'danger' : 'warning'}`} role="status">
        <span aria-hidden="true">{STATUS[req.status].icon}</span>
        <div>{t(STATUS[req.status].help)}</div>
      </div>
      <ErrorBox error={error} />

      <dl className="facts">
        <dt>{t('reqPurpose')}</dt>
        <dd>{req.purpose}</dd>
        <dt>{t('reqIntendedRecipient')}</dt>
        <dd>{req.intendedRecipient ?? '—'}</dd>
        <dt>{t('obSourceEvidence')}</dt>
        <dd>{req.sourceEvidenceRef ?? '—'}</dd>
        <dt>{t('obPreparedBy')}</dt>
        <dd>{req.createdByName ?? '—'}</dd>
        <dt>{t('obSubmittedBy')}</dt>
        <dd>{req.submittedByName ? `${req.submittedByName} · ${fmt(req.submittedAt)}` : '—'}</dd>
        <dt>{t('reqDecidedBy')}</dt>
        <dd>{req.decidedByName ? `${req.decidedByName} · ${fmt(req.decidedAt)} · ${req.decisionOutcome} · ${req.approvalReference}` : '—'}</dd>
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
            disabled={busy || evidence === (req.sourceEvidenceRef ?? '')}
            onClick={() => void act(() => api(`/requisitions/${id}`, { method: 'PATCH', body: { rowVersion: req.rowVersion, sourceEvidenceRef: evidence } }))}
          >
            {t('save')}
          </button>
        </div>
      )}

      <h3>{t('obLines')}</h3>
      <LinesTable req={req} editable={draft && can.prepare} busy={busy} onRemove={(lineId) => void act(() => api(`/requisitions/${id}/lines/${lineId}`, { method: 'DELETE' }))} />
      {draft && can.prepare && <AddLineForm req={req} onAdded={load} />}

      {req.status === 'SUBMITTED' && can.approve && <DecideForm req={req} isMaker={isMaker} onDecided={load} />}

      {req.status !== 'DECIDED' && req.status !== 'CANCELLED' && (
        <div className="form">
          <h3>{t('obActions')}</h3>
          <Field label="reason">
            <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="toolbar">
            {draft && can.prepare && (
              <button type="button" className="btn primary" disabled={busy || !req.lines?.length} onClick={() => void call('submit', { reason: reason || undefined })}>
                {t('reqSubmit')}
              </button>
            )}
            {req.status === 'SUBMITTED' && can.approve && (
              <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void call('return', { reason })}>
                {t('reqReturn')}
              </button>
            )}
            {(draft ? can.prepare || can.approve : can.approve) && (
              <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void call('cancel', { reason })}>
                {t('reqCancel')}
              </button>
            )}
          </div>
          <p className="hint">{t('obReasonHint')}</p>
        </div>
      )}
    </section>
  );
}

function LinesTable({ req, editable, busy, onRemove }: { req: Requisition; editable: boolean; busy: boolean; onRemove: (lineId: number) => void }) {
  const lines = req.lines ?? [];
  if (lines.length === 0) return <p>{t('obNoLines')}</p>;
  const decided = req.status === 'DECIDED';
  return (
    <table className="data">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{t('item')}</th>
          <th scope="col">{t('reqRequested')}</th>
          {decided && <th scope="col">{t('reqApproved')}</th>}
          {decided && <th scope="col">{t('reqCommitment')}</th>}
          <th scope="col">{t('location')}</th>
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
            <td data-label={t('reqRequested')}>
              <span className="qty">{l.requestedQuantity}</span> {l.baseUomCode}
            </td>
            {decided && (
              <td data-label={t('reqApproved')}>
                <span className="qty">{l.approvedQuantity ?? '0'}</span> {l.baseUomCode}
              </td>
            )}
            {decided && (
              <td data-label={t('reqCommitment')}>
                {l.commitment ? <span className={`badge status-${l.commitment.status.toLowerCase()}`}>{l.commitment.status}</span> : '—'}
              </td>
            )}
            <td data-label={t('location')}>{l.locationCode ?? '—'}</td>
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

function useLocations(warehouseId: number) {
  const [locations, setLocations] = useState<Location[]>([]);
  useEffect(() => {
    void api<{ data: Location[] }>(`/warehouses/${warehouseId}/locations`)
      .then((r) => setLocations(r.data.filter((l) => l.isActive)))
      .catch(() => setLocations([]));
  }, [warehouseId]);
  return locations;
}

function AddLineForm({ req, onAdded }: { req: Requisition; onAdded: () => void }) {
  const locations = useLocations(req.warehouseId);
  const [itemQuery, setItemQuery] = useState('');
  const [item, setItem] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [matches, setMatches] = useState<Item[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const q = itemQuery.trim();
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
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/requisitions/${req.id}/lines`, {
        method: 'POST',
        body: { itemId: item.id, requestedQuantity: quantity.trim(), warehouseLocationId: locationId ? Number(locationId) : null, notes: notes || null },
      });
      setItem(null);
      setQuantity('');
      setLocationId('');
      setNotes('');
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
          <input aria-label={t('obFindItem')} placeholder={t('obFindItem')} value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} />
          <button type="button" className="btn secondary" onClick={() => void search()}>
            {t('search')}
          </button>
        </div>
        {matches.length > 0 && (
          <Field label="item">
            <select required value={item?.id ?? ''} onChange={(e) => setItem(matches.find((m) => m.id === Number(e.target.value)) ?? null)}>
              <option value="">—</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.itemCode} · {m.name} ({m.baseUomCode})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="reqRequested">
          <input required inputMode="decimal" autoComplete="off" pattern="[0-9]+([.][0-9]{1,6})?" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="location">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('none')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="obSourceLine">
          <input maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </fieldset>
      <button type="submit" className="btn primary" disabled={busy || !item}>
        {t('obAddLine')}
      </button>
    </form>
  );
}

function DecideForm({ req, isMaker, onDecided }: { req: Requisition; isMaker: boolean; onDecided: () => void }) {
  const lines = req.lines ?? [];
  const [quantities, setQuantities] = useState<Record<number, string>>(() => Object.fromEntries(lines.map((l) => [l.id, l.requestedQuantity])));
  const [approvalReference, setApprovalReference] = useState('');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per decision attempt, reused on retry so a lost response can never decide twice.
  const [decideKey, setDecideKey] = useState(() => crypto.randomUUID());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/requisitions/${req.id}/decide`, {
        method: 'POST',
        headers: { 'Idempotency-Key': decideKey },
        body: {
          rowVersion: req.rowVersion,
          lineDecisions: lines.map((l) => ({ lineId: l.id, approvedQuantity: (quantities[l.id] ?? '0').trim() || '0' })),
          approvalReference,
          decisionNotes: decisionNotes || undefined,
        },
      });
      setDecideKey(crypto.randomUUID());
      onDecided();
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <h3>{t('reqDecide')}</h3>
      {isMaker && <p className="notice warning">{t('reqMakerCheckerHint')}</p>}
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        {lines.map((l) => (
          <Field key={l.id} label="reqApproved">
            <div className="toolbar">
              <span>
                {l.itemCode} · {l.itemName} ({t('reqRequested')}: {l.requestedQuantity} {l.baseUomCode})
              </span>
              <input
                inputMode="decimal"
                autoComplete="off"
                pattern="[0-9]+([.][0-9]{1,6})?"
                value={quantities[l.id] ?? ''}
                onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
              />
            </div>
          </Field>
        ))}
        <Field label="obApprovalReference">
          <input maxLength={200} value={approvalReference} onChange={(e) => setApprovalReference(e.target.value)} />
        </Field>
        <Field label="reqDecisionNotes">
          <input maxLength={1000} value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} />
        </Field>
        <p className="hint">{t('obApprovalAuthorityNote')}</p>
      </fieldset>
      <button type="button" className="btn primary" disabled={busy || isMaker || approvalReference.trim().length < 3} onClick={() => void submit()}>
        {t('reqDecide')}
      </button>
    </div>
  );
}
