import fs from 'node:fs';
import path from 'node:path';

const [inputGlb, inputNormal, outputGlb] = process.argv.slice(2);
if (!inputGlb || !inputNormal || !outputGlb) {
  console.error('Usage: node scripts/embed-glb-normal-map.mjs input.glb normal.png output.glb');
  process.exit(1);
}

const align4 = (buffer, fill = 0) => {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
};

const glb = fs.readFileSync(path.resolve(inputGlb));
if (glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2) {
  throw new Error(`${inputGlb} is not a GLB 2.0 file`);
}

let jsonChunk = null;
let binChunk = Buffer.alloc(0);
for (let offset = 12; offset + 8 <= glb.length;) {
  const length = glb.readUInt32LE(offset);
  const type = glb.readUInt32LE(offset + 4);
  const body = glb.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) jsonChunk = body;
  if (type === 0x004e4942) binChunk = body;
  offset += 8 + length;
}
if (!jsonChunk) throw new Error(`${inputGlb} has no JSON chunk`);

const document = JSON.parse(jsonChunk.toString('utf8').replace(/\0+$/g, '').trim());
const normalBytes = fs.readFileSync(path.resolve(inputNormal));
const binary = align4(binChunk);
const byteOffset = binary.length;
const combinedBinary = align4(Buffer.concat([binary, normalBytes]));

document.buffers ||= [{ byteLength: 0 }];
document.bufferViews ||= [];
document.images ||= [];
document.textures ||= [];

document.bufferViews.push({ buffer: 0, byteOffset, byteLength: normalBytes.length });
const bufferView = document.bufferViews.length - 1;
document.images.push({ bufferView, mimeType: 'image/png', name: 'vendor-garment-normal' });
const source = document.images.length - 1;
document.textures.push({ source, name: 'vendor-garment-normal' });
const texture = document.textures.length - 1;
for (const material of document.materials || []) material.normalTexture = { index: texture };
document.buffers[0].byteLength = combinedBinary.length;

const encodedJson = align4(Buffer.from(JSON.stringify(document)), 0x20);
const header = Buffer.alloc(12);
header.write('glTF', 0, 4, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + encodedJson.length + 8 + combinedBinary.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(encodedJson.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(combinedBinary.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

fs.mkdirSync(path.dirname(path.resolve(outputGlb)), { recursive: true });
fs.writeFileSync(path.resolve(outputGlb), Buffer.concat([
  header, jsonHeader, encodedJson, binHeader, combinedBinary,
]));
console.log(outputGlb);
