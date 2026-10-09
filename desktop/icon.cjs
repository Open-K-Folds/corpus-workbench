'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
// Code-native corpus-page mark. The same shapes produce the SVG source,
// antialiased PNG and multiresolution ICO without image services or packages.
const colors = [[33,52,74], [247,241,223], [214,223,222], [89,113,132], [222,128,107]];
function insidePolygon(x, y, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [ax, ay] = vertices[i], [bx, by] = vertices[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
function point(x, y) {
  const dx = Math.max(44 - x, 0, x - 212), dy = Math.max(44 - y, 0, y - 212);
  if (x < 16 || x > 240 || y < 16 || y > 240 || dx * dx + dy * dy > 28 * 28) return null;
  let color = colors[0];
  if (insidePolygon(x, y, [[76,52],[144,52],[180,88],[180,204],[76,204]])) color = colors[1];
  if (insidePolygon(x, y, [[144,52],[144,88],[180,88]])) color = colors[2];
  if (x >= 96 && x <= 156 && (y >= 110 && y <= 118 || y >= 132 && y <= 140)) color = colors[3];
  if (x >= 96 && x <= 156 && y >= 164 && y <= 174) color = colors[4];
  return color;
}
function crc32(bytes) {
  let value = -1;
  for (const byte of bytes) {value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));}
  return (value ^ -1) >>> 0;
}
function chunk(name, bytes) {
  const output = Buffer.alloc(bytes.length + 12); output.writeUInt32BE(bytes.length, 0); output.write(name, 4); bytes.copy(output, 8); output.writeUInt32BE(crc32(output.subarray(4, 8 + bytes.length)), 8 + bytes.length); return output;
}
function png(size) {
  const scanlines = Buffer.alloc(size * (1 + size * 4));
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const total = [0,0,0]; let count = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {const color = point((column + (sx + .5) / 4) * 256 / size, (row + (sy + .5) / 4) * 256 / size); if (color) {count++; for (let channel = 0; channel < 3; channel++) total[channel] += color[channel];}}
    const index = row * (1 + size * 4) + 1 + column * 4;
    for (let channel = 0; channel < 3; channel++) scanlines[index + channel] = count ? Math.round(total[channel] / count) : 0;
    scanlines[index + 3] = Math.round(count * 255 / 16);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
async function generateIcon(resources) {
  await fs.mkdir(resources, {recursive: true});
  const sizes = [16,24,32,48,64,128,256], images = sizes.map(png), directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {const start = 6 + index * 16; directory[start] = sizes[index] % 256; directory[start + 1] = sizes[index] % 256; directory.writeUInt16LE(1, start + 4); directory.writeUInt16LE(32, start + 6); directory.writeUInt32LE(image.length, start + 8); directory.writeUInt32LE(offset, start + 12); offset += image.length;});
  await fs.writeFile(path.join(resources, 'icon.ico'), Buffer.concat([directory, ...images]));
  await fs.writeFile(path.join(resources, 'icon.png'), images.at(-1));
}
module.exports = {generateIcon};
