import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export const signAccessToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.JWT_ACCESS_SECRET, { expiresIn: config.ACCESS_TOKEN_TTL });

/** Verifies the bearer token, then loads the user so suspended accounts are rejected immediately. */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  let payload;
  try { payload = jwt.verify(token, config.JWT_ACCESS_SECRET); }
  catch { throw unauthorized('Invalid or expired token'); }
  const { rows } = await query('SELECT id, email, name, role, status FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user) throw unauthorized('Account no longer exists');
  if (user.status !== 'ACTIVE') throw forbidden('Account is suspended');
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) throw forbidden();
  next();
};
