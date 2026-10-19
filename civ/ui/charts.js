// History charts: the people of the greatest realms over time, stacked,
// with the world's total on top.

import { yearText } from '../../engine/civ/sim.js';

export function drawChart(cv, h, m, focus = 0) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(10, Math.round(r.width * dpr));
  cv.height = Math.max(10, Math.round(r.height * dpr));
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width;
  const H = r.height;
  g.clearRect(0, 0, W, H);
  const n = h.years.length;
  if (n < 2) {
    g.fillStyle = '#cbbfa6';
    g.font = 'italic 14px Georgia, serif';
    g.fillText('History is only beginning…', 10, 24);
    return [];
  }
  // The realms that were ever greatest, plus the focused one.
  const peak = (c) => c.pop.reduce((a, b) => Math.max(a, b), 0);
  const civs = h.civs.filter((c) => c.pop.length);
  civs.sort((a, b) => peak(b) - peak(a));
  let top = civs.slice(0, 8);
  if (focus && !top.some((c) => c.id === focus)) {
    const f = civs.find((c) => c.id === focus);
    if (f) top = [...top.slice(0, 7), f];
  }
  const series = top.map((c) => {
    const v = new Float64Array(n);
    for (let k = 0; k < c.pop.length; k++) {
      const j = c.start + k;
      if (j < n) v[j] = c.pop[k];
    }
    return { id: c.id, v };
  });
  const maxW = Math.max(...h.world, 1);
  const pad = { l: 44, r: 6, t: 8, b: 20 };
  const x = (k) => pad.l + (k / (n - 1)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / maxW) * (H - pad.t - pad.b);
  // Grid.
  g.strokeStyle = 'rgba(246,226,180,.12)';
  g.fillStyle = '#9a8f7c';
  g.font = '11px Georgia, serif';
  g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = (maxW * k) / 4;
    g.beginPath();
    g.moveTo(pad.l, y(v));
    g.lineTo(W - pad.r, y(v));
    g.stroke();
    g.fillText(short(v), 4, y(v) + 4);
  }
  for (let k = 0; k <= 4; k++) {
    const i = Math.round(((n - 1) * k) / 4);
    const t = yearText(h.years[i]);
    const tw = g.measureText(t).width;
    g.fillText(t, Math.min(W - tw - 2, Math.max(pad.l, x(i) - tw / 2)), H - 5);
  }
  // Stacked areas.
  const base = new Float64Array(n);
  const legend = [];
  for (const s of series) {
    const c = m.civs.get(s.id);
    const color = c ? c.color : '#888';
    g.beginPath();
    for (let k = 0; k < n; k++) g.lineTo(x(k), y(base[k] + s.v[k]));
    for (let k = n - 1; k >= 0; k--) g.lineTo(x(k), y(base[k]));
    g.closePath();
    g.fillStyle = color;
    g.globalAlpha = s.id === focus ? 0.95 : 0.72;
    g.fill();
    g.globalAlpha = 1;
    for (let k = 0; k < n; k++) base[k] += s.v[k];
    legend.push({ name: c ? c.names.land : `#${s.id}`, color });
  }
  // The world.
  g.strokeStyle = '#f4dc98';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let k = 0; k < n; k++) g.lineTo(x(k), y(h.world[k]));
  g.stroke();
  legend.push({ name: 'the whole world', color: '#f4dc98' });
  return legend;
}

function short(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}
