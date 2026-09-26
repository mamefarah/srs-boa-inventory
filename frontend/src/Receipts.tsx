import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Principal } from './api.ts';
import { ErrorBox, Field, type Item } from './ItemMaster.tsx';
import { t, type MessageKey } from './i18n.ts';

type ReceiptStatus = 'DRAFT' | 'SUBMITTED' | 'ARRIVED' | 'INSPECTED' | 'CANCELLED';
type Body = Record<string, unknown>;

interface Warehouse { id: number; code: string; name: string; isActive: boolean }
interface Location { id: number; code: string; name: string; isActive: boolean }
interface ReceiptLine {
  id: number;
  lineNo: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  baseUomId: number;
  baseUomCode: string;
  quantity: string;
  warehouseLocationId: number | null;
  locationCode: string | null;
  batchRef: string | null;
  expiryDate: string | null;
  serialRef: string | null;
  sourceLineRef: string | null;
  acceptedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  quarantineQuantity: string;
  inspectionNotes: string | null;
}
interface DocumentReference {
  id: number;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  sourceUnit?: string | null;
  preparedByName?: string | null;
  preparedByTitle?: string | null;
  checkedByName?: string | null;
  checkedByTitle?: string | null;
  approvedByName?: string | null;
  approvedByTitle?: string | null;
  recipientName?: string | null;
  recipientTitle?: string | null;
  approvalDate?: string | null;
  physicalFileRef?: string | null;
  remarks?: string | null;
}
interface SupplierReturnSummary {
  id: number;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  reason: string | null;
  transactionId: string | null;
  returnEffectiveAt: string | null;
  rowVersion: number;
}
interface Receipt {
  id: number;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  sourcePartyName: string;
  sourceReference: string | null;
  description: string | null;
  status: ReceiptStatus;
  rowVersion: number;
  createdByName: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  arrivedByName: string | null;
  arrivedAt: string | null;
  arrivalTransactionId: string | null;
  inspectedByName: string | null;
  inspectedAt: string | null;
  inspectionTransactionId: string | null;
  lineCount?: number;
  lines?: ReceiptLine[];
  documents?: DocumentReference[];
  supplierReturns?: SupplierReturnSummary[];
}
interface SupplierReturn {
  id: number;
  receiptId: number;
  warehouseId: number;
  warehouseCode: string;
  warehouseName: string;
  reason: string | null;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  rowVersion: number;
  createdByName: string | null;
  createdAt: string;
  returnEffectiveAt: string | null;
  postedByName: string | null;
  postedAt: string | null;
  transactionId: string | null;
  lines: Array<{
    id: number;
    lineNo: number;
    receiptLineId: number;
    quantity: string;
    notes: string | null;
    itemId: number;
    itemCode: string;
    itemName: string;
    rejectedQuantity: string;
    serialRef: string | null;
    batchRef: string | null;
  }>;
  documents: DocumentReference[];
}

const STATUS: Record<ReceiptStatus, { icon: string; label: MessageKey }> = {
  DRAFT: { icon: '✎', label: 'receiptStatusDraft' },
  SUBMITTED: { icon: '⏳', label: 'receiptStatusSubmitted' },
  ARRIVED: { icon: '📦', label: 'receiptStatusArrived' },
  INSPECTED: { icon: '✔', label: 'receiptStatusInspected' },
  CANCELLED: { icon: '✖', label: 'receiptStatusCancelled' },
};

const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(0, 'NETWORK', String(e)));
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const receiptNo = (id: number) => `RCV-${String(id).padStart(6, '0')}`;

type Can = { prepare: boolean; receive: boolean; inspect: boolean; returnRejected: boolean };

