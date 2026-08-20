# syntax=docker/dockerfile:1.7

# Keep the explicit image version aligned with .node-version. The deployment
# verifier rejects drift while the digest preserves immutable builds.
FROM node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS build
WORKDIR /workspace
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false

COPY package.json package-lock.json tsconfig.node.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker-document/package.json ./apps/worker-document/package.json
COPY apps/worker-export/package.json ./apps/worker-export/package.json
COPY apps/worker-character/package.json ./apps/worker-character/package.json
COPY apps/worker-media/package.json ./apps/worker-media/package.json
COPY apps/worker-security/package.json ./apps/worker-security/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/document-processing/package.json ./packages/document-processing/package.json
COPY packages/export-adapters/package.json ./packages/export-adapters/package.json
COPY packages/guidance/package.json ./packages/guidance/package.json
COPY packages/layer-domain/package.json ./packages/layer-domain/package.json
COPY packages/media-processing/package.json ./packages/media-processing/package.json
COPY packages/presets/package.json ./packages/presets/package.json
RUN --mount=type=cache,id=motionprep-npm,target=/root/.npm,sharing=locked npm ci

COPY apps ./apps
COPY packages ./packages
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts/check-worker-health.mjs ./scripts/check-worker-health.mjs

FROM node:24.18.1-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=4000

# Sharp/Pango requires a fontconfig configuration even when every exported
# text layer supplies its own reviewed font file. Keep discovery deterministic
# and avoid production warnings from the slim base image.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends fontconfig \
  && rm -rf /var/lib/apt/lists/*

# Generates the reviewed Adobe fixtures in the exact Linux/font stack used by
# production. The host command targets this stage so Windows and macOS cannot
# silently rewrite text pixels with their local Pango/fontconfig versions.
FROM runtime-base AS adobe-golden-generator
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/packages/layer-domain/package.json ./packages/layer-domain/package.json
COPY --from=build /workspace/packages/layer-domain/dist ./packages/layer-domain/dist
COPY --from=build /workspace/packages/export-adapters/package.json ./packages/export-adapters/package.json
COPY --from=build /workspace/packages/export-adapters/dist ./packages/export-adapters/dist
COPY scripts/generate-adobe-golden.mjs ./scripts/generate-adobe-golden.mjs
CMD ["node", "--conditions=production", "scripts/generate-adobe-golden.mjs"]

FROM runtime-base AS runtime

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
COPY --from=build /workspace/apps/worker-character/package.json ./apps/worker-character/package.json
COPY --from=build /workspace/apps/worker-character/dist ./apps/worker-character/dist
COPY --from=build /workspace/apps/worker-security/package.json ./apps/worker-security/package.json
COPY --from=build /workspace/apps/worker-security/dist ./apps/worker-security/dist
COPY --from=build /workspace/scripts/check-worker-health.mjs ./scripts/check-worker-health.mjs

COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/packages/document-processing/package.json ./packages/document-processing/package.json
COPY --from=build /workspace/packages/document-processing/dist ./packages/document-processing/dist
COPY --from=build /workspace/packages/export-adapters/package.json ./packages/export-adapters/package.json
COPY --from=build /workspace/packages/export-adapters/dist ./packages/export-adapters/dist
COPY --from=build /workspace/packages/guidance/package.json ./packages/guidance/package.json
COPY --from=build /workspace/packages/guidance/dist ./packages/guidance/dist
COPY --from=build /workspace/packages/layer-domain/package.json ./packages/layer-domain/package.json
COPY --from=build /workspace/packages/layer-domain/dist ./packages/layer-domain/dist
COPY --from=build /workspace/packages/media-processing/package.json ./packages/media-processing/package.json
COPY --from=build /workspace/packages/media-processing/dist ./packages/media-processing/dist
COPY --from=build /workspace/packages/presets/package.json ./packages/presets/package.json
COPY --from=build /workspace/packages/presets/dist ./packages/presets/dist

# Every production image must reproduce the reviewed PSD bytes. Application
# compatibility is tested separately in Adobe, while this catches font or
# native-library drift in the deployed runtime itself.
COPY scripts/generate-adobe-golden.mjs ./scripts/generate-adobe-golden.mjs
COPY artifacts/adobe-golden/generated /tmp/adobe-golden-expected
RUN ADOBE_GOLDEN_OUTPUT_DIRECTORY=/tmp/adobe-golden-actual \
      node --conditions=production scripts/generate-adobe-golden.mjs \
      >/tmp/adobe-golden-manifest.log \
  && node --input-type=module -e \
    'import { readFile } from "node:fs/promises"; for (const file of ["image-layers.psd", "book-pages.psd", "manifest.json"]) { const expected = await readFile(`/tmp/adobe-golden-expected/${file}`); const actual = await readFile(`/tmp/adobe-golden-actual/${file}`); if (!expected.equals(actual)) throw new Error(`Adobe Golden drift: ${file}`); }' \
  && rm -rf /tmp/adobe-golden-actual /tmp/adobe-golden-expected \
    /tmp/adobe-golden-manifest.log ./scripts/generate-adobe-golden.mjs

# The runtime invokes Node directly and must not ship build/package-manager
# tooling. Removing it also reduces the vulnerability and mutation surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

USER node
EXPOSE 4000
CMD ["node", "--conditions=production", "apps/api/dist/server.js"]
