import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Deterministic RNG so the world looks identical on every load
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function grain(ctx, w, h, rnd, amount = 0.16, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 255 * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blobs(ctx, w, h, rnd, count, colors, radius, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const r = radius * (0.35 + rnd() * 1.3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[(rnd() * colors.length) | 0];
    g.addColorStop(0, `rgba(${c},${alpha})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function cracks(ctx, w, h, rnd, count, color, width = 1.5) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rnd() * w, y = rnd() * h;
    let a = rnd() * Math.PI * 2;
    ctx.lineWidth = width * (0.5 + rnd());
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 4 + (rnd() * 12) | 0;
    for (let s = 0; s < segs; s++) {
      a += (rnd() - 0.5) * 1.2;
      x += Math.cos(a) * (4 + rnd() * 22);
      y += Math.sin(a) * (4 + rnd() * 22);
      ctx.lineTo(x, y);
      if (rnd() < 0.18) {
        ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y);
        const ba = a + (rnd() < 0.5 ? 1 : -1) * (0.4 + rnd() * 0.9);
        ctx.lineTo(x + Math.cos(ba) * (8 + rnd() * 30), y + Math.sin(ba) * (8 + rnd() * 30));
        ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------
export function makeAsphalt() {
  const w = 512, h = 512;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(1337);
  ctx.fillStyle = '#191b1e'; ctx.fillRect(0, 0, w, h);
  blobs(ctx, w, h, rnd, 26, ['40,43,46', '24,26,29', '52,50,46'], 130, 0.16);
  // aggregate speckle
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * w, y = rnd() * h;
    const v = 20 + rnd() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v + 3},${0.15 + rnd() * 0.4})`;
    ctx.fillRect(x, y, 1 + rnd() * 1.4, 1 + rnd() * 1.4);
  }
  // tar seams
  ctx.strokeStyle = 'rgba(8,9,10,0.9)'; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    let x = rnd() * w, y = 0;
    ctx.moveTo(x, y);
    while (y < h) { y += 20; x += (rnd() - 0.5) * 12; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  cracks(ctx, w, h, rnd, 22, 'rgba(5,6,7,0.85)', 1.3);
  blobs(ctx, w, h, rnd, 16, ['8,9,10'], 55, 0.28);

  const bump = canvas(w, h), bctx = bump.getContext('2d');
  bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 12000; i++) {
    const v = 60 + rnd() * 130;
    bctx.fillStyle = `rgb(${v},${v},${v})`;
    bctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  cracks(bctx, w, h, mulberry32(1337), 22, 'rgba(20,20,20,0.8)', 1.4);

  const rough = canvas(w, h), rctx = rough.getContext('2d');
  rctx.fillStyle = '#b8b8b8'; rctx.fillRect(0, 0, w, h);
  const rr = mulberry32(99);
  // wet patches are smooth (dark in roughness map)
  blobs(rctx, w, h, rr, 30, ['26,26,26'], 95, 0.75);
  blobs(rctx, w, h, rr, 40, ['70,70,70'], 42, 0.55);

  return {
    map: tex(c, { repeat: [9, 9], aniso: 16 }),
    bump: tex(bump, { srgb: false, repeat: [9, 9], aniso: 8 }),
    rough: tex(rough, { srgb: false, repeat: [9, 9], aniso: 8 }),
  };
}

// ---------------------------------------------------------------------------
// Concrete
// ---------------------------------------------------------------------------
export function makeConcrete(seed = 5, base = [96, 94, 86]) {
  const w = 512, h = 512;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; ctx.fillRect(0, 0, w, h);
  blobs(ctx, w, h, rnd, 40, ['150,148,138', '60,58,52', '120,118,108'], 110, 0.14);
  grain(ctx, w, h, rnd, 0.14);
  // form-work board lines
  ctx.strokeStyle = 'rgba(45,44,40,0.35)'; ctx.lineWidth = 2;
  for (let y = 64; y < h; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // stains
  blobs(ctx, w, h, rnd, 16, ['35,38,32', '70,64,50'], 60, 0.25);
  cracks(ctx, w, h, rnd, 10, 'rgba(28,28,26,0.8)', 1.2);

  const bump = canvas(w, h), bctx = bump.getContext('2d');
  bctx.fillStyle = '#7a7a7a'; bctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 8000; i++) {
    const v = 90 + rnd() * 80;
    bctx.fillStyle = `rgb(${v},${v},${v})`;
    bctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  cracks(bctx, w, h, mulberry32(seed + 3), 10, 'rgba(30,30,30,0.9)', 1.2);
  return {
    map: tex(c, { repeat: [2, 2] }),
    bump: tex(bump, { srgb: false, repeat: [2, 2] }),
  };
}

// ---------------------------------------------------------------------------
// Building facade with lit windows
// ---------------------------------------------------------------------------
export function makeFacade(seed = 1, tint = [58, 60, 62]) {
  const w = 512, h = 1024;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const em = canvas(w, h), ectx = em.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`; ctx.fillRect(0, 0, w, h);
  blobs(ctx, w, h, rnd, 30, ['30,32,34', '90,88,82', '45,44,42'], 120, 0.18);
  grain(ctx, w, h, rnd, 0.12);
  // vertical grime streaks
  for (let i = 0; i < 40; i++) {
    const x = rnd() * w, sw = 2 + rnd() * 12, hh = 120 + rnd() * 700;
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, 'rgba(20,22,20,0.30)'); g.addColorStop(1, 'rgba(20,22,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x, rnd() * 300, sw, hh);
  }
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, w, h);

  const cols = 4, rows = 9;
  const mx = 52, my = 46;
  const cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = mx + col * cw + 14, y = my + r * ch + 12;
      const ww = cw - 28, wh = ch - 24;
      // recess / frame
      ctx.fillStyle = 'rgba(12,13,14,0.85)'; ctx.fillRect(x - 4, y - 4, ww + 8, wh + 8);
      const lit = rnd();
      if (lit < 0.34) {
        const warm = rnd() < 0.68;
        const colr = warm ? [255, 196, 120] : [150, 205, 235];
        const alpha = 0.4 + rnd() * 0.6;
        // glass color
        ctx.fillStyle = `rgba(${colr[0] * 0.35},${colr[1] * 0.35},${colr[2] * 0.35},1)`;
        ctx.fillRect(x, y, ww, wh);
        // silhouette / blinds
        ctx.fillStyle = 'rgba(10,10,12,0.55)';
        const blinds = rnd() < 0.5;
        if (blinds) {
          for (let b = 0; b < wh; b += 7) ctx.fillRect(x, y + b, ww, 2);
        } else {
          ctx.fillRect(x + ww * rnd() * 0.6, y, ww * 0.18, wh);
        }
        // emissive window
        ectx.save();
        ectx.shadowColor = `rgba(${colr[0]},${colr[1]},${colr[2]},1)`;
        ectx.shadowBlur = 18;
        ectx.fillStyle = `rgba(${colr[0]},${colr[1]},${colr[2]},${alpha})`;
        ectx.fillRect(x, y, ww, wh);
        ectx.fillStyle = 'rgba(0,0,0,0.45)';
        if (blinds) for (let b = 0; b < wh; b += 7) ectx.fillRect(x, y + b, ww, 2);
        ectx.restore();
      } else {
        // dark glass with faint sky reflection
        const g = ctx.createLinearGradient(x, y, x + ww, y + wh);
        g.addColorStop(0, 'rgba(26,34,42,1)');
        g.addColorStop(0.5, 'rgba(12,16,20,1)');
        g.addColorStop(1, 'rgba(30,40,48,1)');
        ctx.fillStyle = g; ctx.fillRect(x, y, ww, wh);
      }
      // mullions
      ctx.strokeStyle = 'rgba(18,18,20,0.9)'; ctx.lineWidth = 3;
      ctx.strokeRect(x, y, ww, wh);
      ctx.beginPath(); ctx.moveTo(x + ww / 2, y); ctx.lineTo(x + ww / 2, y + wh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + wh * 0.42); ctx.lineTo(x + ww, y + wh * 0.42); ctx.stroke();
      // sill
      ctx.fillStyle = 'rgba(100,98,90,0.55)';
      ctx.fillRect(x - 6, y + wh + 4, ww + 12, 5);
    }
  }
  // roof ledge
  ctx.fillStyle = 'rgba(18,18,20,0.9)'; ctx.fillRect(0, 0, w, 24);
  ctx.fillStyle = 'rgba(120,118,110,0.35)'; ctx.fillRect(0, 24, w, 4);

  return {
    map: tex(c, { repeat: [1, 1], aniso: 8 }),
    emissive: tex(em, { repeat: [1, 1], aniso: 8 }),
  };
}

// ---------------------------------------------------------------------------
// Misc materials
// ---------------------------------------------------------------------------
export function makeMetal(seed = 3, base = [62, 66, 70]) {
  const w = 256, h = 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, rnd, 0.18);
  for (let i = 0; i < 160; i++) {
    ctx.strokeStyle = `rgba(${150 + rnd() * 60},${150 + rnd() * 60},${150 + rnd() * 60},${0.05 + rnd() * 0.15})`;
    ctx.lineWidth = 0.5 + rnd();
    const y = rnd() * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (rnd() - 0.5) * 6); ctx.stroke();
  }
  blobs(ctx, w, h, rnd, 14, ['110,70,40', '40,30,20'], 30, 0.28);
  return { map: tex(c, { repeat: [2, 2] }) };
}

export function makeWood(seed = 8) {
  const w = 256, h = 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#6a5137'; ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 42) {
    ctx.fillStyle = `rgba(${40 + rnd() * 40},${28 + rnd() * 26},${14 + rnd() * 20},0.5)`;
    ctx.fillRect(0, y, w, 40);
    ctx.strokeStyle = 'rgba(20,12,6,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y + 41); ctx.lineTo(w, y + 41); ctx.stroke();
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(${30 + rnd() * 40},${20 + rnd() * 30},${10 + rnd() * 20},0.4)`;
      ctx.lineWidth = 0.8;
      const yy = y + rnd() * 40;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.bezierCurveTo(w * 0.3, yy + rnd() * 8, w * 0.7, yy - rnd() * 8, w, yy + rnd() * 5); ctx.stroke();
    }
  }
  return { map: tex(c, { repeat: [2, 2] }) };
}

export function makeHazard() {
  const w = 256, h = 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#141414';
  for (let i = -h; i < w + h; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + 32, 0); ctx.lineTo(i + 32 - h, h); ctx.lineTo(i - h, h);
    ctx.closePath(); ctx.fill();
  }
  const rnd = mulberry32(4);
  grain(ctx, w, h, rnd, 0.22);
  blobs(ctx, w, h, rnd, 20, ['20,20,20', '90,70,20'], 40, 0.2);
  return { map: tex(c, { repeat: [1, 1] }) };
}

export function makeRust(seed = 11) {
  const w = 256, h = 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = '#5c3a25'; ctx.fillRect(0, 0, w, h);
  blobs(ctx, w, h, rnd, 50, ['120,58,30', '40,26,18', '150,90,45'], 45, 0.4);
  grain(ctx, w, h, rnd, 0.25);
  return { map: tex(c, { repeat: [2, 2] }) };
}

// ---------------------------------------------------------------------------
// Sprites / decals
// ---------------------------------------------------------------------------
export function makeGlowSprite() {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeSmokeSprite(seed = 21) {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * s, y = rnd() * s, r = 6 + rnd() * 18;
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(255,255,255,${0.1 + rnd() * 0.2})`);
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeBloodSplat(seed = 31) {
  const s = 256, c = canvas(s, s), ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.translate(s / 2, s / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.34);
  g.addColorStop(0, 'rgba(88,6,8,0.95)');
  g.addColorStop(0.6, 'rgba(58,3,5,0.85)');
  g.addColorStop(1, 'rgba(30,1,2,0)');
  ctx.fillStyle = g;
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * s * 0.36;
    const r = s * (0.05 + rnd() * 0.12);
    ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, 7); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 0, s * 0.24, 0, 7); ctx.fill();
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = s * (0.2 + rnd() * 0.26);
    ctx.fillStyle = `rgba(70,4,6,${0.5 + rnd() * 0.5})`;
    ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 1 + rnd() * 5, 0, 7); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeBulletHole() {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.3);
  g.addColorStop(0, 'rgba(5,5,6,1)');
  g.addColorStop(0.35, 'rgba(15,15,16,0.95)');
  g.addColorStop(0.6, 'rgba(60,60,60,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(20,20,20,0.7)'; ctx.lineWidth = 1.4;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.random() * 0.2;
    ctx.beginPath(); ctx.moveTo(s / 2 + Math.cos(a) * 6, s / 2 + Math.sin(a) * 6);
    ctx.lineTo(s / 2 + Math.cos(a) * (12 + Math.random() * 22), s / 2 + Math.sin(a) * (12 + Math.random() * 22)); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeFlameSprite() {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s * 0.62, 0, s / 2, s * 0.62, s * 0.5);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.22, 'rgba(255,220,120,0.95)');
  g.addColorStop(0.5, 'rgba(255,130,30,0.55)');
  g.addColorStop(0.8, 'rgba(180,40,10,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeMuzzleSprite() {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.18, 'rgba(255,220,140,0.95)');
  g.addColorStop(0.45, 'rgba(255,150,50,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(255,245,220,0.9)';
  for (let i = 0; i < 6; i++) {
    ctx.save(); ctx.translate(s / 2, s / 2); ctx.rotate(i / 6 * Math.PI * 2 + 0.3);
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(0, -s * 0.46); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------------------
// Neon signs / billboards
// ---------------------------------------------------------------------------
export function makeNeonSign(text, color = '#ff2f7d', opts = {}) {
  const w = 512, h = opts.tall ? 512 : 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const font = opts.font || 'bold 118px "Rajdhani", sans-serif';
  ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = color; ctx.shadowBlur = 34;
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.fillStyle = color;
  if (opts.tall) {
    const chars = text.split('');
    const step = h / (chars.length + 1);
    chars.forEach((ch, i) => {
      ctx.fillText(ch, w / 2, step * (i + 1));
      ctx.strokeText(ch, w / 2, step * (i + 1));
    });
  } else {
    ctx.fillText(text, w / 2, h / 2);
    ctx.strokeText(text, w / 2, h / 2);
  }
  // border tube
  if (opts.border) {
    ctx.shadowBlur = 18; ctx.strokeStyle = opts.border; ctx.lineWidth = 5;
    ctx.strokeRect(18, 18, w - 36, h - 36);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeBillboard(text, sub = '') {
  const w = 1024, h = 512;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#101214'; ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(77);
  grain(ctx, w, h, rnd, 0.12);
  ctx.strokeStyle = 'rgba(210,180,60,0.8)'; ctx.lineWidth = 14;
  ctx.strokeRect(20, 20, w - 40, h - 40);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 150px "Teko", sans-serif';
  ctx.fillStyle = '#e8c34a';
  ctx.shadowColor = 'rgba(232,195,74,0.6)'; ctx.shadowBlur = 26;
  ctx.fillText(text, w / 2, h * 0.42);
  if (sub) {
    ctx.shadowBlur = 0;
    ctx.font = '600 64px "Rajdhani", sans-serif';
    ctx.fillStyle = '#d9d4c5';
    ctx.fillText(sub, w / 2, h * 0.72);
  }
  // grime
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.18})`;
    ctx.fillRect(rnd() * w, rnd() * h, 20 + rnd() * 160, 10 + rnd() * 80);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeStencil(text, color = 'rgba(220,220,210,0.8)', size = 72, w = 512, h = 256) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.font = `bold ${size}px "Rajdhani", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeStarSprite() {
  const s = 64, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(200,220,255,0.7)');
  g.addColorStop(1, 'rgba(120,160,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeRainDrop() {
  const s = 16, c = canvas(16, 64), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(200,225,255,0)');
  g.addColorStop(0.5, 'rgba(200,225,255,0.75)');
  g.addColorStop(1, 'rgba(200,225,255,0)');
  ctx.fillStyle = g; ctx.fillRect(6, 0, 4, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeEnvMap() {
  // equirectangular night city environment for wet reflections
  const w = 1024, h = 512;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#03050a');
  g.addColorStop(0.42, '#0a1420');
  g.addColorStop(0.55, '#1c2b38');
  g.addColorStop(0.62, '#3a2a26');
  g.addColorStop(0.72, '#0b0e12');
  g.addColorStop(1, '#050607');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const rnd = mulberry32(2024);
  // city light blobs around horizon
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w, y = h * (0.5 + rnd() * 0.14);
    const r = 8 + rnd() * 46;
    const warm = rnd() < 0.6;
    const col = warm ? '255,170,90' : '120,190,255';
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(${col},${0.25 + rnd() * 0.5})`);
    gg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  // neon streaks
  for (let i = 0; i < 18; i++) {
    const x = rnd() * w, y = h * (0.45 + rnd() * 0.1);
    const col = rnd() < 0.5 ? '255,50,130' : '40,230,255';
    ctx.fillStyle = `rgba(${col},${0.1 + rnd() * 0.25})`;
    ctx.fillRect(x, y, 2 + rnd() * 5, 20 + rnd() * 70);
  }
  // moon glow
  const mg = ctx.createRadialGradient(w * 0.24, h * 0.18, 0, w * 0.24, h * 0.18, 120);
  mg.addColorStop(0, 'rgba(220,235,255,0.85)');
  mg.addColorStop(0.08, 'rgba(200,225,255,0.5)');
  mg.addColorStop(1, 'rgba(120,170,255,0)');
  ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Zombie skin & clothing
// ---------------------------------------------------------------------------
export function makeZombieSkin(seed = 41, base = [124, 136, 104]) {
  const w = 256, h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);

  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, w, h);

  // mottled discolouration
  blobs(ctx, w, h, rnd, 90, ['96,108,82', '150,152,122', '78,86,68', '132,118,96'], 26, 0.45);
  blobs(ctx, w, h, rnd, 40, ['82,64,74', '104,78,82'], 18, 0.3);

  // veins
  ctx.strokeStyle = 'rgba(48,58,52,0.55)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI * 2;
    ctx.lineWidth = 0.7 + rnd() * 1.3;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      a += (rnd() - 0.5) * 0.9;
      x += Math.cos(a) * (6 + rnd() * 14);
      y += Math.sin(a) * (6 + rnd() * 14);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // open wounds
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w, y = rnd() * h, r = 5 + rnd() * 13;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(78,18,18,0.95)');
    g.addColorStop(0.55, 'rgba(112,30,26,0.8)');
    g.addColorStop(1, 'rgba(90,24,22,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  grain(ctx, w, h, rnd, 0.13);
  return tex(c, { repeat: [1, 1] });
}

export function makeCloth(seed = 51, base = [72, 64, 54]) {
  const w = 256, h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);

  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, w, h);

  // woven fibres
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = `rgba(255,255,255,${0.025 + rnd() * 0.035})`;
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 3) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`;
    ctx.fillRect(x, 0, 1, h);
  }

  // dirt, grease and dried blood
  blobs(ctx, w, h, rnd, 55, ['30,26,22', '18,16,14', '54,44,34'], 22, 0.4);
  blobs(ctx, w, h, rnd, 16, ['88,22,18', '64,16,14'], 16, 0.45);

  // tears
  ctx.strokeStyle = 'rgba(12,10,9,0.9)';
  for (let i = 0; i < 9; i++) {
    let x = rnd() * w, y = rnd() * h;
    ctx.lineWidth = 1 + rnd() * 3;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rnd() - 0.5) * 22;
      y += (rnd() - 0.5) * 16;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  grain(ctx, w, h, rnd, 0.11);
  return tex(c, { repeat: [1.6, 1.6] });
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
let cache = null;
export function getTextures() {
  if (cache) return cache;
  cache = {
    asphalt: makeAsphalt(),
    concrete: makeConcrete(5, [92, 90, 82]),
    concreteDark: makeConcrete(12, [58, 58, 54]),
    facade: [makeFacade(1, [52, 54, 56]), makeFacade(2, [44, 46, 48]), makeFacade(3, [62, 60, 56])],
    metal: makeMetal(3),
    metalDark: makeMetal(6, [38, 40, 44]),
    wood: makeWood(8),
    hazard: makeHazard(),
    rust: makeRust(11),
    glow: makeGlowSprite(),
    smoke: makeSmokeSprite(),
    blood: makeBloodSplat(),
    bullet: makeBulletHole(),
    flame: makeFlameSprite(),
    muzzle: makeMuzzleSprite(),
    star: makeStarSprite(),
    env: makeEnvMap(),
    skin: [makeZombieSkin(41, [124, 136, 104]), makeZombieSkin(42, [108, 122, 94]), makeZombieSkin(43, [142, 138, 112])],
    cloth: [makeCloth(51, [74, 63, 53]), makeCloth(52, [58, 72, 80]), makeCloth(53, [92, 78, 56]), makeCloth(54, [62, 62, 64])],
    pants: [makeCloth(61, [44, 49, 54]), makeCloth(62, [50, 46, 42])],
  };
  return cache;
}
