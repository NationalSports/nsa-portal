import fs from 'node:fs';
import { decode, encode } from 'fast-png';

const atlasPath = new URL('../public/uniform/designs/ayson/design-atlas.png', import.meta.url);
const image = decode(fs.readFileSync(atlasPath));
const { width, height, channels, data } = image;

if (width !== 2048 || height !== 2048 || channels !== 4) {
  throw new Error(`Unexpected AYSONSA atlas: ${width}x${height}, ${channels} channels`);
}

// The soccer foundation wraps the front-body UV edge through u=.865-.903.
// The supplied artwork stopped just before that edge, which left a straight
// base-color channel down the physical side seam. Continue the immediately
// adjacent authored motif into that narrow band. This is a UV-space repair:
// outside-shell pixels are harmless, while sampled pixels now meet cleanly.
const xStart = Math.round(width * 0.864);
const xEnd = Math.round(width * 0.906);
const yStart = Math.round(height * 0.105);
const yEnd = Math.round(height * 0.515);
const sourceOffset = Math.round(width * 0.047);

for (let y = yStart; y <= yEnd; y += 1) {
  for (let x = xStart; x <= xEnd; x += 1) {
    const sourceX = x - sourceOffset;
    const source = (y * width + sourceX) * channels;
    const target = (y * width + x) * channels;
    for (let channel = 0; channel < channels; channel += 1) {
      data[target + channel] = data[source + channel];
    }
  }
}

fs.writeFileSync(atlasPath, encode(image));
console.log(`Bridged AYSONSA side seam at x=${xStart}..${xEnd}, y=${yStart}..${yEnd}`);
