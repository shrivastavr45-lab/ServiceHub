# Database

PostgreSQL 16. Migrations: `apps/api/migrations/*.sql`, applied in filename order by `npm run migrate` (tracked in `schema_migrations`, each in a transaction). Add schema changes as new numbered files; never edit applied ones.

## Tables
| Table | Purpose / key constraints |
|---|---|
| `users` | email (unique on `lower(email)`), `password_hash`, `role` CHECK, `status` ACTIVE/SUSPENDED |
| `refresh_tokens` | hashed token, `family_id` (reuse detection), expiry, revoked_at |
| `customer_profiles`, `provider_profiles` | 1:1 with users (PK = `user_id`). Provider: bio, experience, skills[], `verification_status`, denormalised `rating_avg/rating_count` |
| `categories`, `services` | Admin-managed catalog (soft delete via `is_active`); nothing hardcoded |
| `provider_services` | Provider's price for a catalog service. UNIQUE(provider, service), `price_paise > 0` |
| `service_areas` | city + optional pincode, unique per provider |
| `availability` | weekly slots (weekday 0–6, `end_time > start_time`) |
| `bookings` | Request **and** booking: status CHECK, snapshots, `agreed_price_paise`, `platform_fee_*`, `CHECK (customer_id <> provider_id)` |
| `booking_attachments` | uploaded image keys |
| `price_offers` | Append-only quotation/negotiation history. Partial unique indexes: one `PENDING`, one `ACCEPTED` per booking |
| `booking_status_history` | Every transition: from, to, actor, note |
| `invoices`, `invoice_items` | UNIQUE(booking_id); customer/provider snapshots (JSONB); numbers from sequence `invoice_number_seq`; no update endpoint (immutable) |
| `payments` | method/status/reference, recorded_by |
| `reviews` | UNIQUE(booking_id) (one review per booking), rating CHECK 1–5, VISIBLE/HIDDEN |
| `notifications` | per-user, partial index on unread |
| `disputes` | partial unique index → one OPEN dispute per booking |
| `reports` | user reports, `CHECK (reporter_id <> reported_user_id)` |
| `audit_logs` | append-only actor/action/entity/metadata/ip |
| `platform_settings` | key/value (`platform_fee_percent`) |

## Relationships (summary)
`users 1—1 customer_profiles | provider_profiles` · `categories 1—N services` · `provider_profiles 1—N provider_services N—1 services` · `provider_profiles 1—N service_areas, availability` · `bookings N—1 users(customer), N—1 provider_profiles, N—1 provider_services (SET NULL)` · `bookings 1—N price_offers, booking_status_history, booking_attachments, disputes` · `bookings 1—1 invoices 1—N invoice_items` · `invoices 1—N payments` · `bookings 1—1 reviews`.

## Deviations from the original table list
- `service_requests` + `bookings` → one `bookings` table; `quotations` + `negotiations` → one `price_offers` table; `roles` → `users.role`. Reasons in ARCHITECTURE.md.
- Added: `refresh_tokens`, `booking_attachments`, `platform_settings`, `schema_migrations`.

## Important indexes
`bookings(customer_id, created_at)`, `bookings(provider_id, created_at)`, `bookings(status)`, `provider_services(service_id) WHERE is_active`, `provider_services(price_paise)`, `service_areas(lower(city))`, `provider_profiles(rating_avg DESC)`, `notifications(user_id) WHERE read_at IS NULL`, `reviews(provider_id, created_at)`. Check query plans with `EXPLAIN ANALYZE` as data grows.

## Money & time
Money is INT paise everywhere (invoice tax is rounded to the nearest paisa). Timestamps are `timestamptz` (UTC); the UI renders in the browser's locale.
