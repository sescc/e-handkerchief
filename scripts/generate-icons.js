#!/usr/bin/env node
/**
 * generate-icons.js
 * Generates minimal valid PNG files for the e-Handkerchief PWA icons.
 * Uses only built-in Node.js modules: zlib, fs, crypto.
 *
 * Run: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

/**
 * Compute CRC32 of a Buffer.
 * Uses a precomputed table for speed.
 */
function crc32(buf) {
  // Build CRC table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Write a PNG chunk: length (4B) + type (4B) + data + CRC (4B)
 */
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcInput = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Build IHDR chunk for an RGB (8-bit) PNG.
 */
function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;   // bit depth
  data[9] = 2;   // color type: RGB
  data[10] = 0;  // compression
  data[11] = 0;  // filter
  data[12] = 0;  // interlace
  return pngChunk('IHDR', data);
}

/**
 * Build IDAT chunk: raw scanlines (filter byte 0x00 + RGB pixels),
 * zlib-deflate compressed.
 */
function idat(width, height, r, g, b) {
  // Each row: 1 filter byte + width*3 RGB bytes
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0; // filter: None
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }

  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);
  return pngChunk('IDAT', compressed);
}

/**
 * Build a complete RGB PNG file.
 */
function buildPng(width, height, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const iendData = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([
    signature,
    ihdr(width, height),
    idat(width, height, r, g, b),
    iendData,
  ]);
}

// Primary color: #2d7a4f → R=45, G=122, B=79
const R = 0x2d;
const G = 0x7a;
const B = 0x4f;

const outDir = path.join(__dirname, '..', 'static', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const icons = [
  { name: 'icon-192.png', width: 192, height: 192 },
  { name: 'icon-512.png', width: 512, height: 512 },
  { name: 'shortcut-capture.png', width: 192, height: 192 },
];

for (const icon of icons) {
  const png = buildPng(icon.width, icon.height, R, G, B);
  const outPath = path.join(outDir, icon.name);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${icon.width}x${icon.height}, ${png.length} bytes)`);
}

console.log('Icon generation complete.');
