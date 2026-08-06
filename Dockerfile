# Tredev combined image — FastAPI backend + OpenWA WhatsApp gateway in ONE
# container, so they deploy as a single Render service instead of two separate
# ones on two clouds. Both processes run under supervisord: if the gateway (an
# unofficial, reverse-engineered WhatsApp client — see backend/wa_openwa.py's
# docstring) crashes, supervisord restarts just that program. It can never take
# checkout/orders down with it.
#
# Bonus over every standalone-deployment option we looked at: the gateway now
# only ever talks to 127.0.0.1 inside this one container — it is NEVER reachable
# from the network, public or private. No Caddy, no separate domain, no
# cross-cloud API-key-over-the-internet exposure needed at all.
#
# Build context = repo ROOT (this file lives at the repo root on purpose, so it
# can COPY from both backend/ and services/openwa/). On Render: Root Directory
# = "." (repo root), Dockerfile Path = "Dockerfile".
#
# ENGINE_TYPE is pinned to baileys (see services/openwa.env.example) — a
# WebSocket client with NO Chromium — so unlike the standalone
# services/openwa/Dockerfile, this build skips the whole Puppeteer/Chromium
# install entirely. That's real weight this image doesn't need to carry.

# ===== Stage 1: OpenWA gateway — build the NestJS API + dashboard SPA =====
FROM node:22-slim AS openwa-builder
WORKDIR /build/openwa
RUN apt-get update && apt-get install -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY services/openwa/package*.json ./
# --include=dev: the build needs @nestjs/cli + vite/typescript (devDependencies).
RUN npm ci --include=dev
COPY services/openwa/ ./
RUN npm run build \
    && npm run dashboard:ci -- --include=dev \
    && npm run dashboard:build

# ===== Stage 2: OpenWA gateway — production-only node_modules =====
FROM node:22-slim AS openwa-deps
WORKDIR /build/openwa
COPY services/openwa/package*.json ./
COPY services/openwa/scripts/patch-wwebjs-201832.js services/openwa/scripts/wwebjs-201832.patch ./scripts/
RUN apt-get update && apt-get install -y patch \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci --omit=dev \
    && node scripts/patch-wwebjs-201832.js \
    && npm cache clean --force

# ===== Stage 3: combined runtime =====
FROM python:3.11.7-slim

# Node.js 22 runtime (no Node build toolchain needed — that build already
# happened above) + gcc as a fallback in case any Python dep ever lacks a
# prebuilt wheel for this platform (asyncpg/cryptography/pillow/numpy all ship
# wheels today, so this is a safety net, not an expected requirement).
RUN apt-get update && apt-get install -y curl gnupg supervisor gcc \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- Python backend ---
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .

# --- OpenWA gateway: built dist + dashboard + production node_modules ---
WORKDIR /app/openwa
COPY --from=openwa-deps /build/openwa/node_modules ./node_modules
COPY --from=openwa-deps /build/openwa/package*.json ./
COPY --from=openwa-builder /build/openwa/dist ./dist
COPY --from=openwa-builder /build/openwa/dashboard/dist ./dashboard/dist
# /app/openwa/data is where the Render Disk gets mounted (see deploy notes) —
# session pairing + local media live here. Created up front so the app never
# has to worry about a missing directory on a cold volume.
RUN mkdir -p ./data/sessions ./data/media

# --- Supervise both processes independently ---
COPY supervisord.conf /etc/supervisor/conf.d/tredev.conf

WORKDIR /app/backend
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/tredev.conf"]
