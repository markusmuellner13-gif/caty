// Procedural canvas textures — the whole world is painted at runtime,
// no downloaded assets. Each texture doubles as its own bump map.
import * as THREE from 'three';

function canvasTex(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const R = Math.random;

// near-white speckle that multiplies over the terrain's vertex colors
export function grassDetail() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i++) {
      const v = 205 + R() * 50;
      g.fillStyle = `rgb(${v},${v + 4},${v - 6})`;
      g.fillRect(R() * s, R() * s, 1 + R() * 2, 2 + R() * 4);
    }
    // darker mottled patches
    g.globalAlpha = 0.1;
    for (let i = 0; i < 26; i++) {
      g.fillStyle = R() < 0.5 ? '#9aa88a' : '#ffffff';
      g.beginPath();
      g.arc(R() * s, R() * s, 10 + R() * 30, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

export function brick(base, dark, mortar = '#d8cfc0') {
  return canvasTex(256, (g, s) => {
    g.fillStyle = mortar;
    g.fillRect(0, 0, s, s);
    const bh = 21, bw = 62;
    for (let row = 0; row * bh < s + bh; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col * bw < s + bw; col++) {
        const x = col * bw + off, y = row * bh;
        g.fillStyle = R() < 0.7 ? base : dark;
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        // shading + grain
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(x + 2, y + bh - 5, bw - 4, 3);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x + 2, y + 2, bw - 4, 2);
        for (let i = 0; i < 8; i++) {
          g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
          g.fillRect(x + 3 + R() * (bw - 8), y + 3 + R() * (bh - 8), 2, 2);
        }
      }
    }
  });
}

export function planks(base, gap = 'rgba(20,12,6,0.55)') {
  return canvasTex(256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    const pw = 43;
    for (let p = 0; p * pw < s + pw; p++) {
      const x = p * pw;
      // per-plank tint
      g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${0.05 + R() * 0.08})`;
      g.fillRect(x, 0, pw - 2, s);
      // grain streaks
      for (let i = 0; i < 10; i++) {
        g.strokeStyle = `rgba(30,18,8,${0.1 + R() * 0.15})`;
        g.lineWidth = 1 + R();
        g.beginPath();
        const gx = x + 4 + R() * (pw - 10);
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + R() * 6 - 3, s * 0.33, gx + R() * 6 - 3, s * 0.66, gx + R() * 8 - 4, s);
        g.stroke();
      }
      // knots
      if (R() < 0.6) {
        g.fillStyle = 'rgba(35,20,8,0.5)';
        g.beginPath();
        g.ellipse(x + pw / 2, R() * s, 3 + R() * 3, 5 + R() * 4, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = gap;
      g.fillRect(x + pw - 2, 0, 2, s);
    }
  });
}

export function asphalt() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#43464c';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 7000; i++) {
      const v = 45 + R() * 50;
      g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      g.fillRect(R() * s, R() * s, 1 + R(), 1 + R());
    }
    // cracks + patches
    g.strokeStyle = 'rgba(20,22,26,0.5)';
    for (let i = 0; i < 5; i++) {
      g.lineWidth = 0.8 + R();
      g.beginPath();
      let x = R() * s, y = R() * s;
      g.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += R() * 30 - 15; y += R() * 30 - 15; g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 0.1;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = R() < 0.5 ? '#2c2e33' : '#585c64';
      g.beginPath();
      g.arc(R() * s, R() * s, 14 + R() * 34, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

export function pavement() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#a2a2a8';
    g.fillRect(0, 0, s, s);
    const sw = 64;
    for (let i = 0; i <= s / sw; i++) {
      g.fillStyle = 'rgba(60,60,66,0.55)';
      g.fillRect(i * sw - 1, 0, 3, s);
      g.fillRect(0, i * sw - 1, s, 3);
    }
    for (let i = 0; i < 3200; i++) {
      const v = 140 + R() * 60;
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(R() * s, R() * s, 1 + R(), 1 + R());
    }
    g.globalAlpha = 0.09;
    for (let i = 0; i < 10; i++) {
      g.fillStyle = R() < 0.5 ? '#77777d' : '#c2c2c8';
      g.beginPath();
      g.arc(R() * s, R() * s, 10 + R() * 26, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

export function shingles(base, dark) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = dark;
    g.fillRect(0, 0, s, s);
    const rh = 26, tw = 40;
    for (let row = 0; row * rh < s + rh; row++) {
      const off = row % 2 ? tw / 2 : 0;
      for (let col = -1; col * tw < s + tw; col++) {
        const x = col * tw + off, y = row * rh;
        g.fillStyle = base;
        g.beginPath();
        g.moveTo(x + 1, y);
        g.lineTo(x + tw - 1, y);
        g.lineTo(x + tw - 1, y + rh - 6);
        g.quadraticCurveTo(x + tw / 2, y + rh + 3, x + 1, y + rh - 6);
        g.fill();
        g.fillStyle = `rgba(0,0,0,${0.08 + R() * 0.12})`;
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(x + 1, y + 1, tw - 2, 2);
      }
    }
  });
}

export function stone() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#8d8d94';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) {
      const v = 115 + R() * 60;
      g.fillStyle = `rgb(${v},${v},${v + 5})`;
      g.fillRect(R() * s, R() * s, 1 + R() * 2, 1 + R() * 2);
    }
    g.globalAlpha = 0.14;
    for (let i = 0; i < 18; i++) {
      g.fillStyle = R() < 0.5 ? '#6e6e76' : '#b0b0b8';
      g.beginPath();
      g.arc(R() * s, R() * s, 8 + R() * 22, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}

export function bark() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#6b4a2f';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      const x = R() * s;
      g.strokeStyle = `rgba(${R() < 0.5 ? '40,24,12' : '125,92,60'},${0.3 + R() * 0.4})`;
      g.lineWidth = 2 + R() * 5;
      g.beginPath();
      g.moveTo(x, -8);
      g.bezierCurveTo(x + R() * 14 - 7, s * 0.33, x + R() * 14 - 7, s * 0.66, x + R() * 18 - 9, s + 8);
      g.stroke();
    }
  });
}

export function straw(base, dark) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      g.strokeStyle = R() < 0.5 ? dark : 'rgba(255,244,200,0.5)';
      g.lineWidth = 1 + R();
      g.globalAlpha = 0.3 + R() * 0.4;
      const x = R() * s, y = R() * s, a = R() * 0.9 - 0.45;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * (10 + R() * 22), y + Math.sin(a) * 6);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

export function stucco() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#efe3cf';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i++) {
      const v = 215 + R() * 40;
      g.fillStyle = `rgb(${v},${v - 6},${v - 20})`;
      g.fillRect(R() * s, R() * s, 1 + R() * 2, 1 + R() * 2);
    }
    g.globalAlpha = 0.07;
    for (let i = 0; i < 14; i++) {
      g.fillStyle = R() < 0.5 ? '#c9b898' : '#fffaf0';
      g.beginPath();
      g.arc(R() * s, R() * s, 12 + R() * 30, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  });
}
