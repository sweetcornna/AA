// The hosted web build and the native Tauri shells ship the same bundle; these
// say which one is running and where the public web version lives.
import { resolveWebOrigin } from "./webConfiguration";

/** Public web URL of this build, or null when no hosted counterpart is configured. */
export const WEB_ORIGIN = resolveWebOrigin(import.meta.env.VITE_WEB_ORIGIN).origin;

/** True inside the Tauri shells (desktop / Android / iOS), false in a browser. */
export function isNativeShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
