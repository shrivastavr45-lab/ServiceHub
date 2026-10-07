import { Link } from 'react-router-dom';
import { label } from '../lib/format.js';

const cx = (...a) => a.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', className, as: As = 'button', ...p }) {
  const v = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-500/50',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  const s = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' }[size];
  return <As className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed', v, s, className)} {...p} />;
}

export const LinkButton = (p) => <Button as={Link} {...p} />;

export function Card({ className, children, title, action }) {
  return (
    <div className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>{action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Field({ label: l, error, hint, children }) {
  return (
    <label className="block">
      {l && <span className="mb-1 block text-sm font-medium text-slate-700">{l}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100';
export const Input = (p) => <input className={inputCls} {...p} />;
export const Textarea = (p) => <textarea rows={4} className={inputCls} {...p} />;
export const Select = ({ children, ...p }) => <select className={inputCls} {...p}>{children}</select>;

export const Spinner = () => <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" role="status" aria-label="Loading" />;
export const Loading = () => <div className="flex justify-center py-16"><Spinner /></div>;

export function ErrorBox({ message, onRetry }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry} className="font-medium underline">Retry</button>}
    </div>
  );
}

export function Empty({ title, hint, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const STATUS = {
  REQUESTED: 'bg-slate-100 text-slate-700', QUOTED: 'bg-amber-100 text-amber-800', NEGOTIATING: 'bg-orange-100 text-orange-800',
  ACCEPTED: 'bg-sky-100 text-sky-800', SCHEDULED: 'bg-indigo-100 text-indigo-800', IN_PROGRESS: 'bg-violet-100 text-violet-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800', CANCELLED: 'bg-red-100 text-red-700', DISPUTED: 'bg-rose-200 text-rose-900',
  PAID: 'bg-emerald-100 text-emerald-800', UNPAID: 'bg-amber-100 text-amber-800', OPEN: 'bg-amber-100 text-amber-800', RESOLVED: 'bg-emerald-100 text-emerald-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800', SUSPENDED: 'bg-red-100 text-red-700', APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800', REJECTED: 'bg-red-100 text-red-700', VISIBLE: 'bg-emerald-100 text-emerald-800',
  HIDDEN: 'bg-slate-200 text-slate-600', DISMISSED: 'bg-slate-200 text-slate-600', SUPERSEDED: 'bg-slate-100 text-slate-500',
};
export const Badge = ({ status, children }) => (
  <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS[status] || 'bg-slate-100 text-slate-700')}>{children ?? label(status)}</span>
);

export function Stars({ value = 0, count }) {
  const v = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span className="text-amber-500" aria-label={`${value} out of 5`}>{'★'.repeat(v)}<span className="text-slate-300">{'★'.repeat(5 - v)}</span></span>
      {count != null && <span className="text-slate-500">{count ? `${Number(value).toFixed(1)} (${count})` : 'No reviews yet'}</span>}
    </span>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>Page {meta.page} of {meta.totalPages} · {meta.total} results</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const PageHeader = ({ title, subtitle, action }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="text-2xl font-bold text-slate-900">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>
    {action}
  </div>
);

export const Stat = ({ label: l, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{l}</p>
    <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
  </div>
);

export function Table({ columns, rows, empty = 'Nothing here yet.', rowKey = (r) => r.id }) {
  if (!rows?.length) return <Empty title={empty} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>{columns.map((c) => <th key={c.header} className="whitespace-nowrap px-4 py-3">{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-slate-50">
              {columns.map((c) => <td key={c.header} className="px-4 py-3 align-top">{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
