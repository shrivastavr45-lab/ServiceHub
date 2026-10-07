# ServiceHub

A service marketplace connecting customers with local providers (electricians, plumbers, AC technicians, carpenters, painters, cleaners, appliance repair…). Customers search, request, negotiate, book, pay and review. Providers manage services, quotes, schedule, invoices and earnings. Admins run the platform.

**Stack:** React + Vite + Tailwind · Node.js + Express 5 · PostgreSQL 16 · JWT (access + rotating refresh) · bcrypt · Zod · Vitest/Supertest · Docker Compose.
Plain JavaScript (ESM), raw parameterised SQL via `pg`, plain SQL migrations.

## Quick start with Docker

```bash
cp .env.example .env          # then edit JWT_ACCESS_SECRET (see below)
docker compose up --build
```

- Web: http://localhost:5173 · API: http://localhost:4000 · Health: http://localhost:4000/health
- The API container runs migrations and seeds demo data on start (the seed is skipped if data exists).

> The Docker setup was written but **not executed** in the environment this project was built in (no Docker daemon there). If `docker compose up` fails, use the manual setup below and please check `docker/` – the application itself was run and tested natively.

## Manual setup (without Docker)

Requires Node 22+ and PostgreSQL 16.

```bash
# 1. Install dependencies (npm workspaces: apps/api, apps/web, packages/shared)
npm install

# 2. Environment variables
cp .env.example .env
#   Generate a strong secret and paste it as JWT_ACCESS_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start PostgreSQL (either your own server, or just the DB container)
docker compose up -d db
#   or create manually:  createuser servicehub -P ; createdb -O servicehub servicehub ; createdb -O servicehub servicehub_test

# 4. Run migrations
npm run migrate

# 5. Seed demo data
npm run seed

# 6. Start the backend  (http://localhost:4000)
npm run dev:api

# 7. Start the frontend (http://localhost:5173) – in a second terminal
npm run dev:web

# 8. Run the tests (uses TEST_DATABASE_URL – this database is WIPED each run)
npm test
```

Production build of the web app: `npm run build:web` (output in `apps/web/dist`).

## Demo credentials (development seed data only)

All accounts use the password from `SEED_PASSWORD` in `.env` (default `Password123!`). **Never seed these in production.**

| Role | Email |
|---|---|
| Admin | admin@servicehub.test |
| Customers | priya@servicehub.test · arjun@servicehub.test · neha@servicehub.test |
| Providers | rajesh@ (electrician) · amit@ (electrician) · suresh@ (plumber) · imran@ (AC) · mohan@ (carpenter) · sunita@ (cleaner) · pradeep@ (appliances) — all `@servicehub.test` |

Seed data includes 7 categories / 23 services, provider listings, areas and weekly availability, 5 completed jobs with invoices, payments and reviews, and live bookings in the REQUESTED, QUOTED, NEGOTIATING, ACCEPTED, SCHEDULED and IN_PROGRESS states.

**Try the full flow:** log in as `priya@` → *Find providers* → request a service → log in as that provider → quote → counter/accept → schedule → start → complete → generate invoice → log back in as customer → pay → review.

## Important environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | **Required**, ≥32 chars. Signs access tokens. API refuses to start without it |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL_DAYS` | Token lifetimes (default 15m / 30d) |
| `CORS_ORIGIN` | Allowed web origin(s), comma-separated |
| `UPLOAD_DIR`, `PUBLIC_API_URL` | Where uploaded images are stored / the public URL they are served under |
| `BCRYPT_ROUNDS` | bcrypt cost (default 10) |
| `TEST_DATABASE_URL` | Separate DB used by tests |
| `VITE_API_URL` | API base URL baked into the web build |

## Repository layout

```
apps/api          Express API (routes/, services/, middleware/, lib/, migrations/, test/)
apps/web          React app (pages/, components/, lib/)
packages/shared   Booking state machine + constants shared by API and web
docker/           Dockerfiles, nginx config
docs/             ARCHITECTURE.md, API.md, DATABASE.md, DEPLOYMENT.md
.github/workflows CI (tests + web build against Postgres)
```

## What's implemented

Everything in the spec's three roles, the request → quote → negotiate → schedule → work → invoice → pay → review flow, state machine with history, append-only negotiation, immutable invoices with a printable view, in-app notifications, disputes, user reports, audit log, admin dashboard and moderation, image uploads with content validation behind a storage interface.

## Known limitations

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#known-limitations-and-production-checklist). Highlights: no email (verification / password reset / email notifications), no online payment gateway (payments are *recorded*), no Swagger UI (endpoints are documented in `docs/API.md`), no automated frontend tests, local-disk uploads, and the Docker setup is unexecuted.
