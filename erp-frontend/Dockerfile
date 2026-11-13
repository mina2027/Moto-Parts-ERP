# syntax=docker/dockerfile:1
# Build context is this folder (erp-frontend/) — the project is self-contained.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* .npmrc* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/ui/package.json packages/ui/
COPY packages/pos-core/package.json packages/pos-core/
RUN npm ci --ignore-scripts

COPY tsconfig.base.json tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts tailwind.config.ts postcss.config.js index.html ./
COPY packages packages
COPY public public
COPY src src

# Vite inlines these at build time, so they are baked per-image rather than per-container.
ARG VITE_API_URL=/api
ARG VITE_SOCKET_URL=
ARG VITE_PUBLIC_URL=
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL \
    VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY nginx/app.conf /etc/nginx/conf.d/app.conf
COPY --from=build /repo/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
