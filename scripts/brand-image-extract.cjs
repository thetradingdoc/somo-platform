'use strict';

/**
 * Extract solid black logo/icon from PSD exports (transparent, white-bg, or black-on-black).
 * Black-on-black uses border flood-fill — NOT dilation (which blobs the wordmark).
 */

function sampleCorners(data, w, h) {
  const pts = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.floor(w / 2), 0],
    [Math.floor(w / 2), h - 1]
  ];
  let sum = 0;
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4;
    sum += data[i] + data[i + 1] + data[i + 2];
  }
  return sum / (pts.length * 3);
}

function countOpaqueAlpha(data) {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 200) n++;
  }
  return n;
}

function isPureBlack(r, g, b) {
  return r === 0 && g === 0 && b === 0;
}

/** Flood-fill pure-black pixels reachable from image border → background */
function floodBackgroundMask(data, w, h) {
  const bg = new Uint8Array(w * h);
  const queue = [];

  function seed(x, y) {
    const idx = y * w + x;
    if (bg[idx]) return;
    const i = idx * 4;
    if (!isPureBlack(data[i], data[i + 1], data[i + 2])) return;
    bg[idx] = 1;
    queue.push(idx);
  }

  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (queue.length) {
    const idx = queue.pop();
    const x = idx % w;
    const y = (idx - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      if (bg[nidx]) continue;
      const i = nidx * 4;
      if (!isPureBlack(data[i], data[i + 1], data[i + 2])) continue;
      bg[nidx] = 1;
      queue.push(nidx);
    }
  }
  return bg;
}

function dilateMask(mask, w, h, iterations) {
  let m = mask;
  for (let iter = 0; iter < iterations; iter++) {
    const next = m.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) next[ny * w + nx] = 1;
          }
        }
      }
    }
    m = next;
  }
  return m;
}

function extractFromRaw(data, info) {
  const w = info.width;
  const h = info.height;
  const out = Buffer.from(data);

  const cornerLum = sampleCorners(data, w, h);
  const opaqueCount = countOpaqueAlpha(data);
  const hasTransparency = opaqueCount < w * h * 0.98;

  let mode = 'black-on-black';

  if (hasTransparency && cornerLum < 40) {
    mode = 'transparent';
  } else if (cornerLum > 200) {
    mode = 'white-bg';
  }

  if (mode === 'transparent') {
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] < 16) {
        out[i + 3] = 0;
        continue;
      }
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 255;
    }
  } else if (mode === 'white-bg') {
    for (let i = 0; i < out.length; i += 4) {
      const lum = out[i] + out[i + 1] + out[i + 2];
      if (lum >= 740) {
        out[i + 3] = 0;
      } else {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 255;
      }
    }
  } else {
    const bg = floodBackgroundMask(data, w, h);
    const logo = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!bg[idx]) logo[idx] = 1;
      }
    }
    // Close 1px gaps in anti-aliased edges
    const closed = dilateMask(logo, w, h, 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const i = idx * 4;
        if (closed[idx]) {
          out[i] = 0;
          out[i + 1] = 0;
          out[i + 2] = 0;
          out[i + 3] = 255;
        } else {
          out[i + 3] = 0;
        }
      }
    }
  }

  return { buffer: out, info, mode };
}

module.exports = {
  extractFromRaw,
  sampleCorners,
  countOpaqueAlpha
};
