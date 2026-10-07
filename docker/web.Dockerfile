# ---- Web: "dev" target runs Vite with HMR; "prod" builds static files served by Nginx ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=apps/web --workspace=packages/shared --include-workspace-root
COPY packages/shared packages/shared

FROM base AS dev
COPY apps/web apps/web
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM base AS build
COPY apps/web apps/web
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w apps/web

FROM nginx:1.27-alpine AS prod
COPY docker/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
