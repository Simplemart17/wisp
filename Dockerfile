# Wisp — self-host image (SPEC §1: self-hostability is a feature).
# Build:  docker build -t wisp .
# Run:    docker run -p 3007:3007 -e SUPABASE_URL=... -e SUPABASE_SECRET_KEY=... wisp

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined into the browser bundle at build time, so the Clerk
# publishable key (public by design) must be baked here — runtime env alone
# only reaches the server. Leave unset to build with sender accounts disabled.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
# Optional error monitoring. The DSN is public and, like the Clerk key, baked
# into the bundle; unset builds ship no monitoring at all. Org/project plus
# the auth token (a BuildKit secret, so it never lands in an image layer)
# additionally upload source maps for readable stack traces.
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN SENTRY_ORG=$SENTRY_ORG SENTRY_PROJECT=$SENTRY_PROJECT
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3007 HOSTNAME=0.0.0.0
RUN addgroup -S wisp && adduser -S wisp -G wisp
COPY --from=build --chown=wisp:wisp /app/.next/standalone ./
COPY --from=build --chown=wisp:wisp /app/.next/static ./.next/static
COPY --from=build --chown=wisp:wisp /app/public ./public
USER wisp
EXPOSE 3007
CMD ["node", "server.js"]
