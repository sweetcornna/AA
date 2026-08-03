import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { resolveSupabaseConfiguration } from "./src/lib/supabaseConfiguration";
import { resolveWebOrigin } from "./src/lib/webConfiguration";

const host = process.env.TAURI_DEV_HOST;

// The Tauri CLI exports this while running the bundled build; a bare `vite build`
// is therefore the hosted web build.
const nativeBuild = Boolean(process.env.TAURI_ENV_PLATFORM);

// https://vitejs.dev/config/ — tuned for Tauri (fixed port, ignore src-tauri).
export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "");
    const result = resolveSupabaseConfiguration(
      {
        url: env.VITE_SUPABASE_URL,
        publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
        legacyAnonKey: env.VITE_SUPABASE_ANON_KEY,
      },
      true,
    );
    if (result.error) throw new Error(`Supabase 配置错误：${result.error}`);
    process.env.VITE_SUPABASE_ORIGIN = result.configuration.url;

    const web = resolveWebOrigin(env.VITE_WEB_ORIGIN);
    if (web.error) throw new Error(`Web 站点配置错误：${web.error}`);
  }

  return {
    plugins: [react()],
    // Relative asset URLs let one artifact serve from any path — GitHub Pages'
    // project subpath included — while Tauri keeps loading from the shell root.
    base: command === "build" && !nativeBuild ? "./" : "/",
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
      watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_ENV_"],
    build: {
      // Tauri uses Chromium on Windows/Linux and WebKit on macOS/iOS.
      target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
      sourcemap: false,
    },
  };
});
