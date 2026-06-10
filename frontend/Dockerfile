# --- deps stage ---
FROM node:20-alpine AS deps
# Coupe la notice "Corepack is about to download..." au premier usage de pnpm.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# .npmrc copié explicitement : il porte update-notifier=false (bannière
# "Update available!" de pnpm) et le stage deps ne fait pas de COPY . .
COPY package.json pnpm-lock.yaml* .npmrc ./
RUN pnpm install --frozen-lockfile || pnpm install

# --- build stage ---
FROM node:20-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Les NEXT_PUBLIC_* sont bakés dans le bundle au build — IL FAUT les passer
# via build args (pas via env runtime), sinon le bundle JS sert au navigateur
# une URL vide et le client échoue avant même la connexion WebSocket.
ARG NEXT_PUBLIC_BACKEND_HTTP_URL
ARG NEXT_PUBLIC_BACKEND_WS_URL
ENV NEXT_PUBLIC_BACKEND_HTTP_URL=$NEXT_PUBLIC_BACKEND_HTTP_URL
ENV NEXT_PUBLIC_BACKEND_WS_URL=$NEXT_PUBLIC_BACKEND_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# --- runtime stage ---
FROM node:20-alpine AS runtime
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/.npmrc ./.npmrc
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3000
USER node
CMD ["pnpm", "start"]
