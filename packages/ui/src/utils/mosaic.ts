/** Average each block into a single color to create a deterministic mosaic. */
export function mosaicPixels(data: Uint8ClampedArray, width: number, height: number, blockSize = 12) {
  const output = new Uint8ClampedArray(data.length);
  const size = Math.max(1, Math.round(blockSize));
  for (let top = 0; top < height; top += size) for (let left = 0; left < width; left += size) {
    const right = Math.min(width, left + size), bottom = Math.min(height, top + size);
    const totals = [0, 0, 0, 0];
    const count = (right - left) * (bottom - top);
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) totals[channel] += data[index + channel];
    }
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) output[index + channel] = Math.round(totals[channel] / count);
    }
  }
  return output;
}
