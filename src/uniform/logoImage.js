// Logo image preparation shared by the builder, 3D viewer, and production
// renderer. Transparent pixels around a PNG are not part of its finished print
// size, so crop them before measuring aspect ratio or applying inches.

export function visibleAlphaBounds(data, width, height, threshold = 8) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < left || bottom < top
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function trimTransparentCanvas(canvas) {
  if (!canvas || !canvas.width || !canvas.height) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = visibleAlphaBounds(image.data, canvas.width, canvas.height);
  if (!bounds || (bounds.x === 0 && bounds.y === 0 && bounds.width === canvas.width && bounds.height === canvas.height)) return canvas;
  const out = document.createElement('canvas');
  out.width = bounds.width; out.height = bounds.height;
  out.getContext('2d').drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return out;
}

export function canvasFromImage(img, maxPixels = Infinity) {
  const sourceWidth = img.naturalWidth || img.width || 1;
  const sourceHeight = img.naturalHeight || img.height || 1;
  const factor = Math.min(1, maxPixels / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * factor));
  const height = Math.max(1, Math.round(sourceHeight * factor));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return trimTransparentCanvas(canvas);
}

export function cloneCanvas(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  out.getContext('2d').drawImage(canvas, 0, 0);
  return out;
}
