import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const previewApiOrigin = resolvePlaywrightPreviewApiOrigin(
  process.env.PLAYWRIGHT_PREVIEW_API_ORIGIN,
);
export const strictContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
].join("; ");

export default defineConfig({
  envDir: "../../",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: {
      "Content-Security-Policy": strictContentSecurityPolicy,
    },
    ...(previewApiOrigin
      ? {
          proxy: {
            "/v1": {
              target: previewApiOrigin,
            },
          },
        }
      : {}),
  },
  build: {
    manifest: true,
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (
            normalizedId.endsWith("/features/projects/ProjectsView.tsx") ||
            normalizedId.endsWith("/features/exports/ExportsView.tsx")
          ) {
            return "project-pages";
          }
          if (
            normalizedId.includes("/src/features/workspace/CharacterStudio") ||
            normalizedId.includes("/src/features/workspace/useCharacterStudio")
          ) {
            return "workspace-character";
          }
          if (normalizedId.includes("/src/features/workspace/")) {
            return "workspace";
          }
          const sharedPrimitives = [
            "/src/shared/DataState.tsx",
            "/src/shared/Dialog.tsx",
            "/src/shared/formatters.ts",
            "/src/shared/hooks/useDebounce.ts",
            "/src/shared/modal-environment.ts",
            "/src/shared/useConfirmation.tsx",
            "/src/shared/workflowFailurePresentation.ts",
            "/src/features/auth/PasswordRequirements.tsx",
            "/src/shared/exportPresentation.ts",
            "/src/shared/pdfSegmentation.ts",
            "/src/shared/useStoredPreference.ts",
          ];
          return sharedPrimitives.some((modulePath) =>
            normalizedId.includes(modulePath),
          )
            ? "ui-primitives"
            : undefined;
        },
      },
    },
  },
});

export function resolvePlaywrightPreviewApiOrigin(
  configuredOrigin: string | undefined,
): string | undefined {
  const value = configuredOrigin?.trim();
  if (!value) return undefined;
  const origin = new URL(value);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
    throw new Error(
      "PLAYWRIGHT_PREVIEW_API_ORIGIN must be an HTTP loopback origin.",
    );
  }
  return origin.origin;
}
