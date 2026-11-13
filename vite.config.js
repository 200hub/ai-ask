import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [sveltekit({
    adapter: adapter({ fallback: "index.html" }),
    preprocess: vitePreprocess(),
  })],
  resolve: {
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
  },
  test: {
    include: ["src/lib/__tests__/**/*.test.{ts,svelte.ts}"],
    globals: true,
    environment: "jsdom",
    setupFiles: "src/lib/__tests__/setup.ts",
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/lib/**/*.{ts,svelte}"]
    }
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
