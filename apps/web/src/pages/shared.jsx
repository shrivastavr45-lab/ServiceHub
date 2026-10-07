import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, patch, qs } from '../lib/api.js';
import { useFetch, useAction } from '../lib/hooks.js';
import { money, dateTime, date, label, rupeesToPaise, toIso } from '../lib/format.js';
import { useAuth } from '../auth.jsx';
import { Button, Card, Field, Input, Select, Textarea, Loading, ErrorBox, Empty, Badge, Pagination, PageHeader, Modal, Table } from '../components/ui.jsx';

const base = (role) => ({ CUSTOMER: '/customer', SERVICE_PROVIDER: '/provider', ADMIN: '/admin' }[role]);

// ---------------------------------------------------------------- Booking list
export function BookingList({ title, subtitle, statuses }) {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') || 1);
  const { data, meta, loading, error, reload } = useFetch(() => get(`/bookings${qs({ status: statuses.join(','), page })}`), [statuses.join(), page]);
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data.length ? (
        <Empty title="Nothing here yet" hint={user.role === 'CUSTOMER' ? 'Find a provider and send your first request.' : 'New activity will appear here.'}
          action={user.role === 'CUSTOMER' && <Link to="/providers" className="font-medium text-brand-600">Find providers →</Link>} />
      ) : (
        <div className="space-y-3">
          {data.map((b) => {
            const myTurn = ['QUOTED', 'NEGOTIATING'].includes(b.status) && b.pending_offer_by && b.pending_offer_by !== user.id;
            const needsQuote = user.role === 'SERVICE_PROVIDER' && b.status === 'REQUESTED';
            return (
              <Link key={b.id} to={`${base(user.role)}/bookings/${b.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-500">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{b.service_name} <span className="font-normal text-slate-500">· {b.category_name}</span></p>
                    <p className="text-sm text-slate-600">{user.role === 'CUSTOMER' ? `Provider: ${b.provider_name}` : `Customer: ${b.customer_name}`} · {b.city}</p>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-500">{b.description}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <Badge status={b.status} />
                    {(myTurn || needsQuote) && <p className="text-xs font-semibold text-orange-600">{needsQuote ? 'Awaiting your quote' : 'Your turn to respond'}</p>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  {b.agreed_price_paise ? <span>Agreed: <b className="text-slate-800">{money(b.agreed_price_paise)}</b></span>
                    : b.pending_offer_paise ? <span>Latest offer: <b className="text-slate-800">{money(b.pending_offer_paise)}</b></span> : <span>Listed from {money(b.listed_price_paise)}</span>}
                  {b.scheduled_at && <span>Scheduled: {dateTime(b.scheduled_at)}</span>}
                  <span>Updated {dateTime(b.updated_at)}</span>
                  {b.payment_status && <Badge status={b.payment_status} />}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <Pagination meta={meta} onPage={(p) => setSp({ page: p })} />
    </>
  );
}

// ---------------------------------------------------------------- Booking detail
const money0 = (v) => (v === '' || v == null ? 0 : rupeesToPaise(v) || 0);

function ActionCard({ title, children }) {
  return <Card title={title} className="border-brand-500/40">{children}</Card>;
}

function AmountForm({ submitLabel, onSubmit, placeholder }) {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => onSubmit(rupeesToPaise(amount), message || undefined)); }}>
      <ErrorBox message={error} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Amount (₹)"><Input type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={placeholder} /></Field>
        <Field label="Message (optional)"><Input value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} /></Field>
      </div>
      <Button disabled={busy}>{busy ? 'Sending…' : submitLabel}</Button>
    </form>
  );
}

function InvoiceForm({ booking, onDone }) {
  const [items, setItems] = useState([{ description: booking.service_name, quantity: 1, price: String((booking.agreed_price_paise || 0) / 100) }]);
  const [extra, setExtra] = useState('');
  const [discount, setDiscount] = useState('');
  const [tax, setTax] = useState('0');
  const { busy, error, run } = useAction();
  const subtotal = items.reduce((s, i) => s + Math.round(Number(i.quantity || 0) * money0(i.price)), 0);
  const taxable = subtotal + money0(extra) - money0(discount);
  const total = taxable + Math.round((taxable * Number(tax || 0)) / 100);
  const upd = (i, k, v) => setItems(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await post('/invoices', {
        booking_id: booking.id,
        items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_price_paise: money0(i.price) })),
        additional_charges_paise: money0(extra), discount_paise: money0(discount), tax_percent: Number(tax || 0),
      });
      onDone();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBox message={error} />
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-12 items-end gap-2">
          <div className="col-span-12 sm:col-span-6"><Field label={i === 0 ? 'Description' : undefined}><Input required value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} /></Field></div>
          <div className="col-span-4 sm:col-span-2"><Field label={i === 0 ? 'Qty' : undefined}><Input type="number" min="0.01" step="0.01" required value={it.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} /></Field></div>
          <div className="col-span-5 sm:col-span-3"><Field label={i === 0 ? 'Unit price (₹)' : undefined}><Input type="number" min="0" step="0.01" required value={it.price} onChange={(e) => upd(i, 'price', e.target.value)} /></Field></div>
          <div className="col-span-3 sm:col-span-1">{items.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, x) => x !== i))}>✕</Button>}</div>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => setItems([...items, { description: '', quantity: 1, price: '' }])}>+ Add line</Button>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Additional charges (₹)"><Input type="number" min="0" step="0.01" value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        <Field label="Discount (₹)"><Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
        <Field label="Tax / GST (%)"><Input type="number" min="0" max="100" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
      </div>
      <p className="text-right text-lg font-semibold">Total: {money(Math.max(total, 0))}</p>
      <Button disabled={busy}>{busy ? 'Generating…' : 'Generate invoice'}</Button>
    </form>
  );
}

function PayForm({ invoice, onDone }) {
  const [method, setMethod] = useState('UPI');
  const [reference, setReference] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/payments', { invoice_id: invoice.id, method, reference: reference || undefined }); onDone(); }); }}>
      <ErrorBox message={error} />
      <p className="text-sm text-slate-600">Amount due: <b>{money(invoice.total_paise)}</b>. Payments are recorded here; no money moves through ServiceHub yet.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'].map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
        <Field label="Reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID" /></Field>
      </div>
      <Button disabled={busy}>{busy ? 'Recording…' : 'Mark as paid'}</Button>
    </form>
  );
}

function ReviewForm({ booking, onDone }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const { busy, error, run } = useAction();
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/reviews', { booking_id: booking.id, rating, comment: comment || undefined }); onDone(); }); }}>
      <ErrorBox message={error} />
      <div className="flex gap-1 text-3xl" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} onClick={() => setRating(n)} aria-label={`${n} stars`} className={n <= rating ? 'text-amber-500' : 'text-slate-300'}>★</button>)}
      </div>
      <Field label="Your review"><Textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="How was the work?" /></Field>
      <Button disabled={busy}>Submit review</Button>
    </form>
  );
}

function ReasonModal({ open, onClose, title, cta, onSubmit, withType }) {
  const [reason, setReason] = useState('');
  const [type, setType] = useState('SERVICE_QUALITY');
  const { busy, error, run } = useAction();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await onSubmit(reason, type); onClose(); }); }}>
        <ErrorBox message={error} />
        {withType && <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{['WORK_INCOMPLETE', 'WRONG_PRICE', 'PAYMENT_ISSUE', 'SERVICE_QUALITY', 'CANCELLATION', 'OTHER'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>}
        <Field label="Details"><Textarea rows={4} required minLength={withType ? 10 : 3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Close</Button><Button variant="danger" disabled={busy}>{cta}</Button></div>
      </form>
    </Modal>
  );
}

export function BookingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: b, loading, error, reload } = useFetch(() => get(`/bookings/${id}`), [id]);
  const [invoice, setInvoice] = useState(null);
  const [modal, setModal] = useState(null);
  const act = useAction();
  const [when, setWhen] = useState('');

  useEffect(() => {
    if (b?.invoice) get(`/invoices/${b.invoice.id}`).then((r) => setInvoice(r.data)).catch(() => {});
    else setInvoice(null);
    if (b?.preferred_at && !when) setWhen(new Date(new Date(b.preferred_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.id, b?.invoice?.id, b?.status]);

  if (loading && !b) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const isCustomer = user.role === 'CUSTOMER';
  const isProvider = user.role === 'SERVICE_PROVIDER';
  const pending = b.offers.find((o) => o.status === 'PENDING');
  const myTurn = pending && pending.offered_by !== user.id && (isCustomer || isProvider);
  const call = (fn) => act.run(async () => { await fn(); await reload(); });
  const other = isCustomer ? { id: b.provider_id, name: b.provider_name, phone: b.provider_phone } : { id: b.customer_id, name: b.customer_name, phone: b.customer_phone };
  const canCancel = user.role === 'ADMIN' ? b.status !== 'CANCELLED' : ['REQUESTED', 'QUOTED', 'NEGOTIATING', 'ACCEPTED', 'SCHEDULED'].includes(b.status);
  const canDispute = (isCustomer || isProvider) && ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status);

  return (
    <div className="space-y-6">
      <PageHeader title={b.service_name} subtitle={`${b.category_name} · requested ${dateTime(b.created_at)}`} action={<Badge status={b.status} />} />
      <ErrorBox message={act.error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* ----- Actions ----- */}
          {isProvider && b.status === 'REQUESTED' && (
            <ActionCard title="Respond to this request">
              <p className="mb-3 text-sm text-slate-600">Your listed price: <b>{money(b.listed_price_paise)}</b>. Send a quotation or decline.</p>
              <AmountForm submitLabel="Send quotation" placeholder={String((b.listed_price_paise || 0) / 100)} onSubmit={(amount, message) => call(() => post('/quotations', { booking_id: b.id, amount_paise: amount, message }))} />
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setModal('decline')}>Decline request</Button>
            </ActionCard>
          )}
          {myTurn && ['QUOTED', 'NEGOTIATING'].includes(b.status) && (
            <ActionCard title={`${pending.offered_by_name} offered ${money(pending.amount_paise)}`}>
              <div className="mb-4 flex flex-wrap gap-2">
                <Button disabled={act.busy} onClick={() => call(() => post(`/negotiations/${b.id}/accept`))}>Accept {money(pending.amount_paise)}</Button>
                <Button variant="secondary" onClick={() => setModal('reject')}>Reject & cancel</Button>
              </div>
              <p className="mb-2 text-sm font-medium text-slate-700">Or make a counter-offer</p>
              <AmountForm submitLabel="Send counter-offer" onSubmit={(amount, message) => call(() => post(`/negotiations/${b.id}/counter`, { amount_paise: amount, message }))} />
            </ActionCard>
          )}
          {pending && !myTurn && !['ADMIN'].includes(user.role) && ['QUOTED', 'NEGOTIATING'].includes(b.status) && (
            <Card><p className="text-sm text-slate-600">⏳ Waiting for <b>{other.name}</b> to respond to your offer of <b>{money(pending.amount_paise)}</b>.</p></Card>
          )}
          {isProvider && b.status === 'ACCEPTED' && (
            <ActionCard title="Schedule the job">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Date & time"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
                <Button disabled={act.busy || !when} onClick={() => call(() => post(`/bookings/${b.id}/schedule`, { scheduled_at: toIso(when) }))}>Confirm schedule</Button>
              </div>
            </ActionCard>
          )}
          {isProvider && b.status === 'SCHEDULED' && <ActionCard title="Ready to begin?"><Button disabled={act.busy} onClick={() => call(() => post(`/bookings/${b.id}/start`))}>Start work</Button></ActionCard>}
          {isProvider && b.status === 'IN_PROGRESS' && <ActionCard title="Finished the job?"><Button disabled={act.busy} onClick={() => call(() => post(`/bookings/${b.id}/complete`))}>Mark as completed</Button></ActionCard>}
          {isProvider && b.status === 'COMPLETED' && !b.invoice && <ActionCard title="Generate invoice"><InvoiceForm booking={b} onDone={reload} /></ActionCard>}
          {isCustomer && invoice && invoice.payment_status === 'UNPAID' && ['COMPLETED'].includes(b.status) && <ActionCard title={`Pay invoice ${invoice.invoice_number}`}><PayForm invoice={invoice} onDone={reload} /></ActionCard>}
          {isProvider && invoice && invoice.payment_status === 'UNPAID' && <Card title="Received payment in person?"><PayForm invoice={invoice} onDone={reload} /></Card>}
          {isCustomer && b.status === 'COMPLETED' && !b.review && <ActionCard title="Rate your provider"><ReviewForm booking={b} onDone={reload} /></ActionCard>}
          {b.review && <Card title="Review"><p className="text-amber-500">{'★'.repeat(b.review.rating)}<span className="text-slate-300">{'★'.repeat(5 - b.review.rating)}</span></p><p className="text-sm text-slate-700">{b.review.comment || 'No comment'}</p></Card>}

          {/* ----- Details ----- */}
          <Card title="Request details">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Customer</dt><dd className="font-medium">{b.customer_name}{b.customer_phone ? ` · ${b.customer_phone}` : ''}</dd></div>
              <div><dt className="text-slate-500">Provider</dt><dd className="font-medium"><Link className="text-brand-600" to={`/providers/${b.provider_id}`}>{b.provider_name}</Link>{b.provider_phone ? ` · ${b.provider_phone}` : ''}</dd></div>
              <div><dt className="text-slate-500">Address</dt><dd>{b.address}, {b.city} {b.pincode}</dd></div>
              <div><dt className="text-slate-500">Preferred time</dt><dd>{dateTime(b.preferred_at)}</dd></div>
              <div><dt className="text-slate-500">Scheduled for</dt><dd>{dateTime(b.scheduled_at)}</dd></div>
              <div><dt className="text-slate-500">Agreed price</dt><dd className="font-semibold">{b.agreed_price_paise ? money(b.agreed_price_paise) : '—'}</dd></div>
              {b.platform_fee_paise != null && user.role !== 'CUSTOMER' && <div><dt className="text-slate-500">Platform fee ({b.platform_fee_percent}%)</dt><dd>{money(b.platform_fee_paise)}</dd></div>}
              {b.cancelled_reason && <div className="sm:col-span-2"><dt className="text-slate-500">Cancellation reason</dt><dd>{b.cancelled_reason}</dd></div>}
            </dl>
            <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{b.description}</p>
            {!b.agreed_price_paise && user.role !== 'ADMIN' && <p className="mt-3 text-xs text-slate-500">Phone numbers are shared once a price is agreed.</p>}
            {b.attachments.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{b.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name} className="h-24 w-24 rounded-lg border object-cover" /></a>)}</div>}
          </Card>

          {b.invoice && (
            <Card title="Invoice" action={<Link className="text-sm font-medium text-brand-600" to={`${base(user.role)}/invoices/${b.invoice.id}`}>Open →</Link>}>
              <p className="text-sm">{b.invoice.invoice_number} · <b>{money(b.invoice.total_paise)}</b> · <Badge status={b.invoice.payment_status} /></p>
            </Card>
          )}
          {b.disputes.length > 0 && (
            <Card title="Disputes">{b.disputes.map((d) => (
              <div key={d.id} className="mb-3 text-sm"><div className="flex items-center gap-2"><b>{label(d.reason)}</b><Badge status={d.status} /></div><p className="text-slate-600">{d.description}</p>{d.resolution && <p className="mt-1 text-emerald-700">Resolution: {d.resolution}</p>}</div>
            ))}</Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Negotiation history">
            {!b.offers.length ? <p className="text-sm text-slate-500">No offers yet.</p> : (
              <ol className="space-y-3">
                {b.offers.map((o) => (
                  <li key={o.id} className={`rounded-lg border p-3 text-sm ${o.status === 'ACCEPTED' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between"><span className="font-semibold">{money(o.amount_paise)}</span><Badge status={o.status} /></div>
                    <p className="text-xs text-slate-500">{o.offered_by_name} ({o.offered_by_role === 'CUSTOMER' ? 'customer' : 'provider'}) · {dateTime(o.created_at)}</p>
                    {o.message && <p className="mt-1 text-slate-700">“{o.message}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Status timeline">
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
              {b.history.map((h, i) => (
                <li key={i} className="relative text-sm"><span className="absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <p className="font-medium">{label(h.to_status)}</p><p className="text-xs text-slate-500">{dateTime(h.created_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</p>{h.note && <p className="text-xs text-slate-600">{h.note}</p>}</li>
              ))}
            </ol>
          </Card>
          {(canCancel || canDispute) && (
            <Card title="Other actions">
              <div className="flex flex-wrap gap-2">
                {canCancel && b.status !== 'CANCELLED' && <Button variant="secondary" size="sm" onClick={() => setModal('cancel')}>Cancel booking</Button>}
                {canDispute && <Button variant="secondary" size="sm" onClick={() => setModal('dispute')}>Raise dispute</Button>}
                {(isCustomer || isProvider) && <Button variant="ghost" size="sm" onClick={() => setModal('report')}>Report {other.name.split(' ')[0]}</Button>}
              </div>
              {['IN_PROGRESS', 'COMPLETED'].includes(b.status) && <p className="mt-2 text-xs text-slate-500">Once work has started, a booking can only be disputed, not cancelled.</p>}
            </Card>
          )}
        </div>
      </div>

      <ReasonModal open={modal === 'decline'} onClose={() => setModal(null)} title="Decline request" cta="Decline" onSubmit={(r) => call(() => post(`/bookings/${b.id}/reject`, { reason: r }))} />
      <ReasonModal open={modal === 'reject'} onClose={() => setModal(null)} title="Reject this offer" cta="Reject & cancel" onSubmit={(r) => call(() => post(`/negotiations/${b.id}/reject`, { reason: r }))} />
      <ReasonModal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel booking" cta="Cancel booking" onSubmit={(r) => call(() => post(`/bookings/${b.id}/cancel`, { reason: r }))} />
      <ReasonModal open={modal === 'dispute'} withType onClose={() => setModal(null)} title="Raise a dispute" cta="Submit dispute" onSubmit={(r, t) => call(() => post('/disputes', { booking_id: b.id, reason: t, description: r }))} />
      <ReasonModal open={modal === 'report'} onClose={() => setModal(null)} title={`Report ${other.name}`} cta="Submit report" onSubmit={(r) => post('/reports', { reported_user_id: other.id, reason: 'Reported from booking', details: r })} />
    </div>
  );
}

// ---------------------------------------------------------------- Invoices
export function InvoiceList() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const { data, meta, loading, error, reload } = useFetch(() => get(`/invoices?page=${page}`), [page]);
  return (
    <>
      <PageHeader title="Invoices" />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <Table rows={data} empty="No invoices yet. They appear once a job is completed."
          columns={[
            { header: 'Invoice', render: (i) => <Link className="font-medium text-brand-600" to={`${base(user.role)}/invoices/${i.id}`}>{i.invoice_number}</Link> },
            { header: 'Service', key: 'service_name' },
            { header: user.role === 'CUSTOMER' ? 'Provider' : 'Customer', render: (i) => (user.role === 'CUSTOMER' ? i.provider_name : i.customer_name) },
            { header: 'Date', render: (i) => date(i.issued_at) },
            { header: 'Total', render: (i) => money(i.total_paise) },
            { header: 'Status', render: (i) => <Badge status={i.payment_status} /> },
          ]} />
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

export function InvoiceView() {
  const { id } = useParams();
  const { data: inv, loading, error, reload } = useFetch(() => get(`/invoices/${id}`), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const c = inv.customer_snapshot; const p = inv.provider_snapshot;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => window.print()}>🖨 Print / Save as PDF</Button></div>
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <div className="flex justify-between border-b border-slate-200 pb-6">
          <div><h1 className="text-2xl font-bold text-brand-600">INVOICE</h1><p className="mt-1 text-sm text-slate-500">{inv.invoice_number}</p></div>
          <div className="text-right text-sm"><p>Date: <b>{date(inv.issued_at)}</b></p><p className="mt-1"><Badge status={inv.payment_status} /></p></div>
        </div>
        <div className="grid gap-6 py-6 text-sm sm:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase text-slate-500">From (provider)</p><p className="font-semibold">{p.name}</p>{p.city && <p>{p.city}</p>}{p.phone && <p>{p.phone}</p>}{p.email && <p>{p.email}</p>}{p.gstin && <p>GSTIN: {p.gstin}</p>}</div>
          <div><p className="text-xs font-semibold uppercase text-slate-500">Billed to (customer)</p><p className="font-semibold">{c.name}</p>{c.address && <p>{c.address}</p>}<p>{[c.city, c.pincode].filter(Boolean).join(' ')}</p>{c.phone && <p>{c.phone}</p>}</div>
        </div>
        <p className="mb-2 text-sm"><span className="text-slate-500">Service:</span> <b>{inv.service_name}</b></p>
        {inv.description && <p className="mb-4 text-sm text-slate-600">{inv.description}</p>}
        <table className="w-full text-sm">
          <thead className="border-y border-slate-200 text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{inv.items.map((i, k) => <tr key={k} className="border-b border-slate-100"><td className="py-2">{i.description}</td><td className="text-right">{Number(i.quantity)}</td><td className="text-right">{money(i.unit_price_paise)}</td><td className="text-right">{money(i.amount_paise)}</td></tr>)}</tbody>
        </table>
        <dl className="ml-auto mt-4 w-64 space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(inv.subtotal_paise)}</dd></div>
          {inv.additional_charges_paise > 0 && <div className="flex justify-between"><dt>Additional charges</dt><dd>{money(inv.additional_charges_paise)}</dd></div>}
          {inv.discount_paise > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{money(inv.discount_paise)}</dd></div>}
          {Number(inv.tax_percent) > 0 && <div className="flex justify-between"><dt>Tax ({Number(inv.tax_percent)}%)</dt><dd>{money(inv.tax_paise)}</dd></div>}
          <div className="flex justify-between border-t border-slate-300 pt-2 text-lg font-bold"><dt>Total</dt><dd>{money(inv.total_paise)}</dd></div>
        </dl>
        {inv.payments.length > 0 && <p className="mt-6 text-sm text-slate-600">Paid via {label(inv.payments[0].method)} on {date(inv.payments[0].paid_at)}{inv.payments[0].reference ? ` (ref ${inv.payments[0].reference})` : ''}.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Notifications
export function Notifications() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const { data, meta, loading, error, reload } = useFetch(() => get(`/notifications?page=${page}`), [page]);
  const changed = () => window.dispatchEvent(new Event('notifications-changed'));
  const readAll = async () => { await post('/notifications/read-all'); await reload(); changed(); };
  const markRead = async (n) => { if (!n.read_at) { await post(`/notifications/${n.id}/read`); changed(); reload(); } };
  const link = (n) => (n.data?.booking_id ? `${base(user.role)}/bookings/${n.data.booking_id}` : null);
  return (
    <>
      <PageHeader title="Notifications" action={<Button variant="secondary" size="sm" onClick={readAll}>Mark all as read</Button>} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data.length ? <Empty title="You're all caught up" hint="Updates about your bookings will appear here." /> : (
        <ul className="space-y-2">
          {data.map((n) => (
            <li key={n.id} className={`rounded-xl border p-4 ${n.read_at ? 'border-slate-200 bg-white' : 'border-brand-500/40 bg-brand-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-medium">{n.title}</p><p className="text-sm text-slate-600">{n.body}</p><p className="mt-1 text-xs text-slate-400">{dateTime(n.created_at)}</p></div>
                <div className="flex shrink-0 gap-2">
                  {link(n) && <Link to={link(n)} onClick={() => markRead(n)} className="text-sm font-medium text-brand-600">View</Link>}
                  {!n.read_at && <button onClick={() => markRead(n)} className="text-sm text-slate-500 hover:underline">Mark read</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}

// ---------------------------------------------------------------- Profile (customer + provider)
export function Profile() {
  const { user } = useAuth();
  return user.role === 'SERVICE_PROVIDER' ? <ProviderProfileForm /> : <CustomerProfileForm />;
}

function CustomerProfileForm() {
  const { data, loading, error, reload } = useFetch(() => get('/users/me'));
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const { busy, error: err, run } = useAction();
  useEffect(() => { if (data) setF({ name: data.name, phone: data.phone || '', address: data.profile?.address || '', city: data.profile?.city || '', pincode: data.profile?.pincode || '' }); }, [data]);
  if (loading || !f) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const set = (k) => (e) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  const save = (e) => { e.preventDefault(); run(async () => { await patch('/users/me', { name: f.name, phone: f.phone || null, address: f.address || null, city: f.city || null, pincode: f.pincode || null }); setSaved(true); }); };
  return (
    <>
      <PageHeader title="My profile" subtitle={data.email} />
      <Card className="max-w-2xl"><form onSubmit={save} className="space-y-4">
        <ErrorBox message={err} />{saved && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Profile saved.</p>}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><Input required value={f.name} onChange={set('name')} /></Field><Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field></div>
        <Field label="Address"><Input value={f.address} onChange={set('address')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="City"><Input value={f.city} onChange={set('city')} /></Field><Field label="Pincode"><Input value={f.pincode} onChange={set('pincode')} /></Field></div>
        <Button disabled={busy}>Save changes</Button>
      </form></Card>
      <PasswordCard />
    </>
  );
}

function PasswordCard() {
  const [f, setF] = useState({ current_password: '', new_password: '' });
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Card title="Change password" className="mt-6 max-w-2xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/users/me/password', f); setDone(true); setF({ current_password: '', new_password: '' }); }); }}>
        <ErrorBox message={error} />{done && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Password updated. Other devices were signed out.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password"><Input type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
          <Field label="New password" hint="8+ chars with a letter and number"><Input type="password" required minLength={8} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        </div>
        <Button variant="secondary" disabled={busy}>Update password</Button>
      </form>
    </Card>
  );
}

function ProviderProfileForm() {
  const { data, loading, error, reload } = useFetch(() => get('/providers/me/profile'));
  const areas = useFetch(() => get('/providers/me/areas'));
  const [f, setF] = useState(null);
  const [areaList, setAreaList] = useState([]);
  const [newArea, setNewArea] = useState({ city: '', pincode: '' });
  const [saved, setSaved] = useState('');
  const { busy, error: err, run } = useAction();
  useEffect(() => { if (data) setF({ headline: data.headline || '', bio: data.bio || '', experience_years: data.experience_years, skills: (data.skills || []).join(', '), city: data.city || '', gstin: data.gstin || '', phone: data.phone || '' }); }, [data]);
  useEffect(() => { if (areas.data) setAreaList(areas.data.map(({ city, pincode }) => ({ city, pincode }))); }, [areas.data]);
  if (loading || !f) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const set = (k) => (e) => { setSaved(''); setF({ ...f, [k]: e.target.value }); };
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await put('/providers/me/profile', { headline: f.headline || null, bio: f.bio || null, experience_years: Number(f.experience_years || 0), city: f.city || null, gstin: f.gstin || null, skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean) });
      await patch('/users/me', { phone: f.phone || null });
      setSaved('Profile saved.');
    });
  };
  const saveAreas = (list) => run(async () => { await put('/providers/me/areas', { areas: list.map((a) => ({ city: a.city, pincode: a.pincode || null })) }); await areas.reload(); setSaved('Service areas saved.'); });
  return (
    <>
      <PageHeader title="Professional profile" subtitle={data.email} action={<Link className="text-sm font-medium text-brand-600" to={`/providers/${data.user_id}`}>View public profile →</Link>} />
      {data.verification_status !== 'APPROVED' && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Your profile is <b>{data.verification_status.toLowerCase()}</b> and is hidden from search until an admin approves it.</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2"><form onSubmit={save} className="space-y-4">
          <ErrorBox message={err} />{saved && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{saved}</p>}
          <Field label="Headline"><Input maxLength={120} value={f.headline} onChange={set('headline')} placeholder="e.g. Licensed electrician, 10 yrs" /></Field>
          <Field label="About you"><Textarea value={f.bio} onChange={set('bio')} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Years of experience"><Input type="number" min="0" max="70" value={f.experience_years} onChange={set('experience_years')} /></Field>
            <Field label="Home city"><Input value={f.city} onChange={set('city')} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={set('phone')} /></Field>
          </div>
          <Field label="Skills" hint="Comma-separated"><Input value={f.skills} onChange={set('skills')} /></Field>
          <Field label="GSTIN (optional)" hint="Shown on your invoices"><Input value={f.gstin} onChange={set('gstin')} /></Field>
          <Button disabled={busy}>Save profile</Button>
        </form></Card>
        <Card title="Service areas">
          <ul className="mb-3 space-y-2 text-sm">
            {areaList.map((a, i) => <li key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span>{a.city}{a.pincode ? ` – ${a.pincode}` : ' (whole city)'}</span><button className="text-red-600" onClick={() => saveAreas(areaList.filter((_, x) => x !== i))} aria-label="Remove area">✕</button></li>)}
            {!areaList.length && <li className="text-slate-500">No areas yet.</li>}
          </ul>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); const l = [...areaList, newArea]; setNewArea({ city: '', pincode: '' }); saveAreas(l); }}>
            <Input required placeholder="City" value={newArea.city} onChange={(e) => setNewArea({ ...newArea, city: e.target.value })} />
            <Input placeholder="Pincode (optional)" value={newArea.pincode} onChange={(e) => setNewArea({ ...newArea, pincode: e.target.value })} />
            <Button size="sm" variant="secondary" disabled={busy}>Add area</Button>
          </form>
        </Card>
      </div>
      <PasswordCard />
    </>
  );
}
