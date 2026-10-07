# Deployment

The application is designed to be deployed later; this file records what is ready and what must change first. **Nothing here has been run against real infrastructure.**

## Artifacts
- `docker/api.Dockerfile` – production-style API image (`runtime` stage, runs as non-root `node`, `CMD node src/server.js`; applies migrations on boot).
- `docker/web.Dockerfile` – `prod` target builds the SPA with `VITE_API_URL` build-arg and serves it via Nginx (`docker/nginx-web.conf`).
- `docker-compose.yml` – **development** only (bind mounts, seeded data, exposed DB port).
- `.github/workflows/ci.yml` – runs API tests against Postgres and builds the web app.

```bash
docker build -f docker/api.Dockerfile --target runtime -t servicehub-api .
docker build -f docker/web.Dockerfile --target prod --build-arg VITE_API_URL=https://api.example.com -t servicehub-web .
```

## Target topology (future)
Route 53 → ALB (HTTPS, ACM cert) → EC2 instances running the API container(s) and Nginx/web → RDS PostgreSQL; uploads in S3; logs to CloudWatch; Redis for shared rate limiting/caching when scaling out. The API is stateless, so multiple instances behind the ALB work once uploads and rate limits are externalised.

## Environment in production
`NODE_ENV=production`, strong unique `JWT_ACCESS_SECRET` (from a secret manager, not a file in git), `DATABASE_URL` (RDS, TLS), `CORS_ORIGIN` = exact web origin, `PUBLIC_API_URL`, `BCRYPT_ROUNDS≥12`. In production the refresh cookie is `Secure`, so HTTPS is mandatory. Serve web and API on the same site (e.g. `app.example.com` + `api.example.com`) so `SameSite=Lax` cookies work. Do **not** run the seed in production (it creates well-known demo accounts); create the first admin manually (insert a user with `role='ADMIN'` and a bcrypt hash).

## Known limitations and production checklist
1. **Email:** no email verification, password reset or email notifications (only in-app). Add a mailer and `auth_tokens` table.
2. **Payments:** recorded, not processed. A gateway (e.g. Razorpay) and its legal/regulatory implications are out of scope; platform fees are *calculated and recorded* but not collected.
3. **Uploads:** local disk. Implement an S3 `storage` (`save/url/remove`) before running >1 instance; consider private buckets + signed URLs.
4. **Rate limiting** is in-memory per instance → use a Redis store behind a load balancer. `trust proxy` is set to 1 hop; adjust to your topology.
5. **Swagger/OpenAPI UI** not included (see API.md). **Frontend tests** not included (backend: 30 integration tests).
6. **No background jobs:** quotes/requests never expire automatically; no auto-complete.
7. **Security extras to consider:** 2FA for admins, account lockout, CSRF token on `/auth/refresh`, virus scanning for uploads, CSP for the web origin (Nginx), dependency audit in CI.
8. **Operations:** DB backups (RDS snapshots), migration strategy for multiple instances (run migrations as a one-off task instead of on every boot), structured logging/CloudWatch, health check at `/health`.
9. **Search** is simple SQL (`ILIKE`, city/pincode matching). Add `pg_trgm`/full-text/PostGIS as volume grows.
10. **Scheduling** checks clashes within one hour but doesn't validate against the provider's weekly availability (availability is used for search and shown to customers).
