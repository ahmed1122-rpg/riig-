import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
          const sharedPrimitives = [
            "/src/shared/DataState.tsx",
            "/src/shared/Dialog.tsx",
            "/src/shared/formatters.ts",
            "/src/shared/hooks/useDebounce.ts",
            "/src/shared/modal-environment.ts",
            "/src/shared/useConfirmation.tsx",
            "/src/shared/workflowFailurePresentation.ts",
            "/src/features/auth/PasswordRequirements.tsx",
            "/src/features/exports/exportPresentation.ts",
            "/src/features/workspace/pdfSegmentation.ts",
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
