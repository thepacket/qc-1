# ─── Stage 1: build the PWA ─────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Install deps first (cached unless the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Stage 2: static host ───────────────────────────────────────────────
# QC-1 runs entirely in the browser (simulator in a Web Worker), so the
# server only serves files. nginx sets the cache headers a PWA needs.
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/headers.conf /etc/nginx/snippets/headers.conf
COPY deploy/plot-host-headers.conf /etc/nginx/snippets/plot-host-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
