import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../auth.jsx';
import { get } from '../lib/api.js';
import { Button, LinkButton } from './ui.jsx';

export function Brand() {
  return <Link to="/" className="flex items-center gap-2 text-lg font-bold text-brand-600"><span aria-hidden>🛠️</span> ServiceHub</Link>;
}

export function PublicLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Brand />
          <nav className="hidden gap-6 text-sm font-medium text-slate-600 sm:flex">
            <NavLink to="/categories" className="hover:text-brand-600">Categories</NavLink>
            <NavLink to="/providers" className="hover:text-brand-600">Find providers</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <LinkButton to={homeFor(user.role)} size="sm">Dashboard</LinkButton>
                <Button variant="secondary" size="sm" onClick={async () => { await logout(); nav('/'); }}>Logout</Button>
              </>
            ) : (
              <>
                <LinkButton to="/login" variant="ghost" size="sm">Login</LinkButton>
                <LinkButton to="/register" size="sm">Sign up</LinkButton>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-sm text-slate-500">© {new Date().getFullYear()} ServiceHub · Trusted local professionals</footer>
    </div>
  );
}

const NAV = {
  CUSTOMER: [
    ['/customer', 'Dashboard', true], ['/providers', 'Find providers'], ['/customer/requests', 'My requests'],
    ['/customer/quotations', 'Quotations & negotiation'], ['/customer/bookings', 'Bookings'], ['/customer/invoices', 'Invoices'],
    ['/customer/payments', 'Payments'], ['/customer/reviews', 'Reviews'], ['/customer/notifications', 'Notifications'], ['/customer/profile', 'Profile'],
  ],
  SERVICE_PROVIDER: [
    ['/provider', 'Dashboard', true], ['/provider/requests', 'Service requests'], ['/provider/quotations', 'Quotations & negotiation'],
    ['/provider/bookings', 'Bookings'], ['/provider/services', 'My services'], ['/provider/availability', 'Availability'],
    ['/provider/earnings', 'Earnings'], ['/provider/invoices', 'Invoices'], ['/provider/reviews', 'Reviews'],
    ['/provider/notifications', 'Notifications'], ['/provider/profile', 'Profile'],
  ],
  ADMIN: [
    ['/admin', 'Dashboard', true], ['/admin/customers', 'Customers'], ['/admin/providers', 'Providers'], ['/admin/categories', 'Categories'],
    ['/admin/services', 'Services'], ['/admin/bookings', 'Bookings'], ['/admin/disputes', 'Disputes'], ['/admin/reviews', 'Reviews'],
    ['/admin/reports', 'Reports'], ['/admin/audit-logs', 'Audit logs'], ['/admin/settings', 'Settings'],
  ],
};

function useUnread(role) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (role === 'ADMIN') return undefined;
    let alive = true;
    const tick = () => get('/notifications/unread-count').then((r) => alive && setN(r.data.count)).catch(() => {});
    tick();
    const t = setInterval(tick, 30000);
    const onRead = () => tick();
    window.addEventListener('notifications-changed', onRead);
    return () => { alive = false; clearInterval(t); window.removeEventListener('notifications-changed', onRead); };
  }, [role]);
  return n;
}

export function DashboardLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useUnread(user.role);
  const items = NAV[user.role];
  const notifPath = user.role === 'CUSTOMER' ? '/customer/notifications' : '/provider/notifications';
  return (
    <div className="min-h-screen lg:flex">
      <aside className={`${open ? 'block' : 'hidden'} no-print border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:block lg:h-screen lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-r`}>
        <div className="hidden px-5 py-4 lg:block"><Brand /></div>
        <nav className="space-y-1 p-3">
          {items.map(([to, text, end]) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>
              {text}
              {to === notifPath && unread > 0 && <span className="rounded-full bg-red-500 px-2 text-xs text-white">{unread}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <button className="rounded p-1 text-2xl lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu">☰</button>
          <span className="lg:hidden"><Brand /></span>
          <span className="hidden text-sm text-slate-500 lg:block">Signed in as <b className="text-slate-800">{user.name}</b> · {user.role.replace('_', ' ').toLowerCase()}</span>
          <div className="flex items-center gap-2">
            {user.role !== 'ADMIN' && <Link to={notifPath} className="relative px-2 text-xl" aria-label="Notifications">🔔{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{unread}</span>}</Link>}
            <Button variant="secondary" size="sm" onClick={async () => { await logout(); nav('/'); }}>Logout</Button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
