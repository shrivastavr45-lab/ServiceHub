import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, qs } from '../lib/api.js';
import { useFetch, useAction } from '../lib/hooks.js';
import { money, date, label, WEEKDAYS, rupeesToPaise } from '../lib/format.js';
import { useAuth, homeFor } from '../auth.jsx';
import { Button, LinkButton, Card, Field, Input, Select, Loading, ErrorBox, Empty, Stars, Pagination } from '../components/ui.jsx';

export function Landing() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const cats = useFetch(() => get('/categories'));
  const go = (e) => { e.preventDefault(); nav(`/providers${qs({ q, city })}`); };
  return (
    <>
      <section className="bg-gradient-to-br from-brand-600 to-brand-500 px-4 py-20 text-white">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-extrabold sm:text-5xl">Trusted local pros, one tap away</h1>
          <p className="mt-4 text-lg text-brand-100">Electricians, plumbers, AC technicians and more. Get quotes, negotiate a fair price, and book with confidence.</p>
          <form onSubmit={go} className="mt-8 flex flex-col gap-2 rounded-xl bg-white p-2 shadow-lg sm:flex-row">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What do you need? e.g. Electrician" aria-label="Service"
              className="flex-1 rounded-lg px-4 py-3 text-slate-800 focus:outline-none" />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" aria-label="City"
              className="rounded-lg px-4 py-3 text-slate-800 focus:outline-none sm:w-44" />
            <Button className="px-6 py-3">Search</Button>
          </form>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="mb-6 text-2xl font-bold">Popular categories</h2>
        {cats.loading ? <Loading /> : cats.error ? <ErrorBox message={cats.error} onRetry={cats.reload} /> : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {cats.data.map((c) => (
              <Link key={c.id} to={`/providers${qs({ category: c.slug })}`} className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm transition hover:border-brand-500 hover:shadow">
                <div className="text-3xl">{c.icon || '🛠️'}</div>
                <p className="mt-2 font-semibold">{c.name}</p>
                <p className="text-xs text-slate-500">{c.services.length} services</p>
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="border-t border-slate-200 bg-white px-4 py-14">
        <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-3">
          {[['1. Request', 'Pick a provider, describe the work and attach photos.'], ['2. Negotiate', 'Receive a quotation, counter-offer and agree on a price. Every offer is recorded.'], ['3. Book & review', 'Get the job done, receive an invoice, pay and rate your provider.']].map(([t, d]) => (
            <div key={t}><h3 className="text-lg font-semibold text-brand-600">{t}</h3><p className="mt-1 text-slate-600">{d}</p></div>
          ))}
        </div>
      </section>
    </>
  );
}

export function Categories() {
  const { data, loading, error, reload } = useFetch(() => get('/categories'));
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">Service categories</h1>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data.length ? <Empty title="No categories yet" /> : (
        <div className="grid gap-5 md:grid-cols-2">
          {data.map((c) => (
            <Card key={c.id} title={<span>{c.icon} {c.name}</span>} action={<Link className="text-sm font-medium text-brand-600" to={`/providers${qs({ category: c.slug })}`}>View providers →</Link>}>
              <div className="flex flex-wrap gap-2">
                {c.services.map((s) => <Link key={s.id} to={`/providers${qs({ service_id: s.id })}`} className="rounded-full bg-slate-100 px-3 py-1 text-sm hover:bg-brand-50 hover:text-brand-700">{s.name}</Link>)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProviderSearch() {
  const [sp, setSp] = useSearchParams();
  const f = Object.fromEntries(sp.entries());
  const cats = useFetch(() => get('/categories'));
  const { data, meta, loading, error, reload } = useFetch(() => get(`/providers${qs({ ...f, min_price: f.min_price ? rupeesToPaise(f.min_price) : '', max_price: f.max_price ? rupeesToPaise(f.max_price) : '' })}`), [sp.toString()]);
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('page'); setSp(n); };
  const [draft, setDraft] = useState(null);
  const d = draft ?? f;
  const apply = (e) => { e.preventDefault(); const n = new URLSearchParams(); Object.entries(d).forEach(([k, v]) => v && k !== 'page' && n.set(k, v)); setSp(n); };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[17rem_1fr]">
      <form onSubmit={apply} className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Filters</h2>
        <Field label="Search"><Input value={d.q || ''} onChange={(e) => setDraft({ ...d, q: e.target.value })} placeholder="Name, service…" /></Field>
        <Field label="Category">
          <Select value={d.category || ''} onChange={(e) => setDraft({ ...d, category: e.target.value })}>
            <option value="">All categories</option>
            {cats.data?.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="City"><Input value={d.city || ''} onChange={(e) => setDraft({ ...d, city: e.target.value })} placeholder="e.g. New Delhi" /></Field>
        <Field label="Pincode"><Input value={d.pincode || ''} onChange={(e) => setDraft({ ...d, pincode: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min ₹"><Input type="number" min="0" value={d.min_price || ''} onChange={(e) => setDraft({ ...d, min_price: e.target.value })} /></Field>
          <Field label="Max ₹"><Input type="number" min="0" value={d.max_price || ''} onChange={(e) => setDraft({ ...d, max_price: e.target.value })} /></Field>
        </div>
        <Field label="Minimum rating">
          <Select value={d.min_rating || ''} onChange={(e) => setDraft({ ...d, min_rating: e.target.value })}>
            <option value="">Any</option><option value="3">3★ & up</option><option value="4">4★ & up</option><option value="4.5">4.5★ & up</option>
          </Select>
        </Field>
        <Field label="Available on"><Input type="date" value={d.available_on || ''} onChange={(e) => setDraft({ ...d, available_on: e.target.value })} /></Field>
        <div className="flex gap-2">
          <Button className="flex-1">Apply</Button>
          <Button type="button" variant="secondary" onClick={() => { setDraft({}); setSp({}); }}>Clear</Button>
        </div>
      </form>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">{meta ? `${meta.total} provider${meta.total === 1 ? '' : 's'} found` : ' '}</p>
          <Select value={f.sort || 'rating'} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
            <option value="rating">Top rated</option><option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option><option value="experience">Most experienced</option>
          </Select>
        </div>
        {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data.length ? (
          <Empty title="No providers match your filters" hint="Try a different category, city or price range." />
        ) : (
          <div className="space-y-4">
            {data.map((p) => (
              <Link key={p.id} to={`/providers/${p.id}`} className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    <p className="text-sm text-slate-600">{p.headline}</p>
                    <p className="mt-1 text-xs text-slate-500">📍 {p.city || '—'} · {p.experience_years} yrs experience</p>
                  </div>
                  <div className="text-right"><Stars value={p.rating_avg} count={p.rating_count} /><p className="mt-1 text-sm text-slate-600">from <b>{money(p.min_price_paise)}</b></p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.services.slice(0, 5).map((s) => <span key={s.id} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs">{s.name} · {money(s.price_paise)}</span>)}
                </div>
              </Link>
            ))}
          </div>
        )}
        <Pagination meta={meta} onPage={(p) => set('page', p)} />
      </div>
    </div>
  );
}

export function ProviderProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data: p, loading, error, reload } = useFetch(() => get(`/providers/${id}`), [id]);
  if (loading) return <Loading />;
  if (error) return <div className="mx-auto max-w-3xl p-6"><ErrorBox message={error} onRetry={reload} /></div>;
  const request = (psId) => {
    if (!user) return nav('/login', { state: { from: `/providers/${id}` } });
    nav(`/customer/new-request/${psId}`);
  };
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <p className="text-slate-600">{p.headline}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-500">
            <Stars value={p.rating_avg} count={p.rating_count} /><span>📍 {p.city}</span><span>{p.experience_years} yrs experience</span><span>Member since {date(p.member_since)}</span>
          </div>
          {p.bio && <p className="mt-4 whitespace-pre-line text-slate-700">{p.bio}</p>}
          {p.skills?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{p.skills.map((s) => <span key={s} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{s}</span>)}</div>}
        </Card>
        <Card title="Services & prices">
          {!p.services.length ? <Empty title="No services listed" /> : (
            <ul className="divide-y divide-slate-100">
              {p.services.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div><p className="font-medium">{s.name}</p><p className="text-xs text-slate-500">{s.category}{s.description ? ` · ${s.description}` : ''}</p></div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{money(s.price_paise)}<span className="text-xs font-normal text-slate-500"> {label(s.price_unit).toLowerCase()}</span></span>
                    {(!user || user.role === 'CUSTOMER') && <Button size="sm" onClick={() => request(s.id)}>Request</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">Listed prices are starting points. The provider sends a quotation and you can negotiate.</p>
        </Card>
        <Card title={`Reviews (${p.rating_count})`}>
          {!p.reviews.length ? <p className="text-sm text-slate-500">No reviews yet.</p> : (
            <ul className="space-y-4">
              {p.reviews.map((r) => (
                <li key={r.id}><div className="flex items-center justify-between"><Stars value={r.rating} /><span className="text-xs text-slate-400">{date(r.created_at)}</span></div>
                  <p className="mt-1 text-sm text-slate-700">{r.comment || <i>No comment</i>}</p><p className="text-xs text-slate-500">— {r.customer_name}</p></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Service areas">{p.areas.length ? <ul className="space-y-1 text-sm">{p.areas.map((a, i) => <li key={i}>📍 {a.city}{a.pincode ? ` – ${a.pincode}` : ' (all areas)'}</li>)}</ul> : <p className="text-sm text-slate-500">Not specified</p>}</Card>
        <Card title="Weekly availability">
          {p.availability.length ? <ul className="space-y-1 text-sm">{p.availability.map((a, i) => <li key={i} className="flex justify-between"><span>{WEEKDAYS[a.weekday]}</span><span className="text-slate-600">{a.start_time}–{a.end_time}</span></li>)}</ul> : <p className="text-sm text-slate-500">Not specified</p>}
        </Card>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [f, setF] = useState({ email: '', password: '' });
  const { busy, error, run } = useAction();
  const submit = async (e) => {
    e.preventDefault();
    const u = await run(() => login(f.email, f.password));
    if (u) nav(loc.state?.from || homeFor(u.role), { replace: true });
  };
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card title="Welcome back">
        <form onSubmit={submit} className="space-y-4">
          <ErrorBox message={error} />
          <Field label="Email"><Input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Password"><Input type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Button className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          <p className="text-center text-sm text-slate-500">New here? <Link className="font-medium text-brand-600" to="/register">Create an account</Link></p>
        </form>
      </Card>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ role: sp.get('role') === 'provider' ? 'SERVICE_PROVIDER' : 'CUSTOMER', name: '', email: '', phone: '', city: '', password: '' });
  const [fieldErr, setFieldErr] = useState({});
  const { busy, error, run } = useAction();
  const submit = async (e) => {
    e.preventDefault();
    setFieldErr({});
    const body = { ...f }; if (!body.phone) delete body.phone; if (!body.city) delete body.city;
    try {
      const u = await register(body);
      nav(homeFor(u.role), { replace: true });
    } catch (err) {
      const fe = {}; (err.details || []).forEach((d) => { fe[d.path] = d.message; }); setFieldErr(fe);
      await run(async () => { throw err; });
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card title="Create your account">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
            {[['CUSTOMER', 'I need a service'], ['SERVICE_PROVIDER', 'I offer services']].map(([v, t]) => (
              <button type="button" key={v} onClick={() => setF({ ...f, role: v })} className={`rounded-md py-2 ${f.role === v ? 'bg-white shadow text-brand-700' : 'text-slate-600'}`}>{t}</button>
            ))}
          </div>
          <ErrorBox message={error} />
          <Field label="Full name" error={fieldErr.name}><Input required value={f.name} onChange={set('name')} /></Field>
          <Field label="Email" error={fieldErr.email}><Input type="email" required value={f.email} onChange={set('email')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" error={fieldErr.phone}><Input value={f.phone} onChange={set('phone')} /></Field>
            <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
          </div>
          <Field label="Password" error={fieldErr.password} hint="At least 8 characters, with a letter and a number"><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
          <Button className="w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button>
          <p className="text-center text-sm text-slate-500">Already registered? <Link className="font-medium text-brand-600" to="/login">Sign in</Link></p>
        </form>
      </Card>
    </div>
  );
}

export const NotFound = () => (
  <div className="mx-auto max-w-md px-4 py-20 text-center">
    <p className="text-5xl font-bold text-slate-300">404</p><p className="mt-2 text-slate-600">We couldn't find that page.</p>
    <LinkButton to="/" className="mt-6">Back to home</LinkButton>
  </div>
);
