// Shared between API (enforcement) and Web (UX hints). The API is the source of truth.
export const ROLES = { CUSTOMER: 'CUSTOMER', SERVICE_PROVIDER: 'SERVICE_PROVIDER', ADMIN: 'ADMIN' };

export const BOOKING_STATUS = {
  REQUESTED: 'REQUESTED', QUOTED: 'QUOTED', NEGOTIATING: 'NEGOTIATING', ACCEPTED: 'ACCEPTED',
  SCHEDULED: 'SCHEDULED', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED', DISPUTED: 'DISPUTED',
};

// from -> allowed next states
export const TRANSITIONS = {
  REQUESTED: ['QUOTED', 'CANCELLED'],
  QUOTED: ['NEGOTIATING', 'ACCEPTED', 'CANCELLED'],
  NEGOTIATING: ['NEGOTIATING', 'ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED', 'DISPUTED'],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED'],
  DISPUTED: ['COMPLETED', 'CANCELLED'],
  CANCELLED: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
export const TERMINAL_STATES = ['CANCELLED'];
export const MAX_NEGOTIATION_ROUNDS = 6;

export const formatPaise = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
