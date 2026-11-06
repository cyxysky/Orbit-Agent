# syntax=docker/dockerfile:1.7
ARG WEBPILOT_CAPABILITY_SOURCE=workspace
ARG ORBIT_CAPABILITY_SOURCE=${WEBPILOT_CAPABILITY_SOURCE}
ARG WEBPILOT_BASE_PATH=
ARG ORBIT_BASE_PATH=${WEBPILOT_BASE_PATH}

FROM node:22-bookworm-slim AS manifests
RUN --mount=type=bind,target=/source node /source/scripts/stage-workspace-manifests.mjs /source /metadata

FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

ARG ORBIT_CAPABILITY_SOURCE
ENV WEBPILOT_CAPABILITY_SOURCE=${ORBIT_CAPABILITY_SOURCE}
# The runner below provisions its own system/Python layers. Keep the
# dependency-only build layer from downloading another complete runtime cache.
ENV CAPABILITY_SKIP_RUNTIME_INSTALL=1
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY scripts/prepare-capability-install.mjs ./scripts/prepare-capability-install.mjs
COPY scripts/prune-runtime-dependencies.cjs ./scripts/prune-runtime-dependencies.cjs
COPY --from=manifests /metadata/packages ./packages
# Desktop binaries are not needed by this server image.
RUN export ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    && if [ "$WEBPILOT_CAPABILITY_SOURCE" = "npm" ]; then node scripts/prepare-capability-install.mjs npm && npm install --no-audit --no-fund && cp package.json /tmp/webpilot-package.json && cp package-lock.json /tmp/webpilot-package-lock.json; else npm ci --no-audit --no-fund; fi

FROM dependencies AS build

COPY . .
RUN if [ "$WEBPILOT_CAPABILITY_SOURCE" = "npm" ]; then cp /tmp/webpilot-package.json package.json && cp /tmp/webpilot-package-lock.json package-lock.json; else node scripts/prepare-capability-install.mjs workspace; fi
RUN node scripts/stage-capability-runtime.mjs "$WEBPILOT_CAPABILITY_SOURCE"
ARG WEBPILOT_BASE_PATH
ARG ORBIT_BASE_PATH
ARG BUILD_CPUS=1
ARG BUILD_HEAP_MB=1280
ARG BUILD_BUNDLER=turbopack
ARG BUILD_TYPECHECK=true
# Only the public service mount path is compiled into the image.
RUN --mount=type=cache,target=/app/.next/cache \
    case "$BUILD_BUNDLER" in turbopack|webpack) ;; *) echo "BUILD_BUNDLER must be turbopack or webpack" >&2; exit 1 ;; esac \
    && case "$BUILD_TYPECHECK" in true|false) ;; *) echo "BUILD_TYPECHECK must be true or false" >&2; exit 1 ;; esac \
    && ORBIT_BASE_PATH="$ORBIT_BASE_PATH" ORBIT_BUILD_CPUS="$BUILD_CPUS" ORBIT_BUILD_TYPECHECK="$BUILD_TYPECHECK" NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP_MB" npm run build -- "--$BUILD_BUNDLER"
RUN npm prune --omit=dev && node scripts/prune-runtime-dependencies.cjs

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ARG ORBIT_CAPABILITY_SOURCE
ARG ORBIT_BASE_PATH
ENV WEBPILOT_CAPABILITY_SOURCE=${ORBIT_CAPABILITY_SOURCE}

# Serialize system-runtime provisioning after compilation on memory-limited builders.
COPY --from=build /app/package*.json ./
COPY --from=build /app/scripts/prune-runtime-dependencies.cjs ./scripts/prune-runtime-dependencies.cjs
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-nogui fonts-noto-cjk python3 python3-venv python3-uno ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV ORBIT_BASE_PATH=${ORBIT_BASE_PATH}
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV LIBREOFFICE_PATH=/usr/bin/libreoffice
ENV CAPABILITY_FILE_RUNTIME_DIR=/app/capability-runtime/file
ENV CAPABILITY_BROWSER_RUNTIME_DIR=/app/capability-runtime/browser
ENV CAPABILITY_COMPUTER_RUNTIME_DIR=/app/capability-runtime/computer
ENV LIBREOFFICE_UNO_PROGRAM_WORKER_PATH=/app/capability-runtime/file/python/libreoffice-program-worker.py
ENV APP_DATA_DIR=/app
ENV ARTIFACTS_DIR=/app/artifacts

COPY --from=build /app/node_modules ./node_modules
# Install only the Chromium revision used by the SDK, without unused base browsers.
RUN node node_modules/patchright/cli.js install --with-deps chromium
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/dist-backend ./dist-backend
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/electron/product.json /app/electron/product-brand.js ./electron/
COPY --from=build /app/server ./server
COPY --from=build /app/.capability-runtime/file ./capability-runtime/file
COPY --from=build /app/.capability-runtime/browser ./capability-runtime/browser
COPY --from=build /app/.capability-runtime/computer ./capability-runtime/computer
COPY --from=build /app/packages/capability-sdk/runtime/execution ./capability-runtime/execution

RUN find ./server -type f -name '*.test.js' -delete \
    && mkdir -p .data artifacts

EXPOSE 3000

ENV HEADLESS_BROWSER=true
CMD ["node", "server/webpilot-server.js"]


# docker build --platform linux/amd64 -t orbit:latest .
