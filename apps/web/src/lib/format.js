export { formatPaise as money } from '@servicehub/shared';
export const rupeesToPaise = (v) => Math.round(parseFloat(v) * 100);
export const paiseToRupees = (p) => (p / 100).toString();
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
export const toIso = (localValue) => (localValue ? new Date(localValue).toISOString() : undefined);
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const label = (s) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '');
