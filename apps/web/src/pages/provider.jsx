import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, put, patch, del } from '../lib/api.js';
import { useFetch, useAction } from '../lib/hooks.js';
import { money, date, label, WEEKDAYS, rupeesToPaise } from '../lib/format.js';
import { useAuth } from '../auth.jsx';
import { Button, Card, Field, Input, Select, Textarea, Loading, ErrorBox, Empty, Badge, Stat, PageHeader, Table, Stars, Modal } from '../components/ui.jsx';

export function ProviderDashboard() {
  const { user } = useAuth();
  const earn = useFetch(() => get('/providers/me/earnings'));
  const jobs = useFetch(() => get('/bookings?limit=100'));
  const prof = useFetch(() => get('/providers/me/profile'));
  if (earn.loading || jobs.loading) return <Loading />;
  if (earn.error || jobs.error) return <ErrorBox message={earn.error || jobs.error} onRetry={() => { earn.reload(); jobs.reload(); }} />;
  const b = jobs.data;
  const newReq = b.filter((x) => x.status === 'REQUESTED');
  const respond = b.filter((x) => ['QUOTED', 'NEGOTIATING'].includes(x.status) && x.pending_offer_by !== user.id);
  const upcoming = b.filter((x) => ['ACCEPTED', 'SCHEDULED', 'IN_PROGRESS'].includes(x.status));
  const toInvoice = b.filter((x) => x.status === 'COMPLETED' && !x.invoice_id);
  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Your business at a glance" />
      {prof.data && prof.data.verification_status !== 'APPROVED' && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Your profile is {prof.data.verification_status.toLowerCase()} — customers can't find you until an admin approves it.</div>}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="New requests" value={newReq.length} /><Stat label="Offers awaiting you" value={respond.length} />
        <Stat label="Upcoming jobs" value={upcoming.length} /><Stat label="Jobs to invoice" value={toInvoice.length} />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Completed jobs" value={earn.data.completed_jobs} /><Stat label="Invoiced" value={money(earn.data.invoiced_paise)} />
        <Stat label="Paid" value={money(earn.data.paid_paise)} /><Stat label="Pending payment" value={money(earn.data.unpaid_paise)} />
      </div>
      <Card title="Needs your attention">
        {![...newReq, ...respond, ...toInvoice].length ? <Empty title="You're all caught up" /> : (
          <ul className="divide-y divide-slate-100">{[...newReq, ...respond, ...toInvoice].map((x) => (
            <li key={x.id} className="flex items-center justify-between py-2 text-sm"><span>{x.service_name} · {x.customer_name} <Badge status={x.status} /></span><Link className="font-medium text-brand-600" to={`/provider/bookings/${x.id}`}>Open →</Link></li>))}</ul>
        )}
      </Card>
    </>
  );
}

export function ProviderServices() {
  const mine = useFetch(() => get('/providers/me/services'));
  const catalog = useFetch(() => get('/services'));
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const act = useAction();
  const toggle = (s) => act.run(async () => { await patch(`/providers/me/services/${s.id}`, { is_active: !s.is_active }); await mine.reload(); });
  const remove = (s) => window.confirm(`Remove ${s.name}?`) && act.run(async () => { await del(`/providers/me/services/${s.id}`); await mine.reload(); });
  return (
    <>
      <PageHeader title="My services" subtitle="What you offer and your starting prices" action={<Button onClick={() => setOpen(true)}>+ Add service</Button>} />
      <ErrorBox message={act.error} />
      {mine.loading ? <Loading /> : mine.error ? <ErrorBox message={mine.error} onRetry={mine.reload} /> : (
        <Table rows={mine.data} empty="You haven't added any services yet. Add one so customers can find you." columns={[
          { header: 'Service', render: (s) => <div><p className="font-medium">{s.name}</p><p className="text-xs text-slate-500">{s.category}</p></div> },
          { header: 'Price', render: (s) => `${money(s.price_paise)} ${label(s.price_unit).toLowerCase()}` },
          { header: 'Status', render: (s) => <Badge status={s.is_active ? 'ACTIVE' : 'HIDDEN'}>{s.is_active ? 'Listed' : 'Hidden'}</Badge> },
          { header: '', render: (s) => <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEdit(s)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.is_active ? 'Hide' : 'Show'}</Button><Button size="sm" variant="ghost" onClick={() => remove(s)}>Remove</Button></div> },
        ]} />
      )}
      <ServiceModal open={open} onClose={() => setOpen(false)} catalog={catalog.data || []} existing={(mine.data || []).map((m) => m.service_id)} onSaved={() => { setOpen(false); mine.reload(); }} />
      <ServiceModal open={!!edit} item={edit} onClose={() => setEdit(null)} catalog={[]} onSaved={() => { setEdit(null); mine.reload(); }} />
    </>
  );
}

