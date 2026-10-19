// Paints map chunks (terrain, towns, trees) off the main thread and sends
// them back as bitmaps at full, half and quarter size.

import { Painter } from './painter.js';

let painter = null;

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
    painter = new Painter(m.world);
    return;
  }
  try {
    if (m.t === 'chunk') {
      const cells = new Map(m.cells);
      const cv = painter.paint(m.kx, m.ky, { cells, blds: m.blds, colors: m.colors, chunksX: m.chunksX });
      const low = shrink(cv, 4);
      if (!m.full) {
        const half = m.half ? shrink(cv, 2) : null;
        const out = { key: m.key, ver: m.ver, low, half };
        self.postMessage(out, half ? [low, half] : [low]);
        return;
      }
      const half = shrink(cv, 2);
      const bmp = cv.transferToImageBitmap();
      self.postMessage({ key: m.key, ver: m.ver, bmp, half, low }, [bmp, half, low]);
    }
  } catch (err) {
    self.postMessage({ key: m.key, error: String(err && err.stack ? err.stack : err) });
  }
});
