// Generate every brand export from the SVG used by the React interface.
// Run from the repository root: node scripts/gen-icon.mjs
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = join(root, "apps/app");
const exportsDir = join(root, "docs/brand/exports");
const scratch = join(root, ".artifacts/brand-export");
const blue = "#1769df";
const source = await readFile(join(app, "src/assets/brand-symbol.svg"), "utf8");
const geometry = source.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
if (!geometry) throw new Error("Missing brand SVG geometry");
await mkdir(exportsDir, { recursive: true });
await mkdir(scratch, { recursive: true });

function symbol(color, inset = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="translate(${inset} ${inset}) scale(${(24 - inset * 2) / 24})">${geometry.replaceAll("currentColor", color)}</g></svg>`;
}
function icon({ square = false, foreground = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${foreground ? "" : `<rect width="1024" height="1024" rx="${square ? 0 : 246}" fill="${blue}"/>`}<svg x="143.36" y="143.36" width="737.28" height="737.28" viewBox="0 0 24 24">${geometry.replaceAll("currentColor", "#fff")}</svg></svg>`;
}
const rounded = icon();
const square = icon({ square: true });
await writeFile(join(exportsDir, "tongxiang-symbol.svg"), symbol(blue));
await writeFile(join(exportsDir, "tongxiang-symbol-white.svg"), symbol("#fff"));
await writeFile(join(exportsDir, "tongxiang-app-icon.svg"), rounded);
await writeFile(join(exportsDir, "tongxiang-maskable.svg"), square);
await writeFile(join(app, "public/favicon.svg"), rounded);
await writeFile(join(app, "src-tauri/app-icon.svg"), rounded);

// Adaptive Android foreground has a separate transparent layer and safe area.
await writeFile(join(scratch, "android-foreground.svg"), icon({ foreground: true }));
await writeFile(join(scratch, "android-background.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${blue}"/></svg>`);
const manifestPath = join(scratch, "tauri-icons.json");
await writeFile(manifestPath, JSON.stringify({
  default: join(app, "src-tauri/app-icon.svg"),
  bg_color: blue,
  android_bg: join(scratch, "android-background.svg"),
  android_fg: join(scratch, "android-foreground.svg"),
  android_fg_scale: 100,
  android_monochrome: join(scratch, "android-foreground.svg"),
}, null, 2));
execFileSync(process.execPath, [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "icon", manifestPath, "--ios-color", blue, "--output", join(app, "src-tauri/icons")], { cwd: app, stdio: "inherit" });

// Tauri preserves pre-existing adaptive XML; replace it to reference new layers.
const android = join(app, "src-tauri/gen/android/app/src/main/res");
await writeFile(join(android, "values/ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">${blue}</color></resources>\n`);
for (const api of [26, 33]) {
  const directory = join(android, `mipmap-anydpi-v${api}`);
  await mkdir(directory, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@mipmap/ic_launcher_background"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>${api >= 33 ? '\n  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>' : ""}\n</adaptive-icon>\n`;
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) await writeFile(join(directory, name), xml);
}

// Tauri writes mobile icons directly to existing native projects. Keep the
// fallback icon folders in sync FROM these freshly generated resources.
for (const directory of await readdir(android)) {
  if (directory.startsWith("mipmap-")) await cp(join(android, directory), join(app, "src-tauri/icons/android", directory), { recursive: true });
}
await copyFile(join(android, "values/ic_launcher_background.xml"), join(app, "src-tauri/icons/android/values/ic_launcher_background.xml"));
const ios = join(app, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset");
for (const filename of await readdir(ios)) {
  if (filename.endsWith(".png")) await copyFile(join(ios, filename), join(app, "src-tauri/icons/ios", filename));
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function raster(svg, size, path, background = "transparent") {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:${background}}body>svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path, omitBackground: background === "transparent", animations: "disabled" });
  }
  for (const [size, filename, svg] of [
    [32, "favicon.png", rounded],
    [180, "apple-touch-icon.png", square],
    [192, "icon-192.png", rounded],
    [512, "icon-512.png", rounded],
    [512, "icon-maskable-512.png", square],
  ]) await raster(svg, size, join(app, "public", filename));
  await raster(rounded, 1024, join(app, "src-tauri/app-icon.png"));
  await raster(rounded, 512, join(exportsDir, "tongxiang-app-icon.png"));
  await raster(symbol(blue, 4), 640, join(exportsDir, "tongxiang-symbol.png"), "#fff");

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#202735;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.lockup{height:630px;display:flex;align-items:center;justify-content:center;gap:48px}.icon{width:180px;height:180px}.icon svg{width:100%;height:100%}h1{font-size:66px;letter-spacing:-2px;line-height:1.15;margin:0 0 22px;font-weight:650}p{font-size:27px;color:#677283;margin:0}</style><div class="lockup"><div class="icon">${rounded}</div><div><h1>AA 记账</h1><p>一起生活，清楚分账。</p></div></div>`);
  await page.screenshot({ path: join(app, "public/og.png"), animations: "disabled" });
  await copyFile(join(app, "public/og.png"), join(exportsDir, "tongxiang-lockup.png"));
} finally {
  await browser.close();
}

await writeFile(join(exportsDir, "manifest.json"), JSON.stringify({
  concept: "同享",
  source: "apps/app/src/assets/brand-symbol.svg",
  color: blue,
  viewBox: "0 0 24 24",
  construction: "Two balanced circle arcs surround equal strokes; rounded 2.3-unit stroke.",
  safeArea: "Symbol fits inside radius 0.30 of icon width, within the 0.40 maskable safe zone.",
  exports: ["tongxiang-symbol.svg", "tongxiang-symbol-white.svg", "tongxiang-app-icon.svg", "tongxiang-maskable.svg", "tongxiang-app-icon.png", "tongxiang-symbol.png", "tongxiang-lockup.png"],
  regenerate: "node scripts/gen-icon.mjs",
}, null, 2) + "\n");
console.log("Updated SVG, Web/PWA, Android, iOS and desktop brand resources.");
