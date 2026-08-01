# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build
WORKDIR /workspace
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false

COPY package.json package-lock.json tsconfig.node.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker-document/package.json ./apps/worker-document/package.json
COPY apps/worker-export/package.json ./apps/worker-export/package.json
COPY apps/worker-media/package.json ./apps/worker-media/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/document-processing/package.json ./packages/document-processing/package.json
COPY packages/export-adapters/package.json ./packages/export-adapters/package.json
COPY packages/guidance/package.json ./packages/guidance/package.json
COPY packages/media-processing/package.json ./packages/media-processing/package.json
COPY packages/presets/package.json ./packages/presets/package.json
RUN npm ci

COPY apps ./apps
COPY packages ./packages
RUN npm run build
RUN npm prune --omit=dev
COPY scripts/check-worker-health.mjs ./scripts/check-worker-health.mjs

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=4000

COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/node_modules ./node_modules

COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/migrations ./apps/api/migrations
COPY --from=build /workspace/apps/worker-media/package.json ./apps/worker-media/package.json
COPY --from=build /workspace/apps/worker-media/dist ./apps/worker-media/dist
COPY --from=build /workspace/apps/worker-document/package.json ./apps/worker-document/package.json
COPY --from=build /workspace/apps/worker-document/dist ./apps/worker-document/dist
COPY --from=build /workspace/apps/worker-export/package.json ./apps/worker-export/package.json
COPY --from=build /workspace/apps/worker-export/dist ./apps/worker-export/dist
COPY --from=build /workspace/scripts/check-worker-health.mjs ./scripts/check-worker-health.mjs

COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/packages/document-processing/package.json ./packages/document-processing/package.json
COPY --from=build /workspace/packages/document-processing/dist ./packages/document-processing/dist
COPY --from=build /workspace/packages/export-adapters/package.json ./packages/export-adapters/package.json
COPY --from=build /workspace/packages/export-adapters/dist ./packages/export-adapters/dist
COPY --from=build /workspace/packages/guidance/package.json ./packages/guidance/package.json
COPY --from=build /workspace/packages/guidance/dist ./packages/guidance/dist
COPY --from=build /workspace/packages/media-processing/package.json ./packages/media-processing/package.json
COPY --from=build /workspace/packages/media-processing/dist ./packages/media-processing/dist
COPY --from=build /workspace/packages/presets/package.json ./packages/presets/package.json
COPY --from=build /workspace/packages/presets/dist ./packages/presets/dist

# The runtime invokes Node directly and must not ship build/package-manager
# tooling. Removing it also reduces the vulnerability and mutation surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

USER node
EXPOSE 4000
CMD ["node", "--conditions=production", "apps/api/dist/server.js"]
