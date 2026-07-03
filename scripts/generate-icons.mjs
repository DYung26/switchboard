import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICON_SIZES = [16, 48, 128];
const BRAND_COLOR = [37, 99, 235, 255];
const BACKGROUND_COLOR = [255, 255, 255, 255];
const OUTER_RING_RATIO = 0.82;
const INNER_DOT_RATIO = 0.62;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, "../src/assets/icons");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    let c = (crc ^ byte) & 0xff;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function renderConcentricCirclePng(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const center = (size - 1) / 2;
  const outerRadius = (size - 1) / 2;
  const innerRadius = outerRadius * INNER_DOT_RATIO;
  const ringThreshold = outerRadius * OUTER_RING_RATIO;
  const transparent = [0, 0, 0, 0];

  const bytesPerPixel = 4;
  const rowBytes = 1 + size * bytesPerPixel;
  const raw = Buffer.alloc(size * rowBytes);

  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      const pixel =
        distance > outerRadius
          ? transparent
          : distance > ringThreshold
            ? BRAND_COLOR
            : distance > innerRadius
              ? BACKGROUND_COLOR
              : BRAND_COLOR;
      raw.set(pixel, offset);
      offset += bytesPerPixel;
    }
  }

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outputDir, { recursive: true });
for (const size of ICON_SIZES) {
  const filePath = path.join(outputDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, renderConcentricCirclePng(size));
  console.log(`Generated ${filePath}`);
}
