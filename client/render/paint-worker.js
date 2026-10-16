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
      const bmp = renderChunk(world, m.cx, m.cy, ov).transferToImageBitmap();
      self.postMessage({ key: m.key, bmp }, [bmp]);
    } else if (m.t === 'layer') {
      const r = renderSettlementLayer(world, m.L, { color: m.color });
      const bmp = r.canvas.transferToImageBitmap();
      self.postMessage({ key: m.key, bmp, px: r.px, py: r.py, v: m.v, color: m.color }, [bmp]);
    }
  } catch (err) {
    self.postMessage({ key: m.key, error: String(err && err.stack ? err.stack : err) });
  }
});