function ServiceModal({ open, onClose, catalog, existing = [], item, onSaved }) {
  const [f, setF] = useState({ service_id: '', price: '', price_unit: 'FIXED', description: '' });
  const { busy, error, run } = useAction();
  useEffect(() => { setF(item ? { service_id: item.service_id, price: String(item.price_paise / 100), price_unit: item.price_unit, description: item.description || '' } : { service_id: '', price: '', price_unit: 'FIXED', description: '' }); }, [item, open]);
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { price_paise: rupeesToPaise(f.price), price_unit: f.price_unit, description: f.description || undefined };
      if (item) await patch(`/providers/me/services/${item.id}`, body); else await post('/providers/me/services', { ...body, service_id: Number(f.service_id) });
      onSaved();
    });
  };
  const available = catalog.filter((s) => !existing.includes(s.id));
  return (
    <Modal open={open} onClose={onClose} title={item ? `Edit ${item.name}` : 'Add a service'}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        {!item && <Field label="Service"><Select required value={f.service_id} onChange={(e) => setF({ ...f, service_id: e.target.value })}>
          <option value="">Select…</option>{available.map((s) => <option key={s.id} value={s.id}>{s.category_name} – {s.name}</option>)}</Select></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)"><Input type="number" min="1" step="0.01" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Charged"><Select value={f.price_unit} onChange={(e) => setF({ ...f, price_unit: e.target.value })}><option value="FIXED">Fixed</option><option value="PER_HOUR">Per hour</option><option value="PER_UNIT">Per unit</option></Select></Field>
        </div>
        <Field label="Notes (optional)"><Textarea rows={2} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

export function Availability() {
  const { data, loading, error, reload } = useFetch(() => get('/providers/me/availability'));
  const [slots, setSlots] = useState([]);
  const [saved, setSaved] = useState(false);
  const { busy, error: err, run } = useAction();
  useEffect(() => { if (data) setSlots(data.map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time }))); }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const upd = (i, k, v) => { setSaved(false); setSlots(slots.map((s, x) => (x === i ? { ...s, [k]: v } : s))); };
  const save = () => run(async () => { await put('/providers/me/availability', { slots }); setSaved(true); await reload(); });
  return (
    <>
      <PageHeader title="Availability" subtitle="Weekly hours when customers can book you" action={<Button onClick={save} disabled={busy}>Save changes</Button>} />
      <ErrorBox message={err} />{saved && <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Availability saved.</p>}
      <div className="space-y-3">
        {WEEKDAYS.map((day, wd) => {
          const rows = slots.map((s, i) => ({ ...s, i })).filter((s) => s.weekday === wd);
          return (
            <Card key={wd}><div className="flex flex-wrap items-center gap-4">
              <p className="w-28 font-medium">{day}</p>
              <div className="flex-1 space-y-2">
                {!rows.length && <p className="text-sm text-slate-400">Unavailable</p>}
                {rows.map((s) => (
                  <div key={s.i} className="flex items-center gap-2"><Input type="time" value={s.start_time} onChange={(e) => upd(s.i, 'start_time', e.target.value)} /><span>to</span><Input type="time" value={s.end_time} onChange={(e) => upd(s.i, 'end_time', e.target.value)} />
                    <button className="px-2 text-red-600" onClick={() => setSlots(slots.filter((_, x) => x !== s.i))} aria-label="Remove slot">✕</button></div>))}
              </div>
              <Button size="sm" variant="secondary" onClick={() => { setSaved(false); setSlots([...slots, { weekday: wd, start_time: '09:00', end_time: '18:00' }]); }}>+ Add hours</Button>
            </div></Card>
          );
        })}
      </div>
    </>
  );
}

export function Earnings() {
  const { data, loading, error, reload } = useFetch(() => get('/providers/me/earnings'));
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Earnings" subtitle="Based on completed jobs and their invoices" />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Completed jobs" value={data.completed_jobs} /><Stat label="Total invoiced" value={money(data.invoiced_paise)} />
        <Stat label="Payments received" value={money(data.paid_paise)} /><Stat label="Awaiting payment" value={money(data.unpaid_paise)} />
        <Stat label="Platform fees" value={money(data.platform_fees_paise)} hint="Based on agreed job prices" /><Stat label="Net after fees" value={money(data.net_paise)} />
      </div>
      <Card title="Monthly breakdown"><Table rows={data.monthly} rowKey={(r) => r.month} empty="No completed jobs yet." columns={[
        { header: 'Month', key: 'month' }, { header: 'Jobs', key: 'jobs' }, { header: 'Invoiced', render: (r) => money(r.invoiced_paise) }]} /></Card>
    </>
  );
}

export function ProviderReviews() {
  const { data, loading, error, reload } = useFetch(() => get('/reviews/mine'));
  return (
    <>
      <PageHeader title="Reviews" subtitle="What customers say about your work" />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data.length ? <Empty title="No reviews yet" hint="Reviews appear after customers rate completed jobs." /> : (
        <div className="space-y-3">{data.map((r) => (
          <Card key={r.id}><div className="flex items-center justify-between"><p className="font-medium">{r.service_name} · {r.customer_name}</p><span className="text-xs text-slate-400">{date(r.created_at)}</span></div>
            <Stars value={r.rating} /><p className="mt-1 text-sm text-slate-700">{r.comment || <i>No comment</i>}</p></Card>))}</div>
      )}
    </>
  );
}
