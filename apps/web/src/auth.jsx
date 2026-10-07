import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { post, setToken, refreshSession } from './lib/api.js';
import { Loading } from './components/ui.jsx';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // On page load, try to restore the session from the httpOnly refresh cookie.
  useEffect(() => {
    refreshSession().then((s) => { if (s) setUser(s.user); }).finally(() => setReady(true));
  }, []);

  const finish = (d) => { setToken(d.accessToken); setUser(d.user); return d.user; };
  const value = {
    user, ready,
    login: async (email, password) => finish((await post('/auth/login', { email, password })).data),
    register: async (form) => finish((await post('/auth/register', form)).data),
    logout: async () => { try { await post('/auth/logout'); } finally { setToken(null); setUser(null); } },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const homeFor = (role) => ({ CUSTOMER: '/customer', SERVICE_PROVIDER: '/provider', ADMIN: '/admin' }[role] || '/');

/** UX-only guard. The API enforces real authorization. */
export function RequireRole({ role, children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}
