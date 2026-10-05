import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type Principal } from './api.ts';
import { t, type MessageKey } from './i18n.ts';
import { scaled, unscaled } from './decimal.ts';
import { ErrorBox, Field } from './ItemMaster.tsx';

/**
 * M6 goods issue + custody handoff (PRD §24; ADR-0016). The server and database enforce every
 * permission, scope, available-to-promise and commitment rule; the flags here only hide controls.
 * A DRAFT issue moves no stock. Only a server-confirmed post is shown as posted (UX_PATTERNS §10).
 */

type Status = 'DRAFT' | 'POSTED' | 'CANCELLED';
type Scope = 'EXTERNAL' | 'INTERNAL_CUSTODY';

interface IssueLine {
  id: number;
  lineNo: number;
  requisitionLineId: number;
  itemCode: string;
  itemName: string;
  baseUomCode: string;
  quantity: string;
  locationCode: string | null;
  batchRef: string | null;
}
interface IssueDoc {
  id: number;
  documentType: 'ISSUE_VOUCHER' | 'RECIPIENT_ACKNOWLEDGEMENT';
  documentNumber: string;
  documentDate: string;
  recipientName: string | null;
  physicalFileRef: string | null;
}
interface Issue {
  id: number;
  warehouseCode: string;
  requisitionId: number;
  requisitionPurpose: string;
  destinationScope: Scope;
  custodianName: string | null;
  recipientName: string;
  recipientUnit: string | null;
  handoverLocation: string | null;
  reason: string | null;
  status: Status;
  rowVersion: number;
  createdByName: string | null;
  postedByName: string | null;
  postedAt: string | null;
  transactionId: string | null;
  cancelReason: string | null;
  lineCount?: number;
  lines?: IssueLine[];
  documents?: IssueDoc[];
}
interface ReqLine {
  id: number;
  lineNo: number;
  itemCode: string;
  itemName: string;
  baseUomCode: string;
  approvedQuantity: string | null;
  commitment: { quantityBaseUom: string; quantityFulfilled: string; status: string } | null;
}
interface Req {
  id: number;
  warehouseCode: string;
  purpose: string;
  lines?: ReqLine[];
}
interface Custodian { id: number; custodianType: string; displayName: string }

