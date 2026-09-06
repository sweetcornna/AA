import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

// Verify whole compressed files in the native library, then require every JS
// file from the current build. Size/mtime guesses break with lazy route chunks
// and can silently select an older build left in Cargo's cache.
export function verifyEmbeddedJavaScript(native, compressedFiles, expectedFiles) {
  const decoded = [];
  for (const compressed of compressedFiles) {
    if (!compressed.length || !native.includes(compressed)) continue;
    try {
      decoded.push(brotliDecompressSync(compressed));
    } catch {
      throw new Error("Embedded JavaScript is not valid Brotli data");
    }
  }
  if (!expectedFiles.length || !decoded.length)
    throw new Error("Current build or native library contains no JavaScript assets");
  for (const expected of expectedFiles) {
    if (!decoded.some((actual) => actual.equals(expected)))
      throw new Error("A current JavaScript asset is missing from the APK native library");
  }
  return Buffer.concat(decoded.flatMap((value) => [value, Buffer.from("\n")]));
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(filename));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

async function main() {
  const [nativePath, codegenRoot, distPath, output] = process.argv.slice(2);
  if (!nativePath || !codegenRoot || !distPath || !output)
    throw new Error("Usage: verify-android-assets.mjs <native-library> <codegen-root> <dist> <output>");
  const candidates = (await filesBelow(codegenRoot))
    .filter((filename) => filename.includes(`${path.sep}tauri-codegen-assets${path.sep}`) && /\.m?js$/.test(filename));
  const expected = (await filesBelow(distPath)).filter((filename) => /\.m?js$/.test(filename));
  const verified = verifyEmbeddedJavaScript(
    await readFile(nativePath),
    await Promise.all(candidates.map((filename) => readFile(filename))),
    await Promise.all(expected.map((filename) => readFile(filename))),
  );
  await writeFile(output, verified, { mode: 0o600 });
  console.log(`Verified ${expected.length} current JavaScript chunks in the APK native library.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
