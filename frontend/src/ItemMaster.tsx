import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from './api.ts';
import { t, type MessageKey } from './i18n.ts';

/** Item master screens (M2). Server enforces every permission; `canManage` only hides controls. */

export interface Item {
  id: number;
  itemCode: string;
  name: string;
  description: string | null;
  specification: string | null;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  baseUomId: number;
  baseUomCode: string;
  assetControlType: string;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  isSerialTracked: boolean;
  isHazardous: boolean;
  defaultShelfLifeDays: number | null;
  usefulLifeMonths: number | null;
  isActive: boolean;
  rowVersion: number;
  baseUomLocked?: boolean;
}
interface Uom { id: number; code: string; name: string; decimalPlaces: number; isActive: boolean; rowVersion: number }
interface Category { id: number; code: string; name: string; parentId: number | null; isActive: boolean; rowVersion: number }
interface Candidate { itemCode: string; name: string; similarity: number }

const CONTROL_TYPES = ['SUPPLY', 'FIXED_ASSET_CANDIDATE', 'SPECIAL_CONTROLLED_ITEM', 'UNCLASSIFIED'];
const PAGE = 25;

function useReference() {
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Uom[] }>('/uoms'), api<{ data: Category[] }>('/item-categories')])
      .then(([u, c]) => {
        setUoms(u.data);
        setCategories(c.data);
        setError(null);
      })
      .catch((e) => setError(e as ApiError))
      .finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);
  return { uoms, categories, loading, error, reload };
}

