# ---- API image (dev & prod) ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS deps
RUN npm ci --workspace=apps/api --workspace=packages/shared --include-workspace-root

FROM deps AS runtime
COPY packages/shared packages/shared
COPY apps/api apps/api
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 4000
USER node
CMD ["node", "src/server.js"]