export function ReceiptsView({ principal }: { principal: Principal }) {
  const can: Can = {
    prepare: principal.permissions.includes('PREPARE_RECEIPTS'),
    receive: principal.permissions.includes('RECEIVE_RECEIPTS'),
    inspect: principal.permissions.includes('INSPECT_RECEIPTS'),
    returnRejected: principal.permissions.includes('RETURN_REJECTED_STOCK'),
  };
  const [open, setOpen] = useState<{ type: 'new' | 'receipt' | 'return'; id?: number } | null>(null);

  if (open?.type === 'new') return <NewReceipt onDone={(id) => setOpen(id ? { type: 'receipt', id } : null)} />;
  if (open?.type === 'receipt' && open.id) {
    return <ReceiptDetail id={open.id} can={can} onClose={() => setOpen(null)} onOpenReturn={(id) => setOpen({ type: 'return', id })} />;
  }
  if (open?.type === 'return' && open.id) {
    return <SupplierReturnDetail id={open.id} can={can} onClose={() => setOpen(null)} />;
  }
  return <ReceiptList canPrepare={can.prepare} onOpen={(id) => setOpen({ type: 'receipt', id })} onNew={() => setOpen({ type: 'new' })} />;
}

function StatusBadge({ status }: { status: ReceiptStatus }) {
  return <span className={`badge status-${status.toLowerCase()}`}><span aria-hidden="true">{STATUS[status].icon}</span> {t(STATUS[status].label)}</span>;
}

