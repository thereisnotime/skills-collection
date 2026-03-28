#!/usr/bin/env node
/**
 * Generates a simple PNG icon for the VS Code marketplace
 * Requires: npm install sharp
 *
 * Usage: node scripts/generate-icon.js
 */

const fs = require('fs');
const path = require('path');

// Create a simple 128x128 PNG with an "L" shape
// This is a minimal valid PNG structure

// PNG signature
const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// Helper to create a chunk
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type);
  const crc = crc32(Buffer.concat([typeBuffer, data]));

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = [];

  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Create IHDR chunk (128x128, 8-bit RGBA)
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(128, 0);  // width
ihdrData.writeUInt32BE(128, 4);  // height
ihdrData[8] = 8;   // bit depth
ihdrData[9] = 6;   // color type (RGBA)
ihdrData[10] = 0;  // compression
ihdrData[11] = 0;  // filter
ihdrData[12] = 0;  // interlace

const ihdr = createChunk('IHDR', ihdrData);

// Create image data - simple L shape in purple on transparent
const width = 128;
const height = 128;
const rawData = [];

// Colors
const purple = [138, 43, 226, 255];  // Blue-violet
const transparent = [0, 0, 0, 0];

for (let y = 0; y < height; y++) {
  rawData.push(0); // filter byte for each row
  for (let x = 0; x < width; x++) {
    // Draw stylized "L" shape
    const inVertical = x >= 24 && x <= 44 && y >= 16 && y <= 96;
    const inHorizontal = x >= 24 && x <= 104 && y >= 84 && y <= 104;
    const inAccent = x >= 88 && x <= 104 && y >= 68 && y <= 84;
    // Crown/horns at top
    const inLeftHorn = x >= 16 && x <= 28 && y >= 8 && y <= 20;
    const inRightHorn = x >= 40 && x <= 52 && y >= 8 && y <= 20;
    const inCrown = x >= 28 && x <= 40 && y >= 4 && y <= 16;

    const pixel = (inVertical || inHorizontal || inAccent || inLeftHorn || inRightHorn || inCrown) ? purple : transparent;
    rawData.push(...pixel);
  }
}

// Compress with zlib
const zlib = require('zlib');
const compressed = zlib.deflateSync(Buffer.from(rawData), { level: 9 });
const idat = createChunk('IDAT', compressed);

// Create IEND chunk
const iend = createChunk('IEND', Buffer.alloc(0));

// Combine all chunks
const png = Buffer.concat([signature, ihdr, idat, iend]);

// Write to file
const outputPath = path.join(__dirname, '..', 'media', 'icons', 'loki-icon.png');
fs.writeFileSync(outputPath, png);

console.log(`PNG icon created at: ${outputPath}`);
console.log(`Size: ${png.length} bytes`);
