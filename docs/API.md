# API reference

Base URL `http://localhost:4000`. All routes under `/api`. JSON in/out (snake_case). Authenticate with `Authorization: Bearer <accessToken>`.

**Success:** `{ "data": … , "meta": {page,limit,total,totalPages} }` (meta on paginated lists) · **Error:** `{ "error": { "code", "message", "details" } }`
**Status codes:** 200/201/204 · 400 bad request · 401 unauthenticated · 403 forbidden · 404 not found (also used to hide other users' resources) · 409 conflict / invalid state transition · 422 validation (`details` lists `path` + `message`) · 429 rate limited.
**Pagination:** `?page=1&limit=20` (limit ≤ 100). **Money:** integer paise.
Roles: `C` customer, `P` provider, `A` admin, `—` public.

## Auth — `/api/auth`
| Method & path | Who | Notes |
|---|---|---|
| POST `/register` | — | `{name,email,password,role: CUSTOMER\|SERVICE_PROVIDER,phone?,city?}` → access token + refresh cookie |
| POST `/login` | — | `{email,password}` |
| POST `/refresh` | cookie | Rotates the refresh token; returns a new access token |
| POST `/logout` | — | Revokes refresh token, clears cookie |
| GET `/me` | any | |

## Users — `/api/users`
GET `/me`, PATCH `/me` (name, phone, address, city, pincode), POST `/me/password` `{current_password,new_password}`.

## Catalog — `/api/categories`, `/api/services`
| | |
|---|---|
| GET `/api/categories` — public | Active categories with nested active services |
| POST / PATCH `/:id` / DELETE `/:id` — A | DELETE is a soft deactivate |
| GET `/api/services?category_id&q` — public | |
| POST / PATCH `/:id` / DELETE `/:id` — A | |

## Providers — `/api/providers`
| | |
|---|---|
| GET `/` — public | Search. Filters: `q, category, category_id, service_id, city, pincode, min_price, max_price (paise), min_rating, available_on (YYYY-MM-DD)`; `sort=rating\|price_asc\|price_desc\|experience`. Only APPROVED, active providers |
| GET `/:id` — public | Profile, services, areas, availability, reviews |
| GET `/services/:id` — public | One listed service + provider (`provider_service_id`) |
| GET/PUT `/me/profile` — P | headline, bio, experience_years, skills[], city, gstin |
| GET/POST `/me/services`, PATCH/DELETE `/me/services/:id` — P | `{service_id,price_paise,price_unit,description}`; own listings only |
| GET/PUT `/me/areas` — P | `{areas:[{city,pincode?}]}` (replaces set) |
| GET/PUT `/me/availability` — P | `{slots:[{weekday 0-6,start_time "HH:MM",end_time}]}` |
| GET `/me/earnings` — P | Totals + monthly breakdown |

## Requests, quotations, negotiation, bookings
| Method & path | Who | Notes |
|---|---|---|
| POST `/api/requests` | C | `multipart/form-data`: `provider_service_id, description, address, city, pincode?, preferred_at?`, `images` (≤5). Creates booking in `REQUESTED` |
| GET `/api/requests`, GET `/api/bookings` | C/P/A | `?status=A,B&page`. Scoped to the caller (admin sees all) |
| GET `/api/bookings/:id` | party/A | Offers, status history, attachments, invoice, review, disputes |
| POST `/api/quotations` | P | `{booking_id,amount_paise,message?}` REQUESTED → QUOTED |
| GET `/api/negotiations/:bookingId` | party/A | Full offer history + agreed price |
| POST `/api/negotiations/:bookingId/counter` | C/P | `{amount_paise,message?}` → NEGOTIATING (only the party who didn't make the pending offer) |
| POST `/api/negotiations/:bookingId/accept` | C/P | Locks agreed price + platform fee → ACCEPTED |
| POST `/api/negotiations/:bookingId/reject` | C/P | `{reason?}` → CANCELLED |
| POST `/api/bookings/:id/reject` | P | Decline a REQUESTED booking |
| POST `/api/bookings/:id/schedule` | P | `{scheduled_at?}` ACCEPTED → SCHEDULED (rejects clashes within 1 h) |
| POST `/api/bookings/:id/start` · `/complete` | P | SCHEDULED → IN_PROGRESS → COMPLETED |
| POST `/api/bookings/:id/cancel` | C/P/A | `{reason}` |

## Invoices & payments
| | |
|---|---|
| POST `/api/invoices` — P | `{booking_id, items?[{description,quantity,unit_price_paise}], additional_charges_paise, discount_paise, tax_percent}`; COMPLETED bookings only, one per booking, immutable. Number `INV-<year>-<seq>` |
| GET `/api/invoices`, `/:id` — party/A | |
| POST `/api/payments` — C/P | `{invoice_id, method: CASH\|UPI\|CARD\|BANK_TRANSFER\|OTHER, reference?}` records a full payment (no gateway) |
| GET `/api/payments` | |

## Reviews, notifications, disputes, reports
| | |
|---|---|
| POST `/api/reviews` — C | `{booking_id,rating 1-5,comment?}`; completed booking of the caller, once |
| GET `/api/reviews?provider_id=` — public · GET `/api/reviews/mine` | |
| GET `/api/notifications?unread=true`, `/unread-count`, POST `/:id/read`, `/read-all` | own only |
| POST `/api/disputes` — C/P | `{booking_id,reason,description}` (SCHEDULED/IN_PROGRESS/COMPLETED ≤14 days) → booking DISPUTED |
| GET `/api/disputes`, `/:id` | party/A |
| POST `/api/reports` — C/P | `{reported_user_id,reason,details?}` |

## Admin — `/api/admin` (all A)
GET `/dashboard` · GET `/users?role&status&q` · PATCH `/users/:id/status` `{status,reason?}` · PATCH `/providers/:id/verification` · GET `/bookings` · GET `/categories`, `/services` (incl. inactive) · POST `/disputes/:id/resolve` `{resolution,booking_status: COMPLETED|CANCELLED}` · GET `/reviews`, PATCH `/reviews/:id` `{status}` · GET `/reports`, PATCH `/reports/:id` · GET `/audit-logs?action=` · GET/PUT `/settings` `{platform_fee_percent}`.

Not provided: a Swagger/OpenAPI UI (this document is the reference).
