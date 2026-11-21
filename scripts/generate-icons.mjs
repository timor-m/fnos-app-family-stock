#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const iconsDir = join(root, "packages/assets/icons");
const generatedDir = join(iconsDir, "generated");
const uiSrcIcon = join(root, "packages/ui/src/assets/app-icon.png");
const uiPublicIcon = join(root, "packages/ui/public/app-icon.png");
const sizes = [32, 48, 64, 72, 96, 128, 256, 512];

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function hex(color, alpha = 255) {
  const value = color.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    alpha
  ];
}

function blendPixel(buffer, width, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= width || alpha <= 0) return;
  const offset = (y * width + x) * 4;
  const sourceAlpha = clamp(color[3] * alpha) / 255;
  const targetAlpha = buffer[offset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    buffer[offset + channel] = Math.round((color[channel] * sourceAlpha + buffer[offset + channel] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  }
  buffer[offset + 3] = Math.round(outAlpha * 255);
}

function roundedRectAlpha(px, py, x, y, w, h, r) {
  const cx = clamp(px, x + r, x + w - r);
  const cy = clamp(py, y + r, y + h - r);
  return clamp(r + 0.5 - Math.hypot(px - cx, py - cy), 0, 1);
}

function drawRoundedRect(buffer, width, x, y, w, h, r, colorFn) {
  const minX = Math.floor(x - 1);
  const maxX = Math.ceil(x + w + 1);
  const minY = Math.floor(y - 1);
  const maxY = Math.ceil(y + h + 1);
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const alpha = roundedRectAlpha(px + 0.5, py + 0.5, x, y, w, h, r);
      if (alpha) blendPixel(buffer, width, px, py, colorFn(px, py), alpha);
    }
  }
}

function drawCircle(buffer, width, cx, cy, radius, color) {
  const minX = Math.floor(cx - radius - 1);
  const maxX = Math.ceil(cx + radius + 1);
  const minY = Math.floor(cy - radius - 1);
  const maxY = Math.ceil(cy + radius + 1);
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const alpha = clamp(radius + 0.5 - Math.hypot(px + 0.5 - cx, py + 0.5 - cy), 0, 1);
      if (alpha) blendPixel(buffer, width, px, py, color, alpha);
    }
  }
}

function drawLine(buffer, width, points, lineWidth, color) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const minX = Math.floor(Math.min(x1, x2) - lineWidth);
    const maxX = Math.ceil(Math.max(x1, x2) + lineWidth);
    const minY = Math.floor(Math.min(y1, y2) - lineWidth);
    const maxY = Math.ceil(Math.max(y1, y2) + lineWidth);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy || 1;
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const t = clamp(((px + 0.5 - x1) * dx + (py + 0.5 - y1) * dy) / lengthSquared, 0, 1);
        const nearestX = x1 + dx * t;
        const nearestY = y1 + dy * t;
        const alpha = clamp(lineWidth / 2 + 0.5 - Math.hypot(px + 0.5 - nearestX, py + 0.5 - nearestY), 0, 1);
        if (alpha) blendPixel(buffer, width, px, py, color, alpha);
      }
    }
  }
  for (const [x, y] of points) drawCircle(buffer, width, x, y, lineWidth / 2, color);
}

function drawPolygon(buffer, width, points, color) {
  const minX = Math.floor(Math.min(...points.map(([x]) => x)));
  const maxX = Math.ceil(Math.max(...points.map(([x]) => x)));
  const minY = Math.floor(Math.min(...points.map(([, y]) => y)));
  const maxY = Math.ceil(Math.max(...points.map(([, y]) => y)));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const x = px + 0.5;
      const y = py + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) blendPixel(buffer, width, px, py, color, 1);
    }
  }
}

function downsample(source, sourceWidth, targetWidth) {
  const scale = sourceWidth / targetWidth;
  const target = Buffer.alloc(targetWidth * targetWidth * 4);
  for (let y = 0; y < targetWidth; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = ((y * scale + sy) * sourceWidth + (x * scale + sx)) * 4;
          for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[offset + channel];
        }
      }
      const targetOffset = (y * targetWidth + x) * 4;
      const count = scale * scale;
      for (let channel = 0; channel < 4; channel += 1) target[targetOffset + channel] = Math.round(totals[channel] / count);
    }
  }
  return target;
}

