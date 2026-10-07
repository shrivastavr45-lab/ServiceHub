# Architecture

## Overview
A modular monolith: one stateless Express API, one PostgreSQL database, one React SPA.

```
Browser (React SPA) ──HTTPS/JSON──▶ Express API ──▶ PostgreSQL
                                      │
                                      └──▶ Storage interface (local disk now, S3 later)
```

## API layering
`routes/*.js` (HTTP + validation with Zod + role middleware) → `services/bookingService.js` (business rules, transactions, state machine) → `pg` queries. Cross-cutting: `middleware/auth.js` (JWT + RBAC), `middleware/error.js` (one error shape), `lib/audit.js`, `lib/notify.js`, `lib/storage.js`.

Responses: `{ "data": …, "meta": { page, limit, total, totalPages } }`; errors: `{ "error": { code, message, details? } }`. JSON bodies use snake_case. Money is **integer paise**.

## Key design decisions
| Decision | Why |
|---|---|
| **Service request = booking in `REQUESTED`** (no separate requests table) | One entity and one state machine. `/api/requests` is a creation/list alias over bookings. |
| **Quotation + negotiation = one append-only `price_offers` table** | A quote is just the first offer. History is never overwritten; partial unique indexes guarantee at most one `PENDING` and one `ACCEPTED` offer per booking. `/api/quotations` and `/api/negotiations` are routes over it. |
| **No `roles` table** – a CHECK-constrained `role` column | Three fixed roles, one per user. |
| **Booking state machine in `packages/shared`**, enforced only in `services/bookingService.transition()` | The web uses it for UX hints; the API is the sole enforcer. Every change runs in a transaction that locks the row (`SELECT … FOR UPDATE`) and writes `booking_status_history`. |
| **Snapshots** (service/category name, listed price on the booking; party details on invoices) | Later profile/catalog edits don't rewrite history. |
| **Denormalised provider rating** (`rating_avg`, `rating_count`) recomputed in the review transaction | Search sorts by rating without aggregating reviews per query. |
| **Notifications written in the same transaction as the event** | An event and its notification commit or roll back together. Email/SMS/push can later consume the table. |
| **Plain SQL migrations + `pg`** | Fewer moving parts; constraints and partial indexes are first-class. |

## Booking state machine
```
REQUESTED → QUOTED → NEGOTIATING ⇄ NEGOTIATING → ACCEPTED → SCHEDULED → IN_PROGRESS → COMPLETED
Cancel (CANCELLED): from REQUESTED, QUOTED, NEGOTIATING, ACCEPTED, SCHEDULED (and DISPUTED, by admin)
DISPUTED: from SCHEDULED, IN_PROGRESS, COMPLETED (within 14 days) → admin resolves to COMPLETED or CANCELLED
```
Provider declining a request = cancel with a reason. CANCELLED is terminal. Anything else is rejected with `409 INVALID_STATE_TRANSITION`.

Negotiation rules: only the party who did *not* make the pending offer may accept, counter or reject it; max 6 offers per booking; accepting locks `agreed_price_paise` and the platform fee (percentage from `platform_settings`) on the booking.

## Authentication & authorization
- Passwords: bcrypt (cost configurable). Login does a dummy hash compare for unknown emails (no user enumeration by timing/message).
- Access token: JWT, 15 min, held **in memory** by the SPA. Refresh token: random opaque value in an `httpOnly`, `SameSite=Lax` cookie scoped to `/api/auth`, stored only as a SHA-256 hash.
- **Rotation with reuse detection:** each refresh revokes the used token and issues a new one in the same family; replaying a revoked token revokes the entire family. Logout and password change revoke server-side. Suspension revokes tokens and is checked on every request (the user row is loaded per request, so a stale JWT can't outlive a suspension).
- RBAC at the route level (`requireRole`); **ownership checks in queries/services** (a provider updating someone else's listing gets 404; booking/invoice/dispute access requires being a party or admin). Admin accounts cannot self-register.

## Security measures actually implemented
bcrypt hashing · JWT + refresh rotation · Zod validation on all inputs · parameterised SQL everywhere · Helmet headers · CORS allow-list with credentials · rate limiting (global, plus stricter on login/register) · upload validation by magic bytes (JPEG/PNG/WebP, 5 files × 5 MB, random server-side names, `nosniff`) · secrets only from env (startup fails if missing) · audit log for admin actions, disputes and auth events · DB constraints as a second line of defence (CHECKs, unique and partial-unique indexes, FKs) · phone numbers hidden until a price is agreed · generic 500s in production.
Not implemented: email verification, password reset, 2FA, CSRF tokens (refresh endpoint relies on SameSite cookies + CORS; see DEPLOYMENT), virus scanning, per-account lockout.

## Frontend
React Router with role-segmented layouts; `RequireRole` guards are UX only. `lib/api.js` keeps the access token in memory and transparently refreshes once on 401. Shared hooks `useFetch`/`useAction` give every page loading, error and empty states. Tailwind for styling; no state library.

## Scaling notes
The API is stateless (JWT + DB-backed refresh tokens), so it can run behind a load balancer as multiple instances. Before that: move uploads to S3 (implement the `storage` interface), and use a shared rate-limit store (Redis). Search is plain PostgreSQL with indexes; add `pg_trgm`/full-text or PostGIS later.
