import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, postForm } from '../lib/api.js';
import { useFetch, useAction } from '../lib/hooks.js';
import { money, dateTime, date, toIso } from '../lib/format.js';
import { useAuth } from '../auth.jsx';
import { Button, LinkButton, Card, Field, Input, Textarea, Loading, ErrorBox, Empty, Badge, Stat, PageHeader, Table, Stars } from '../components/ui.jsx';

export function CustomerDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useFetch(() => get('/bookings?limit=100'));
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const active = data.filter((b) => !['COMPLETED', 'CANCELLED'].includes(b.status));
  const respond = data.filter((b) => ['QUOTED', 'NEGOTIATING'].includes(b.status) && b.pending_offer_by !== user.id);
  const toPay = data.filter((b) => b.status === 'COMPLETED' && b.payment_status === 'UNPAID');
  const toReview = data.filter((b) => b.status === 'COMPLETED' && !b.reviewed);
  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]} 👋`} subtitle="Here's what's happening with your service requests."
        action={<LinkButton to="/providers">Find a provider</LinkButton>} />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active bookings" value={active.length} />
        <Stat label="Quotes to respond to" value={respond.length} />
        <Stat label="Invoices to pay" value={toPay.length} />
        <Stat label="Awaiting your review" value={toReview.length} />
      </div>
      {respond.length > 0 && (
        <Card title="Needs your response" className="mb-6">
          <ul className="divide-y divide-slate-100">{respond.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2 text-sm"><span>{b.service_name} · {b.provider_name} · <b>{money(b.pending_offer_paise)}</b></span><Link className="font-medium text-brand-600" to={`/customer/bookings/${b.id}`}>Review →</Link></li>
          ))}</ul>
        </Card>
      )}
      <Card title="Recent activity" action={<Link to="/customer/bookings" className="text-sm font-medium text-brand-600">All bookings</Link>}>
        {!data.length ? <Empty title="No bookings yet" hint="Search for a provider to send your first request." /> : (
          <ul className="divide-y divide-slate-100">{data.slice(0, 6).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div><Link to={`/customer/bookings/${b.id}`} className="font-medium text-slate-900 hover:text-brand-600">{b.service_name}</Link><p className="text-xs text-slate-500">{b.provider_name} · {dateTime(b.updated_at)}</p></div><Badge status={b.status} />
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}

export function NewRequest() {
  const { providerServiceId } = useParams();
  const nav = useNavigate();
  const svc = useFetch(() => get(`/providers/services/${providerServiceId}`), [providerServiceId]);
  const me = useFetch(() => get('/users/me'));
  const [f, setF] = useState({ description: '', address: '', city: '', pincode: '', preferred_at: '' });
  const [files, setFiles] = useState([]);
  const { busy, error, run } = useAction();
  useEffect(() => { if (me.data?.profile) setF((x) => ({ ...x, address: me.data.profile.address || '', city: me.data.profile.city || '', pincode: me.data.profile.pincode || '' })); }, [me.data]);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  if (svc.loading) return <Loading />;
  if (svc.error) return <ErrorBox message={svc.error} onRetry={svc.reload} />;
  const s = svc.data;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pick = (e) => setFiles([...files, ...Array.from(e.target.files)].slice(0, 5));
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const fd = new FormData();
      fd.append('provider_service_id', providerServiceId);
      fd.append('description', f.description); fd.append('address', f.address); fd.append('city', f.city);
      if (f.pincode) fd.append('pincode', f.pincode);
      if (f.preferred_at) fd.append('preferred_at', toIso(f.preferred_at));
      files.forEach((file) => fd.append('images', file));
      const r = await postForm('/requests', fd);
      nav(`/customer/bookings/${r.data.id}`);
    });
  };
  return (
    <>
      <PageHeader title="Request a service" subtitle={`${s.service_name} · ${s.provider_name} · listed from ${money(s.price_paise)}`} />
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <ErrorBox message={error} />
          <Field label="Describe the work required" hint="The more detail, the more accurate the quotation."><Textarea required minLength={10} maxLength={2000} value={f.description} onChange={set('description')} /></Field>
          <Field label="Service address"><Input required minLength={5} value={f.address} onChange={set('address')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="City"><Input required value={f.city} onChange={set('city')} /></Field><Field label="Pincode"><Input value={f.pincode} onChange={set('pincode')} /></Field></div>
          <Field label="Preferred date & time (optional)"><Input type="datetime-local" min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} value={f.preferred_at} onChange={set('preferred_at')} /></Field>
          <Field label="Photos (optional, up to 5 · JPEG, PNG or WebP · max 5 MB each)">
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={pick} disabled={files.length >= 5} className="block w-full text-sm" />
          </Field>
          {files.length > 0 && <div className="flex flex-wrap gap-3">{previews.map((u, i) => (
            <div key={u} className="relative"><img src={u} alt="" className="h-20 w-20 rounded-lg border object-cover" />
              <button type="button" onClick={() => setFiles(files.filter((_, x) => x !== i))} className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-red-600 text-xs text-white" aria-label="Remove">✕</button></div>))}</div>}
          <div className="flex gap-2"><Button disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button><LinkButton variant="secondary" to={`/providers/${s.provider_id}`}>Back</LinkButton></div>
        </form>
      </Card>
    </>
  );
}

export function CustomerPayments() {
  const { data, loading, error, reload } = useFetch(() => get('/payments?limit=100'));
  return (
    <>
      <PageHeader title="Payments" subtitle="Payments you've recorded against invoices" />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} empty="No payments recorded yet." columns={[
          { header: 'Invoice', render: (p) => <Link className="font-medium text-brand-600" to={`/customer/invoices/${p.invoice_id}`}>{p.invoice_number}</Link> },
          { header: 'Service', key: 'service_name' }, { header: 'Date', render: (p) => date(p.paid_at) },
          { header: 'Method', key: 'method' }, { header: 'Amount', render: (p) => money(p.amount_paise) }, { header: 'Status', render: (p) => <Badge status={p.status} /> },
        ]} />
      )}
    </>
  );
}

export function CustomerReviews() {
  const mine = useFetch(() => get('/reviews/mine'));
  const pending = useFetch(() => get('/bookings?status=COMPLETED&limit=100'));
  const todo = (pending.data || []).filter((b) => !b.reviewed);
  return (
    <>
      <PageHeader title="Reviews" />
      {todo.length > 0 && (
        <Card title="Waiting for your review" className="mb-6"><ul className="divide-y divide-slate-100">{todo.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-2 text-sm"><span>{b.service_name} · {b.provider_name}</span><Link className="font-medium text-brand-600" to={`/customer/bookings/${b.id}`}>Write review →</Link></li>))}</ul></Card>
      )}
      {mine.loading ? <Loading /> : mine.error ? <ErrorBox message={mine.error} onRetry={mine.reload} /> : !mine.data.length ? <Empty title="You haven't written any reviews yet" /> : (
        <div className="space-y-3">{mine.data.map((r) => (
          <Card key={r.id}><div className="flex items-center justify-between"><p className="font-medium">{r.service_name} · {r.provider_name}</p><span className="text-xs text-slate-400">{date(r.created_at)}</span></div>
            <Stars value={r.rating} /><p className="mt-1 text-sm text-slate-700">{r.comment || <i>No comment</i>}</p></Card>))}</div>
      )}
    </>
  );
}
