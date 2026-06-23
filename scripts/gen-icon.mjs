// Generate a simple 1024x1024 placeholder PNG (brand green with a lighter
// rounded square) to feed `tauri icon`. Replace src-tauri/app-icon.png with a
// real design later and re-run `npm run tauri icon`.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 1024;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// brand colors
const bg = [22, 163, 74]; // #16a34a
const fg = [134, 239, 172]; // light green

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let p = 0;
const inset = SIZE * 0.22;
const radius = SIZE * 0.16;
function inRounded(x, y) {
  if (x < inset || x > SIZE - inset || y < inset || y > SIZE - inset) return false;
  // round the corners of the inner square
  const corners = [
    [inset + radius, inset + radius],
    [SIZE - inset - radius, inset + radius],
    [inset + radius, SIZE - inset - radius],
    [SIZE - inset - radius, SIZE - inset - radius],
  ];
  for (const [cx, cy] of corners) {
    const nearX = x < inset + radius || x > SIZE - inset - radius;
    const nearY = y < inset + radius || y > SIZE - inset - radius;
    if (nearX && nearY) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.hypot(dx, dy) > radius && Math.abs(dx) > 0 && Math.abs(dy) > 0) {
        // only reject for the matching corner quadrant
      }
    }
  }
  return true;
}

for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0; // filter type: none
  for (let x = 0; x < SIZE; x++) {
    const c = inRounded(x, y) ? fg : bg;
    raw[p++] = c[0];
    raw[p++] = c[1];
    raw[p++] = c[2];
    raw[p++] = 255;
  }
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = new URL("../apps/app/src-tauri/app-icon.png", import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes)`);