function ReceiptList({ canPrepare, onOpen, onNew }: { canPrepare: boolean; onOpen: (id: number) => void; onNew: () => void }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(() => {
    const q = new URLSearchParams({ limit: '100' });
    if (status) q.set('status', status);
    api<{ data: Receipt[] }>(`/receipts?${q}`).then((r) => { setRows(r.data); setError(null); }).catch((e) => setError(asError(e)));
  }, [status]);
  useEffect(load, [load]);

  return (
    <section>
      <p className="hint">{t('receiptIntro')}</p>
      <div className="toolbar">
        <select aria-label={t('status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('receiptAllStatuses')}</option>
          {Object.entries(STATUS).map(([code, v]) => <option key={code} value={code}>{t(v.label)}</option>)}
        </select>
        {canPrepare && <button type="button" className="btn primary" onClick={onNew}>{t('receiptNew')}</button>}
      </div>
      <ErrorBox error={error} />
      {rows?.length === 0 && <p>{t('empty')}</p>}
      {!!rows?.length && (
        <table className="data">
          <thead><tr><th>{t('receipt')}</th><th>{t('warehouse')}</th><th>{t('receiptSupplier')}</th><th>{t('status')}</th><th>{t('receiptLines')}</th><th>{t('receiptCreatedBy')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label={t('receipt')}><button type="button" className="linklike" onClick={() => onOpen(r.id)}>{receiptNo(r.id)}</button></td>
                <td data-label={t('warehouse')}>{r.warehouseCode}</td>
                <td data-label={t('receiptSupplier')}>{r.sourcePartyName}</td>
                <td data-label={t('status')}><StatusBadge status={r.status} /></td>
                <td data-label={t('receiptLines')}>{r.lineCount ?? 0}</td>
                <td data-label={t('receiptCreatedBy')}>{r.createdByName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewReceipt({ onDone }: { onDone: (id?: number) => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [f, setF] = useState({ warehouseId: '', sourcePartyName: '', sourceReference: '', description: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ data: Warehouse[] }>('/warehouses').then((r) => setWarehouses(r.data.filter((w) => w.isActive))).catch((e) => setError(asError(e)));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ data: Receipt }>('/receipts', { method: 'POST', body: {
        warehouseId: Number(f.warehouseId), sourcePartyName: f.sourcePartyName, sourceReference: f.sourceReference || null, description: f.description || null,
      }});
      onDone(r.data.id);
    } catch (err) { setError(asError(err)); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h2>{t('receiptNew')}</h2>
      <p className="hint">{t('receiptDraftHint')}</p>
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        <Field label="warehouse"><select required value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">—</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>
        <Field label="receiptSupplier"><input required maxLength={300} value={f.sourcePartyName} onChange={(e) => setF({ ...f, sourcePartyName: e.target.value })} /></Field>
        <Field label="receiptSourceRef"><input maxLength={300} value={f.sourceReference} onChange={(e) => setF({ ...f, sourceReference: e.target.value })} /></Field>
        <Field label="description"><textarea maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </fieldset>
      <div className="toolbar"><button className="btn primary" type="submit" disabled={busy}>{t('save')}</button><button className="btn secondary" type="button" onClick={() => onDone()}>{t('cancel')}</button></div>
    </form>
  );
}

function ReceiptDetail({ id, can, onClose, onOpenReturn }: { id: number; can: Can; onClose: () => void; onOpenReturn: (id: number) => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [arrivalKey, setArrivalKey] = useState(() => crypto.randomUUID());
  const [inspectKey, setInspectKey] = useState(() => crypto.randomUUID());

  const load = useCallback(() => {
    api<{ data: Receipt }>(`/receipts/${id}`).then((r) => { setReceipt(r.data); setError(null); }).catch((e) => setError(asError(e)));
  }, [id]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); load(); } catch (e) { setError(asError(e)); } finally { setBusy(false); }
  };
  if (!receipt) return <section><button type="button" className="btn secondary" onClick={onClose}>{t('receiptBack')}</button><ErrorBox error={error} /><p role="status">{t('loading')}</p></section>;

  const call = (action: string, body: Body) => act(() => api(`/receipts/${id}/${action}`, { method: 'POST', body: { rowVersion: receipt.rowVersion, ...body } }));
  const lines = receipt.lines ?? [];
  const documents = receipt.documents ?? [];

  return (
    <section>
      <div className="toolbar"><button type="button" className="btn secondary" onClick={onClose}>{t('receiptBack')}</button><h2>{receiptNo(receipt.id)}</h2><StatusBadge status={receipt.status} /></div>
      <ErrorBox error={error} />
      <dl className="facts">
        <dt>{t('warehouse')}</dt><dd>{receipt.warehouseCode} · {receipt.warehouseName}</dd>
        <dt>{t('receiptSupplier')}</dt><dd>{receipt.sourcePartyName}</dd>
        <dt>{t('receiptSourceRef')}</dt><dd>{receipt.sourceReference ?? '—'}</dd>
        <dt>{t('receiptCreatedBy')}</dt><dd>{receipt.createdByName ?? '—'}</dd>
        <dt>{t('receiptArrival')}</dt><dd>{receipt.arrivedByName ?? '—'} · {fmt(receipt.arrivedAt)} · {receipt.arrivalTransactionId ?? '—'}</dd>
        <dt>{t('receiptInspection')}</dt><dd>{receipt.inspectedByName ?? '—'} · {fmt(receipt.inspectedAt)} · {receipt.inspectionTransactionId ?? '—'}</dd>
      </dl>

      <h3>{t('receiptDocuments')}</h3>
      <DocumentTable documents={documents} />
      {receipt.status !== 'CANCELLED' && (can.prepare || can.receive || can.inspect) && <DocumentForm path={`/receipts/${id}/documents`} onAdded={load} />}

      <h3>{t('receiptLines')}</h3>
      <ReceiptLinesTable receipt={receipt} canPrepare={can.prepare} busy={busy} onChanged={load} />
      {receipt.status === 'DRAFT' && can.prepare && <AddReceiptLine receipt={receipt} onAdded={load} />}

      {receipt.status === 'ARRIVED' && can.inspect && (
        <>
          <h3>{t('receiptInspection')}</h3>
          <p className="hint">{t('receiptInspectionHint')}</p>
          {lines.map((line) => <InspectionLine key={line.id} receipt={receipt} line={line} onSaved={load} />)}
        </>
      )}

      <div className="form">
        <h3>{t('receiptActions')}</h3>
        {(receipt.status === 'DRAFT' || receipt.status === 'SUBMITTED') && (
          <Field label="reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        )}
        <div className="toolbar">
          {receipt.status === 'DRAFT' && can.prepare && <button type="button" className="btn primary" disabled={busy || lines.length === 0} onClick={() => void call('submit', {})}>{t('receiptSubmit')}</button>}
          {receipt.status === 'SUBMITTED' && can.receive && <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void call('return', { reason })}>{t('receiptReturnDraft')}</button>}
          {(receipt.status === 'DRAFT' || receipt.status === 'SUBMITTED') && can.prepare && <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void call('cancel', { reason })}>{t('receiptCancel')}</button>}
          {receipt.status === 'SUBMITTED' && can.receive && (
            <button type="button" className="btn primary" disabled={busy || documents.length === 0} onClick={() => {
              if (!window.confirm(t('receiptArriveConfirm'))) return;
              void act(async () => {
                await api(`/receipts/${id}/arrive`, { method: 'POST', body: { rowVersion: receipt.rowVersion, effectiveAt: new Date().toISOString() }, headers: { 'Idempotency-Key': arrivalKey } });
                setArrivalKey(crypto.randomUUID());
              });
            }}>{t('receiptRecordArrival')}</button>
          )}
          {receipt.status === 'ARRIVED' && can.inspect && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => {
              if (!window.confirm(t('receiptInspectConfirm'))) return;
              void act(async () => {
                await api(`/receipts/${id}/inspect`, { method: 'POST', body: { rowVersion: receipt.rowVersion, effectiveAt: new Date().toISOString() }, headers: { 'Idempotency-Key': inspectKey } });
                setInspectKey(crypto.randomUUID());
              });
            }}>{t('receiptPostInspection')}</button>
          )}
        </div>
      </div>

      {receipt.status === 'INSPECTED' && (
        <section>
          <h3>{t('supplierReturns')}</h3>
          {can.returnRejected && <button type="button" className="btn primary" disabled={busy} onClick={() => void act(async () => {
            const r = await api<{ data: SupplierReturn }>('/supplier-returns', { method: 'POST', body: { receiptId: id, reason: 'Rejected stock return' } });
            onOpenReturn(r.data.id);
          })}>{t('supplierReturnNew')}</button>}
          {!!receipt.supplierReturns?.length && (
            <table className="data"><thead><tr><th>{t('supplierReturn')}</th><th>{t('status')}</th><th>{t('reason')}</th></tr></thead>
              <tbody>{receipt.supplierReturns.map((r) => <tr key={r.id}><td data-label={t('supplierReturn')}><button type="button" className="linklike" onClick={() => onOpenReturn(r.id)}>RET-{String(r.id).padStart(6, '0')}</button></td><td data-label={t('status')}>{r.status}</td><td data-label={t('reason')}>{r.reason ?? '—'}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      )}
    </section>
  );
}

function DocumentTable({ documents }: { documents: DocumentReference[] }) {
  if (!documents.length) return <p>{t('receiptNoDocuments')}</p>;
  return (
    <table className="data"><thead><tr><th>{t('receiptDocumentType')}</th><th>{t('receiptDocumentNo')}</th><th>{t('receiptDocumentDate')}</th><th>{t('receiptPaperApprover')}</th><th>{t('receiptPhysicalFile')}</th></tr></thead>
      <tbody>{documents.map((d) => <tr key={d.id}><td data-label={t('receiptDocumentType')}>{d.documentType}</td><td data-label={t('receiptDocumentNo')}>{d.documentNumber}</td><td data-label={t('receiptDocumentDate')}>{d.documentDate}</td><td data-label={t('receiptPaperApprover')}>{[d.approvedByName, d.approvedByTitle].filter(Boolean).join(' · ') || '—'}</td><td data-label={t('receiptPhysicalFile')}>{d.physicalFileRef ?? '—'}</td></tr>)}</tbody>
    </table>
  );
}

function DocumentForm({ path, onAdded }: { path: string; onAdded: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ documentType: 'MODEL_19_GRN', documentNumber: '', documentDate: today, approvedByName: '', approvedByTitle: '', physicalFileRef: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api(path, { method: 'POST', body: {
        documentType: f.documentType, documentNumber: f.documentNumber, documentDate: f.documentDate,
        approvedByName: f.approvedByName || null, approvedByTitle: f.approvedByTitle || null, physicalFileRef: f.physicalFileRef || null,
      }});
      setF({ ...f, documentNumber: '', approvedByName: '', approvedByTitle: '', physicalFileRef: '' }); onAdded();
    } catch (e) { setError(asError(e)); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h4>{t('receiptAddDocument')}</h4><p className="hint">{t('receiptPaperHint')}</p><ErrorBox error={error} />
      <fieldset disabled={busy}>
        <Field label="receiptDocumentType"><select value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value })}>
          <option value="MODEL_19_GRN">Model 19 / GRN</option><option value="STORES_RECEIPT_VOUCHER">Stores Receipt Voucher</option><option value="DELIVERY_NOTE">Delivery note</option><option value="INVOICE">Invoice</option><option value="PO_CONTRACT">PO / Contract</option><option value="INSPECTION_CERTIFICATE">Inspection certificate</option><option value="SUPPLIER_RETURN">Supplier return</option><option value="OTHER">Other</option>
        </select></Field>
        <Field label="receiptDocumentNo"><input required maxLength={200} value={f.documentNumber} onChange={(e) => setF({ ...f, documentNumber: e.target.value })} /></Field>
        <Field label="receiptDocumentDate"><input required type="date" value={f.documentDate} onChange={(e) => setF({ ...f, documentDate: e.target.value })} /></Field>
        <Field label="receiptPaperApprover"><input maxLength={200} value={f.approvedByName} onChange={(e) => setF({ ...f, approvedByName: e.target.value })} /></Field>
        <Field label="receiptPaperApproverTitle"><input maxLength={200} value={f.approvedByTitle} onChange={(e) => setF({ ...f, approvedByTitle: e.target.value })} /></Field>
        <Field label="receiptPhysicalFile"><input maxLength={300} value={f.physicalFileRef} onChange={(e) => setF({ ...f, physicalFileRef: e.target.value })} /></Field>
      </fieldset>
      <button className="btn secondary" type="submit" disabled={busy}>{t('receiptAddDocument')}</button>
    </form>
  );
}

function ReceiptLinesTable({ receipt, canPrepare, busy, onChanged }: { receipt: Receipt; canPrepare: boolean; busy: boolean; onChanged: () => void }) {
  const lines = receipt.lines ?? [];
  if (!lines.length) return <p>{t('receiptNoLines')}</p>;
  return (
    <table className="data"><thead><tr><th>#</th><th>{t('item')}</th><th>{t('quantity')}</th><th>{t('location')}</th><th>{t('receiptTracking')}</th><th>{t('receiptInspectionOutcome')}</th>{receipt.status === 'DRAFT' && canPrepare && <th>{t('action')}</th>}</tr></thead>
      <tbody>{lines.map((l) => <tr key={l.id}>
        <td data-label="#">{l.lineNo}</td><td data-label={t('item')}>{l.itemCode} · {l.itemName}</td><td data-label={t('quantity')}><span className="qty">{l.quantity}</span> {l.baseUomCode}</td><td data-label={t('location')}>{l.locationCode ?? '—'}</td><td data-label={t('receiptTracking')}>{[l.batchRef,l.expiryDate,l.serialRef].filter(Boolean).join(' · ') || '—'}</td><td data-label={t('receiptInspectionOutcome')}>{`A ${l.acceptedQuantity} · R ${l.rejectedQuantity} · D ${l.damagedQuantity} · Q ${l.quarantineQuantity}`}</td>
        {receipt.status === 'DRAFT' && canPrepare && <td data-label={t('action')}><button type="button" className="btn secondary" disabled={busy} onClick={() => void api(`/receipts/${receipt.id}/lines/${l.id}`, { method: 'DELETE' }).then(onChanged)}>{t('obRemove')}</button></td>}
      </tr>)}</tbody>
    </table>
  );
}

function AddReceiptLine({ receipt, onAdded }: { receipt: Receipt; onAdded: () => void }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Item[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [f, setF] = useState({ quantity: '', locationId: '', batchRef: '', expiryDate: '', serialRef: '', sourceLineRef: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ data: Location[] }>(`/warehouses/${receipt.warehouseId}/locations`).then((r) => setLocations(r.data.filter((l) => l.isActive))).catch((e) => setError(asError(e))); }, [receipt.warehouseId]);
  const search = async () => {
    try { const r = await api<{ data: Item[] }>(`/items?${new URLSearchParams({ q: q.trim(), active: 'true', limit: '10' })}`); setMatches(r.data); } catch (e) { setError(asError(e)); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!item) return; setBusy(true); setError(null);
    try {
      await api(`/receipts/${receipt.id}/lines`, { method: 'POST', body: {
        itemId: item.id, quantity: f.quantity.trim(), warehouseLocationId: f.locationId ? Number(f.locationId) : null,
        batchRef: f.batchRef || null, expiryDate: f.expiryDate || null, serialRef: f.serialRef || null, sourceLineRef: f.sourceLineRef || null,
      }});
      setQ(''); setMatches([]); setItem(null); setF({ quantity:'',locationId:'',batchRef:'',expiryDate:'',serialRef:'',sourceLineRef:'' }); onAdded();
    } catch (e) { setError(asError(e)); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h4>{t('receiptAddLine')}</h4><ErrorBox error={error} />
      {!item ? <>
        <div className="toolbar"><input aria-label={t('obFindItem')} value={q} onChange={(e) => setQ(e.target.value)} /><button type="button" className="btn secondary" disabled={!q.trim()} onClick={() => void search()}>{t('search')}</button></div>
        {!!matches.length && <table className="data"><tbody>{matches.map((m) => <tr key={m.id}><td>{m.itemCode} · {m.name}</td><td>{m.baseUomCode}</td><td><button type="button" className="btn secondary" onClick={() => setItem(m)}>{t('receiptSelect')}</button></td></tr>)}</tbody></table>}
      </> : <>
        <p><strong>{item.itemCode} · {item.name}</strong> — {item.baseUomCode}</p>
        <fieldset disabled={busy}>
          <Field label="quantity"><input required inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="location"><select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></Field>
          {item.isBatchTracked && <Field label="obBatchRef"><input required value={f.batchRef} onChange={(e) => setF({ ...f, batchRef: e.target.value })} /></Field>}
          {item.isExpiryTracked && <Field label="obExpiryDate"><input required type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></Field>}
          {item.isSerialTracked && <Field label="obSerialRef"><input required value={f.serialRef} onChange={(e) => setF({ ...f, serialRef: e.target.value })} /></Field>}
          <Field label="obSourceLine"><input value={f.sourceLineRef} onChange={(e) => setF({ ...f, sourceLineRef: e.target.value })} /></Field>
        </fieldset>
        <div className="toolbar"><button type="submit" className="btn primary" disabled={busy}>{t('receiptAddLine')}</button><button type="button" className="btn secondary" onClick={() => setItem(null)}>{t('cancel')}</button></div>
      </>}
    </form>
  );
}

function InspectionLine({ receipt, line, onSaved }: { receipt: Receipt; line: ReceiptLine; onSaved: () => void }) {
  const [f, setF] = useState({ accepted: line.acceptedQuantity, rejected: line.rejectedQuantity, damaged: line.damagedQuantity, quarantine: line.quarantineQuantity, notes: line.inspectionNotes ?? '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api(`/receipts/${receipt.id}/lines/${line.id}/inspection`, { method: 'PATCH', body: {
        rowVersion: receipt.rowVersion, acceptedQuantity: f.accepted, rejectedQuantity: f.rejected, damagedQuantity: f.damaged, quarantineQuantity: f.quarantine, inspectionNotes: f.notes || null,
      }});
      onSaved();
    } catch (e) { setError(asError(e)); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <strong>{line.itemCode} · {line.itemName}</strong> — {line.quantity} {line.baseUomCode}
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        <Field label="receiptAccepted"><input required inputMode="decimal" value={f.accepted} onChange={(e) => setF({ ...f, accepted: e.target.value })} /></Field>
        <Field label="receiptRejected"><input required inputMode="decimal" value={f.rejected} onChange={(e) => setF({ ...f, rejected: e.target.value })} /></Field>
        <Field label="receiptDamaged"><input required inputMode="decimal" value={f.damaged} onChange={(e) => setF({ ...f, damaged: e.target.value })} /></Field>
        <Field label="receiptQuarantine"><input required inputMode="decimal" value={f.quarantine} onChange={(e) => setF({ ...f, quarantine: e.target.value })} /></Field>
        <Field label="receiptInspectionNotes"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </fieldset>
      <button className="btn secondary" type="submit" disabled={busy}>{t('save')}</button>
    </form>
  );
}

function SupplierReturnDetail({ id, can, onClose }: { id: number; can: Can; onClose: () => void }) {
  const [ret, setRet] = useState<SupplierReturn | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [postKey, setPostKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api<{ data: SupplierReturn }>(`/supplier-returns/${id}`);
      setRet(r.data);
      const source = await api<{ data: Receipt }>(`/receipts/${r.data.receiptId}`);
      setReceipt(source.data); setError(null);
    } catch (e) { setError(asError(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); await load(); } catch (e) { setError(asError(e)); } finally { setBusy(false); } };
  if (!ret || !receipt) return <section><button type="button" className="btn secondary" onClick={onClose}>{t('receiptBack')}</button><ErrorBox error={error} /><p>{t('loading')}</p></section>;

  return (
    <section>
      <div className="toolbar"><button type="button" className="btn secondary" onClick={onClose}>{t('receiptBack')}</button><h2>RET-{String(ret.id).padStart(6,'0')}</h2><span className="badge">{ret.status}</span></div>
      <ErrorBox error={error} />
      <dl className="facts"><dt>{t('receipt')}</dt><dd>{receiptNo(receipt.id)}</dd><dt>{t('warehouse')}</dt><dd>{ret.warehouseCode} · {ret.warehouseName}</dd><dt>{t('reason')}</dt><dd>{ret.reason ?? '—'}</dd><dt>{t('receiptSupplier')}</dt><dd>{receipt.sourcePartyName}</dd></dl>

      <h3>{t('receiptDocuments')}</h3><DocumentTable documents={ret.documents ?? []} />
      {ret.status === 'DRAFT' && can.returnRejected && <DocumentForm path={`/supplier-returns/${id}/documents`} onAdded={() => void load()} />}

      <h3>{t('supplierReturnLines')}</h3>
      {!ret.lines.length ? <p>{t('receiptNoLines')}</p> : <table className="data"><thead><tr><th>{t('item')}</th><th>{t('quantity')}</th><th>{t('receiptRejected')}</th></tr></thead><tbody>{ret.lines.map((l) => <tr key={l.id}><td>{l.itemCode} · {l.itemName}</td><td>{l.quantity}</td><td>{l.rejectedQuantity}</td></tr>)}</tbody></table>}
      {ret.status === 'DRAFT' && can.returnRejected && <SupplierReturnLineForm id={id} receipt={receipt} onAdded={() => void load()} />}

      {ret.status === 'DRAFT' && can.returnRejected && <div className="form">
        <Field label="reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy || !ret.lines.length || !ret.documents.length} onClick={() => {
            if (!window.confirm(t('supplierReturnPostConfirm'))) return;
            void act(async () => {
              await api(`/supplier-returns/${id}/post`, { method:'POST', body:{ rowVersion: ret.rowVersion, effectiveAt: new Date().toISOString() }, headers:{ 'Idempotency-Key': postKey } });
              setPostKey(crypto.randomUUID());
            });
          }}>{t('supplierReturnPost')}</button>
          <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void act(() => api(`/supplier-returns/${id}/cancel`, { method:'POST', body:{ rowVersion: ret.rowVersion, reason } }))}>{t('receiptCancel')}</button>
        </div>
      </div>}
    </section>
  );
}

function SupplierReturnLineForm({ id, receipt, onAdded }: { id: number; receipt: Receipt; onAdded: () => void }) {
  const eligible = (receipt.lines ?? []).filter((l) => Number(l.rejectedQuantity) > 0);
  const [receiptLineId, setReceiptLineId] = useState(eligible[0]?.id ? String(eligible[0].id) : '');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api(`/supplier-returns/${id}/lines`, { method:'POST', body:{ receiptLineId:Number(receiptLineId), quantity } });
      setQuantity(''); onAdded();
    } catch(e) { setError(asError(e)); } finally { setBusy(false); }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h4>{t('supplierReturnAddLine')}</h4><ErrorBox error={error} />
      <Field label="item"><select required value={receiptLineId} onChange={(e) => setReceiptLineId(e.target.value)}><option value="">—</option>{eligible.map((l) => <option key={l.id} value={l.id}>{l.itemCode} · {l.itemName} — {t('receiptRejected')} {l.rejectedQuantity}</option>)}</select></Field>
      <Field label="quantity"><input required inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
      <button className="btn secondary" type="submit" disabled={busy || !receiptLineId}>{t('supplierReturnAddLine')}</button>
    </form>
  );
}