function renderIcon(size) {
  const scale = 4;
  const width = size * scale;
  const unit = width / 1024;
  const buffer = Buffer.alloc(width * width * 4);
  const darkGreen = hex("#0B6B45");
  const shelfGreen = hex("#0B6B45", 230);
  const paperTop = hex("#FFFFFF");
  const paperBottom = hex("#F4FFF5");
  const boxTop = hex("#83D889");
  const boxBottom = hex("#45B974");

  drawRoundedRect(buffer, width, 0, 0, 1024 * unit, 1024 * unit, 248 * unit, (px, py) => {
    const t = (px + py) / (width * 2);
    return [
      Math.round(mix(11, 131, t)),
      Math.round(mix(107, 216, t)),
      Math.round(mix(69, 137, t)),
      255
    ];
  });

  drawPolygon(buffer, width, [[512, 176], [854, 424], [796, 502], [512, 294], [228, 502], [170, 424]].map(([x, y]) => [x * unit, y * unit]), hex("#063C35", 46));
  drawRoundedRect(buffer, width, 214 * unit, 372 * unit, 596 * unit, 500 * unit, 86 * unit, () => hex("#063C35", 46));
  drawPolygon(buffer, width, [[512, 148], [872, 410], [806, 498], [512, 282], [218, 498], [152, 410]].map(([x, y]) => [x * unit, y * unit]), hex("#FFFFFF"));
  drawRoundedRect(buffer, width, 194 * unit, 348 * unit, 636 * unit, 492 * unit, 86 * unit, (px, py) => {
    const t = clamp((py - 348 * unit) / (492 * unit), 0, 1);
    return [
      Math.round(mix(paperTop[0], paperBottom[0], t)),
      Math.round(mix(paperTop[1], paperBottom[1], t)),
      Math.round(mix(paperTop[2], paperBottom[2], t)),
      255
    ];
  });

  drawLine(buffer, width, [[238, 432], [512, 232], [786, 432]].map(([x, y]) => [x * unit, y * unit]), 62 * unit, darkGreen);
  drawLine(buffer, width, [[286, 596], [738, 596]].map(([x, y]) => [x * unit, y * unit]), 34 * unit, shelfGreen);
  drawLine(buffer, width, [[312, 752], [712, 752]].map(([x, y]) => [x * unit, y * unit]), 34 * unit, shelfGreen);

  drawRoundedRect(buffer, width, 384 * unit, 440 * unit, 256 * unit, 120 * unit, 28 * unit, (px, py) => {
    const t = clamp((py - 440 * unit) / (120 * unit), 0, 1);
    return [
      Math.round(mix(boxTop[0], boxBottom[0], t)),
      Math.round(mix(boxTop[1], boxBottom[1], t)),
      Math.round(mix(boxTop[2], boxBottom[2], t)),
      255
    ];
  });
  drawLine(buffer, width, [[384, 484], [640, 484]].map(([x, y]) => [x * unit, y * unit]), 30 * unit, hex("#CFF1D7", 235));

  for (const x of [314, 522]) {
    drawRoundedRect(buffer, width, x * unit, 634 * unit, 188 * unit, 116 * unit, 28 * unit, (px, py) => {
      const t = clamp((py - 634 * unit) / (116 * unit), 0, 1);
      return [
        Math.round(mix(boxTop[0], boxBottom[0], t)),
        Math.round(mix(boxTop[1], boxBottom[1], t)),
        Math.round(mix(boxTop[2], boxBottom[2], t)),
        255
      ];
    });
  }
  drawLine(buffer, width, [[342, 676], [474, 676]].map(([x, y]) => [x * unit, y * unit]), 26 * unit, hex("#CFF1D7", 235));
  drawLine(buffer, width, [[550, 676], [682, 676]].map(([x, y]) => [x * unit, y * unit]), 26 * unit, hex("#CFF1D7", 235));
  drawCircle(buffer, width, 694 * unit, 732 * unit, 54 * unit, hex("#FFC64B"));

  return downsample(buffer, width, size);
}

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      return value >>> 0;
    });
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function encodePng(width, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * width);
  for (let y = 0; y < width; y += 1) {
    rows[y * (width * 4 + 1)] = 0;
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function writePng(path, size) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, renderIcon(size)));
}

mkdirSync(generatedDir, { recursive: true });
for (const size of sizes) writePng(join(generatedDir, `icon_${size}.png`), size);
writePng(join(generatedDir, "icon-source.png"), 512);
writePng(join(iconsDir, "ICON.PNG"), 512);
writePng(join(iconsDir, "ICON_256.PNG"), 256);
writePng(uiSrcIcon, 256);
writePng(uiPublicIcon, 256);

console.log(`Generated family stock icons: ${sizes.join(", ")} px`);
