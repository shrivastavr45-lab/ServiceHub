import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, put, patch, del, qs } from '../lib/api.js';
import { useFetch, useAction } from '../lib/hooks.js';
import { money, dateTime, label } from '../lib/format.js';
import { Button, Card, Field, Input, Select, Textarea, Loading, ErrorBox, Badge, Stat, PageHeader, Table, Pagination, Modal, Stars } from '../components/ui.jsx';

// Generic paged list wrapper
function usePaged(path, extra = {}) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(extra);
  const r = useFetch(() => get(`${path}${qs({ ...extra, page })}`), [path, page, key]);
  useEffect(() => { setPage(1); }, [key]);
  return { ...r, page, setPage };
}

export function AdminDashboard() {
  const { data: d, loading, error, reload } = useFetch(() => get('/admin/dashboard'));
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const max = Math.max(1, ...d.bookings_per_day.map((x) => x.bookings));
  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="Platform overview" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Customers" value={d.total_customers} /><Stat label="Providers" value={d.total_providers} />
        <Stat label="Total bookings" value={d.total_bookings} /><Stat label="Active providers (30d)" value={d.active_providers} />
        <Stat label="Completed" value={d.completed_bookings} /><Stat label="Cancelled" value={d.cancelled_bookings} />
        <Stat label="Revenue (GMV)" value={money(d.revenue_paise)} hint="Agreed price of completed jobs" /><Stat label="Platform fees" value={money(d.platform_fees_paise)} />
        <Stat label="Open disputes" value={d.open_disputes} /><Stat label="Open reports" value={d.open_reports} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Bookings, last 14 days">
          <div className="flex h-32 items-end gap-1" role="img" aria-label="Bookings per day">
            {d.bookings_per_day.map((x) => <div key={x.day} title={`${x.day}: ${x.bookings}`} className="flex-1 rounded-t bg-brand-500/80" style={{ height: `${Math.max(4, (x.bookings / max) * 100)}%` }} />)}
          </div>
        </Card>
        <Card title="Popular services">
          {!d.popular_services.length ? <p className="text-sm text-slate-500">No bookings yet.</p> : (
            <ul className="space-y-2 text-sm">{d.popular_services.map((s) => <li key={s.service_name} className="flex justify-between"><span>{s.service_name} <span className="text-slate-400">· {s.category_name}</span></span><b>{s.bookings}</b></li>)}</ul>)}
        </Card>
        <Card title="Recent activity" className="lg:col-span-2">
          <ul className="divide-y divide-slate-100 text-sm">{d.recent_activity.map((a) => (
            <li key={a.id} className="flex justify-between py-2"><span><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{a.action}</code> {a.actor_name && <span className="text-slate-500">by {a.actor_name}</span>}</span><span className="text-xs text-slate-400">{dateTime(a.created_at)}</span></li>))}</ul>
        </Card>
      </div>
    </>
  );
}

