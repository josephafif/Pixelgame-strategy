// Paints terrain chunks and settlement layers off the main thread, so that
// zooming and panning never wait for pixel work. Results come back as
// ImageBitmaps (transferred, not copied).

import { renderChunk } from './ground.js';
import { renderSettlementLayer } from './settlement-layer.js';

let world = null;
let ov = null;

function applyPatch(p) {
  const W = world.width;
  for (const k of ['road', 'ground', 'crop', 'cleared']) {
    const src = p[k];
    const dst = ov[k];
    for (let y = 0; y < p.h; y++) dst.set(src.subarray(y * p.w, (y + 1) * p.w), (p.y0 + y) * W + p.x0);
  }
}

/** A smaller copy of a canvas, as an ImageBitmap. */
function shrink(cv, k) {
  const out = new OffscreenCanvas(Math.max(1, Math.round(cv.width / k)), Math.max(1, Math.round(cv.height / k)));
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'medium';
  g.drawImage(cv, 0, 0, out.width, out.height);
  return out.transferToImageBitmap();
}

self.addEventListener('message', (e) => {
  const m = e.data;
  if (m.t === 'world') {
    world = m.world;
    const n = world.width * world.height;
    ov = { road: new Uint8Array(n), ground: new Uint8Array(n), crop: new Uint8Array(n), cleared: new Uint8Array(n), worldRoad: new Uint8Array(n) };
    return;
  }
  try {
    if (m.t === 'chunk') {
      applyPatch(m.patch);
      const cv = renderChunk(world, m.cx, m.cy, ov);
      // Smaller copies for zoomed-out views: half size for the far end of the
      // close-up view, quarter size (4 px per tile) for the whole map.
      const low = shrink(cv, 4);
      if (m.lowOnly) {
        self.postMessage({ key: m.key, low }, [low]);
        return;
      }
      // The full picture only when it will be shown at full size.
      const half = shrink(cv, 2);
      if (!m.full) {
        self.postMessage({ key: m.key, half, low }, [half, low]);
        return;
      }
      const bmp = cv.transferToImageBitmap();
      self.postMessage({ key: m.key, bmp, half, low }, [bmp, half, low]);
    } else if (m.t === 'layer') {
      const r = renderSettlementLayer(world, m.L, { color: m.color });
      const low = shrink(r.canvas, 4);
      if (m.lowOnly) {
        self.postMessage({ key: m.key, low, px: r.px, py: r.py, w: r.canvas.width, h: r.canvas.height, v: m.v, color: m.color }, [low]);
        return;
      }
      const half = shrink(r.canvas, 2);
      const out = { key: m.key, half, low, px: r.px, py: r.py, w: r.canvas.width, h: r.canvas.height, v: m.v, color: m.color };
      if (m.full) out.bmp = r.canvas.transferToImageBitmap();
      self.postMessage(out, out.bmp ? [out.bmp, half, low] : [half, low]);
    }
  } catch (err) {
    self.postMessage({ key: m.key, error: String(err && err.stack ? err.stack : err) });
  }
});