const STATUS: Record<Status, { icon: string; label: MessageKey; help: MessageKey }> = {
  DRAFT: { icon: '✎', label: 'issStatusDraft', help: 'issHelpDraft' },
  POSTED: { icon: '✔', label: 'issStatusPosted', help: 'issHelpPosted' },
  CANCELLED: { icon: '✖', label: 'issStatusCancelled', help: 'issHelpCancelled' },
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
const issNo = (id: number) => `ISS-${String(id).padStart(6, '0')}`;
const today = () => new Date().toISOString().slice(0, 10);
const QTY_RE = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/;

/** Quantity still available to hand over on a decided line: the open reservation, else the approved quantity. */
export function remainingToIssue(l: ReqLine): string {
  const c = l.commitment;
  if (c) return unscaled(scaled(c.quantityBaseUom) - scaled(c.quantityFulfilled));
  return l.approvedQuantity ?? '0';
}

export function IssuesView({ principal }: { principal: Principal }) {
  const can = { prepare: principal.permissions.includes('PREPARE_ISSUES'), post: principal.permissions.includes('POST_ISSUES') };
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  if (openId === 'new') return <NewIssueForm onDone={(id) => setOpenId(id ?? null)} />;
  if (openId !== null) return <IssueDetail id={openId} can={can} onClose={() => setOpenId(null)} />;
  return <IssueList canPrepare={can.prepare} onOpen={setOpenId} />;
}

function IssueList({ canPrepare, onOpen }: { canPrepare: boolean; onOpen: (id: number | 'new') => void }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Issue[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('status', status);
    api<{ data: Issue[] }>(`/issues?${params}`)
      .then((r) => {
        setRows(r.data);
        setError(null);
      })
      .catch((e) => setError(asError(e)));
  }, [status]);
  useEffect(load, [load]);

  return (
    <section>
      <p className="hint">{t('issIntro')}</p>
      <div className="toolbar">
        <select aria-label={t('status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('issAllStatuses')}</option>
          {(Object.keys(STATUS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {t(STATUS[s].label)}
            </option>
          ))}
        </select>
        {canPrepare && (
          <button type="button" className="btn primary" onClick={() => onOpen('new')}>
            {t('issNew')}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {rows && rows.length === 0 && <p>{t('empty')}</p>}
      {rows && rows.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th scope="col">{t('issNumber')}</th>
              <th scope="col">{t('warehouse')}</th>
              <th scope="col">{t('issRecipient')}</th>
              <th scope="col">{t('status')}</th>
              <th scope="col">{t('obLines')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label={t('issNumber')}>
                  <button type="button" className="linklike" onClick={() => onOpen(r.id)}>
                    {issNo(r.id)}
                  </button>
                </td>
                <td data-label={t('warehouse')}>{r.warehouseCode}</td>
                <td data-label={t('issRecipient')}>{r.recipientName}</td>
                <td data-label={t('status')}>
                  <StatusBadge status={r.status} />
                </td>
                <td data-label={t('obLines')}>{r.lineCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewIssueForm({ onDone }: { onDone: (id?: number) => void }) {
  const [reqs, setReqs] = useState<Array<{ id: number; warehouseCode: string; purpose: string }>>([]);
  const [custodians, setCustodians] = useState<Custodian[]>([]);
  const [req, setReq] = useState<Req | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [f, setF] = useState({ scope: 'EXTERNAL' as Scope, custodianId: '', recipientName: '', recipientUnit: '', handoverLocation: '', reason: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // One reference per form so a lost response and a retry can never create two drafts.
  const [clientRef] = useState(() => `web-${crypto.randomUUID()}`);

  useEffect(() => {
    api<{ data: Array<{ id: number; warehouseCode: string; purpose: string }> }>('/requisitions?status=DECIDED&limit=100')
      .then((r) => setReqs(r.data))
      .catch((e) => setError(asError(e)));
    api<{ data: Custodian[] }>('/issues/custodians')
      .then((r) => setCustodians(r.data))
      .catch(() => setCustodians([]));
  }, []);

  const pick = async (id: number) => {
    setError(null);
    if (!id) return setReq(null);
    try {
      const r = await api<{ data: Req }>(`/requisitions/${id}`);
      setReq(r.data);
      setQty(Object.fromEntries((r.data.lines ?? []).map((l) => [l.id, remainingToIssue(l)])));
    } catch (e) {
      setError(asError(e));
    }
  };

  const open = (req?.lines ?? []).filter((l) => scaled(remainingToIssue(l)) > 0n);
  const chosen = open.filter((l) => (qty[l.id] ?? '').trim() !== '' && (qty[l.id] ?? '').trim() !== '0');
  const badQty = chosen.some((l) => !QTY_RE.test(qty[l.id]!.trim()) || scaled(qty[l.id]!.trim()) > scaled(remainingToIssue(l)));
  const valid = !!req && chosen.length > 0 && !badQty && f.recipientName.trim().length > 0 && (f.scope === 'EXTERNAL' || f.custodianId !== '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ data: Issue }>('/issues', {
        method: 'POST',
        body: {
          requisitionId: req.id,
          destinationScope: f.scope,
          custodianId: f.scope === 'INTERNAL_CUSTODY' ? Number(f.custodianId) : null,
          recipientName: f.recipientName,
          recipientUnit: f.recipientUnit || null,
          handoverLocation: f.handoverLocation || null,
          reason: f.reason || null,
          clientRef,
          lines: chosen.map((l) => ({ requisitionLineId: l.id, quantity: qty[l.id]!.trim() })),
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
      <h2>{t('issNew')}</h2>
      <p className="hint">{t('issNoStockEffectDraft')}</p>
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        <Field label="issRequisition">
          <select required value={req?.id ?? ''} onChange={(e) => void pick(Number(e.target.value))}>
            <option value="">—</option>
            {reqs.map((r) => (
              <option key={r.id} value={r.id}>
                REQ-{String(r.id).padStart(6, '0')} · {r.warehouseCode} · {r.purpose}
              </option>
            ))}
          </select>
        </Field>
        {req && open.length === 0 && <p className="notice warning">{t('issNothingToIssue')}</p>}
        {open.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th scope="col">{t('item')}</th>
                <th scope="col">{t('reqApproved')}</th>
                <th scope="col">{t('issRemaining')}</th>
                <th scope="col">{t('issQuantityNow')}</th>
              </tr>
            </thead>
            <tbody>
              {open.map((l) => (
                <tr key={l.id}>
                  <td data-label={t('item')}>
                    {l.itemCode} · {l.itemName}
                  </td>
                  <td data-label={t('reqApproved')}>
                    <span className="qty">{l.approvedQuantity ?? '0'}</span> {l.baseUomCode}
                  </td>
                  <td data-label={t('issRemaining')}>
                    <span className="qty">{remainingToIssue(l)}</span> {l.baseUomCode}
                  </td>
                  <td data-label={t('issQuantityNow')}>
                    <input
                      aria-label={`${t('issQuantityNow')} ${l.itemCode}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={qty[l.id] ?? ''}
                      onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {badQty && <p className="notice danger">{t('issQuantityInvalid')}</p>}
        <Field label="issDestination">
          <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as Scope })}>
            <option value="EXTERNAL">{t('issScopeExternal')}</option>
            <option value="INTERNAL_CUSTODY">{t('issScopeInternal')}</option>
          </select>
        </Field>
        {f.scope === 'INTERNAL_CUSTODY' && (
          <Field label="issCustodian">
            <select required value={f.custodianId} onChange={(e) => setF({ ...f, custodianId: e.target.value })}>
              <option value="">—</option>
              {custodians.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} ({c.custodianType})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="issRecipient">
          <input required maxLength={200} value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} />
        </Field>
        <Field label="issRecipientUnit">
          <input maxLength={200} value={f.recipientUnit} onChange={(e) => setF({ ...f, recipientUnit: e.target.value })} />
        </Field>
        <Field label="issHandoverLocation">
          <input maxLength={200} value={f.handoverLocation} onChange={(e) => setF({ ...f, handoverLocation: e.target.value })} />
        </Field>
        <Field label="reason">
          <input maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
        <p className="hint">{t('issVoucherRequiredAtPost')}</p>
      </fieldset>
      <div className="toolbar">
        <button type="submit" className="btn primary" disabled={busy || !valid}>
          {t('save')}
        </button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function IssueDetail({ id, can, onClose }: { id: number; can: { prepare: boolean; post: boolean }; onClose: () => void }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  // Reused across retries of the same post attempt; a new key only after the server answered (UX_PATTERNS §10).
  const [postKey, setPostKey] = useState(() => crypto.randomUUID());

  const load = useCallback(() => {
    api<{ data: Issue }>(`/issues/${id}`)
      .then((r) => {
        setIssue(r.data);
        setError(null);
      })
      .catch((e) => setError(asError(e)));
  }, [id]);
  useEffect(load, [load]);

  if (!issue) return error ? <ErrorBox error={error} /> : <p role="status">{t('loading')}</p>;
  const draft = issue.status === 'DRAFT';
  const docs = issue.documents ?? [];
  const hasVoucher = docs.some((d) => d.documentType === 'ISSUE_VOUCHER');
  const ack = docs.filter((d) => d.documentType === 'RECIPIENT_ACKNOWLEDGEMENT');

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/issues/${id}/post`, { method: 'POST', headers: { 'Idempotency-Key': postKey }, body: { rowVersion: issue.rowVersion } });
      setPostKey(crypto.randomUUID());
      setConfirming(false);
      load();
    } catch (err) {
      const e = asError(err);
      setError(e);
      // A network failure leaves the outcome unknown: reload to show what the server recorded; the key is kept for retry.
      if (e.status === 0 || e.code === 'STALE_VERSION') load();
      else setPostKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  };
  const cancelIssue = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/issues/${id}/cancel`, { method: 'POST', body: { rowVersion: issue.rowVersion, reason } });
      setReason('');
      load();
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="toolbar">
        <button type="button" className="btn secondary" onClick={onClose}>
          ← {t('obBackToList')}
        </button>
      </div>
      <h2>
        {issNo(issue.id)} · {issue.warehouseCode} <StatusBadge status={issue.status} />
      </h2>
      <div className={`notice ${issue.status === 'POSTED' ? 'info' : issue.status === 'CANCELLED' ? 'danger' : 'warning'}`} role="status">
        <span aria-hidden="true">{STATUS[issue.status].icon}</span>
        <div>{t(STATUS[issue.status].help)}</div>
      </div>
      <ErrorBox error={error} />

      <dl className="facts">
        <dt>{t('issRequisition')}</dt>
        <dd>
          REQ-{String(issue.requisitionId).padStart(6, '0')} · {issue.requisitionPurpose}
        </dd>
        <dt>{t('issDestination')}</dt>
        <dd>{issue.destinationScope === 'EXTERNAL' ? t('issScopeExternal') : `${t('issScopeInternal')} · ${issue.custodianName ?? '—'}`}</dd>
        <dt>{t('issRecipient')}</dt>
        <dd>{[issue.recipientName, issue.recipientUnit].filter(Boolean).join(' · ')}</dd>
        <dt>{t('issHandoverLocation')}</dt>
        <dd>{issue.handoverLocation ?? '—'}</dd>
        <dt>{t('obPreparedBy')}</dt>
        <dd>{issue.createdByName ?? '—'}</dd>
        <dt>{t('issPostedBy')}</dt>
        <dd>{issue.postedByName ? `${issue.postedByName} · ${fmt(issue.postedAt)}` : '—'}</dd>
        {issue.cancelReason && (
          <>
            <dt>{t('reason')}</dt>
            <dd>{issue.cancelReason}</dd>
          </>
        )}
      </dl>

      <h3>{t('obLines')}</h3>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{t('item')}</th>
            <th scope="col">{t('issQuantity')}</th>
            <th scope="col">{t('location')}</th>
          </tr>
        </thead>
        <tbody>
          {(issue.lines ?? []).map((l) => (
            <tr key={l.id}>
              <td data-label="#">{l.lineNo}</td>
              <td data-label={t('item')}>
                {l.itemCode} · {l.itemName}
              </td>
              <td data-label={t('issQuantity')}>
                <span className="qty">{l.quantity}</span> {l.baseUomCode}
              </td>
              <td data-label={t('location')}>{l.locationCode ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('issDocuments')}</h3>
      {docs.length === 0 ? <p>{t('empty')}</p> : (
        <ul>
          {docs.map((d) => (
            <li key={d.id}>
              <strong>{d.documentType === 'ISSUE_VOUCHER' ? t('issVoucher') : t('issAcknowledgement')}</strong> {d.documentNumber} · {d.documentDate}
              {d.physicalFileRef ? ` · ${d.physicalFileRef}` : ''}
            </li>
          ))}
        </ul>
      )}
      {issue.status === 'POSTED' && ack.length === 0 && <p className="notice warning">{t('issAckPending')}</p>}
      {issue.status !== 'CANCELLED' && can.prepare && (draft ? !hasVoucher : true) && (
        <DocumentForm issueId={id} type={draft ? 'ISSUE_VOUCHER' : 'RECIPIENT_ACKNOWLEDGEMENT'} defaultRecipient={issue.recipientName} onAdded={load} />
      )}

      {draft && (
        <div className="form">
          <h3>{t('obActions')}</h3>
          {!hasVoucher && <p className="hint">{t('issVoucherRequiredAtPost')}</p>}
          <Field label="reason">
            <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="toolbar">
            {can.post && !confirming && (
              <button type="button" className="btn primary" disabled={busy || !hasVoucher} onClick={() => setConfirming(true)}>
                {t('issPost')}
              </button>
            )}
            {can.post && confirming && (
              <>
                <p className="notice warning">{t('issPostConfirm')}</p>
                <button type="button" className="btn primary" disabled={busy} onClick={() => void post()}>
                  {t('issPostConfirmButton')}
                </button>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  {t('cancel')}
                </button>
              </>
            )}
            {(can.prepare || can.post) && (
              <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void cancelIssue()}>
                {t('issCancel')}
              </button>
            )}
          </div>
          <p className="hint">{t('obReasonHint')}</p>
        </div>
      )}
    </section>
  );
}

function DocumentForm({ issueId, type, defaultRecipient, onAdded }: { issueId: number; type: IssueDoc['documentType']; defaultRecipient: string; onAdded: () => void }) {
  const [f, setF] = useState({ documentNumber: '', documentDate: today(), physicalFileRef: '', approvedByName: '', recipientName: type === 'RECIPIENT_ACKNOWLEDGEMENT' ? defaultRecipient : '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/issues/${issueId}/documents`, {
        method: 'POST',
        body: {
          documentType: type,
          documentNumber: f.documentNumber,
          documentDate: f.documentDate,
          physicalFileRef: f.physicalFileRef || null,
          approvedByName: type === 'ISSUE_VOUCHER' ? f.approvedByName || null : null,
          recipientName: f.recipientName || null,
        },
      });
      setF({ ...f, documentNumber: '', physicalFileRef: '' });
      onAdded();
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h3>{type === 'ISSUE_VOUCHER' ? t('issAddVoucher') : t('issAddAcknowledgement')}</h3>
      <p className="hint">{t('issHardCopyNote')}</p>
      <ErrorBox error={error} />
      <fieldset disabled={busy}>
        <Field label="issDocumentNumber">
          <input required maxLength={200} value={f.documentNumber} onChange={(e) => setF({ ...f, documentNumber: e.target.value })} />
        </Field>
        <Field label="issDocumentDate">
          <input required type="date" value={f.documentDate} onChange={(e) => setF({ ...f, documentDate: e.target.value })} />
        </Field>
        {type === 'ISSUE_VOUCHER' && (
          <Field label="issApprovedByName">
            <input maxLength={200} value={f.approvedByName} onChange={(e) => setF({ ...f, approvedByName: e.target.value })} />
          </Field>
        )}
        <Field label="issSignatoryName">
          <input maxLength={200} value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} />
        </Field>
        <Field label="issPhysicalFileRef">
          <input maxLength={300} value={f.physicalFileRef} onChange={(e) => setF({ ...f, physicalFileRef: e.target.value })} />
        </Field>
      </fieldset>
      <button type="submit" className="btn secondary" disabled={busy || !f.documentNumber.trim()}>
        {t('save')}
      </button>
    </form>
  );
}