function ErrorBox({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const issues = (error.details?.issues as Array<{ path: string; message: string }> | undefined) ?? [];
  return (
    <div className="notice danger" role="alert">
      <span aria-hidden="true">⛔</span>
      <div>
        <strong className="notice-title">{error.code}</strong>
        <div>{error.message}</div>
        {issues.length > 0 && (
          <ul>
            {issues.map((i) => (
              <li key={i.path + i.message}>
                {i.path}: {i.message}
              </li>
            ))}
          </ul>
        )}
        {error.requestId && <small>{error.requestId}</small>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: MessageKey; children: ReactNode }) {
  return (
    <label className="field">
      <span>{t(label)}</span>
      {children}
    </label>
  );
}

export function ItemsView({ canManage }: { canManage: boolean }) {
  const ref = useReference();
  const [q, setQ] = useState('');
  const [active, setActive] = useState<'true' | 'false' | 'all'>('true');
  const [categoryId, setCategoryId] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ data: Item[]; page: { total: number } } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ active, limit: String(PAGE), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (categoryId) params.set('categoryId', categoryId);
    api<{ data: Item[]; page: { total: number } }>(`/items?${params}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(e as ApiError));
  }, [q, active, categoryId, offset]);
  useEffect(load, [load]);

  const openItem = (id: number) => {
    api<{ data: Item }>(`/items/${id}`).then((r) => setEditing(r.data)).catch((e) => setError(e as ApiError));
  };

  if (editing) {
    return (
      <ItemForm
        item={editing === 'new' ? null : editing}
        canManage={canManage}
        uoms={ref.uoms}
        categories={ref.categories}
        referenceUnavailable={Boolean(ref.error)}
        onRetryReference={ref.reload}
        onDone={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <section>
      {ref.error && (
        <div className="notice danger" role="alert">
          <span aria-hidden="true">⛔</span>
          <div>
            {t('referenceLoadError')}
            <div>
              <button type="button" className="btn secondary" onClick={ref.reload}>
                {t('retry')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="toolbar">
        <input aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => { setOffset(0); setQ(e.target.value); }} />
        <select aria-label={t('status')} value={active} onChange={(e) => { setOffset(0); setActive(e.target.value as typeof active); }}>
          <option value="true">{t('showActive')}</option>
          <option value="false">{t('showInactive')}</option>
          <option value="all">{t('showAll')}</option>
        </select>
        <select aria-label={t('category')} value={categoryId} onChange={(e) => { setOffset(0); setCategoryId(e.target.value); }}>
          <option value="">{t('allCategories')}</option>
          {ref.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentId ? '— ' : ''}
              {c.code} · {c.name}
            </option>
          ))}
        </select>
        {canManage && (
          <button type="button" className="btn primary" disabled={ref.loading || Boolean(ref.error)} onClick={() => setEditing('new')}>
            {t('newItem')}
          </button>
        )}
      </div>
      <ErrorBox error={error} />
      {data && data.data.length === 0 && <p>{t('empty')}</p>}
      {data && data.data.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th scope="col">{t('itemCode')}</th>
              <th scope="col">{t('name')}</th>
              <th scope="col">{t('category')}</th>
              <th scope="col">{t('uom')}</th>
              <th scope="col">{t('control')}</th>
              <th scope="col">{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((i) => (
              <tr key={i.id}>
                <td data-label={t('itemCode')}>
                  <button type="button" className="linklike" onClick={() => openItem(i.id)}>
                    {i.itemCode}
                  </button>
                </td>
                <td data-label={t('name')}>{i.name}</td>
                <td data-label={t('category')}>{i.categoryCode}</td>
                <td data-label={t('uom')}>{i.baseUomCode}</td>
                <td data-label={t('control')}>{i.assetControlType}</td>
                <td data-label={t('status')}>
                  <span className="badge">{i.isActive ? t('active') : t('inactive')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && (
        <div className="toolbar">
          <button type="button" className="btn secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            {t('previous')}
          </button>
          <span>
            {data.page.total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, data.page.total)} / {data.page.total}
          </span>
          <button type="button" className="btn secondary" disabled={offset + PAGE >= data.page.total} onClick={() => setOffset(offset + PAGE)}>
            {t('next')}
          </button>
        </div>
      )}
    </section>
  );
}

type FormState = {
  itemCode: string;
  name: string;
  description: string;
  specification: string;
  categoryId: string;
  baseUomId: string;
  assetControlType: string;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  isSerialTracked: boolean;
  isHazardous: boolean;
  defaultShelfLifeDays: string;
  usefulLifeMonths: string;
  reason: string;
  confirmNotDuplicate: boolean;
};

function toForm(i: Item | null): FormState {
  return {
    itemCode: i?.itemCode ?? '',
    name: i?.name ?? '',
    description: i?.description ?? '',
    specification: i?.specification ?? '',
    categoryId: i ? String(i.categoryId) : '',
    baseUomId: i ? String(i.baseUomId) : '',
    assetControlType: i?.assetControlType ?? 'UNCLASSIFIED',
    isBatchTracked: i?.isBatchTracked ?? false,
    isExpiryTracked: i?.isExpiryTracked ?? false,
    isSerialTracked: i?.isSerialTracked ?? false,
    isHazardous: i?.isHazardous ?? false,
    defaultShelfLifeDays: i?.defaultShelfLifeDays ? String(i.defaultShelfLifeDays) : '',
    usefulLifeMonths: i?.usefulLifeMonths ? String(i.usefulLifeMonths) : '',
    reason: '',
    confirmNotDuplicate: false,
  };
}

function ItemForm({
  item,
  canManage,
  uoms,
  categories,
  referenceUnavailable,
  onRetryReference,
  onDone,
}: {
  item: Item | null;
  canManage: boolean;
  uoms: Uom[];
  categories: Category[];
  referenceUnavailable: boolean;
  onRetryReference: () => void;
  onDone: () => void;
}) {
  // Entered values are preserved across validation errors (UX rule).
  const [f, setF] = useState<FormState>(() => toForm(item));
  const [error, setError] = useState<ApiError | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const readOnly = !canManage;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (referenceUnavailable) return;
    setBusy(true);
    setError(null);
    const common = {
      name: f.name,
      description: f.description || null,
      specification: f.specification || null,
      categoryId: Number(f.categoryId),
      baseUomId: Number(f.baseUomId),
      assetControlType: f.assetControlType,
      isBatchTracked: f.isBatchTracked,
      isExpiryTracked: f.isExpiryTracked,
      isSerialTracked: f.isSerialTracked,
      isHazardous: f.isHazardous,
      defaultShelfLifeDays: f.defaultShelfLifeDays ? Number(f.defaultShelfLifeDays) : null,
      usefulLifeMonths: f.usefulLifeMonths ? Number(f.usefulLifeMonths) : null,
      reason: f.reason,
      confirmNotDuplicate: f.confirmNotDuplicate,
    };
    try {
      if (item) {
        const body: Record<string, unknown> = { ...common, rowVersion: item.rowVersion };
        if (item.baseUomLocked) delete body.baseUomId;
        await api(`/items/${item.id}`, { method: 'PATCH', body });
      } else {
        await api('/items', { method: 'POST', body: { ...common, itemCode: f.itemCode } });
      }
      onDone();
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.code === 'POSSIBLE_DUPLICATE') setCandidates((e2.details?.candidates as Candidate[]) ?? []);
      setError(e2);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api(`/items/${item.id}/activation`, { method: 'POST', body: { active: !item.isActive, rowVersion: item.rowVersion, reason: f.reason } });
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h2>
        {item ? `${t('editItem')}: ${item.itemCode}` : t('newItem')}{' '}
        {item && <span className="badge">{item.isActive ? t('active') : t('inactive')}</span>}
      </h2>
      <p className="hint">{t('noStockEffect')}</p>
      {referenceUnavailable && (
        <div className="notice danger" role="alert">
          <span aria-hidden="true">⛔</span>
          <div>
            {t('referenceLoadError')}
            <div>
              <button type="button" className="btn secondary" onClick={onRetryReference}>
                {t('retry')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {candidates.length > 0 && (
        <div className="notice warning" role="status">
          <span aria-hidden="true">⚠</span>
          <div>
            {t('possibleDuplicate')}
            <ul>
              {candidates.map((c) => (
                <li key={c.itemCode}>
                  {c.itemCode} — {c.name} ({Math.round(c.similarity * 100)}%)
                </li>
              ))}
            </ul>
            <label className="check">
              <input type="checkbox" checked={f.confirmNotDuplicate} onChange={(e) => set('confirmNotDuplicate', e.target.checked)} />
              {t('confirmNotDuplicate')}
            </label>
          </div>
        </div>
      )}
      <fieldset disabled={readOnly || busy}>
        <Field label="itemCode">
          <input required value={f.itemCode} disabled={Boolean(item)} onChange={(e) => set('itemCode', e.target.value)} />
        </Field>
        <Field label="name">
          <input required maxLength={200} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="specification">
          <textarea maxLength={2000} value={f.specification} onChange={(e) => set('specification', e.target.value)} />
        </Field>
        <Field label="description">
          <textarea maxLength={2000} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="category">
          <select required value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">—</option>
            {categories.filter((c) => c.isActive || String(c.id) === f.categoryId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? '— ' : ''}
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="uom">
          <select required value={f.baseUomId} disabled={Boolean(item?.baseUomLocked)} onChange={(e) => set('baseUomId', e.target.value)}>
            <option value="">—</option>
            {uoms.filter((u) => u.isActive || String(u.id) === f.baseUomId).map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} · {u.name}
              </option>
            ))}
          </select>
        </Field>
        {item?.baseUomLocked && <p className="hint">🔒 {t('uomLocked')}</p>}
        <Field label="control">
          <select value={f.assetControlType} onChange={(e) => set('assetControlType', e.target.value)}>
            {CONTROL_TYPES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        {(['isBatchTracked', 'isExpiryTracked', 'isSerialTracked', 'isHazardous'] as const).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
            {t(({ isBatchTracked: 'batchTracked', isExpiryTracked: 'expiryTracked', isSerialTracked: 'serialTracked', isHazardous: 'hazardous' } as const)[k])}
          </label>
        ))}
        <Field label="shelfLife">
          <input type="number" min={1} inputMode="numeric" value={f.defaultShelfLifeDays} onChange={(e) => set('defaultShelfLifeDays', e.target.value)} />
        </Field>
        <Field label="usefulLife">
          <input type="number" min={1} inputMode="numeric" value={f.usefulLifeMonths} onChange={(e) => set('usefulLifeMonths', e.target.value)} />
        </Field>
        {canManage && (
          <Field label="reason">
            <input required minLength={5} maxLength={500} value={f.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        )}
      </fieldset>
      <div className="toolbar">
        {canManage && (
          <button type="submit" className="btn primary" disabled={busy || referenceUnavailable}>
            {t('save')}
          </button>
        )}
        {canManage && item && (
          <button type="button" className="btn secondary" disabled={busy || f.reason.trim().length < 5} onClick={() => void toggleActive()}>
            {item.isActive ? t('deactivate') : t('activate')}
          </button>
        )}
        <button type="button" className="btn secondary" onClick={onDone}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function UomForm({
  uom,
  canManage,
  referenceUnavailable,
  onRetryReference,
  onDone,
}: {
  uom: Uom | null;
  canManage: boolean;
  referenceUnavailable: boolean;
  onRetryReference: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState(uom?.code ?? '');
  const [name, setName] = useState(uom?.name ?? '');
  const [decimalPlaces, setDecimalPlaces] = useState(uom ? String(uom.decimalPlaces) : '0');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = !canManage;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (referenceUnavailable) return;
    setBusy(true);
    setError(null);
    try {
      if (uom) {
        await api(`/uoms/${uom.id}`, { method: 'PATCH', body: { name, decimalPlaces: Number(decimalPlaces), rowVersion: uom.rowVersion, reason } });
      } else {
        await api('/uoms', { method: 'POST', body: { code, name, decimalPlaces: Number(decimalPlaces), reason } });
      }
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!uom) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/uoms/${uom.id}`, { method: 'PATCH', body: { isActive: !uom.isActive, rowVersion: uom.rowVersion, reason } });
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h2>
        {uom ? `${t('editUom')}: ${uom.code}` : t('newUom')}{' '}
        {uom && <span className="badge">{uom.isActive ? t('active') : t('inactive')}</span>}
      </h2>
      {referenceUnavailable && (
        <div className="notice danger" role="alert">
          <span aria-hidden="true">⛔</span>
          <div>
            {t('referenceLoadError')}
            <div>
              <button type="button" className="btn secondary" onClick={onRetryReference}>
                {t('retry')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      <fieldset disabled={readOnly || busy}>
        <Field label="code">
          <input required value={code} disabled={Boolean(uom)} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="name">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="decimalPlaces">
          <input type="number" min={0} max={6} value={decimalPlaces} onChange={(e) => setDecimalPlaces(e.target.value)} />
        </Field>
        {canManage && (
          <Field label="reason">
            <input required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </fieldset>
      <div className="toolbar">
        {canManage && (
          <button type="submit" className="btn primary" disabled={busy || referenceUnavailable}>
            {t('save')}
          </button>
        )}
        {canManage && uom && (
          <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void toggleActive()}>
            {uom.isActive ? t('deactivate') : t('activate')}
          </button>
        )}
        <button type="button" className="btn secondary" onClick={onDone}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function CategoryForm({
  category,
  categories,
  canManage,
  referenceUnavailable,
  onRetryReference,
  onDone,
}: {
  category: Category | null;
  categories: Category[];
  canManage: boolean;
  referenceUnavailable: boolean;
  onRetryReference: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState(category?.code ?? '');
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parentId ? String(category.parentId) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = !canManage;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (referenceUnavailable) return;
    setBusy(true);
    setError(null);
    try {
      if (category) {
        await api(`/item-categories/${category.id}`, {
          method: 'PATCH',
          body: { name, parentId: parentId ? Number(parentId) : null, rowVersion: category.rowVersion, reason },
        });
      } else {
        await api('/item-categories', { method: 'POST', body: { code, name, parentId: parentId ? Number(parentId) : null, reason } });
      }
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/item-categories/${category.id}`, { method: 'PATCH', body: { isActive: !category.isActive, rowVersion: category.rowVersion, reason } });
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <h2>
        {category ? `${t('editCategory')}: ${category.code}` : t('newCategory')}{' '}
        {category && <span className="badge">{category.isActive ? t('active') : t('inactive')}</span>}
      </h2>
      {referenceUnavailable && (
        <div className="notice danger" role="alert">
          <span aria-hidden="true">⛔</span>
          <div>
            {t('referenceLoadError')}
            <div>
              <button type="button" className="btn secondary" onClick={onRetryReference}>
                {t('retry')}
              </button>
            </div>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      <fieldset disabled={readOnly || busy}>
        <Field label="code">
          <input required value={code} disabled={Boolean(category)} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="name">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="parentCategory">
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t('none')}</option>
            {categories
              .filter((c) => !c.parentId && c.isActive && c.id !== category?.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
          </select>
        </Field>
        {canManage && (
          <Field label="reason">
            <input required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </fieldset>
      <div className="toolbar">
        {canManage && (
          <button type="submit" className="btn primary" disabled={busy || referenceUnavailable}>
            {t('save')}
          </button>
        )}
        {canManage && category && (
          <button type="button" className="btn secondary" disabled={busy || reason.trim().length < 5} onClick={() => void toggleActive()}>
            {category.isActive ? t('deactivate') : t('activate')}
          </button>
        )}
        <button type="button" className="btn secondary" onClick={onDone}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

export function ReferenceView({ canManage }: { canManage: boolean }) {
  const ref = useReference();
  const [editingUom, setEditingUom] = useState<Uom | 'new' | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null);

  if (editingUom) {
    return (
      <UomForm
        uom={editingUom === 'new' ? null : editingUom}
        canManage={canManage}
        referenceUnavailable={Boolean(ref.error)}
        onRetryReference={ref.reload}
        onDone={() => {
          setEditingUom(null);
          ref.reload();
        }}
      />
    );
  }
  if (editingCategory) {
    return (
      <CategoryForm
        category={editingCategory === 'new' ? null : editingCategory}
        categories={ref.categories}
        canManage={canManage}
        referenceUnavailable={Boolean(ref.error)}
        onRetryReference={ref.reload}
        onDone={() => {
          setEditingCategory(null);
          ref.reload();
        }}
      />
    );
  }

  return (
    <section>
      {ref.error && (
        <div className="notice danger" role="alert">
          <span aria-hidden="true">⛔</span>
          <div>
            {t('referenceLoadError')}
            <div>
              <button type="button" className="btn secondary" onClick={ref.reload}>
                {t('retry')}
              </button>
            </div>
          </div>
        </div>
      )}
      <h2>{t('uom')}</h2>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{t('code')}</th>
            <th scope="col">{t('name')}</th>
            <th scope="col">{t('decimalPlaces')}</th>
            <th scope="col">{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {ref.uoms.map((u) => (
            <tr key={u.id}>
              <td data-label={t('code')}>
                <button type="button" className="linklike" onClick={() => setEditingUom(u)}>
                  {u.code}
                </button>
              </td>
              <td data-label={t('name')}>{u.name}</td>
              <td data-label={t('decimalPlaces')}>{u.decimalPlaces}</td>
              <td data-label={t('status')}>
                <span className="badge">{u.isActive ? t('active') : t('inactive')}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={ref.loading || Boolean(ref.error)} onClick={() => setEditingUom('new')}>
            {t('newUom')}
          </button>
        </div>
      )}
      <h2>{t('category')}</h2>
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{t('code')}</th>
            <th scope="col">{t('name')}</th>
            <th scope="col">{t('parentCategory')}</th>
            <th scope="col">{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {ref.categories.map((c) => (
            <tr key={c.id}>
              <td data-label={t('code')}>
                <button type="button" className="linklike" onClick={() => setEditingCategory(c)}>
                  {c.code}
                </button>
              </td>
              <td data-label={t('name')}>{c.name}</td>
              <td data-label={t('parentCategory')}>{ref.categories.find((p) => p.id === c.parentId)?.code ?? t('none')}</td>
              <td data-label={t('status')}>
                <span className="badge">{c.isActive ? t('active') : t('inactive')}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={ref.loading || Boolean(ref.error)} onClick={() => setEditingCategory('new')}>
            {t('newCategory')}
          </button>
        </div>
      )}
    </section>
  );
}