export function Users({ role }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const { data, meta, loading, error, reload, setPage } = usePaged('/admin/users', { role, status, q: dq });
  const act = useAction();
  const setStatusFor = (u, s) => {
    const reason = s === 'SUSPENDED' ? window.prompt(`Reason for suspending ${u.name}?`) : undefined;
    if (s === 'SUSPENDED' && reason === null) return;
    act.run(async () => { await patch(`/admin/users/${u.id}/status`, { status: s, reason: reason || undefined }); await reload(); });
  };
  const verify = (u, v) => act.run(async () => { await patch(`/admin/providers/${u.id}/verification`, { verification_status: v }); await reload(); });
  const isProv = role === 'SERVICE_PROVIDER';
  return (
    <>
      <PageHeader title={isProv ? 'Providers' : 'Customers'} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-xs" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <div className="w-40"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select></div>
      </div>
      <ErrorBox message={act.error} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} empty="No users found." columns={[
          { header: 'Name', render: (u) => <div><p className="font-medium">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></div> },
          { header: 'Joined', render: (u) => dateTime(u.created_at) },
          { header: 'Bookings', key: 'bookings' },
          ...(isProv ? [
            { header: 'Rating', render: (u) => <Stars value={u.rating_avg} count={u.rating_count} /> },
            { header: 'Verification', render: (u) => <Select value={u.verification_status} onChange={(e) => verify(u, e.target.value)} aria-label="Verification"><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></Select> },
          ] : []),
          { header: 'Status', render: (u) => <Badge status={u.status} /> },
          { header: '', render: (u) => (u.status === 'ACTIVE'
            ? <Button size="sm" variant="danger" onClick={() => setStatusFor(u, 'SUSPENDED')}>Suspend</Button>
            : <Button size="sm" variant="secondary" onClick={() => setStatusFor(u, 'ACTIVE')}>Activate</Button>) },
        ]} />
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

export function Categories() {
  const { data, loading, error, reload } = useFetch(() => get('/admin/categories'));
  const [edit, setEdit] = useState(null);
  const act = useAction();
  const toggle = (c) => act.run(async () => { await patch(`/categories/${c.id}`, { is_active: !c.is_active }); await reload(); });
  return (
    <>
      <PageHeader title="Categories" action={<Button onClick={() => setEdit({})}>+ New category</Button>} />
      <ErrorBox message={act.error} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} columns={[
          { header: 'Category', render: (c) => <span>{c.icon} <b>{c.name}</b></span> }, { header: 'Slug', key: 'slug' }, { header: 'Services', key: 'service_count' },
          { header: 'Status', render: (c) => <Badge status={c.is_active ? 'ACTIVE' : 'HIDDEN'}>{c.is_active ? 'Active' : 'Inactive'}</Badge> },
          { header: '', render: (c) => <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEdit(c)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button></div> },
        ]} />
      )}
      <CategoryModal item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function CategoryModal({ item, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', icon: '', description: '' });
  const { busy, error, run } = useAction();
  useEffect(() => { setF({ name: item?.name || '', icon: item?.icon || '', description: item?.description || '' }); }, [item]);
  const submit = (e) => { e.preventDefault(); run(async () => { const body = { name: f.name, icon: f.icon || null, description: f.description || null }; if (item.id) await patch(`/categories/${item.id}`, body); else await post('/categories', body); onSaved(); }); };
  return (
    <Modal open={!!item} onClose={onClose} title={item?.id ? 'Edit category' : 'New category'}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox message={error} />
        <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Icon (emoji)"><Input maxLength={4} value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

export function Services() {
  const { data, loading, error, reload } = useFetch(() => get('/admin/services'));
  const cats = useFetch(() => get('/admin/categories'));
  const [edit, setEdit] = useState(null);
  const act = useAction();
  const toggle = (s) => act.run(async () => { await patch(`/services/${s.id}`, { is_active: !s.is_active }); await reload(); });
  return (
    <>
      <PageHeader title="Services" action={<Button onClick={() => setEdit({})}>+ New service</Button>} />
      <ErrorBox message={act.error} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} columns={[
          { header: 'Service', render: (s) => <b>{s.name}</b> }, { header: 'Category', key: 'category_name' },
          { header: 'Status', render: (s) => <Badge status={s.is_active ? 'ACTIVE' : 'HIDDEN'}>{s.is_active ? 'Active' : 'Inactive'}</Badge> },
          { header: '', render: (s) => <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEdit(s)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.is_active ? 'Deactivate' : 'Activate'}</Button></div> },
        ]} />
      )}
      <ServiceModal item={edit} cats={cats.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function ServiceModal({ item, cats, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', category_id: '', description: '' });
  const { busy, error, run } = useAction();
  useEffect(() => { setF({ name: item?.name || '', category_id: item?.category_id || '', description: item?.description || '' }); }, [item]);
  const submit = (e) => { e.preventDefault(); run(async () => { const body = { name: f.name, category_id: Number(f.category_id), description: f.description || null }; if (item.id) await patch(`/services/${item.id}`, body); else await post('/services', body); onSaved(); }); };
  return (
    <Modal open={!!item} onClose={onClose} title={item?.id ? 'Edit service' : 'New service'}>
      <form onSubmit={submit} className="space-y-4"><ErrorBox message={error} />
        <Field label="Category"><Select required value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">Select…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

export function Bookings() {
  const [status, setStatus] = useState('');
  const { data, meta, loading, error, reload, setPage } = usePaged('/admin/bookings', { status });
  return (
    <>
      <PageHeader title="Bookings" />
      <div className="mb-4 w-52"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>
        {['REQUESTED', 'QUOTED', 'NEGOTIATING', 'ACCEPTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></div>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} empty="No bookings." columns={[
          { header: 'Service', render: (b) => <Link className="font-medium text-brand-600" to={`/admin/bookings/${b.id}`}>{b.service_name}</Link> },
          { header: 'Customer', key: 'customer_name' }, { header: 'Provider', key: 'provider_name' },
          { header: 'Price', render: (b) => (b.agreed_price_paise ? money(b.agreed_price_paise) : '—') }, { header: 'Fee', render: (b) => (b.platform_fee_paise ? money(b.platform_fee_paise) : '—') },
          { header: 'Created', render: (b) => dateTime(b.created_at) }, { header: 'Status', render: (b) => <Badge status={b.status} /> },
        ]} />
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

export function Disputes() {
  const [status, setStatus] = useState('OPEN');
  const { data, meta, loading, error, reload, setPage } = usePaged('/disputes', { status });
  const [target, setTarget] = useState(null);
  return (
    <>
      <PageHeader title="Disputes" />
      <div className="mb-4 w-44"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option></Select></div>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} empty="No disputes." columns={[
          { header: 'Booking', render: (d) => <Link className="font-medium text-brand-600" to={`/admin/bookings/${d.booking_id}`}>{d.service_name}</Link> },
          { header: 'Parties', render: (d) => <span className="text-xs">{d.customer_name} ↔ {d.provider_name}</span> },
          { header: 'Reason', render: (d) => <div><b>{label(d.reason)}</b><p className="max-w-xs text-xs text-slate-500">{d.description}</p><p className="text-xs text-slate-400">raised by {d.raised_by_name}</p></div> },
          { header: 'Status', render: (d) => <div><Badge status={d.status} />{d.resolution && <p className="mt-1 max-w-xs text-xs text-slate-500">{d.resolution}</p>}</div> },
          { header: '', render: (d) => d.status === 'OPEN' && <Button size="sm" onClick={() => setTarget(d)}>Resolve</Button> },
        ]} />
      )}
      <Pagination meta={meta} onPage={setPage} />
      <ResolveModal dispute={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); reload(); }} />
    </>
  );
}

function ResolveModal({ dispute, onClose, onDone }) {
  const [resolution, setResolution] = useState('');
  const [bookingStatus, setBookingStatus] = useState('COMPLETED');
  const { busy, error, run } = useAction();
  return (
    <Modal open={!!dispute} onClose={onClose} title="Resolve dispute">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { await post(`/admin/disputes/${dispute.id}/resolve`, { resolution, booking_status: bookingStatus }); setResolution(''); onDone(); }); }}>
        <ErrorBox message={error} />
        <Field label="Outcome for the booking"><Select value={bookingStatus} onChange={(e) => setBookingStatus(e.target.value)}><option value="COMPLETED">Mark as completed (in provider's favour)</option><option value="CANCELLED">Cancel booking (in customer's favour)</option></Select></Field>
        <Field label="Resolution notes (sent to both parties)"><Textarea required minLength={5} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Close</Button><Button disabled={busy}>Resolve</Button></div>
      </form>
    </Modal>
  );
}

