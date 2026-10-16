// Pixel icons for the interface, painted once into data URLs.

import { Pix } from '../render/pix.js';

const urls = new Map();

function toUrl(p) {
  const cv = document.createElement('canvas');
  cv.width = p.w;
  cv.height = p.h;
  cv.getContext('2d').drawImage(p.toCanvas(), 0, 0);
  return cv.toDataURL();
}

const PAINT = {
  food(p) {
    for (let k = 0; k < 4; k++) p.vline(4 + k * 2, 4, 13, '#b8932f');
    for (let k = 0; k < 4; k++) {
      p.set(4 + k * 2, 3, '#f0d27a');
      p.set(4 + k * 2, 2, '#f0d27a');
      p.set(5 + k * 2, 4, '#d9b54a');
    }
    p.hline(3, 12, 9, '#8a5a32');
  },
  wood(p) {
    p.ellipse(8, 9, 6, 3.5, (dx) => (dx < -0.55 ? '#e0b880' : '#8f6a3e'));
    p.ellipse(3.5, 9, 2.2, 3, '#e0b880');
    p.set(3, 9, '#8f6a3e');
  },
  stone(p) {
    p.rect(2, 7, 6, 6, '#9d9ca4');
    p.rect(8, 5, 6, 8, '#b5b4bc');
    p.hline(2, 7, 7, '#cfcfd6');
    p.hline(8, 13, 5, '#dcdce2');
  },
  iron(p) {
    p.rect(2, 8, 12, 4, '#6c7a8a');
    p.hline(3, 12, 7, '#9fb0c2');
    p.hline(2, 13, 12, '#4a5664');
  },
  fuel(p) {
    p.ellipse(5, 10, 3.5, 3, '#2a262f');
    p.ellipse(10, 9, 4, 3.5, '#3b3640');
    p.set(9, 7, '#6a6470');
    p.set(4, 9, '#5e5866');
  },
  herbs(p) {
    p.vline(8, 5, 14, '#3f7a2e');
    p.ellipse(5, 6, 3, 2, '#6aa848');
    p.ellipse(11, 8, 3, 2, '#7cbf5a');
    p.ellipse(6, 11, 2.5, 1.6, '#5f9a3e');
  },
  crystal(p) {
    for (let j = 0; j < 10; j++) {
      const half = j < 4 ? j : 9 - j;
      for (let x = 8 - half; x <= 8 + half; x++) p.set(x, 3 + j, x < 8 ? '#e2b0ff' : '#a04ae8');
    }
  },
  goods(p) {
    p.rect(3, 5, 10, 9, '#a07446');
    p.hline(3, 12, 5, '#c49a62');
    p.line(3, 13, 12, 5, '#6f5030');
    p.vline(12, 5, 13, '#6f5030');
  },
  arms(p) {
    p.line(3, 13, 12, 4, '#c4c3ca');
    p.line(4, 13, 13, 4, '#8a8a92');
    p.line(4, 9, 8, 13, '#8f6a3e');
    p.set(12, 3, '#ffffff');
  },
  coin(p) {
    p.ellipse(8, 8, 5.5, 5.5, (dx, dy) => (dx + dy < -0.4 ? '#ffe28a' : dx + dy > 0.5 ? '#b8862a' : '#e8b840'));
    p.vline(8, 5, 10, '#b8862a');
  },
  pop(p) {
    p.ellipse(8, 5, 2.5, 2.5, '#e8b88a');
    p.rect(5, 8, 7, 6, '#3a68c8');
  },
  soldier(p) {
    p.rect(5, 3, 6, 3, '#a7a7af');
    p.rect(5, 6, 6, 3, '#e8b88a');
    p.rect(4, 9, 8, 5, '#c83a3a');
    p.vline(13, 2, 14, '#8f6a3e');
  },
  house(p) {
    for (let j = 0; j < 5; j++) p.hline(8 - j - 1, 8 + j, 3 + j, '#b9553c');
    p.rect(3, 8, 10, 6, '#e9ddc0');
    p.rect(7, 10, 3, 4, '#6a4527');
  },
};

export function icon(name) {
  if (!urls.has(name)) {
    const p = new Pix(16, 16);
    (PAINT[name] || PAINT.goods)(p);
    p.outline('#231a16');
    urls.set(name, toUrl(p));
  }
  return urls.get(name);
}

export function iconImg(name, title = '') {
  return `<img src="${icon(name)}" alt="${title || name}" title="${title || name}">`;
}
