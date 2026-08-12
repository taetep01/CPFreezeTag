import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  define: {
    // Phaser requires global
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["phaser", "@colyseus/sdk"],
  },
});