export function Reviews() {
  const { data, meta, loading, error, reload, setPage } = usePaged('/admin/reviews');
  const act = useAction();
  const toggle = (r) => act.run(async () => { await patch(`/admin/reviews/${r.id}`, { status: r.status === 'VISIBLE' ? 'HIDDEN' : 'VISIBLE' }); await reload(); });
  return (
    <>
      <PageHeader title="Reviews" subtitle="Hidden reviews are excluded from public pages and ratings" />
      <ErrorBox message={act.error} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} empty="No reviews." columns={[
          { header: 'Review', render: (r) => <div><Stars value={r.rating} /><p className="max-w-md text-sm">{r.comment || <i>No comment</i>}</p></div> },
          { header: 'Customer', key: 'customer_name' }, { header: 'Provider', key: 'provider_name' }, { header: 'Date', render: (r) => dateTime(r.created_at) },
          { header: 'Status', render: (r) => <Badge status={r.status} /> },
          { header: '', render: (r) => <Button size="sm" variant="secondary" onClick={() => toggle(r)}>{r.status === 'VISIBLE' ? 'Hide' : 'Restore'}</Button> },
        ]} />
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

export function Reports() {
  const [status, setStatus] = useState('OPEN');
  const { data, meta, loading, error, reload, setPage } = usePaged('/admin/reports', { status });
  const act = useAction();
  const resolve = (r, s) => act.run(async () => { await patch(`/admin/reports/${r.id}`, { status: s }); await reload(); });
  const suspend = (r) => window.confirm(`Suspend ${r.reported_name}?`) && act.run(async () => { await patch(`/admin/users/${r.reported_user_id}/status`, { status: 'SUSPENDED', reason: 'Following user report' }); await reload(); });
  return (
    <>
      <PageHeader title="Reported users" />
      <div className="mb-4 w-44"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option></Select></div>
      <ErrorBox message={act.error} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} empty="No reports." columns={[
          { header: 'Reported user', render: (r) => <div><b>{r.reported_name}</b><p className="text-xs text-slate-500">{label(r.reported_role)} · <Badge status={r.reported_status} /></p></div> },
          { header: 'Reported by', key: 'reporter_name' },
          { header: 'Details', render: (r) => <div className="max-w-sm text-sm"><p className="font-medium">{r.reason}</p><p className="text-slate-600">{r.details}</p></div> },
          { header: 'Date', render: (r) => dateTime(r.created_at) }, { header: 'Status', render: (r) => <Badge status={r.status} /> },
          { header: '', render: (r) => r.status === 'OPEN' && <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => resolve(r, 'RESOLVED')}>Resolve</Button><Button size="sm" variant="ghost" onClick={() => resolve(r, 'DISMISSED')}>Dismiss</Button>{r.reported_status === 'ACTIVE' && <Button size="sm" variant="danger" onClick={() => suspend(r)}>Suspend user</Button>}</div> },
        ]} />
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

export function AuditLogs() {
  const [action, setAction] = useState('');
  const { data, meta, loading, error, reload, setPage } = usePaged('/admin/audit-logs', { action });
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Append-only record of sensitive actions" />
      <div className="mb-4 max-w-xs"><Input placeholder="Filter by action prefix, e.g. user." value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action filter" /></div>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} rowKey={(r) => r.id} empty="No log entries." columns={[
          { header: 'Time', render: (l) => dateTime(l.created_at) }, { header: 'Actor', render: (l) => l.actor_name ? `${l.actor_name} (${label(l.actor_role)})` : 'system' },
          { header: 'Action', render: (l) => <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{l.action}</code> },
          { header: 'Entity', render: (l) => (l.entity_type ? `${l.entity_type} ${String(l.entity_id || '').slice(0, 8)}` : '—') },
          { header: 'Details', render: (l) => <span className="text-xs text-slate-500">{Object.keys(l.metadata || {}).length ? JSON.stringify(l.metadata) : ''}</span> },
          { header: 'IP', key: 'ip' },
        ]} />
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

export function Settings() {
  const { data, loading, error, reload } = useFetch(() => get('/admin/settings'));
  const [fee, setFee] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error: err, run } = useAction();
  useEffect(() => { if (data) setFee(data.platform_fee_percent); }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Platform settings" />
      <Card title="Platform fee" className="max-w-md">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { await put('/admin/settings', { platform_fee_percent: Number(fee) }); setSaved(true); }); }}>
          <ErrorBox message={err} />{saved && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Saved. Applies to bookings agreed from now on.</p>}
          <Field label="Fee charged to providers (% of agreed price)"><Input type="number" min="0" max="50" step="0.1" value={fee} onChange={(e) => { setSaved(false); setFee(e.target.value); }} /></Field>
          <Button disabled={busy}>Save</Button>
        </form>
      </Card>
    </>
  );
}
