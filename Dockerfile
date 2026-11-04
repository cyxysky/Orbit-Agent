# syntax=docker/dockerfile:1.7
ARG WEBPILOT_CAPABILITY_SOURCE=workspace
ARG ORBIT_CAPABILITY_SOURCE=${WEBPILOT_CAPABILITY_SOURCE}

FROM mcr.microsoft.com/playwright:v1.60.0-noble AS manifests
RUN --mount=type=bind,target=/source node /source/scripts/stage-workspace-manifests.mjs /source /metadata

FROM mcr.microsoft.com/playwright:v1.60.0-noble AS build

WORKDIR /app

ARG ORBIT_CAPABILITY_SOURCE
ENV WEBPILOT_CAPABILITY_SOURCE=${ORBIT_CAPABILITY_SOURCE}
# The runner below provisions its own system/Python layers. Keep the
# dependency-only build layer from downloading another complete runtime cache.
ENV CAPABILITY_SKIP_RUNTIME_INSTALL=1

COPY package*.json ./
COPY scripts/prepare-capability-install.mjs ./scripts/prepare-capability-install.mjs
COPY --from=manifests /metadata/packages ./packages
RUN if [ "$WEBPILOT_CAPABILITY_SOURCE" = "npm" ]; then node scripts/prepare-capability-install.mjs npm && npm install && cp package.json /tmp/webpilot-package.json && cp package-lock.json /tmp/webpilot-package-lock.json; else npm ci; fi

COPY . .
RUN if [ "$WEBPILOT_CAPABILITY_SOURCE" = "npm" ]; then cp /tmp/webpilot-package.json package.json && cp /tmp/webpilot-package-lock.json package-lock.json; else node scripts/prepare-capability-install.mjs workspace; fi
RUN node scripts/stage-capability-runtime.mjs "$WEBPILOT_CAPABILITY_SOURCE"
ARG WEBPILOT_BASE_PATH=
ARG ORBIT_BASE_PATH=${WEBPILOT_BASE_PATH}
# Only the public service mount path is compiled into the image.
RUN ORBIT_BASE_PATH="$ORBIT_BASE_PATH" npm run build
RUN npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.60.0-noble AS runner

WORKDIR /app

ARG ORBIT_CAPABILITY_SOURCE
ENV WEBPILOT_CAPABILITY_SOURCE=${ORBIT_CAPABILITY_SOURCE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-nogui fonts-noto-cjk python3 python3-venv python3-uno \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
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

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
# Patchright pins a different Chromium revision from the base image.
RUN node node_modules/patchright/cli.js install --with-deps chromium
COPY --from=build /app/.next ./.next
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

CMD ["node", "server/webpilot-server.js"]


# docker build --platform linux/amd64 -t orbit:20260806 .
