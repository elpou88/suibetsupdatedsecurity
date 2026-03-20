import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

function stubExternalPlugin() {
  const stubs = [
    "@pythnetwork/pyth-sui-js",
    "@pythnetwork/hermes-client",
  ];
  return {
    name: "stub-externals",
    resolveId(id: string) {
      if (stubs.some((s) => id === s || id.startsWith(s + "/"))) {
        return "\0stub:" + id;
      }
    },
    load(id: string) {
      if (id.startsWith("\0stub:")) {
        return "export default {};";
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    themePlugin(),
    stubExternalPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      events: "events",
      buffer: "buffer",
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["events", "buffer"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      plugins: [],
    },
  },
});
