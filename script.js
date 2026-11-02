/* =====================================================================
   Wack MyGuyVR — 3D ragdoll physics sandbox
   Rendering: three.js r128   Physics: cannon.js 0.6.2
   Every model, texture and sound effect is generated in this file.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1. Helpers
     ------------------------------------------------------------------ */
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deepClone = (o) => JSON.parse(JSON.stringify(o));
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randDir(rng = Math.random) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    return { x: s * Math.cos(th), y: u, z: s * Math.sin(th) };
  }

  const loadingEl = $('#loading');
  const loadingText = $('#loading-text');
  const setLoading = (t) => { if (loadingText) loadingText.textContent = t; };
  function fatal(msg) { setLoading(msg); if (loadingEl) loadingEl.classList.add('error'); }

  if (typeof THREE === 'undefined' || typeof CANNON === 'undefined') {
    fatal('The 3D engine didn’t load. Check your internet connection and reload the page.');
    return;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: keep going */ } },
  };
  const LIB_KEY = 'wmg.library';
  const settings = Object.assign({
    quality: 'medium', volume: 0.7, muted: false, names: true, getUp: true,
    slowmo: false, showFps: false, follow: true, defaultWorld: 'lab', autosave: true,
  }, store.get('wmg.settings', {}));
  const saveSettings = () => store.set('wmg.settings', settings);

  const state = { inMenu: true, paused: false, panel: null, tool: 'punch', focus: 0, score: 0, envId: 'lab', shake: 0, simTime: 0, particleMul: 1 };

  /* ------------------------------------------------------------------
     2. Renderer, scene, camera, lights
     ------------------------------------------------------------------ */
  const canvas = $('#view');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    fatal('WebGL isn’t available in this browser, so the simulator can’t start. Try a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.03, 600);

  const hemi = new THREE.HemisphereLight(0xdcd6ff, 0x2a2433, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(6, 13, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 45 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  // Fixed light count: changing the number of lights forces shader recompiles, so these are reused.
  const accents = [0, 1].map(() => { const l = new THREE.PointLight(0x8b5cf6, 0, 22, 2); scene.add(l); return l; });
  const flashes = [0].map(() => { const l = new THREE.PointLight(0xffa040, 0, 16, 2); scene.add(l); return l; });
  let flashIdx = 0;

  /* ------------------------------------------------------------------
     3. Procedural textures
     ------------------------------------------------------------------ */
  function makeCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function toTex(c, { srgb = true, repeat = 1 } = {}) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = maxAniso;
    return t;
  }
  // Tileable multi-octave value noise.
  function tileNoise(size, cells, octaves, seed) {
    const rng = mulberry32(seed), out = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      const p = cells << o, grid = new Float32Array(p * p);
      for (let i = 0; i < p * p; i++) grid[i] = rng();
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * p, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % p;
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * p, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % p;
          const a = grid[x0 + y0 * p], b = grid[x1 + y0 * p], c = grid[x0 + y1 * p], d = grid[x1 + y1 * p];
          const top = a + (b - a) * sx, bot = c + (d - c) * sx;
          out[x + y * size] += amp * (top + (bot - top) * sy);
        }
      }
      total += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }
  function noiseCanvas(size, cells, oct, seed, fn) {
    const c = makeCanvas(size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
    const n = tileNoise(size, cells, oct, seed), o = [0, 0, 0];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        fn(n[i], x, y, o);
        d[i * 4] = o[0]; d[i * 4 + 1] = o[1]; d[i * 4 + 2] = o[2]; d[i * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function lines(g, segs) { g.beginPath(); segs.forEach(([a, b, c, d]) => { g.moveTo(a, b); g.lineTo(c, d); }); g.stroke(); }

  const TEX = {};
  function makeTextures() {
    const TAU = Math.PI * 2;
    // Lab floor: poured concrete tiles.
    {
      const s = 512;
      const c = noiseCanvas(s, 6, 6, 3, (v, x, y, o) => { const k = 74 + v * 66; o[0] = k; o[1] = k + 1; o[2] = k + 6; });
      const g = c.getContext('2d'), r = mulberry32(5);
      for (let i = 0; i < 6000; i++) { const a = r() * 0.18; g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`; g.fillRect(r() * s, r() * s, 1 + r() * 1.5, 1 + r() * 1.5); }
      g.strokeStyle = 'rgba(8,8,12,.7)'; g.lineWidth = 3;
      lines(g, [[0, 0, 0, s], [s / 2, 0, s / 2, s], [s, 0, s, s], [0, 0, s, 0], [0, s / 2, s, s / 2], [0, s, s, s]]);
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
      lines(g, [[3, 0, 3, s], [s / 2 + 3, 0, s / 2 + 3, s], [0, 3, s, 3], [0, s / 2 + 3, s, s / 2 + 3]]);
      TEX.labFloor = toTex(c, { repeat: 25 });
    }
    // Wall panels.
    {
      const s = 512;
      const c = noiseCanvas(s, 4, 5, 9, (v, x, y, o) => { const k = 52 + v * 40; o[0] = k; o[1] = k; o[2] = k + 9; });
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 5; g.strokeRect(2, 2, s - 4, s - 4);
      lines(g, [[0, s / 2, s, s / 2]]);
      g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2; g.strokeRect(7, 7, s - 14, s - 14);
      g.fillStyle = 'rgba(0,0,0,.55)';
      [[18, 18], [s - 18, 18], [18, s - 18], [s - 18, s - 18], [18, s / 2 - 14], [s - 18, s / 2 - 14], [18, s / 2 + 14], [s - 18, s / 2 + 14]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); });
      g.fillStyle = 'rgba(0,0,0,.35)';
      for (let i = 0; i < 6; i++) g.fillRect(s * 0.3, s * 0.68 + i * 14, s * 0.4, 6);
      TEX.wall = toTex(c);
    }
    // Neon arena floor (colour + emissive grid).
    {
      const s = 512;
      const grid = (g, em) => {
        g.strokeStyle = em ? '#c6a6ff' : 'rgba(139,92,246,.6)'; g.lineWidth = em ? 3 : 2;
        g.shadowColor = '#8b5cf6'; g.shadowBlur = em ? 10 : 0;
        const segs = []; for (let i = 0; i <= 4; i++) { const p = (i * s) / 4; segs.push([p, 0, p, s], [0, p, s, p]); }
        lines(g, segs); g.shadowBlur = 0;
      };
      const c = noiseCanvas(s, 8, 4, 21, (v, x, y, o) => { const k = 14 + v * 18; o[0] = k; o[1] = k * 0.9; o[2] = k * 1.45; });
      grid(c.getContext('2d'), false);
      TEX.arena = toTex(c, { repeat: 20 });
      const e = makeCanvas(s), eg = e.getContext('2d'); eg.fillStyle = '#000'; eg.fillRect(0, 0, s, s); grid(eg, true);
      TEX.arenaGlow = toTex(e, { repeat: 20 });
    }
    // Desert sand with ripples (frequencies chosen so the tile wraps cleanly).
    {
      const s = 512, f1 = (TAU * 9) / s, f2 = (TAU * 3) / s;
      const c = noiseCanvas(s, 10, 5, 33, (v, x, y, o) => {
        const rip = Math.sin(x * f1 + y * f2 + v * 9) * 0.5 + 0.5, k = 0.76 + v * 0.36 + rip * 0.07;
        o[0] = 214 * k; o[1] = 176 * k; o[2] = 124 * k;
      });
      TEX.sand = toTex(c, { repeat: 22 });
    }
    // Moon regolith with craters.
    {
      const s = 512;
      const c = noiseCanvas(s, 8, 6, 44, (v, x, y, o) => { const k = 92 + v * 88; o[0] = k; o[1] = k; o[2] = k * 1.03; });
      const g = c.getContext('2d'), r = mulberry32(8);
      for (let i = 0; i < 40; i++) {
        const x = r() * s, y = r() * s, rad = 4 + Math.pow(r(), 2.5) * 48;
        const gr = g.createRadialGradient(x, y, rad * 0.1, x, y, rad);
        gr.addColorStop(0, 'rgba(0,0,0,.38)'); gr.addColorStop(0.72, 'rgba(0,0,0,.16)');
        gr.addColorStop(0.87, 'rgba(255,255,255,.24)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
      }
      TEX.moon = toTex(c, { repeat: 14 });
      TEX.moonRock = toTex(c, { repeat: 1 });
    }
    // Rock texture for desert boulders.
    TEX.rock = toTex(noiseCanvas(256, 6, 6, 17, (v, x, y, o) => { const k = 0.55 + v * 0.65; o[0] = 160 * k; o[1] = 118 * k; o[2] = 84 * k; }));
    // Wooden crate.
    {
      const s = 256;
      const c = noiseCanvas(s, 4, 4, 51, (v, x, y, o) => {
        const plank = Math.floor(y / (s / 4)), grain = Math.sin(y * 0.9 + v * 16 + plank * 3) * 0.5 + 0.5;
        const k = 0.6 + 0.24 * grain + 0.14 * v + (plank % 2) * 0.05;
        o[0] = 176 * k; o[1] = 120 * k; o[2] = 66 * k;
      });
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(40,22,8,.8)'; g.lineWidth = 2;
      lines(g, [[0, s / 4, s, s / 4], [0, s / 2, s, s / 2], [0, (3 * s) / 4, s, (3 * s) / 4]]);
      g.strokeStyle = '#5c3615'; g.lineWidth = 24; g.strokeRect(12, 12, s - 24, s - 24);
      g.lineWidth = 18; lines(g, [[22, 22, s - 22, s - 22]]);
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(24, 24, s - 48, s - 48); g.strokeRect(1, 1, s - 2, s - 2);
      g.fillStyle = '#2a2a2e';
      [[12, 12], [s - 12, 12], [12, s - 12], [s - 12, s - 12], [s / 2, 12], [s / 2, s - 12], [12, s / 2], [s - 12, s / 2]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill(); });
      TEX.crate = toTex(c);
    }
    // Brushed metal (dark, used for anvil / pads).
    {
      const mk = (base, seed) => {
        const s = 256, c = makeCanvas(s), g = c.getContext('2d'), r = mulberry32(seed);
        g.fillStyle = base; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 1000; i++) { const a = r() * 0.12; g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; g.fillRect(0, r() * s, s, 1); }
        return c;
      };
      TEX.metalDark = toTex(mk('#3b3d44', 61));
      TEX.metalLight = toTex(mk('#9aa0aa', 62));
      TEX.metalBump = toTex(mk('#808080', 63), { srgb: false });
    }
    // Explosive barrel wrap.
    {
      const w = 512, h = 256;
      const base = noiseCanvas(256, 6, 4, 77, (v, x, y, o) => { const k = 0.75 + v * 0.35; o[0] = 178 * k; o[1] = 32 * k; o[2] = 30 * k; });
      const c = makeCanvas(w, h), g = c.getContext('2d');
      g.drawImage(base, 0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h * 0.14, w, 10); g.fillRect(0, h * 0.82, w, 10);
      g.fillStyle = '#f5c518'; g.fillRect(0, h * 0.38, w, h * 0.24);
      g.save(); g.beginPath(); g.rect(0, h * 0.38, w, h * 0.24); g.clip();
      g.fillStyle = '#141414';
      for (let x = -40; x < w + 40; x += 36) { g.beginPath(); g.moveTo(x, h * 0.38); g.lineTo(x + 18, h * 0.38); g.lineTo(x + 18 - 30, h * 0.62); g.lineTo(x - 30, h * 0.62); g.fill(); }
      g.restore();
      [w * 0.25, w * 0.75].forEach((cx) => {
        g.fillStyle = '#141414'; g.fillRect(cx - 62, h * 0.4, 124, h * 0.2);
        g.fillStyle = '#f5c518'; g.font = '700 42px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('BOOM', cx, h * 0.505);
      });
      TEX.barrel = toTex(c);
    }
    // Fabric weave, skin pores, hair strands (bump maps, linear).
    TEX.fabric = toTex(noiseCanvas(256, 32, 2, 71, (v, x, y, o) => {
      const w = Math.sin((x * Math.PI) / 2) * Math.sin((y * Math.PI) / 2) * 0.5 + 0.5;
      o[0] = o[1] = o[2] = 100 + w * 90 + v * 50;
    }), { srgb: false, repeat: 3 });
    TEX.skin = toTex(noiseCanvas(256, 40, 3, 81, (v, x, y, o) => { o[0] = o[1] = o[2] = 128 + (v - 0.5) * 170; }), { srgb: false, repeat: 2 });
    {
      const s = 256, c = makeCanvas(s), g = c.getContext('2d'), r = mulberry32(91);
      g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1500; i++) {
        const x = r() * s, a = 0.08 + r() * 0.28;
        g.strokeStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; g.lineWidth = 0.6 + r() * 1.2;
        g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + r() * 8 - 4, s * 0.33, x + r() * 8 - 4, s * 0.66, x, s); g.stroke();
      }
      TEX.hair = toTex(c, { srgb: false, repeat: 2 });
    }
    // Sprites.
    {
      const s = 128, c = makeCanvas(s), g = c.getContext('2d');
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      TEX.glow = toTex(c);
    }
    {
      const s = 256, c = makeCanvas(s), g = c.getContext('2d'), r = mulberry32(19);
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(12,8,6,.9)'); gr.addColorStop(0.45, 'rgba(22,15,10,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 400; i++) { const a = r() * TAU, d = Math.pow(r(), 0.6) * s * 0.48; g.fillStyle = `rgba(0,0,0,${r() * 0.35})`; g.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 2 + r() * 3, 2 + r() * 3); }
      TEX.scorch = toTex(c);
    }
    {
      const s = 64, c = makeCanvas(s), g = c.getContext('2d');
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 12 : 28; g.lineTo(s / 2 + Math.cos(a) * rr, s / 2 + Math.sin(a) * rr); }
      g.closePath(); g.fillStyle = '#ffd84a'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#7a4b00'; g.stroke();
      TEX.star = toTex(c);
    }
    {
      const s = 128, c = makeCanvas(s), g = c.getContext('2d'), m = s / 2;
      g.fillStyle = '#f2c21b'; g.beginPath(); g.arc(m, m, m - 4, 0, TAU); g.fill();
      g.fillStyle = '#111';
      g.beginPath(); g.moveTo(m, m); g.arc(m, m, m - 4, -Math.PI / 2, 0); g.fill();
      g.beginPath(); g.moveTo(m, m); g.arc(m, m, m - 4, Math.PI / 2, Math.PI); g.fill();
      g.lineWidth = 6; g.strokeStyle = '#111'; g.beginPath(); g.arc(m, m, m - 5, 0, TAU); g.stroke();
      TEX.crashMark = toTex(c);
    }
    // Earth for the moon sky.
    {
      const s = 256, n2 = tileNoise(s, 6, 4, 202);
      const c = noiseCanvas(s, 4, 6, 201, (v, x, y, o) => {
        const lat = Math.abs(y / s - 0.5) * 2, cl = n2[y * s + x];
        if (lat > 0.86) { o[0] = o[1] = o[2] = 235; return; }
        if (v > 0.56) { o[0] = 70 + v * 60; o[1] = 120 + v * 40; o[2] = 60; } else { o[0] = 20; o[1] = 60 + v * 50; o[2] = 140 + v * 80; }
        if (cl > 0.6) { const k = (cl - 0.6) * 4; o[0] = lerp(o[0], 250, k); o[1] = lerp(o[1], 250, k); o[2] = lerp(o[2], 255, k); }
      });
      TEX.earth = toTex(c);
    }
  }
  function skyTex(top, bottom) {
    const c = makeCanvas(4, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  function buildEnvMap() {
    const pm = new THREE.PMREMGenerator(renderer), s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: 0x24202c, side: THREE.BackSide })));
    const panel = (w, h, col, k, pos, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); s.add(m);
    };
    panel(12, 5, 0xffffff, 5, [0, 6.9, 0], [Math.PI / 2, 0, 0]);
    panel(6, 6, 0xb48cff, 2.4, [-14.9, 2, 0], [0, Math.PI / 2, 0]);
    panel(7, 5, 0xffe2c4, 2.6, [14.9, 3, 4], [0, -Math.PI / 2, 0]);
    panel(10, 3, 0xffffff, 1.6, [0, 3, -14.9], null);
    const rt = pm.fromScene(s, 0.035);
    pm.dispose();
    return rt.texture;
  }

  /* ------------------------------------------------------------------
     4. Shared materials and geometry
     ------------------------------------------------------------------ */
  const MAT = {}, GEO = {};
  function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }
  function glowMat(color) { return new THREE.SpriteMaterial({ map: TEX.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }); }
  function makeShared() {
    MAT.pupil = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
    MAT.crashMark = new THREE.MeshStandardMaterial({ map: TEX.crashMark, transparent: true, alphaTest: 0.5, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
    MAT.crate = new THREE.MeshStandardMaterial({ map: TEX.crate, roughness: 0.85, bumpMap: TEX.crate, bumpScale: 0.012 });
    MAT.barrelSide = new THREE.MeshStandardMaterial({ map: TEX.barrel, roughness: 0.42, metalness: 0.35, bumpMap: TEX.metalBump, bumpScale: 0.002 });
    MAT.barrelTop = new THREE.MeshStandardMaterial({ color: 0x8f1b1b, roughness: 0.45, metalness: 0.45, map: TEX.metalLight });
    MAT.ball = new THREE.MeshPhysicalMaterial({ color: 0x6d28d9, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, metalness: 0.05 });
    MAT.ballHole = new THREE.MeshStandardMaterial({ color: 0x0b0610, roughness: 0.9 });
    MAT.anvil = new THREE.MeshStandardMaterial({ map: TEX.metalDark, metalness: 0.92, roughness: 0.36, bumpMap: TEX.metalBump, bumpScale: 0.003 });
    MAT.wall = new THREE.MeshStandardMaterial({ map: TEX.wall, roughness: 0.8, bumpMap: TEX.wall, bumpScale: 0.025 });
    MAT.metalPlate = new THREE.MeshStandardMaterial({ map: TEX.metalDark, metalness: 0.75, roughness: 0.42 });
    MAT.ledPurple = new THREE.MeshStandardMaterial({ color: 0x1a0f2e, emissive: 0x9b6bff, emissiveIntensity: 2.4 });
    MAT.ledCyan = new THREE.MeshStandardMaterial({ color: 0x0a1a22, emissive: 0x38d5ff, emissiveIntensity: 2.2 });
    MAT.pillar = new THREE.MeshStandardMaterial({ color: 0x17141f, metalness: 0.6, roughness: 0.35 });
    MAT.rock = new THREE.MeshStandardMaterial({ map: TEX.rock, roughness: 0.95, bumpMap: TEX.rock, bumpScale: 0.04, flatShading: true });
    MAT.moonRock = new THREE.MeshStandardMaterial({ map: TEX.moonRock, roughness: 0.97, bumpMap: TEX.moonRock, bumpScale: 0.04, flatShading: true });
    MAT.sandDune = new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1 });
    MAT.cactus = new THREE.MeshStandardMaterial({ color: 0x4f7f3a, roughness: 0.75, bumpMap: TEX.fabric, bumpScale: 0.02 });
    MAT.wood = new THREE.MeshStandardMaterial({ map: TEX.crate, roughness: 0.9 });
    MAT.scorch = new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    MAT.star = new THREE.SpriteMaterial({ map: TEX.star, transparent: true, depthWrite: false });
    MAT.glowPurple = glowMat(0xa77bff);
    MAT.glowOrange = glowMat(0xffa64d);
    MAT.glowRed = glowMat(0xff3355);
    MAT.glowBlue = glowMat(0x6fb6ff);
    MAT.boltPurple = new THREE.MeshBasicMaterial({ color: 0xf1e6ff });
    MAT.boltOrange = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
    MAT.rocketBody = new THREE.MeshStandardMaterial({ color: 0xe8e6ee, metalness: 0.5, roughness: 0.35 });
    MAT.rocketNose = new THREE.MeshStandardMaterial({ color: 0x7c3aed, metalness: 0.3, roughness: 0.4 });
    MAT.flame = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    MAT.grenade = new THREE.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 0.65, metalness: 0.2, bumpMap: TEX.fabric, bumpScale: 0.01 });
    MAT.grenadeCap = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.35, metalness: 0.85 });
    MAT.wellCore = new THREE.MeshBasicMaterial({ color: 0x030205 });
    MAT.wellRing = new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

    GEO.box = new THREE.BoxGeometry(1, 1, 1);
    GEO.sphere = new THREE.SphereGeometry(1, 32, 20);
    GEO.ring = new THREE.RingGeometry(0.86, 1, 72);
    GEO.plane = new THREE.PlaneGeometry(1, 1);
    GEO.barrel = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 32);
    GEO.ball = new THREE.SphereGeometry(0.21, 40, 28);
    GEO.boltCore = capsuleGeo(0.022, 0.022, 0.32);
    GEO.rocketTube = new THREE.CylinderGeometry(0.055, 0.055, 0.38, 16);
    GEO.rocketNose = new THREE.ConeGeometry(0.055, 0.14, 16);
    GEO.fin = new THREE.BoxGeometry(0.01, 0.1, 0.07);
    GEO.flame = new THREE.ConeGeometry(0.05, 0.3, 12);
    GEO.grenade = new THREE.SphereGeometry(0.085, 24, 18);
    GEO.grenadeCap = new THREE.CylinderGeometry(0.03, 0.035, 0.05, 12);
    GEO.anvil = [
      [new THREE.BoxGeometry(0.5, 0.1, 0.3), [0, -0.13, 0]],
      [new THREE.BoxGeometry(0.26, 0.14, 0.2), [0, -0.01, 0]],
      [new THREE.BoxGeometry(0.62, 0.12, 0.3), [0, 0.12, 0]],
    ];
    GEO.anvilHorn = new THREE.ConeGeometry(0.085, 0.32, 16);
    Object.values(GEO).forEach((g) => { if (g && g.userData) g.userData.shared = true; });
    GEO.anvil.forEach(([g]) => { g.userData.shared = true; });
  }

  /* ------------------------------------------------------------------
     5. Particles
     ------------------------------------------------------------------ */
  class Particles {
    constructor(max, additive) {
      this.max = max; this.n = 0; this.lastN = -1;
      const F = (k) => new Float32Array(max * k);
      this.pos = F(3); this.col = F(3); this.size = F(1); this.alpha = F(1);
      this.vel = F(3); this.life = F(1); this.maxLife = F(1); this.base = F(1); this.grow = F(1); this.grav = F(1); this.drag = F(1); this.a0 = F(1);
      const g = new THREE.BufferGeometry();
      const mk = (arr, k) => { const a = new THREE.BufferAttribute(arr, k); a.setUsage(THREE.DynamicDrawUsage); return a; };
      this.aPos = mk(this.pos, 3); this.aCol = mk(this.col, 3); this.aSize = mk(this.size, 1); this.aAlpha = mk(this.alpha, 1);
      g.setAttribute('position', this.aPos); g.setAttribute('pcolor', this.aCol); g.setAttribute('psize', this.aSize); g.setAttribute('palpha', this.aAlpha);
      g.setDrawRange(0, 0);
      this.geo = g;
      this.mat = new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 600 } },
        vertexShader: [
          'attribute vec3 pcolor; attribute float psize; attribute float palpha;',
          'uniform float uScale; varying vec3 vC; varying float vA;',
          'void main(){ vC = pcolor; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);',
          'gl_PointSize = max(1.0, psize * uScale / max(0.05, -mv.z)); gl_Position = projectionMatrix * mv; }',
        ].join('\n'),
        fragmentShader: [
          'varying vec3 vC; varying float vA;',
          'void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;',
          'float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC, a * a * vA); }',
        ].join('\n'),
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.points = new THREE.Points(g, this.mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = additive ? 3 : 2;
      scene.add(this.points);
    }
    spawn(x, y, z, vx, vy, vz, life, size, r, gg, b, o) {
      if (this.n >= this.max) return;
      o = o || {};
      const i = this.n++, i3 = i * 3;
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.col[i3] = r; this.col[i3 + 1] = gg; this.col[i3 + 2] = b;
      this.lastN = -1;
      this.life[i] = this.maxLife[i] = life;
      this.base[i] = this.size[i] = size;
      this.grow[i] = o.grow || 0; this.grav[i] = o.grav === undefined ? -9.8 : o.grav;
      this.drag[i] = o.drag === undefined ? 1 : o.drag; this.a0[i] = o.alpha === undefined ? 1 : o.alpha;
      this.alpha[i] = 0;
    }
    kill(i) {
      const j = --this.n;
      if (i === j) return;
      const i3 = i * 3, j3 = j * 3;
      for (let k = 0; k < 3; k++) { this.pos[i3 + k] = this.pos[j3 + k]; this.vel[i3 + k] = this.vel[j3 + k]; this.col[i3 + k] = this.col[j3 + k]; }
      this.size[i] = this.size[j]; this.alpha[i] = this.alpha[j]; this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
      this.base[i] = this.base[j]; this.grow[i] = this.grow[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.a0[i] = this.a0[j];
    }
    update(dt) {
      const p = this.pos, v = this.vel;
      let i = 0;
      while (i < this.n) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) { this.kill(i); continue; }
        const i3 = i * 3, dr = Math.exp(-this.drag[i] * dt);
        v[i3] *= dr; v[i3 + 1] = v[i3 + 1] * dr + this.grav[i] * dt; v[i3 + 2] *= dr;
        p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
        if (p[i3 + 1] < 0.02 && this.grav[i] < 0) { p[i3 + 1] = 0.02; v[i3 + 1] *= -0.3; v[i3] *= 0.7; v[i3 + 2] *= 0.7; }
        const t = this.life[i] / this.maxLife[i];
        this.alpha[i] = this.a0[i] * Math.min(1, t * 1.6) * Math.min(1, (1 - t) * 12 + 0.1);
        this.size[i] = this.base[i] + this.grow[i] * (1 - t);
        i++;
      }
      this.geo.setDrawRange(0, this.n);
      if (this.n === 0 && this.lastN === 0) return;
      this.lastN = this.n;
      const n = Math.max(1, this.n);
      [[this.aPos, 3], [this.aCol, 3], [this.aSize, 1], [this.aAlpha, 1]].forEach(([a, k]) => { a.updateRange.offset = 0; a.updateRange.count = n * k; a.needsUpdate = true; });
    }
    clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
  }
  let fxAdd, fxSmoke;
  function sparks(p, count, color, speed, size, life) {
    const n = Math.round(count * state.particleMul);
    for (let i = 0; i < n; i++) {
      const d = randDir(), s = speed * rand(0.3, 1);
      fxAdd.spawn(p.x, p.y, p.z, d.x * s, d.y * s + speed * 0.25, d.z * s, life * rand(0.5, 1.2), size * rand(0.6, 1.4), color[0], color[1], color[2], { grav: -9.8, drag: 1.2 });
    }
  }
  function puff(p, count, color, size, life, alpha) {
    const n = Math.max(1, Math.round(count * state.particleMul));
    for (let i = 0; i < n; i++) {
      const d = randDir(), s = rand(0.3, 1.4);
      const k = rand(0.85, 1.1);
      fxSmoke.spawn(p.x + d.x * 0.1, p.y + Math.abs(d.y) * 0.1, p.z + d.z * 0.1, d.x * s, Math.abs(d.y) * s + 0.4, d.z * s, life * rand(0.7, 1.2), size * rand(0.7, 1.2), color[0] * k, color[1] * k, color[2] * k, { grav: 0.5, drag: 2, grow: size * 2.2, alpha });
    }
  }

  /* ------------------------------------------------------------------
     6. Sound (synthesised with Web Audio)
     ------------------------------------------------------------------ */
  const Sound = {
    ctx: null, master: null, noise: null, last: {},
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp); comp.connect(this.ctx.destination);
        this.applyVolume();
        const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = b;
      } catch (e) { this.ctx = null; }
    },
    applyVolume() { if (this.master) this.master.gain.value = settings.muted ? 0 : settings.volume; },
    ok(key, gap) {
      if (!this.ctx || settings.muted || settings.volume <= 0) return false;
      const t = performance.now();
      if (this.last[key] && t - this.last[key] < gap) return false;
      this.last[key] = t; return true;
    },
    tone(f0, f1, dur, type, vol, delay) {
      const c = this.ctx, t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    },
    burst(dur, ftype, f0, f1, vol, q) {
      const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.noise; f.type = ftype; f.Q.value = q || 0.8;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(Math.max(0.0002, vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.05);
    },
    thump(v) { if (!this.ok('thump', 45)) return; const k = clamp(v / 12, 0.15, 1); this.tone(150 + rand(-25, 30), 45, 0.18, 'sine', 0.55 * k); this.burst(0.09, 'lowpass', 1800, 300, 0.28 * k); },
    slap() { if (!this.ok('slap', 30)) return; this.burst(0.13, 'highpass', 2600, 900, 0.55); this.tone(230, 80, 0.12, 'triangle', 0.3); },
    zap() { if (!this.ok('zap', 28)) return; this.tone(1500, 190, 0.13, 'square', 0.07); this.tone(950, 130, 0.16, 'sawtooth', 0.05); },
    shot() { if (!this.ok('shot', 60)) return; this.burst(0.22, 'lowpass', 3000, 300, 0.6); this.tone(160, 50, 0.14, 'square', 0.12); },
    hit() { if (!this.ok('hit', 25)) return; this.tone(520 + rand(-80, 80), 1100, 0.06, 'sine', 0.18); },
    boom(p) { if (!this.ok('boom', 40)) return; p = p || 1; this.burst(1.4 * p, 'lowpass', 2400, 55, 0.95); this.tone(95, 26, 1.0, 'sine', 0.85); this.burst(0.28, 'bandpass', 900, 200, 0.4, 0.5); },
    whoosh() { if (!this.ok('whoosh', 60)) return; this.burst(0.55, 'bandpass', 500, 2600, 0.35, 1.2); },
    clank() { if (!this.ok('clank', 70)) return; [523, 787, 1243, 1688].forEach((f, i) => this.tone(f, f * 0.985, 0.7, 'triangle', 0.14 / (i + 1))); },
    wood() { if (!this.ok('wood', 50)) return; this.burst(0.12, 'bandpass', 700, 380, 0.5, 2); this.tone(190, 120, 0.1, 'triangle', 0.15); },
    crack() { if (!this.ok('crack', 50)) return; this.burst(0.35, 'bandpass', 1400, 400, 0.6, 1.5); },
    pin() { if (!this.ok('pin', 60)) return; this.tone(2200, 1800, 0.06, 'square', 0.05); this.tone(1400, 900, 0.08, 'triangle', 0.06, 0.05); },
    tick() { if (!this.ok('tick', 20)) return; this.tone(1800, 1300, 0.04, 'sine', 0.05); },
    hum() { if (!this.ok('hum', 300)) return; this.tone(70, 38, 4.4, 'sawtooth', 0.07); this.tone(140, 80, 4.4, 'sine', 0.12); },
  };

  /* ------------------------------------------------------------------
     7. HUD helpers (comic pop-ups, toast, score)
     ------------------------------------------------------------------ */
  const labelsLayer = $('#labels');
  const tmpV = new THREE.Vector3();
  function comic(text, p, cls) {
    tmpV.set(p.x, p.y, p.z).project(camera);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) return;
    const el = document.createElement('div');
    el.className = 'comic ' + (cls || '');
    el.textContent = text;
    el.style.left = ((tmpV.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    el.style.top = ((-tmpV.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    el.style.setProperty('--rot', rand(-14, 14).toFixed(1) + 'deg');
    labelsLayer.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }
  let scoreDirty = false;
  function addScore(n) { if (n > 0) { state.score += Math.round(n); scoreDirty = true; } }

  /* ------------------------------------------------------------------
     8. Physics world
     ------------------------------------------------------------------ */
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.45;
  world.defaultContactMaterial.restitution = 0.12;
  const G_ENV = 1, G_PROP = 2, G_PROJ = 4, ALL = 0xffff;
  const DUMMY_BITS = [16, 32, 64, 128, 256, 512];
  const UP = new CANNON.Vec3(0, 1, 0);
  function removeBody(b) { if (world.removeBody) world.removeBody(b); else world.remove(b); }
  const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), collisionFilterGroup: G_ENV, collisionFilterMask: ALL });
  groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  groundBody.userData = { kind: 'ground' };
  world.addBody(groundBody);

  /* ------------------------------------------------------------------
     9. Character data
     ------------------------------------------------------------------ */
  const TYPES = { human: 'Human', alien: 'Alien', robot: 'Robot', crash: 'Crash dummy' };
  const OUTFITS = { tee: 'T-shirt & jeans', camp: 'Print shirt & jeans', hoodie: 'Hoodie & jeans', suit: 'Suit & tie', jacket: 'Blazer (skirt or trousers)', dress: 'Dress', uniform: 'Security uniform', tracksuit: 'Tracksuit', tank: 'Tank top & jeans' };
  const HATS = { none: 'No hat', cap: 'Baseball cap', beanie: 'Beanie', peaked: 'Peaked cap', sunhat: 'Sun hat' };
  const HAIRSTYLES = { bald: 'Bald', buzz: 'Buzz cut', short: 'Short', bob: 'Bob', curly: 'Curly / afro', long: 'Long', ponytail: 'Ponytail', bun: 'Top bun', braids: 'Braids', mohawk: 'Mohawk', spiky: 'Spiky' };
  const FACIAL = { none: 'None', stubble: 'Stubble', mustache: 'Mustache', goatee: 'Goatee', beard: 'Full beard' };
  const SKINS = ['#f6dccb', '#efc8a9', '#e0ae8a', '#cf9670', '#b97c56', '#9c6343', '#7e4c31', '#633a25', '#4a2a1a', '#35200f'];
  const FANTASY_SKINS = ['#7fc97a', '#6fa8dc', '#a78bdb', '#8fb3a8', '#e08ab0'];
  const HAIR_COLORS = ['#0f0b08', '#2b1a10', '#4e3020', '#7a4a26', '#b0773c', '#d9b36a', '#e8dcc8', '#8f8f94', '#7c3aed', '#d6336c', '#1fb5a8'];
  const EYE_COLORS = ['#3b2314', '#6b4423', '#3f7a4a', '#3a6ea5', '#7a8b99', '#8a6d2e'];
  const FACE_KEYS = [
    ['headW', 'Head width'], ['headH', 'Head height'], ['jawW', 'Jaw width'], ['chin', 'Chin length'], ['cheeks', 'Cheek fullness'],
    ['eyeSize', 'Eye size'], ['eyeSpace', 'Eye spacing'], ['eyeHeight', 'Eye height'], ['eyeTilt', 'Eye tilt'],
    ['browTilt', 'Brow angle'], ['browThick', 'Brow thickness'],
    ['noseSize', 'Nose size'], ['noseW', 'Nose width'], ['noseLen', 'Nose length'],
    ['mouthW', 'Mouth width'], ['lips', 'Lip fullness'], ['smile', 'Smile'], ['ears', 'Ear size'],
  ];
  const NAMES = ['Buddy', 'Gus', 'Toni', 'Ravi', 'Mina', 'Jules', 'Sol', 'Ezra', 'Noor', 'Bo', 'Kiki', 'Lars', 'Yuki', 'Femi', 'Tess', 'Rico', 'Ines', 'Dev', 'Hana', 'Kofi'];
  function defaultFace() { const f = {}; FACE_KEYS.forEach(([k]) => { f[k] = 0.5; }); f.smile = 0.6; return f; }
  function normalizeParams(p) {
    const d = {
      name: 'MyGuyVR', type: 'human', body: 'male', skin: SKINS[4], hair: 'short', hairColor: HAIR_COLORS[1], facial: 'none',
      eyeColor: EYE_COLORS[0], outfit: 'tee', shirt: '#7c3aed', pants: '#2c3550', shoes: '#16151a', hat: 'none', hatColor: '#1d1d24', modelId: null, modelName: '', height: 0.5, build: 0.5,
    };
    const o = Object.assign({}, d, p || {});
    o.face = Object.assign(defaultFace(), (p && p.face) || {});
    o.name = String(o.name || 'MyGuyVR').slice(0, 24);
    if (!TYPES[o.type]) o.type = 'human';
    if (!HAIRSTYLES[o.hair]) o.hair = 'short';
    if (!FACIAL[o.facial]) o.facial = 'none';
    if (!OUTFITS[o.outfit]) o.outfit = 'tee';
    if (!HATS[o.hat]) o.hat = 'none';
    return o;
  }
  const PRESETS = [
    { name: 'MyGuyVR', look: 'Print shirt, jeans', body: 'male', skin: SKINS[3], hair: 'short', hairColor: '#2b1a10', outfit: 'camp', shirt: '#e2734f', pants: '#2f4a7a', shoes: '#f2f2f2', height: 0.6, build: 0.55, face: { headW: 0.45, headH: 0.55, jawW: 0.62, chin: 0.58, eyeSize: 0.4, noseSize: 0.55, noseLen: 0.6, lips: 0.4, smile: 0.35, browThick: 0.6 } },
    { name: 'MyGuyVR', look: 'Blazer, skirt', body: 'female', skin: SKINS[1], hair: 'long', hairColor: '#7a2e1f', outfit: 'jacket', shirt: '#d9c99e', pants: '#6b4a2b', shoes: '#5a2d1b', height: 0.5, build: 0.38, face: { headW: 0.42, jawW: 0.36, chin: 0.45, eyeSize: 0.5, noseSize: 0.38, noseW: 0.4, lips: 0.55, smile: 0.45, browThick: 0.35 } },
    { name: 'MyGuyVR', look: 'Red dress, cap', body: 'female', skin: SKINS[8], hair: 'bun', hairColor: '#120c08', outfit: 'dress', shirt: '#c0262d', pants: '#c0262d', shoes: '#111111', hat: 'cap', hatColor: '#141418', height: 0.62, build: 0.4, face: { headW: 0.45, headH: 0.55, jawW: 0.4, eyeSize: 0.5, noseW: 0.6, lips: 0.65, smile: 0.5, browThick: 0.45 } },
    { name: 'MyGuyVR', look: 'Security uniform', body: 'male', skin: SKINS[2], hair: 'short', hairColor: '#3a2416', facial: 'mustache', outfit: 'uniform', shirt: '#26345e', pants: '#1c2440', shoes: '#0d0d0d', hat: 'peaked', hatColor: '#1c2440', height: 0.55, build: 0.66, face: { headW: 0.6, jawW: 0.7, chin: 0.5, eyeSize: 0.35, noseSize: 0.62, noseW: 0.6, lips: 0.35, smile: 0.3, browThick: 0.7, browTilt: 0.4 } },
    { name: 'MyGuyVR', look: 'Buzz cut, hoodie', body: 'male', skin: SKINS[7], hair: 'buzz', hairColor: '#0f0b08', facial: 'goatee', outfit: 'hoodie', shirt: '#2b2733', pants: '#3d4251', shoes: '#e9e6ef', height: 0.62, build: 0.62, face: { headW: 0.55, jawW: 0.62, eyeSize: 0.42, noseW: 0.62, lips: 0.6, smile: 0.5, browThick: 0.65 } },
    { name: 'MyGuyVR', look: 'Beard, tracksuit', body: 'male', skin: SKINS[4], hair: 'short', hairColor: '#2b1a10', facial: 'beard', eyeColor: EYE_COLORS[1], outfit: 'tracksuit', shirt: '#15803d', pants: '#14532d', shoes: '#f4f4f5', height: 0.55, build: 0.58, face: { jawW: 0.6, noseSize: 0.6, noseLen: 0.6, browThick: 0.7, smile: 0.4 } },
    { name: 'MyGuyVR', look: 'Curls, suit', body: 'male', skin: SKINS[9], hair: 'curly', hairColor: '#0f0b08', facial: 'mustache', outfit: 'suit', shirt: '#1f2937', pants: '#1f2937', shoes: '#0b0b0b', height: 0.75, build: 0.55, face: { headW: 0.55, headH: 0.6, jawW: 0.6, chin: 0.55, noseW: 0.7, lips: 0.66, smile: 0.55 } },
    { name: 'MyGuyVR', look: 'Bob, tee', body: 'female', skin: SKINS[0], hair: 'bob', hairColor: '#d9b36a', eyeColor: EYE_COLORS[3], outfit: 'tee', shirt: '#f472b6', pants: '#2b3f66', shoes: '#fafafa', height: 0.42, build: 0.36, face: { headW: 0.44, jawW: 0.36, chin: 0.45, eyeSize: 0.55, noseSize: 0.36, noseW: 0.4, lips: 0.5, browThick: 0.35 } },
    { name: 'MyGuyVR', look: 'Mohawk, tank top', body: 'male', skin: SKINS[3], hair: 'mohawk', hairColor: '#7c3aed', eyeColor: EYE_COLORS[1], outfit: 'tank', shirt: '#111827', pants: '#4b5563', shoes: '#dc2626', height: 0.5, build: 0.72, face: { jawW: 0.7, eyeSize: 0.4, eyeTilt: 0.62, smile: 0.35, browTilt: 0.35, browThick: 0.6 } },
    { name: 'MyGuyVR', look: 'Beanie, tee', body: 'male', skin: SKINS[1], hair: 'short', hairColor: '#d9b36a', facial: 'stubble', eyeColor: EYE_COLORS[4], outfit: 'tee', shirt: '#0ea5e9', pants: '#334155', shoes: '#f97316', hat: 'beanie', hatColor: '#9f1239', height: 0.8, build: 0.5, face: { headH: 0.62, jawW: 0.66, chin: 0.66, eyeSize: 0.38, noseSize: 0.62, noseLen: 0.66, mouthW: 0.55, ears: 0.6 } },
    { name: 'MyGuyVR', look: 'Alien', type: 'alien', body: 'male', skin: FANTASY_SKINS[0], outfit: 'tracksuit', shirt: '#c0c6d4', pants: '#9aa3b5', shoes: '#4b5563', height: 0.3, build: 0.3, face: { headW: 0.75, headH: 0.85, jawW: 0.2, chin: 0.6, eyeSize: 0.7, eyeTilt: 0.8, mouthW: 0.3, lips: 0.2 } },
    { name: 'MyGuyVR', look: 'Robot', type: 'robot', height: 0.6, build: 0.6 },
    { name: 'MyGuyVR', look: 'Crash dummy', type: 'crash', height: 0.55, build: 0.5 },
  ].map(normalizeParams);

  function randomFace() {
    const f = {};
    FACE_KEYS.forEach(([k]) => { f[k] = clamp(0.5 + (Math.random() + Math.random() + Math.random() - 1.5) * 0.6, 0, 1); });
    return f;
  }
  const randColor = () => '#' + new THREE.Color().setHSL(Math.random(), rand(0.35, 0.8), rand(0.25, 0.6)).getHexString();
  function randomCharacter() {
    const fem = Math.random() < 0.5;
    return normalizeParams({
      name: 'MyGuyVR', type: 'human', body: fem ? 'female' : 'male', skin: pick(SKINS),
      hair: pick(fem ? ['long', 'bob', 'ponytail', 'bun', 'braids', 'curly', 'short'] : ['short', 'buzz', 'curly', 'bald', 'mohawk', 'spiky', 'ponytail', 'braids']),
      hairColor: pick(HAIR_COLORS.slice(0, 8)), facial: fem ? 'none' : pick(Object.keys(FACIAL)), eyeColor: pick(EYE_COLORS),
      outfit: pick(fem ? ['tee', 'camp', 'hoodie', 'jacket', 'dress', 'tracksuit', 'tank'] : ['tee', 'camp', 'hoodie', 'suit', 'jacket', 'uniform', 'tracksuit', 'tank']),
      shirt: randColor(), pants: randColor(), shoes: randColor(),
      hat: Math.random() < 0.75 ? 'none' : pick(['cap', 'beanie', 'sunhat']), hatColor: randColor(),
      height: rand(0.2, 0.8), build: rand(0.2, 0.8), face: randomFace(),
    });
  }

  /* ------------------------------------------------------------------
     10. Modelling helpers
     ------------------------------------------------------------------ */
  // Smooth capsule (lathe), y-up, bottom radius rBot, top radius rTop, straight length len.
  function capsuleGeo(rTop, rBot, len, radial, capSeg) {
    radial = radial || 22; capSeg = capSeg || 9;
    const pts = [];
    for (let i = 0; i <= capSeg; i++) { const a = -Math.PI / 2 + (i / capSeg) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * rBot), Math.sin(a) * rBot - len / 2)); }
    for (let i = 0; i <= capSeg; i++) { const a = (i / capSeg) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * rTop), Math.sin(a) * rTop + len / 2)); }
    return new THREE.LatheGeometry(pts, radial);
  }
  // A limb mesh scaled to exactly span 2*halfH (+overlap) around its centre.
  function limb(rTop, rBot, halfH, mat, depth, overlap) {
    const target = 2 * halfH + (overlap || 0);
    const len = Math.max(0.001, target - rTop - rBot);
    const total = len + rTop + rBot, sy = target / total;
    const m = mesh(capsuleGeo(rTop, rBot, len), mat);
    m.scale.set(1, sy, depth || 1);
    m.position.y = -((rTop - rBot) / 2) * sy;
    return m;
  }
  function disposeObj(o) { o.traverse((c) => { if ((c.isMesh || c.isPoints || c.isLine) && c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); }); }
  function disposeMats(M) { Object.values(M).forEach((m) => { if (m && m.isMaterial && !m.userData.keep) m.dispose(); }); }
  const headRadius = (P) => (P.type === 'human' ? 0.106 : 0.116) * (0.94 + 0.12 * P.height);
  function disposeMatsAndTex(M) { disposeMats(M); if (M._tex) M._tex.forEach((t) => t.dispose()); }
  function bottomOf(P) {
    if (P.type === 'robot' || P.type === 'crash') return 'none';
    if (P.outfit === 'dress') return 'dress';
    if (P.outfit === 'jacket') return P.body === 'female' ? 'skirt' : 'trousers';
    if (P.outfit === 'suit' || P.outfit === 'uniform') return 'trousers';
    if (P.outfit === 'tracksuit') return 'track';
    return 'jeans';
  }
  const hashStr = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function shade(hex, k) { const c = new THREE.Color(hex); if (k > 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.multiplyScalar(1 + k); return '#' + c.getHexString(); }
  // Painted cloth: base colour + fibre noise + soft folds. Lathe UVs: u=0/1 is the front, u=.25/.75 the sides, v=1 the top.
  function clothCanvas(base, seed) {
    const S = 256, c = makeCanvas(S), g = c.getContext('2d'), r = mulberry32(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.06})` : `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
    return { c, g, r, S };
  }
  function folds(g, r, S, n, vertical, strength) {
    for (let i = 0; i < n; i++) {
      const p = r() * S, w = 8 + r() * 18, a = (strength || 0.12) * (0.5 + r() * 0.5);
      const gr = vertical ? g.createLinearGradient(p - w, 0, p + w, 0) : g.createLinearGradient(0, p - w, 0, p + w);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.45, `rgba(0,0,0,${a})`); gr.addColorStop(0.6, `rgba(255,255,255,${a * 0.35})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; if (vertical) g.fillRect(p - w, 0, w * 2, S); else g.fillRect(0, p - w, S, w * 2);
    }
  }
  const atFront = (S, fn) => { fn(0); fn(S); };
  function paintTop(kind, color, skin) {
    const { c, g, r, S } = clothCanvas(color, hashStr(kind + color));
    folds(g, r, S, 7, false, kind === 'dress' ? 0.08 : 0.13);
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 2;
    lines(g, [[S * 0.25, 0, S * 0.25, S], [S * 0.75, 0, S * 0.75, S]]);
    const vneck = (fill, w, h) => atFront(S, (x) => { g.fillStyle = fill; g.beginPath(); g.moveTo(x - w, -1); g.lineTo(x + w, -1); g.lineTo(x, h); g.closePath(); g.fill(); });
    const placket = () => atFront(S, (x) => {
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1.5; lines(g, [[x + 5, 50, x + 5, S]]);
      for (let y = 90; y < S; y += 38) { g.fillStyle = '#f1efe8'; g.beginPath(); g.arc(x + 1, y, 3, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.stroke(); }
    });
    if (kind === 'camp') {
      const inks = [shade(color, 0.55), shade(color, -0.45), '#' + new THREE.Color(color).offsetHSL(0.45, 0, 0.05).getHexString(), '#f4ecd8'];
      for (let i = 0; i < 70; i++) {
        const x = r() * S, y = r() * S, col = inks[i % inks.length], rot = r() * Math.PI, big = 0.7 + r() * 0.7;
        [x - S, x, x + S].forEach((xx) => {
          g.save(); g.translate(xx, y); g.rotate(rot); g.fillStyle = col;
          if (i % 3 === 0) { for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(Math.cos(k * 1.256) * 5 * big, Math.sin(k * 1.256) * 5 * big, 4 * big, 2.6 * big, k * 1.256, 0, Math.PI * 2); g.fill(); } }
          else { g.beginPath(); g.ellipse(0, 0, 13 * big, 4.5 * big, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; lines(g, [[-12 * big, 0, 12 * big, 0]]); }
          g.restore();
        });
      }
      vneck(skin, 26, 62); placket();
    } else if (kind === 'tee' || kind === 'tank') {
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, S - 8, S, 3);
    } else if (kind === 'hoodie') {
      for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * S, r() * S, 1, 1); }
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, S - 14, S, 5);
    } else if (kind === 'suit' || kind === 'jacket') {
      if (kind === 'suit') { g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; const segs = []; for (let x = 4; x < S; x += 9) segs.push([x, 0, x, S]); lines(g, segs); }
      atFront(S, (x) => { for (const y of [150, 196]) { g.fillStyle = shade(color, -0.55); g.beginPath(); g.arc(x + 9, y, 4, 0, Math.PI * 2); g.fill(); } });
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; lines(g, [[22, 150, 50, 150], [S - 22, 150, S - 50, 150]]);
    } else if (kind === 'tracksuit') {
      g.fillStyle = '#f3f3f3'; [S * 0.25, S * 0.75].forEach((x) => { g.fillRect(x - 7, 0, 4, S); g.fillRect(x + 3, 0, 4, S); });
      atFront(S, (x) => { g.fillStyle = '#d4d4d8'; g.fillRect(x - 1.5, 0, 3, S); });
    } else if (kind === 'uniform') {
      for (const x0 of [24, S - 64]) {
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(x0, 78, 40, 44);
        g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x0, 78, 40, 12);
        g.fillStyle = '#d6d3c4'; g.beginPath(); g.arc(x0 + 20, 86, 2.5, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#e8c23a'; g.beginPath();
      for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 6, rr = i % 2 ? 6 : 12; g.lineTo(44 + Math.cos(a) * rr, 56 + Math.sin(a) * rr); }
      g.closePath(); g.fill();
      [S * 0.25, S * 0.75].forEach((x) => { g.fillStyle = '#c9a227'; g.fillRect(x - 12, 18, 24, 22); g.fillStyle = shade(color, -0.4); g.fillRect(x - 9, 21, 18, 16); });
      vneck(skin, 14, 34); placket();
    } else if (kind === 'dress') {
      folds(g, r, S, 9, true, 0.1);
      atFront(S, (x) => { g.fillStyle = skin; g.beginPath(); g.ellipse(x, 0, 34, 40, 0, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = skin; g.beginPath(); g.ellipse(S / 2, 0, 30, 26, 0, 0, Math.PI * 2); g.fill();
    }
    return toTex(c);
  }
  function paintBottom(kind, color) {
    const { c, g, r, S } = clothCanvas(color, hashStr('b' + kind + color));
    if (kind === 'jeans') {
      g.lineWidth = 1;
      for (let i = -S; i < S; i += 3) { g.strokeStyle = i % 2 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.07)'; lines(g, [[i, S, i + S, 0]]); }
      atFront(S, (x) => { const gr = g.createRadialGradient(x, S * 0.45, 4, x, S * 0.45, 70); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - 70, 0, 140, S); });
      folds(g, r, S, 5, false, 0.12);
      g.strokeStyle = '#c98a3e'; g.lineWidth = 1.4; g.setLineDash([4, 3]);
      [S * 0.25, S * 0.75].forEach((x) => lines(g, [[x - 3, 0, x - 3, S], [x + 3, 0, x + 3, S]]));
      g.setLineDash([]);
    } else if (kind === 'trousers') {
      folds(g, r, S, 4, false, 0.1);
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; lines(g, [[1, 0, 1, S], [S - 1, 0, S - 1, S], [S / 2, 0, S / 2, S]]);
      g.strokeStyle = 'rgba(0,0,0,.25)'; lines(g, [[S * 0.25, 0, S * 0.25, S], [S * 0.75, 0, S * 0.75, S]]);
    } else if (kind === 'track') {
      folds(g, r, S, 5, false, 0.1);
      g.fillStyle = '#f3f3f3'; [S * 0.25, S * 0.75].forEach((x) => { g.fillRect(x - 7, 0, 4, S); g.fillRect(x + 3, 0, 4, S); });
    } else {
      folds(g, r, S, 10, true, 0.14);
    }
    return toTex(c);
  }
  function paintFace(skin) {
    const S = 256, c = makeCanvas(S), g = c.getContext('2d'), r = mulberry32(hashStr(skin));
    g.fillStyle = skin; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 3000; i++) { g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.035})` : `rgba(255,255,255,${r() * 0.035})`; g.fillRect(r() * S, r() * S, 1.5, 1.5); }
    const blob = (u, v, rad, col) => { const x = u * S, y = v * S, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
    for (const s of [-1, 1]) {
      blob(0.25 + s * 0.058, 0.47, 20, 'rgba(70,32,22,.26)');
      blob(0.25 + s * 0.06, 0.41, 16, 'rgba(255,255,255,.07)');
      blob(0.25 + s * 0.1, 0.58, 24, 'rgba(205,72,70,.13)');
      blob(0.25 + s * 0.2, 0.5, 34, 'rgba(60,30,20,.12)');
    }
    blob(0.25, 0.53, 10, 'rgba(255,255,255,.08)');
    blob(0.25, 0.3, 40, 'rgba(255,255,255,.05)');
    return toTex(c);
  }
  // Organic limb: radii sampled top -> bottom across 2h, rounded closed ends.
  function limbLathe(h, radii, overlap) {
    const H = h + (overlap || 0.015), n = radii.length, pts = [];
    pts.push(new THREE.Vector2(1e-4, -H - radii[n - 1] * 0.55));
    pts.push(new THREE.Vector2(radii[n - 1] * 0.72, -H - radii[n - 1] * 0.3));
    for (let i = n - 1; i >= 0; i--) pts.push(new THREE.Vector2(radii[i], lerp(H, -H, i / (n - 1))));
    pts.push(new THREE.Vector2(radii[0] * 0.72, H + radii[0] * 0.3));
    pts.push(new THREE.Vector2(1e-4, H + radii[0] * 0.55));
    return new THREE.LatheGeometry(pts, 22);
  }
  function profileLathe(pts, sx, sy, seg) { return new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(Math.max(1e-4, a * sx), b * sy)), seg || 28); }
  function addHat(g, P, M, r, sx, sy, sz) {
    const hat = P.hat; if (!hat || hat === 'none') return;
    const add = (geo, mat, pos, scl, rot) => { const m = mesh(geo, mat); m.position.set(pos[0], pos[1], pos[2]); if (scl) m.scale.set(scl[0], scl[1], scl[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); g.add(m); return m; };
    if (hat === 'cap') {
      add(new THREE.SphereGeometry(r * 1.12, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hat, [0, r * 0.08, 0], [sx, sy * 0.92, sz], [-0.18, 0, 0]);
      add(new THREE.CylinderGeometry(r * 0.62, r * 0.66, r * 0.035, 28), M.hat, [0, r * 0.22, r * 0.78], [1.05, 1, 1.15], [0.16, 0, 0]);
      add(new THREE.SphereGeometry(r * 0.08, 10, 8), M.hat, [0, r * 1.1 * sy, -r * 0.05]);
    } else if (hat === 'beanie') {
      add(new THREE.SphereGeometry(r * 1.12, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), M.hat, [0, r * 0.1, -r * 0.02], [sx, sy * 1.05, sz], [-0.22, 0, 0]);
      add(new THREE.TorusGeometry(r * 1.06, r * 0.12, 10, 40), M.hat, [0, r * 0.24, -r * 0.08], [sx, sz, 1], [Math.PI / 2 - 0.22, 0, 0]);
    } else if (hat === 'peaked') {
      add(profileLathe([[0, 0], [1.02, 0], [1.08, 0.3], [1.24, 0.5], [1.18, 0.62], [0, 0.66]], r, r), M.hat, [0, r * 0.38, -r * 0.03], [sx, 1, sz * 1.02], [-0.12, 0, 0]);
      add(new THREE.CylinderGeometry(r * 0.6, r * 0.62, r * 0.03, 26, 1, false, 0, Math.PI), M.accent, [0, r * 0.4, r * 0.55], [1, 1, 1], [0.2, -Math.PI / 2, 0]);
      add(new THREE.SphereGeometry(r * 0.09, 10, 8), M.gold, [0, r * 0.62, r * 1.02], [1, 1.1, 0.4]);
    } else if (hat === 'sunhat') {
      add(new THREE.SphereGeometry(r * 1.1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), M.hat, [0, r * 0.12, 0], [sx, sy, sz], [-0.12, 0, 0]);
      add(new THREE.CylinderGeometry(r * 2.0, r * 2.1, r * 0.03, 40), M.hat, [0, r * 0.22, 0.01], [1, 1, 1], [-0.12, 0, 0]);
      add(new THREE.TorusGeometry(r * 1.06, r * 0.05, 8, 40), M.accent, [0, r * 0.3, 0], [sx, sz, 1], [Math.PI / 2 - 0.12, 0, 0]);
    }
  }

  function makeMats(P) {
    const M = {};
    const skinCol = new THREE.Color(P.type === 'crash' ? '#f2c21b' : P.type === 'robot' ? '#b9bec8' : P.skin);
    const fab = (c, rough) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: rough, bumpMap: TEX.fabric, bumpScale: 0.004 });
    if (P.type === 'robot') {
      M.skin = new THREE.MeshStandardMaterial({ color: skinCol, metalness: 0.88, roughness: 0.3, map: TEX.metalLight, bumpMap: TEX.metalBump, bumpScale: 0.002 });
      M.shirt = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.75, roughness: 0.38 });
      M.pants = M.shirt; M.shoes = new THREE.MeshStandardMaterial({ color: 0x23252b, metalness: 0.8, roughness: 0.4 });
    } else if (P.type === 'crash') {
      M.skin = new THREE.MeshPhysicalMaterial({ color: skinCol, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      M.shirt = M.skin; M.pants = M.skin; M.shoes = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.55 });
    } else {
      M.skin = new THREE.MeshStandardMaterial({ color: skinCol, roughness: P.type === 'alien' ? 0.4 : 0.56, bumpMap: TEX.skin, bumpScale: 0.0012 });
      const skinHex = '#' + skinCol.getHexString();
      const topTex = paintTop(P.outfit, P.shirt, skinHex), botTex = paintBottom(bottomOf(P), P.pants);
      M._tex = [topTex, botTex];
      const cloth = (map, rough, sheen) => new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: sheen || 0, bumpMap: TEX.fabric, bumpScale: 0.003, side: THREE.DoubleSide });
      M.shirt = cloth(topTex, P.outfit === 'tracksuit' ? 0.5 : P.outfit === 'dress' ? 0.62 : 0.86, P.outfit === 'tracksuit' ? 0.05 : 0);
      M.pants = cloth(botTex, bottomOf(P) === 'track' ? 0.5 : 0.84);
      const dressy = ['suit', 'uniform', 'jacket', 'dress'].includes(P.outfit);
      M.shoes = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.shoes), roughness: dressy ? 0.28 : 0.55 });
      if (P.type === 'human') { const ft = paintFace(skinHex); M._tex.push(ft); M.face = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55, bumpMap: TEX.skin, bumpScale: 0.0012 }); }
    }
    M.hair = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.hairColor), roughness: 0.68, bumpMap: TEX.hair, bumpScale: 0.006, side: THREE.DoubleSide });
    M.stubble = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.hairColor), roughness: 0.9, transparent: true, opacity: 0.38, depthWrite: false });
    M.brow = P.type === 'human' ? M.hair : new THREE.MeshStandardMaterial({ color: skinCol.clone().multiplyScalar(0.45), roughness: 0.7 });
    M.lip = new THREE.MeshStandardMaterial({ color: skinCol.clone().lerp(new THREE.Color('#a24a58'), P.type === 'human' ? 0.32 : 0.15).multiplyScalar(0.86), roughness: 0.42 });
    M.mouthDark = new THREE.MeshStandardMaterial({ color: 0x2a0b12, roughness: 0.8 });
    M.eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xf3efe9, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
    M.iris = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(P.type === 'crash' ? '#1b1b1b' : P.eyeColor), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    M.accent = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.5, metalness: 0.3 });
    M.trim = new THREE.MeshStandardMaterial({ color: 0xf1f1f3, roughness: 0.7 });
    M.tie = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 });
    M.hat = new THREE.MeshStandardMaterial({ color: new THREE.Color(P.hatColor || '#1d1d24'), roughness: 0.8, bumpMap: TEX.fabric, bumpScale: 0.004 });
    M.gold = new THREE.MeshStandardMaterial({ color: 0xd9b23a, metalness: 0.9, roughness: 0.3 });
    M.sole = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7 });
    M.glow = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(P.type === 'alien' ? '#9dff8a' : '#22e3ff'), emissiveIntensity: 2.4 });
    return M;
  }

  /* ------------------------------------------------------------------
     11. Head + face generator
     ------------------------------------------------------------------ */
  function buildHead(P, M) {
    const F = P.face, g = new THREE.Group(), r = headRadius(P);
    const human = P.type === 'human', alien = P.type === 'alien', robot = P.type === 'robot', crash = P.type === 'crash';
    const sx = (human ? 0.84 + 0.2 * F.headW : 0.88 + 0.22 * F.headW) * (alien ? 1.1 : 1);
    const sy = (0.94 + 0.2 * F.headH) * (alien ? 1.14 : 1);
    const sz = 1.04;
    const refs = { group: g, eyes: [], radius: r, mouthSmile: null, mouthO: null, visor: null };

    const skull = mesh(new THREE.SphereGeometry(r, 48, 36), M.face || M.skin);
    skull.scale.set(sx, sy, sz); g.add(skull);
    const jw = (0.72 + 0.38 * F.jawW) * (alien ? 0.68 : 1), ch = 0.8 + 0.45 * F.chin;
    const jcy = -r * 0.36 * ch, jrx = r * 0.78 * sx * jw, jry = r * 0.62 * ch, jrz = r * 0.76, jcz = r * 0.07;
    const jaw = mesh(new THREE.SphereGeometry(1, 40, 28), M.skin);
    jaw.scale.set(jrx, jry, jrz); jaw.position.set(0, jcy, jcz); g.add(jaw);

    const zSkull = (x, y) => { const a = x / (r * sx), b = y / (r * sy), q = 1 - a * a - b * b; return q > 0 ? r * sz * Math.sqrt(q) : 0; };
    const zJaw = (x, y) => { const a = x / jrx, b = (y - jcy) / jry, q = 1 - a * a - b * b; return q > 0 ? jcz + jrz * Math.sqrt(q) : 0; };
    const zF = (x, y) => Math.max(zSkull(x, y), zJaw(x, y));
    const conform = (geo, off) => {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + zF(p.getX(i), p.getY(i)) + off);
      p.needsUpdate = true; geo.computeVertexNormals(); return geo;
    };

    const neck = mesh(new THREE.CylinderGeometry(r * (human ? 0.36 : 0.4), r * (human ? 0.44 : 0.48), r * 1.7, 20), M.skin);
    neck.position.set(0, -r * 1.15, -r * 0.1); g.add(neck);

    if (!robot) {
      const ck = r * (0.16 + 0.1 * F.cheeks);
      for (const s of [-1, 1]) {
        const x = s * r * 0.46 * sx, y = -r * 0.22;
        const c = mesh(new THREE.SphereGeometry(ck, 20, 14), M.skin);
        c.position.set(x, y, zF(x, y) - ck * 0.8); g.add(c);
      }
    }

    // Eyes
    const ex = r * (0.27 + 0.13 * F.eyeSpace) * (alien ? 1.12 : 1);
    const ey = r * (0.18 * F.eyeHeight);
    const eR = r * (human ? 0.1 + 0.045 * F.eyeSize : 0.12 + 0.06 * F.eyeSize) * (alien ? 1.7 : 1);
    if (robot) {
      const visor = mesh(capsuleGeo(r * 0.14, r * 0.14, ex * 2.1), M.glow);
      visor.rotation.z = Math.PI / 2; visor.scale.z = 0.55;
      visor.position.set(0, ey, zF(0, ey) - r * 0.05); g.add(visor); refs.visor = visor;
      const frame = mesh(capsuleGeo(r * 0.19, r * 0.19, ex * 2.15), M.accent);
      frame.rotation.z = Math.PI / 2; frame.scale.z = 0.5;
      frame.position.set(0, ey, zF(0, ey) - r * 0.09); g.add(frame);
    } else {
      for (const s of [-1, 1]) {
        const eg = new THREE.Group();
        eg.position.set(s * ex, ey, zF(s * ex, ey) - eR * 0.5);
        eg.rotation.y = s * 0.06;
        if (alien) { eg.rotation.z = s * -0.42; eg.scale.set(1.35, 0.8, 0.65); }
        g.add(eg);
        eg.add(mesh(new THREE.SphereGeometry(eR, 28, 20), alien ? MAT.pupil : M.eyeWhite));
        if (!alien) {
          const iris = mesh(new THREE.SphereGeometry(eR * 0.5, 22, 16), M.iris);
          iris.scale.z = 0.4; iris.position.z = eR * 0.82; eg.add(iris);
          const pupil = mesh(new THREE.SphereGeometry(eR * 0.24, 14, 10), MAT.pupil);
          pupil.scale.z = 0.4; pupil.position.z = eR * 0.93; eg.add(pupil);
        }
        const lidPivot = new THREE.Group();
        lidPivot.rotation.z = s * (F.eyeTilt - 0.5) * 0.5; eg.add(lidPivot);
        const lid = mesh(new THREE.SphereGeometry(eR * 1.09, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.skin);
        lid.rotation.x = -0.5; lid.userData.keep = true; lidPivot.add(lid);
        lidPivot.add(mesh(new THREE.SphereGeometry(eR * 1.07, 26, 8, 0, Math.PI * 2, Math.PI * 0.64, Math.PI * 0.36), M.skin));
        refs.eyes.push({ lid, open: alien ? -0.2 : -0.5 });
      }
    }

    // Brows
    if (human || crash) {
      const bt = r * (0.022 + 0.03 * F.browThick), bw = eR * 2.3;
      for (const s of [-1, 1]) {
        const bx = s * ex, by = ey + eR * 1.32 + bt;
        const brow = mesh(capsuleGeo(bt, bt, bw), M.brow);
        brow.rotation.set(0, s * 0.28, Math.PI / 2 + s * (F.browTilt - 0.5) * 0.7);
        brow.position.set(bx, by, zF(bx, by) + bt * 0.1); g.add(brow);
      }
    }

    // Nose
    if (human || crash) {
      const ns = 0.8 + 0.5 * F.noseSize, nw = 0.75 + 0.5 * F.noseW, nl = 0.7 + 0.6 * F.noseLen;
      const ny = -r * 0.2, nz = zF(0, ny);
      const tip = mesh(new THREE.SphereGeometry(r * 0.11 * ns, 22, 16), M.skin);
      tip.scale.set(nw, 0.9, 1); tip.position.set(0, ny, nz + r * 0.06 * nl); g.add(tip);
      const bridge = mesh(capsuleGeo(r * 0.05 * ns * nw, r * 0.075 * ns * nw, r * 0.3 * ns), M.skin);
      bridge.position.set(0, ny + r * 0.19 * ns, nz + r * 0.015 * nl); bridge.rotation.x = -0.32 * nl; g.add(bridge);
      for (const s of [-1, 1]) {
        const ala = mesh(new THREE.SphereGeometry(r * 0.075 * ns, 16, 12), M.skin);
        ala.position.set(s * r * 0.09 * nw * ns, ny - r * 0.03, nz - r * 0.005); g.add(ala);
      }
    } else if (alien) {
      for (const s of [-1, 1]) {
        const d = mesh(new THREE.SphereGeometry(r * 0.025, 10, 8), MAT.pupil);
        d.position.set(s * r * 0.05, -r * 0.22, zF(s * r * 0.05, -r * 0.22)); g.add(d);
      }
    }

    // Mouth
    const mw = r * (human ? 0.22 + 0.14 * F.mouthW : 0.25 + 0.16 * F.mouthW) * (alien ? 0.7 : 1);
    const lipT = r * (human ? 0.016 + 0.02 * F.lips : 0.02 + 0.026 * F.lips);
    const my = jcy - r * 0.13 * ch;
    const beardOff = human && P.facial === 'beard' ? r * 0.065 : human && P.facial === 'stubble' ? r * 0.012 : 0;
    if (robot) {
      const grill = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = mesh(new THREE.BoxGeometry(r * 0.5, r * 0.035, r * 0.08), M.accent);
        b.position.set(0, my + r * 0.08 - i * r * 0.07, zF(0, my) - r * 0.01); grill.add(b);
      }
      g.add(grill); refs.mouthSmile = grill;
    } else {
      const smileG = new THREE.Group(); g.add(smileG);
      const arc = human ? 0.25 + 0.8 * F.smile : 0.35 + 1.25 * F.smile, R = (mw / 2) / Math.sin(arc / 2), oy = my + R * Math.cos(arc / 2);
      const lipGeo = (tube, dy, off) => conform(new THREE.TorusGeometry(R, tube, 10, 36, arc).rotateZ(-Math.PI / 2 - arc / 2).translate(0, oy + dy, 0), off + beardOff);
      smileG.add(mesh(lipGeo(lipT, lipT * 0.75, lipT * 0.35), M.lip));
      smileG.add(mesh(lipGeo(lipT * 1.15, -lipT * 0.95, lipT * 0.4), M.lip));
      smileG.add(mesh(lipGeo(lipT * 0.36, -lipT * 0.1, lipT * 0.8), M.mouthDark));
      const oG = new THREE.Group(); oG.visible = false; g.add(oG);
      const oy2 = my - r * 0.03, orr = r * 0.075 * (alien ? 0.7 : 1);
      oG.add(mesh(conform(new THREE.TorusGeometry(orr, lipT * 1.1, 10, 28).translate(0, oy2, 0), lipT * 0.5 + beardOff), M.lip));
      oG.add(mesh(conform(new THREE.CircleGeometry(orr, 24).translate(0, oy2, 0), lipT * 0.2 + beardOff), M.mouthDark));
      smileG.userData.keep = true; oG.userData.keep = true;
      refs.mouthSmile = smileG; refs.mouthO = oG;
    }

    // Ears / antennae
    if (human || crash) {
      const es = r * (human ? 0.2 : 0.23) * (0.7 + 0.6 * F.ears);
      for (const s of [-1, 1]) {
        const ear = mesh(new THREE.SphereGeometry(es, 20, 14), M.skin);
        ear.scale.set(0.42, 1, 0.72); ear.position.set(s * r * sx * 0.96, -r * 0.06, -r * 0.04); ear.rotation.y = s * 0.35; g.add(ear);
      }
    } else if (alien) {
      for (const s of [-1, 1]) {
        const ear = mesh(new THREE.ConeGeometry(r * 0.11, r * 0.5, 14), M.skin);
        ear.rotation.z = -s * (Math.PI / 2 - 0.45); ear.position.set(s * r * sx * 1.02, r * 0.05, -r * 0.05); g.add(ear);
        const ant = mesh(new THREE.CylinderGeometry(r * 0.025, r * 0.035, r * 0.6, 8), M.skin);
        ant.rotation.z = -s * 0.4; ant.position.set(s * r * 0.36, r * sy + r * 0.12, -r * 0.1); g.add(ant);
        const tip = mesh(new THREE.SphereGeometry(r * 0.08, 14, 10), M.glow);
        tip.position.set(s * r * 0.48, r * sy + r * 0.4, -r * 0.1); g.add(tip);
      }
    } else if (robot) {
      for (const s of [-1, 1]) {
        const bolt = mesh(new THREE.CylinderGeometry(r * 0.17, r * 0.17, r * 0.14, 20), M.accent);
        bolt.rotation.z = Math.PI / 2; bolt.position.set(s * r * sx * 0.98, 0, 0); g.add(bolt);
      }
      const stick = mesh(new THREE.CylinderGeometry(r * 0.03, r * 0.03, r * 0.55, 8), M.accent);
      stick.position.set(0, r * sy + r * 0.22, 0); g.add(stick);
      const ball = mesh(new THREE.SphereGeometry(r * 0.08, 14, 10), M.glow);
      ball.position.set(0, r * sy + r * 0.52, 0); g.add(ball);
    }
    if (crash) {
      for (const s of [-1, 1]) {
        const mk = new THREE.Mesh(new THREE.CircleGeometry(r * 0.3, 32), MAT.crashMark);
        mk.position.set(s * (r * sx * 1.002), r * 0.15, 0); mk.rotation.y = s * Math.PI / 2;
        mk.scale.set(1, sy, 1); g.add(mk);
      }
    }

    if (human) {
      const hatOn = P.hat && P.hat !== 'none';
      const hairP = hatOn && ['curly', 'bun', 'mohawk', 'spiky'].includes(P.hair) ? Object.assign({}, P, { hair: 'short' }) : P;
      addHair(g, hairP, M, r, sx, sy, sz);
      addHat(g, P, M, r, sx, sy, sz);
      addFacialHair(g, P, M, r, { rx: jrx, ry: jry, rz: jrz, cy: jcy, cz: jcz }, my, mw, lipT, zF, beardOff);
    }
    return refs;
  }

  function addHair(g, P, M, r, sx, sy, sz) {
    const st = P.hair, H = M.hair;
    if (st === 'bald') return;
    const cap = (k, th, tilt) => {
      const m = mesh(new THREE.SphereGeometry(r * k, 44, 24, 0, Math.PI * 2, 0, Math.PI * th), H);
      m.scale.set(sx, sy, sz); m.rotation.x = tilt; g.add(m); return m;
    };
    const add = (geo, x, y, z, s, rot) => {
      const m = mesh(geo, H); m.position.set(x, y, z);
      if (s) m.scale.set(s[0], s[1], s[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      g.add(m); return m;
    };
    const band = (k, t0, t1, gap) => add(new THREE.SphereGeometry(r * k, 44, 24, Math.PI / 2 + gap, Math.PI * 2 - gap * 2, Math.PI * t0, Math.PI * (t1 - t0)), 0, 0, 0, [sx, sy, sz]);
    const fringe = (w) => add(new THREE.SphereGeometry(r * 0.5, 24, 16), 0, r * 0.62 * sy, r * 0.52, [sx * w, 0.42, 0.9], [-0.5, 0, 0]);
    switch (st) {
      case 'buzz': cap(1.025, 0.46, -0.3); break;
      case 'short': cap(1.08, 0.47, -0.3); fringe(1.55); break;
      case 'bob': cap(1.1, 0.5, -0.3); band(1.13, 0.22, 0.64, 0.8); fringe(1.7); break;
      case 'long':
        cap(1.09, 0.5, -0.3); band(1.12, 0.22, 0.7, 0.75);
        add(capsuleGeo(r * 0.85, r * 0.62, r * 1.3), 0, -r * 1.05, -r * 0.5, [sx, 1, 0.45]); break;
      case 'curly': {
        cap(1.06, 0.5, -0.3);
        const rng = mulberry32(7), curl = new THREE.SphereGeometry(r * 0.2, 14, 10);
        let n = 0, guard = 0;
        while (n < 70 && guard++ < 2000) {
          const d = randDir(rng);
          if (d.y < -0.45) continue;
          if (d.y < -0.05 && d.z > -0.2) continue;
          if (d.z > 0.45 && d.y < 0.55) continue;
          const k = 1.08, s = 0.85 + rng() * 0.4;
          add(curl, d.x * r * k * sx, d.y * r * k * sy + r * 0.05, d.z * r * k * sz, [s, s, s]); n++;
        }
        break;
      }
      case 'ponytail':
        cap(1.07, 0.47, -0.3);
        add(new THREE.SphereGeometry(r * 0.16, 14, 10), 0, r * 0.3, -r * 1.02);
        add(capsuleGeo(r * 0.2, r * 0.09, r * 1.1), 0, -r * 0.5, -r * 1.22, [1, 1, 0.8], [0.25, 0, 0]); break;
      case 'bun':
        cap(1.07, 0.47, -0.3);
        add(new THREE.SphereGeometry(r * 0.42, 24, 16), 0, r * 0.92 * sy, -r * 0.42, [1, 0.85, 1]); break;
      case 'braids': {
        cap(1.07, 0.47, -0.3);
        const bead = new THREE.SphereGeometry(r * 0.13, 14, 10);
        for (const s of [-1, 1]) {
          for (let i = 0; i < 6; i++) add(bead, s * r * 0.8 * sx, -r * 0.1 - i * r * 0.23, -r * 0.32 - i * r * 0.04, [1, 1.12, 1]);
          const tie = mesh(new THREE.SphereGeometry(r * 0.07, 10, 8), M.tie);
          tie.position.set(s * r * 0.8 * sx, -r * 1.42, -r * 0.56); g.add(tie);
        }
        break;
      }
      case 'mohawk': {
        cap(1.015, 0.45, -0.3);
        const spike = new THREE.SphereGeometry(r * 0.24, 16, 12);
        for (let i = 0; i < 9; i++) {
          const ang = lerp(0.85, -1.7, i / 8);
          add(spike, 0, r * 1.0 * Math.cos(ang) * sy, r * 1.0 * Math.sin(ang) * sz, [0.3, 1.25, 0.75], [ang, 0, 0]);
        }
        break;
      }
      case 'spiky': {
        cap(1.06, 0.46, -0.3);
        const rng = mulberry32(13), cone = new THREE.ConeGeometry(r * 0.13, r * 0.45, 8), upV = new THREE.Vector3(0, 1, 0);
        let n = 0, guard = 0;
        while (n < 18 && guard++ < 2000) {
          const d = randDir(rng);
          if (d.y < 0.3 || (d.z > 0.6 && d.y < 0.7)) continue;
          const m = add(cone, d.x * r * 0.98 * sx, d.y * r * 0.98 * sy, d.z * r * 0.98 * sz);
          m.quaternion.setFromUnitVectors(upV, new THREE.Vector3(d.x, d.y, d.z)); n++;
        }
        break;
      }
      default: break;
    }
  }

  function addFacialHair(g, P, M, r, jaw, my, mw, lipT, zF, beardOff) {
    const f = P.facial;
    if (f === 'none') return;
    const shell = (k, t0, mat) => {
      const m = mesh(new THREE.SphereGeometry(1, 36, 20, 0.15, Math.PI - 0.3, Math.PI * t0, Math.PI * (1 - t0) * 0.92), mat);
      m.scale.set(jaw.rx * k, jaw.ry * k, jaw.rz * k); m.position.set(0, jaw.cy, jaw.cz); g.add(m); return m;
    };
    const mustache = () => {
      for (const s of [-1, 1]) {
        const x = s * mw * 0.26, y = my + lipT * 2.6 + r * 0.02;
        const m = mesh(capsuleGeo(r * 0.045, r * 0.03, mw * 0.42), M.hair);
        m.rotation.set(0, s * 0.3, s * (Math.PI / 2 - 0.25)); m.position.set(x, y, zF(x, y) + r * 0.025 + beardOff * 0.5); g.add(m);
      }
    };
    if (f === 'stubble') shell(1.02, 0.5, M.stubble);
    if (f === 'beard') {
      shell(1.08, 0.45, M.hair);
      const chin = mesh(new THREE.SphereGeometry(r * 0.3, 20, 14), M.hair);
      chin.scale.set(1.1, 1, 0.75); chin.position.set(0, jaw.cy - jaw.ry * 0.82, jaw.cz + jaw.rz * 0.55); g.add(chin);
      mustache();
    }
    if (f === 'mustache') mustache();
    if (f === 'goatee') {
      mustache();
      const y = my - r * 0.26, t = mesh(new THREE.SphereGeometry(r * 0.17, 18, 12), M.hair);
      t.scale.set(1, 1.35, 0.7); t.position.set(0, y, zF(0, y) - r * 0.05); g.add(t);
    }
  }

  /* ------------------------------------------------------------------
     12. Ragdoll dummy
     ------------------------------------------------------------------ */
  function pdForce(b, tx, ty, tz, comp, gain, horiz) {
    const m = b.mass, kp = 140, kd = 22;
    let fx = ((tx - b.position.x) * kp - b.velocity.x * kd) * m * horiz;
    let fy = ((ty - b.position.y) * kp - b.velocity.y * kd) * m;
    let fz = ((tz - b.position.z) * kp - b.velocity.z * kd) * m * horiz;
    const lim = m * 90, l = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (l > lim) { const s = lim / l; fx *= s; fy *= s; fz *= s; }
    b.force.x += fx * gain; b.force.y += (fy + comp) * gain; b.force.z += fz * gain;
  }
  function uprightTorque(b, gain) {
    const up = b.quaternion.vmult(UP), ax = up.cross(UP);
    if (up.y < 0 && ax.norm() < 0.25) ax.set(1, 0, 0);
    const I = (b.inertia.x + b.inertia.y + b.inertia.z) / 3, kp = 160, kd = 22;
    b.torque.x += (ax.x * kp - b.angularVelocity.x * kd) * I * gain;
    b.torque.y += (ax.y * kp - b.angularVelocity.y * kd) * I * gain;
    b.torque.z += (ax.z * kp - b.angularVelocity.z * kd) * I * gain;
  }

  /* Draw-call reducer: bake every static mesh in a part into one mesh per material. */
  function mergeGroup(group) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const buckets = new Map(), drop = [];
    group.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material) || !o.visible) return;
      for (let p = o; p && p !== group; p = p.parent) if (p.userData.keep) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      if (m.determinant() <= 0) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(m);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(g);
      drop.push(o);
    });
    drop.forEach((o) => { o.parent.remove(o); if (!o.geometry.userData.shared) o.geometry.dispose(); });
    buckets.forEach((geos, mat) => {
      let n = 0; geos.forEach((g) => { n += g.attributes.position.count; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let off = 0;
      geos.forEach((g) => {
        pos.set(g.attributes.position.array, off * 3);
        nor.set(g.attributes.normal.array, off * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
        off += g.attributes.position.count; g.dispose();
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.computeBoundingSphere();
      const mesh = new THREE.Mesh(out, mat);
      mesh.castShadow = !mat.transparent; mesh.receiveShadow = true;
      group.add(mesh);
    });
  }

  /* ------------------------------------------------------------------
     Realistic 3D models: rigged humanoid .glb files driven by the ragdoll
     ------------------------------------------------------------------ */
  const ModelStore = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        try {
          const r = indexedDB.open('wmg-models', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('models');
          r.onsuccess = () => { this.db = r.result; res(this.db); };
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
    },
    async put(id, buf) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('models', 'readwrite'); tx.objectStore('models').put(buf, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
    async get(id) { const db = await this.open(); return new Promise((res, rej) => { const rq = db.transaction('models', 'readonly').objectStore('models').get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); }); },
  };
  const modelMem = new Map();
  async function getModelBuffer(id) {
    if (modelMem.has(id)) return modelMem.get(id);
    try { const b = await ModelStore.get(id); if (b) modelMem.set(id, b); return b; } catch (e) { return null; }
  }
  function parseGLB(buf) {
    return new Promise((res, rej) => {
      if (!THREE.GLTFLoader) { rej(new Error('The model loader didn’t load. Check your connection.')); return; }
      new THREE.GLTFLoader().parse(buf.slice(0), '', res, rej);
    });
  }
  const normBone = (n) => String(n).toLowerCase().replace(/mixamorig\d*/g, '').replace(/^(bip0*1|ccbase|armature)/, '').replace(/[^a-z0-9]/g, '').replace(/^(bip0*1|ccbase)/, '');
  function sideNames(S, x) {
    return {
      ua: [`${S}arm`, `${S}upperarm`, `upperarm${x}`, `${x}upperarm`, `arm${x}`],
      la: [`${S}forearm`, `${S}lowerarm`, `lowerarm${x}`, `forearm${x}`, `${x}forearm`],
      hand: [`${S}hand`, `hand${x}`, `${x}hand`],
      ul: [`${S}upleg`, `${S}upperleg`, `${S}thigh`, `thigh${x}`, `upperleg${x}`, `${x}thigh`],
      ll: [`${S}leg`, `${S}lowerleg`, `${S}calf`, `${S}shin`, `calf${x}`, `lowerleg${x}`, `shin${x}`, `${x}calf`],
      foot: [`${S}foot`, `foot${x}`, `${x}foot`],
      toe: [`${S}toebase`, `${S}toes`, `${S}toe`, `toe${x}`, `toes${x}`, `${x}toe`],
    };
  }
  function disposeModelTree(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((k) => { if (m[k]) m[k].dispose(); });
        m.dispose();
      });
    });
  }
  const _dq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _dv = new THREE.Vector3(), _bq = new THREE.Quaternion();

  let dummyIdSeq = 0;
  class Dummy {
    constructor(params, base, bit) {
      this.id = ++dummyIdSeq;
      this.bit = bit;
      this.params = normalizeParams(params);
      this.spawn = { x: base.x, y: 0.01, z: base.z };
      this.root = new THREE.Group(); scene.add(this.root);
      this.stun = 0; this.gain = 1; this.ouch = 0; this.grabbed = false;
      this.lastImpact = 0; this.lastComic = 0; this.blinkT = rand(1, 4); this.blink = 0;
      this.onCollide = (e) => this.handleCollide(e);
      this.label = document.createElement('div'); this.label.className = 'tag'; labelsLayer.appendChild(this.label);
      this.stars = new THREE.Group();
      for (let i = 0; i < 3; i++) { const sp = new THREE.Sprite(MAT.star); sp.scale.setScalar(0.09); this.stars.add(sp); }
      this.stars.visible = false; this.root.add(this.stars);
      this.parts = {}; this.constraints = [];
      this.build(this.spawn);
      this.syncModel();
    }
    addPart(name, shapes, mass, pos, group, base) {
      const b = new CANNON.Body({ mass, allowSleep: false, linearDamping: 0.04, angularDamping: 0.5, collisionFilterGroup: this.bit, collisionFilterMask: ALL & ~this.bit });
      shapes.forEach(([sh, off]) => b.addShape(sh, off ? new CANNON.Vec3(off[0], off[1], off[2]) : undefined));
      mergeGroup(group);
      b.position.set(base.x + pos[0], base.y + pos[1], base.z + pos[2]);
      b.userData = { kind: 'dummy', dummy: this, part: name };
      b.addEventListener('collide', this.onCollide);
      world.addBody(b);
      group.userData.body = b; group.userData.dummy = this;
      group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.root.add(group);
      this.parts[name] = { body: b, mesh: group, local: pos.slice() };
    }
    build(base) {
      const P = this.params, M = (this.mats = makeMats(P));
      const fem = P.body === 'female', robot = P.type === 'robot', crash = P.type === 'crash';
      const S = (0.88 + 0.24 * P.height) * (fem ? 0.95 : 1);
      const W = 0.8 + 0.42 * P.build;
      const sh = fem ? 0.87 : 1, hp = fem ? 1.08 : 1;
      const hy = { ll: 0.215 * S, ul: 0.225 * S, pel: 0.095 * S, ch: 0.215 * S, ua: 0.15 * S, la: 0.14 * S };
      const hr = headRadius(P), footH = 0.05, neckGap = 0.05 * S;
      const y = {};
      y.ll = footH + hy.ll; y.ul = y.ll + hy.ll + hy.ul; y.pel = y.ul + hy.ul + hy.pel; y.ch = y.pel + hy.pel + hy.ch;
      y.head = y.ch + hy.ch + neckGap + hr;
      const shoulderY = y.ch + hy.ch * 0.8;
      y.ua = shoulderY - hy.ua; y.la = y.ua - hy.ua - hy.la;
      const cx = 0.175 * sh * W, cz = 0.1 * W, px = 0.15 * hp * W, pz = 0.098 * W;
      const legR = 0.068 * W * (fem ? 1.03 : 1), armR = 0.045 * W * (fem ? 0.88 : 1);
      const legX = 0.088 * hp * W, armX = cx + armR * 0.75;
      this.dims = { hy, y, hr, S, W };
      this.standPelvisY = y.pel; this.dyPC = y.ch - y.pel; this.dyCH = y.head - y.ch;
      const k = S * W;
      const chain = (r, h, extraBottom) => {
        const top = h - r, bot = -(h - r) - (extraBottom || 0), span = Math.max(0, top - bot);
        const n = Math.max(2, Math.ceil(span / (r * 1.3)) + 1), out = [];
        for (let i = 0; i < n; i++) out.push([new CANNON.Sphere(r), [0, lerp(top, bot, i / (n - 1)), 0]]);
        return out;
      };
      const outfit = robot || crash ? 'none' : P.outfit;
      const bottom = bottomOf(P);
      const longSleeve = ['hoodie', 'suit', 'jacket', 'tracksuit', 'none'].includes(outfit);
      const shortSleeve = ['tee', 'camp', 'uniform'].includes(outfit);
      const bareLegs = bottom === 'skirt' || bottom === 'dress';
      const legMat = bareLegs ? M.skin : M.pants;
      const shoeKind = robot || crash ? 'boot' : bareLegs ? 'heel' : bottom === 'trousers' ? 'dress' : 'sneaker';
      const handMat = robot ? M.shoes : M.skin;
      const add = (grp, geo, mat, pos, scl, rot) => { const m = mesh(geo, mat); if (pos) m.position.set(pos[0], pos[1], pos[2]); if (scl) m.scale.set(scl[0], scl[1], scl[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); grp.add(m); return m; };

      // Head
      const H = buildHead(P, M); this.headRefs = H;
      this.addPart('head', [[new CANNON.Sphere(hr * 1.05)]], 5 * k, [0, y.head, 0], H.group, base);

      // Chest: sculpted torso (waist -> ribcage -> shoulders -> neck)
      const chestG = new THREE.Group();
      const torsoPts = fem
        ? [[0, -1.06], [0.8, -1.04], [0.79, -0.75], [0.84, -0.4], [0.94, -0.02], [0.98, 0.3], [0.96, 0.56], [0.9, 0.78], [0.62, 0.95], [0.34, 1.02], [0, 1.05]]
        : [[0, -1.06], [0.84, -1.04], [0.84, -0.75], [0.89, -0.4], [0.97, -0.02], [1.0, 0.3], [1.0, 0.56], [0.93, 0.8], [0.62, 0.96], [0.33, 1.03], [0, 1.06]];
      add(chestG, profileLathe(torsoPts, cx, hy.ch, 32), M.shirt, null, [1, 1, cz / cx]);
      const sleeveTopMat = outfit === 'tank' || outfit === 'dress' ? M.skin : M.shirt;
      for (const s of [-1, 1]) add(chestG, new THREE.SphereGeometry(armR * 1.35, 20, 14), sleeveTopMat, [s * (armX - armR * 0.35), shoulderY - y.ch, 0], [1, 0.85, 1.05]);
      const collarRib = () => add(chestG, new THREE.TorusGeometry(hr * 0.42, 0.011, 8, 26), M.shirt, [0, hy.ch * 1.0, 0], [1, 0.82, 1], [Math.PI / 2, 0, 0]);
      const collarFlaps = (mat) => { for (const s of [-1, 1]) add(chestG, new THREE.ConeGeometry(0.038 * W, 0.075, 3), mat, [s * 0.042 * W, hy.ch * 0.94, cz * 0.62], [1, 1, 0.22], [-0.9, 0, s * 2.2]); };
      if (outfit === 'tee' || outfit === 'tank' || outfit === 'tracksuit') collarRib();
      if (outfit === 'camp' || outfit === 'uniform') collarFlaps(M.shirt);
      if (outfit === 'uniform') for (const s of [-1, 1]) add(chestG, new THREE.BoxGeometry(0.075, 0.012, 0.045), M.shirt, [s * (cx * 0.78), shoulderY - y.ch + armR * 0.95, 0], [1, 1, 1], [0, 0, s * -0.25]);
      if (outfit === 'hoodie') {
        add(chestG, new THREE.TorusGeometry(hr * 0.72, hr * 0.28, 12, 26), M.shirt, [0, hy.ch * 0.96, -cz * 0.32], [1, 0.85, 1], [Math.PI / 2 - 0.35, 0, 0]);
        add(chestG, new THREE.BoxGeometry(cx * 1.1, hy.ch * 0.34, 0.025), M.shirt, [0, -hy.ch * 0.52, cz * 0.86]);
        for (const s of [-1, 1]) add(chestG, new THREE.CylinderGeometry(0.005, 0.005, hy.ch * 0.45, 6), M.trim, [s * 0.03, hy.ch * 0.52, cz * 0.94]);
      }
      if (outfit === 'suit' || outfit === 'jacket') {
        add(chestG, new THREE.ConeGeometry(cx * 0.3, hy.ch * 0.92, 3), M.trim, [0, hy.ch * 0.5, cz * 0.84], [1, 1, 0.16], [0, 0, Math.PI]);
        for (const s of [-1, 1]) add(chestG, new THREE.BoxGeometry(0.034 * W, hy.ch * 0.78, 0.012), M.shirt, [s * cx * 0.26, hy.ch * 0.44, cz * 0.93], [1, 1, 1], [0.12, 0, s * 0.32]);
        if (outfit === 'suit') {
          add(chestG, new THREE.BoxGeometry(0.034 * W, hy.ch * 0.74, 0.012), M.tie, [0, hy.ch * 0.3, cz * 0.95]);
          add(chestG, new THREE.BoxGeometry(0.044 * W, 0.034, 0.018), M.tie, [0, hy.ch * 0.84, cz * 0.88]);
        }
      }
      if (robot) {
        add(chestG, new THREE.BoxGeometry(cx * 1.2, hy.ch * 0.9, 0.04), M.skin, [0, hy.ch * 0.15, cz * 0.92]);
        add(chestG, new THREE.CylinderGeometry(0.045, 0.045, 0.03, 24), M.glow, [0, hy.ch * 0.2, cz * 0.92 + 0.03], null, [Math.PI / 2, 0, 0]);
      }
      if (crash) for (const s of [-1, 1]) { const mk = new THREE.Mesh(new THREE.CircleGeometry(0.05, 28), MAT.crashMark); mk.position.set(s * cx * 0.45, hy.ch * 0.42, cz * 0.97); chestG.add(mk); }
      this.addPart('chest', [[new CANNON.Box(new CANNON.Vec3(cx * 0.95, hy.ch, cz))]], 22 * k, [0, y.ch, 0], chestG, base);

      // Pelvis: hips, plus shirt hem / skirt / belt
      const pelG = new THREE.Group();
      const hipPts = [[0, -1.02], [0.55, -0.98], [0.9, -0.62], [1.0, -0.15], [0.97, 0.4], [0.9, 1.0], [0, 1.04]];
      add(pelG, profileLathe(hipPts, px, hy.pel, 28), bareLegs ? (bottom === 'dress' ? M.shirt : M.pants) : M.pants, null, [1, 1, pz / px]);
      const flare = (mat, topY, botY, rTop, rBot) => add(pelG, profileLathe([[rBot * 0.98, botY], [rBot, botY + 0.004], [rTop, topY], [0, topY + 0.01]], 1, 1, 36), mat, null, [1, 1, (pz / px) * 1.08]);
      if (bottom === 'skirt') flare(M.pants, hy.pel * 0.95, -hy.pel - hy.ul * 0.95, px * 1.03, px * 1.42);
      if (bottom === 'dress') flare(M.shirt, hy.pel * 0.95, -hy.pel - hy.ul * 1.05, px * 1.03, px * 1.5);
      if (outfit === 'camp') flare(M.shirt, hy.pel * 1.1, -hy.pel * 0.35, px * 1.04, px * 1.1);
      if (outfit === 'jacket' || outfit === 'suit') flare(M.shirt, hy.pel * 1.1, -hy.pel * 0.75, px * 1.05, px * 1.12);
      if (['jeans', 'trousers'].includes(bottom) && outfit !== 'camp' && outfit !== 'suit' && outfit !== 'jacket') {
        add(pelG, new THREE.TorusGeometry(px * 0.99, 0.014, 8, 36), M.accent, [0, hy.pel * 0.72, 0], [1, (pz / px) * 1.03, 1], [Math.PI / 2, 0, 0]);
        add(pelG, new THREE.BoxGeometry(0.04, 0.03, 0.01), M.gold, [0, hy.pel * 0.72, pz * 1.02]);
      }
      if (bottom === 'dress') add(pelG, new THREE.TorusGeometry(px * 1.02, 0.016, 8, 36), M.accent, [0, hy.pel * 0.82, 0], [1, (pz / px) * 1.05, 1], [Math.PI / 2, 0, 0]);
      this.addPart('pelvis', [[new CANNON.Box(new CANNON.Vec3(px, hy.pel, pz))]], 12 * k, [0, y.pel, 0], pelG, base);

      for (const s of [-1, 1]) {
        const sd = s < 0 ? 'L' : 'R';
        // Upper arm (deltoid -> biceps -> elbow), with short or long sleeve
        const ua = new THREE.Group();
        const uaR = [0.98, 1.06, 1.0, 0.88, 0.78].map((v) => v * armR);
        add(ua, limbLathe(hy.ua, uaR), longSleeve ? M.shirt : M.skin);
        if (shortSleeve) add(ua, profileLathe([[1.16, -0.32], [1.2, -0.3], [1.26, 0.9], [1.0, 1.05], [0, 1.08]], armR, hy.ua, 22), M.shirt);
        this.addPart('ua' + sd, chain(armR, hy.ua), 3 * k, [s * armX, y.ua, 0], ua, base);

        // Forearm + hand with fingers
        const la = new THREE.Group();
        const laR = [0.8, 0.9, 0.82, 0.66, 0.56].map((v) => v * armR);
        add(la, limbLathe(hy.la, laR), longSleeve ? M.shirt : M.skin);
        add(la, new THREE.SphereGeometry(armR * 0.8, 14, 10), longSleeve ? M.shirt : M.skin, [0, hy.la, 0]);
        if (outfit === 'suit' || outfit === 'jacket') add(la, new THREE.CylinderGeometry(armR * 0.62, armR * 0.62, 0.022, 18), M.trim, [0, -hy.la + 0.006, 0]);
        if (longSleeve && !robot && !crash) add(la, new THREE.CylinderGeometry(armR * 0.5, armR * 0.5, 0.03, 14), M.skin, [0, -hy.la - 0.01, 0]);
        const hy0 = -hy.la - armR * 0.62;
        add(la, new THREE.SphereGeometry(armR * 0.78, 16, 12), handMat, [0, hy0, 0], [0.62, 1.05, 1.0]);
        const fingerG = capsuleGeo(armR * 0.15, armR * 0.13, armR * 0.7, 8, 4);
        for (let f = 0; f < 4; f++) add(la, fingerG, handMat, [0, hy0 - armR * 0.95, (f - 1.5) * armR * 0.32], [1, 1 - Math.abs(f - 1.5) * 0.1, 1], [0, 0, s * 0.25]);
        add(la, capsuleGeo(armR * 0.17, armR * 0.15, armR * 0.55, 8, 4), handMat, [s * -armR * 0.1, hy0 - armR * 0.2, armR * 0.55], null, [0.7, 0, 0]);
        this.addPart('la' + sd, chain(armR * 0.85, hy.la, armR * 1.0), 2 * k, [s * armX, y.la, 0], la, base);

        // Thigh + knee
        const ul = new THREE.Group();
        const ulR = [1.06, 1.02, 0.93, 0.82, 0.7].map((v) => v * legR);
        add(ul, limbLathe(hy.ul, ulR), legMat);
        add(ul, new THREE.SphereGeometry(legR * 0.72, 16, 12), legMat, [0, -hy.ul, 0.004]);
        this.addPart('ul' + sd, chain(legR * 0.9, hy.ul), 8 * k, [s * legX, y.ul, 0], ul, base);

        // Calf + shoe
        const ll = new THREE.Group();
        const llR = [0.68, 0.76, 0.74, 0.6, 0.48, 0.44].map((v) => v * legR);
        add(ll, limbLathe(hy.ll, llR), legMat);
        const fz = 0.045 * S, fy = -hy.ll - 0.012;
        if (shoeKind === 'heel') {
          add(ll, capsuleGeo(0.032, 0.03, 0.12 * S, 12, 5), M.shoes, [0, fy + 0.012, fz + 0.01], [1, 1, 0.6], [Math.PI / 2 + 0.28, 0, 0]);
          add(ll, new THREE.CylinderGeometry(0.009, 0.006, 0.055, 8), M.shoes, [0, fy - 0.01, fz - 0.06]);
        } else {
          add(ll, capsuleGeo(0.046 * W, 0.042 * W, 0.13 * S, 16, 6), M.shoes, [0, fy + 0.006, fz], [1.0, 1, 0.68], [Math.PI / 2, 0, 0]);
          if (shoeKind === 'sneaker') add(ll, capsuleGeo(0.05 * W, 0.046 * W, 0.135 * S, 16, 6), M.sole, [0, fy - 0.022, fz], [1.04, 1, 0.24], [Math.PI / 2, 0, 0]);
          if (shoeKind === 'dress') add(ll, capsuleGeo(0.048 * W, 0.044 * W, 0.135 * S, 16, 6), M.accent, [0, fy - 0.024, fz], [1.03, 1, 0.16], [Math.PI / 2, 0, 0]);
        }
        this.addPart('ll' + sd, chain(legR * 0.66, hy.ll).concat([
          [new CANNON.Sphere(0.05), [0, -hy.ll, 0.07 * S]],
        ]), 5 * k, [s * legX, y.ll, 0], ll, base);
      }

      // Joints
      const PT = this.parts;
      const J = (a, b, pa, pb, angle, twist) => {
        const c = new CANNON.ConeTwistConstraint(PT[a].body, PT[b].body, {
          pivotA: new CANNON.Vec3(pa[0], pa[1], pa[2]), pivotB: new CANNON.Vec3(pb[0], pb[1], pb[2]),
          axisA: CANNON.Vec3.UNIT_Y, axisB: CANNON.Vec3.UNIT_Y, angle, twistAngle: twist,
        });
        world.addConstraint(c); this.constraints.push(c);
      };
      J('chest', 'head', [0, hy.ch + neckGap * 0.5, 0], [0, -hr - neckGap * 0.5, 0], Math.PI / 5, Math.PI / 5);
      J('pelvis', 'chest', [0, hy.pel, 0], [0, -hy.ch, 0], Math.PI / 7, Math.PI / 8);
      for (const s of [-1, 1]) {
        const sd = s < 0 ? 'L' : 'R';
        J('pelvis', 'ul' + sd, [s * legX, -hy.pel, 0], [0, hy.ul, 0], Math.PI / 3, Math.PI / 8);
        J('ul' + sd, 'll' + sd, [0, -hy.ul, 0], [0, hy.ll, 0], Math.PI / 4, 0.05);
        J('chest', 'ua' + sd, [s * armX, shoulderY - y.ch, 0], [0, hy.ua, 0], Math.PI / 2.2, Math.PI / 3);
        J('ua' + sd, 'la' + sd, [0, -hy.ua, 0], [0, hy.la, 0], Math.PI / 3.5, 0.05);
      }
      const m = (n) => PT[n].body.mass;
      this.compPel = m('pelvis') + 0.5 * (m('ulL') + m('ulR') + m('llL') + m('llR'));
      this.compCh = m('chest') + m('uaL') + m('uaR') + m('laL') + m('laR');
      this.compHead = m('head');
      this.label.textContent = P.name;
      this.sync();
    }
    disposeBody() {
      this.constraints.forEach((c) => world.removeConstraint(c));
      this.constraints = [];
      Object.values(this.parts).forEach((p) => {
        p.body.removeEventListener('collide', this.onCollide);
        removeBody(p.body); this.root.remove(p.mesh); disposeObj(p.mesh);
      });
      this.parts = {};
      if (this.mats) disposeMatsAndTex(this.mats);
    }
    rebuild(params) {
      if (grab && grab.dummy === this) releaseGrab();
      this.params = normalizeParams(params);
      this.rig = null;
      this.disposeBody();
      this.build(this.spawn);
      this.stun = 0; this.gain = 1;
      this.syncModel();
    }
    destroy() {
      if (grab && grab.dummy === this) releaseGrab();
      this.dead = true; this.removeModel();
      this.disposeBody(); scene.remove(this.root); this.label.remove();
    }
    setProceduralVisible(v) { Object.values(this.parts).forEach((p) => { p.mesh.visible = v; }); }
    removeModel() {
      this.modelToken = (this.modelToken || 0) + 1;
      if (this.model) { scene.remove(this.model.root); disposeModelTree(this.model.root); }
      this.model = null; this.rig = null;
    }
    syncModel() {
      const id = this.params.modelId || null;
      if (this.model && this.model.id !== id) this.removeModel();
      if (!id) { this.setProceduralVisible(true); return; }
      if (this.model) { if (!this.calibrateModel()) { this.removeModel(); this.setProceduralVisible(true); } return; }
      const token = this.modelToken = (this.modelToken || 0) + 1;
      getModelBuffer(id)
        .then((buf) => { if (!buf) throw new Error('missing'); return parseGLB(buf); })
        .then((gltf) => {
          if (token !== this.modelToken || this.dead || this.params.modelId !== id) { disposeModelTree(gltf.scene); return; }
          const root = new THREE.Group(); root.add(gltf.scene); scene.add(root);
          const bones = [];
          gltf.scene.traverse((o) => {
            if (o.isBone) bones.push(o);
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
          });
          this.model = { id, root, scene: gltf.scene, bones, rest: bones.map((b) => [b, b.position.clone(), b.quaternion.clone()]) };
          if (!this.calibrateModel()) {
            toast('That model has no humanoid skeleton the ragdoll can drive.');
            this.removeModel(); this.setProceduralVisible(true);
          }
        })
        .catch((err) => {
          if (token !== this.modelToken) return;
          console.warn('Model load failed', err);
          toast(err && err.message === 'missing' ? 'This character’s 3D model isn’t saved on this device. Upload it again in the Creator.' : 'Couldn’t load that 3D model. Use a rigged humanoid .glb file.');
          this.setProceduralVisible(true);
        });
    }
    calibrateModel() {
      const Mo = this.model;
      Mo.rest.forEach(([b, pos, q]) => { b.position.copy(pos); b.quaternion.copy(q); });
      const root = Mo.root;
      root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1); root.updateMatrixWorld(true);
      const map = new Map();
      Mo.bones.forEach((b) => { const n = normBone(b.name); if (!map.has(n)) map.set(n, b); });
      const find = (list) => { for (const n of list) if (map.has(n)) return map.get(n); return null; };
      const side = (S, x) => { const N = sideNames(S, x), o = {}; Object.keys(N).forEach((k) => { o[k] = find(N[k]); }); return o; };
      const hips = find(['hips', 'pelvis']), chest = find(['spine2', 'upperchest', 'chest', 'spine1', 'spine']), head = find(['head']);
      const A = side('left', 'l'), B = side('right', 'r');
      if (!hips || !head || !A.ua || !B.ua || !A.la || !B.la || !A.ul || !B.ul || !A.ll || !B.ll) return false;
      const wp = (o) => o.getWorldPosition(new THREE.Vector3());
      if (A.foot && A.toe && wp(A.toe).z - wp(A.foot).z < 0) { root.rotation.y = Math.PI; root.updateMatrixWorld(true); }
      const box = new THREE.Box3().setFromObject(Mo.scene);
      const h = box.max.y - box.min.y;
      if (!(h > 1e-6)) return false;
      root.scale.setScalar((this.dims.y.head + this.dims.hr * 1.1) / h); root.updateMatrixWorld(true);
      box.setFromObject(Mo.scene);
      const c = box.getCenter(new THREE.Vector3());
      root.position.set(this.spawn.x - c.x, this.spawn.y - box.min.y, this.spawn.z - c.z); root.updateMatrixWorld(true);
      const down = new THREE.Vector3(0, -1, 0);
      const alignDown = (bone, child) => {
        if (!bone || !child) return;
        root.updateMatrixWorld(true);
        const v = wp(child).sub(wp(bone));
        if (v.lengthSq() < 1e-10) return;
        const q = new THREE.Quaternion().setFromUnitVectors(v.normalize(), down);
        const target = q.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
        bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(target));
        bone.updateMatrixWorld(true);
      };
      [A, B].forEach((S) => { alignDown(S.ua, S.la); alignDown(S.la, S.hand); alignDown(S.ul, S.ll); alignDown(S.ll, S.foot); });
      root.updateMatrixWorld(true);
      const aIsL = wp(A.ua).x < this.spawn.x, Lb = aIsL ? A : B, Rb = aIsL ? B : A;
      const restQ = (b) => b.getWorldQuaternion(new THREE.Quaternion());
      const drive = [['pelvis', hips], ['chest', chest], ['head', head], ['uaL', Lb.ua], ['laL', Lb.la], ['ulL', Lb.ul], ['llL', Lb.ll], ['uaR', Rb.ua], ['laR', Rb.la], ['ulR', Rb.ul], ['llR', Rb.ll]]
        .filter(([, b]) => b).map(([part, b]) => [part, b, restQ(b)]);
      const pl = this.parts.pelvis.local;
      const hipOff = wp(hips).sub(new THREE.Vector3(this.spawn.x + pl[0], this.spawn.y + pl[1], this.spawn.z + pl[2]));
      this.rig = { hips, hipOff, drive };
      this.setProceduralVisible(false);
      this.driveModel();
      return true;
    }
    driveModel() {
      const R = this.rig, pb = this.parts.pelvis.body;
      _bq.set(pb.quaternion.x, pb.quaternion.y, pb.quaternion.z, pb.quaternion.w);
      _dv.copy(R.hipOff).applyQuaternion(_bq).add(pb.position);
      R.hips.parent.updateWorldMatrix(true, false);
      R.hips.position.copy(R.hips.parent.worldToLocal(_dv));
      for (const [part, bone, off] of R.drive) {
        const b = this.parts[part].body;
        _dq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).multiply(off);
        bone.parent.getWorldQuaternion(_pq);
        bone.quaternion.copy(_pq.invert().multiply(_dq));
        bone.updateMatrixWorld(false);
      }
    }
    reset() {
      const b = this.spawn;
      Object.values(this.parts).forEach((p) => {
        p.body.position.set(b.x + p.local[0], b.y + p.local[1], b.z + p.local[2]);
        p.body.quaternion.set(0, 0, 0, 1);
        p.body.velocity.setZero(); p.body.angularVelocity.setZero();
        p.body.force.setZero(); p.body.torque.setZero();
      });
      this.stun = 0; this.gain = 1; this.ouch = 0;
      this.sync();
    }
    setName(n) { this.params.name = String(n).slice(0, 24) || 'MyGuyVR'; this.label.textContent = this.params.name; }
    headPos() { return this.parts.head.body.position; }
    stand() {
      if (this.gain <= 0.001) return;
      const gk = this.gain, g = -world.gravity.y;
      const pel = this.parts.pelvis.body, ch = this.parts.chest.body, hd = this.parts.head.body;
      pdForce(pel, pel.position.x, this.spawn.y + this.standPelvisY, pel.position.z, this.compPel * g, gk, 0.15);
      pdForce(ch, pel.position.x, pel.position.y + this.dyPC, pel.position.z, this.compCh * g, gk, 1);
      pdForce(hd, ch.position.x, ch.position.y + this.dyCH, ch.position.z, this.compHead * g, gk * 0.7, 1);
      uprightTorque(pel, gk); uprightTorque(ch, gk);
    }
    hit(power) {
      this.stun = Math.max(this.stun, clamp(0.8 + power * 0.35, 0.8, 4));
      this.ouch = 0.7;
      addScore(power * 10);
    }
    handleCollide(e) {
      const other = e.body;
      if (other && other.userData && other.userData.dummy === this) return;
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v < 2.2) return;
      const now = state.simTime;
      if (now - this.lastImpact < 0.06) return;
      this.lastImpact = now;
      Sound.thump(v);
      addScore(v * 2);
      if (v > 4.5) { this.stun = Math.max(this.stun, clamp(v * 0.22, 0.6, 3.5)); this.ouch = 0.6; }
      const p = e.target.position;
      if (v > 6) sparks(p, 6, [1, 0.92, 0.6], 3, 0.05, 0.4);
      if (v > 8.5 && now - this.lastComic > 0.5) { this.lastComic = now; comic(pick(['POW!', 'BONK!', 'WHAM!', 'OOF!', 'THUD!']), p); }
    }
    update(simDt, realDt) {
      if (this.grabbed) this.stun = Math.max(this.stun, 0.8);
      this.stun = Math.max(0, this.stun - simDt);
      this.ouch = Math.max(0, this.ouch - simDt);
      const want = settings.getUp && this.stun <= 0;
      this.gain = want ? Math.min(1, this.gain + simDt / 1.3) : 0;
      this.blinkT -= realDt;
      if (this.blinkT < 0) { this.blink = 0.13; this.blinkT = rand(2, 5.5); }
      this.blink = Math.max(0, this.blink - realDt);
      const ko = this.stun > 0.3 && !this.grabbed;
      const H = this.headRefs;
      H.eyes.forEach((e) => {
        const target = ko ? 1.45 : this.blink > 0 ? 1.3 : e.open;
        e.lid.rotation.x += (target - e.lid.rotation.x) * Math.min(1, realDt * 25);
      });
      const scared = this.ouch > 0 || this.grabbed || ko;
      if (H.mouthO) { H.mouthO.visible = scared; H.mouthSmile.visible = !scared; }
      if (H.visor) H.visor.material.emissive.setHex(scared ? 0xff3355 : 0x22e3ff);
      const show = ko && this.gain === 0;
      this.stars.visible = show;
      if (show) {
        const hp = this.headPos(), t = performance.now() * 0.004;
        this.stars.children.forEach((sp, i) => {
          const a = t + i * 2.094;
          sp.position.set(hp.x + Math.cos(a) * 0.2, hp.y + this.dims.hr + 0.1 + Math.sin(t * 2 + i) * 0.02, hp.z + Math.sin(a) * 0.2);
        });
      }
    }
    sync() {
      Object.values(this.parts).forEach((p) => { p.mesh.position.copy(p.body.position); p.mesh.quaternion.copy(p.body.quaternion); });
      if (this.rig) this.driveModel();
    }
  }

  /* ------------------------------------------------------------------
     13. Scene state containers
     ------------------------------------------------------------------ */
  const dummies = [];
  const props = [];
  const projectiles = [];
  const wells = [];
  const fxObjs = [];
  const scorches = [];
  const pending = [];
  const env = { objs: [], bodies: [], mats: [], bg: null };
  let grab = null;
  const focusedDummy = () => dummies[clamp(state.focus, 0, dummies.length - 1)];

  /* ------------------------------------------------------------------
     14. Environments
     ------------------------------------------------------------------ */
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.env = true;
  scene.add(ground);

  function envAdd(o) { scene.add(o); env.objs.push(o); return o; }
  function envBox(w, h, d, x, y, z, mat, rot, physics) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.max(w, d) / 4), uv.getY(i) * Math.max(1, h / 4));
    const m = mesh(geo, mat); m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.userData.env = true; envAdd(m);
    if (physics !== false) {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), position: new CANNON.Vec3(x, y, z), collisionFilterGroup: G_ENV, collisionFilterMask: ALL });
      b.quaternion.set(m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w);
      b.userData = { kind: 'env' }; world.addBody(b); env.bodies.push(b);
    }
    return m;
  }
  function envRock(x, z, s, mat) {
    const geo = new THREE.IcosahedronGeometry(s, 1), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const h = Math.sin(vx * 12.9898 + vy * 78.233 + vz * 37.719 + x) * 43758.5453, k = 0.8 + (h - Math.floor(h)) * 0.4;
      p.setXYZ(i, vx * k, vy * k * 0.75, vz * k);
    }
    geo.computeVertexNormals();
    const m = mesh(geo, mat); m.position.set(x, s * 0.3, z); m.rotation.y = x * 3.1; m.userData.env = true; envAdd(m);
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(s * 0.8), position: new CANNON.Vec3(x, s * 0.2, z), collisionFilterGroup: G_ENV, collisionFilterMask: ALL });
    b.userData = { kind: 'env' }; world.addBody(b); env.bodies.push(b);
  }
  function setSky(top, bottom) { if (env.bg) env.bg.dispose(); env.bg = skyTex(top, bottom); scene.background = env.bg; }
  function setLights(h, sn, exposure) {
    hemi.color.set(h[0]); hemi.groundColor.set(h[1]); hemi.intensity = h[2];
    sun.color.set(sn[0]); sun.intensity = sn[1]; sun.position.set(sn[2][0], sn[2][1], sn[2][2]);
    renderer.toneMappingExposure = exposure;
  }
  function accent(i, color, intensity, pos) { const l = accents[i]; l.color.set(color); l.intensity = intensity; l.position.set(pos[0], pos[1], pos[2]); }
  function setGround(tex, o) {
    groundMat.map = tex; groundMat.bumpMap = o.bump ? tex : null; groundMat.bumpScale = o.bump || 0;
    groundMat.roughness = o.rough; groundMat.metalness = o.metal || 0;
    groundMat.emissiveMap = o.emissiveMap || null; groundMat.emissive.set(o.emissive || 0x000000); groundMat.emissiveIntensity = o.emissiveIntensity || 1;
    groundMat.needsUpdate = true;
  }
  function standardProps(dx) {
    dx = dx || 0;
    spawnProp('crate', { x: -3.9 + dx, y: 0.31, z: -3 }, { env: true });
    spawnProp('crate', { x: -3.25 + dx, y: 0.31, z: -3 }, { env: true });
    spawnProp('crate', { x: -3.57 + dx, y: 0.93, z: -3 }, { env: true });
    spawnProp('barrel', { x: 3.4 + dx, y: 0.46, z: -2.6 }, { env: true });
    spawnProp('barrel', { x: 4.2 + dx, y: 0.46, z: -1.9 }, { env: true });
  }

  function buildLab() {
    setSky('#2d2a39', '#121017'); scene.fog = new THREE.Fog(0x1a1820, 24, 80);
    setLights([0xd9d4ff, 0x2b2633, 0.55], [0xfff1e2, 2.1, [6, 13, 7]], 1.05);
    setGround(TEX.labFloor, { rough: 0.82, bump: 0.015 });
    accent(0, 0x8b5cf6, 1.8, [-7, 3.2, -8]); accent(1, 0x38bdf8, 1.1, [7, 3.2, -8]);
    envBox(28, 7, 0.6, 0, 3.5, -11, MAT.wall);
    envBox(0.6, 7, 18, -13.5, 3.5, -2.5, MAT.wall);
    envBox(0.6, 7, 18, 13.5, 3.5, -2.5, MAT.wall);
    envBox(26, 0.12, 0.08, 0, 2.6, -10.67, MAT.ledPurple, null, false);
    envBox(0.08, 0.12, 16, -13.17, 2.6, -2.5, MAT.ledPurple, null, false);
    envBox(0.08, 0.12, 16, 13.17, 2.6, -2.5, MAT.ledCyan, null, false);
    envBox(3.2, 0.25, 2.4, 6.2, 0.62, -5.5, MAT.metalPlate, [0, 0, 0.36]);
    envBox(3, 0.5, 3, -7, 0.25, -6.5, MAT.metalPlate);
    standardProps();
  }
  function buildArena() {
    setSky('#1b1030', '#060509'); scene.fog = new THREE.Fog(0x0a0712, 18, 64);
    setLights([0xa78bfa, 0x0c0a12, 0.38], [0xd8ccff, 1.3, [4, 14, 6]], 1.1);
    setGround(TEX.arena, { rough: 0.35, metal: 0.4, emissiveMap: TEX.arenaGlow, emissive: 0x8b5cf6, emissiveIntensity: 1.0 });
    accent(0, 0x9b6bff, 3.2, [-6, 3.5, -2]); accent(1, 0x38d5ff, 2.4, [6, 3.5, -4]);
    const R = 12, side = 2 * R * Math.tan(Math.PI / 8) + 0.3;
    for (let i = 0; i < 8; i++) {
      const a = i * (Math.PI / 4) + Math.PI / 8;
      envBox(side, 1.2, 0.5, Math.sin(a) * R, 0.6, Math.cos(a) * R, MAT.pillar, [0, a, 0]);
      envBox(side, 0.06, 0.52, Math.sin(a) * R, 1.23, Math.cos(a) * R, i % 2 ? MAT.ledCyan : MAT.ledPurple, [0, a, 0], false);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + Math.PI / 4, x = Math.sin(a) * (R + 0.6), z = Math.cos(a) * (R + 0.6);
      const p = mesh(new THREE.CylinderGeometry(0.5, 0.6, 7, 24), MAT.pillar); p.position.set(x, 3.5, z); envAdd(p);
      for (let j = 0; j < 3; j++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.04, 8, 32), MAT.ledPurple); ring.rotation.x = Math.PI / 2; ring.position.set(x, 1.6 + j * 1.8, z); envAdd(ring); }
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.55, 3.5, 0.55)), position: new CANNON.Vec3(x, 3.5, z), collisionFilterGroup: G_ENV, collisionFilterMask: ALL });
      b.userData = { kind: 'env' }; world.addBody(b); env.bodies.push(b);
    }
    const logo = new THREE.Mesh(new THREE.RingGeometry(2.7, 2.85, 96), MAT.ledPurple); logo.rotation.x = -Math.PI / 2; logo.position.y = 0.012; envAdd(logo);
    standardProps();
  }
  function buildDesert() {
    setSky('#7fb2e0', '#f3dcb0'); scene.fog = new THREE.Fog(0xe8d2ac, 34, 120);
    setLights([0xfff4e0, 0x9a7650, 0.85], [0xffe1b5, 2.6, [12, 18, 4]], 1.0);
    setGround(TEX.sand, { rough: 0.97, bump: 0.03 });
    [[-7, -6, 1.3], [8, -9, 1.8], [-11, 3, 1.1], [10.5, 2, 0.9], [3, -12, 2.2], [-4.5, -14, 2.6]].forEach(([x, z, s]) => envRock(x, z, s, MAT.rock));
    [[-45, -70, 30], [30, -80, 38], [70, -40, 26], [-80, -20, 32]].forEach(([x, z, s]) => { const d = new THREE.Mesh(GEO.sphere, MAT.sandDune); d.scale.set(s, s * 0.16, s * 0.8); d.position.set(x, 0, z); d.receiveShadow = true; envAdd(d); });
    const cactus = (x, z, h) => {
      envBox(0.32, h, 0.32, x, h / 2, z, MAT.cactus);
      const arm = (sx, y, len) => { envBox(0.26, len, 0.26, x + sx * 0.45, y + len / 2, z, MAT.cactus, null, false); envBox(0.45, 0.24, 0.24, x + sx * 0.25, y, z, MAT.cactus, null, false); };
      arm(1, h * 0.45, h * 0.35); arm(-1, h * 0.62, h * 0.25);
    };
    cactus(-6, -9, 2.6); cactus(6.5, -4.5, 2.1); cactus(12, -10, 3.2);
    envBox(0.14, 1.6, 0.14, -1.2, 0.8, -6, MAT.wood); envBox(0.14, 1.6, 0.14, 1.2, 0.8, -6, MAT.wood); envBox(2.6, 0.18, 0.12, 0, 1.45, -6, MAT.wood);
    standardProps();
  }
  function buildMoon() {
    setSky('#000004', '#0d1124'); scene.fog = null;
    setLights([0x9aa6c8, 0x0a0a0a, 0.24], [0xffffff, 3.0, [-9, 11, 5]], 1.1);
    setGround(TEX.moon, { rough: 0.97, bump: 0.05 });
    const n = 2600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const d = randDir(); const y = Math.abs(d.y) * 0.9 + 0.05; pos[i * 3] = d.x * 180; pos[i * 3 + 1] = y * 180; pos[i * 3 + 2] = d.z * 180; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sm = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false }); env.mats.push(sm);
    envAdd(new THREE.Points(sg, sm));
    const em = new THREE.MeshStandardMaterial({ map: TEX.earth, roughness: 0.7, emissive: 0x0a1a33, emissiveIntensity: 0.6 }); env.mats.push(em);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), em); earth.position.set(-40, 34, -130); envAdd(earth);
    const atm = new THREE.Sprite(MAT.glowBlue); atm.scale.setScalar(30); atm.position.copy(earth.position); envAdd(atm);
    [[-6, -7, 1.0], [8, -10, 1.6], [-12, 2, 0.8], [11, 1, 1.2], [2, -14, 2.0]].forEach(([x, z, s]) => envRock(x, z, s, MAT.moonRock));
    [[-8, 3, 3], [7, -3, 2.2]].forEach(([x, z, s]) => { const rim = new THREE.Mesh(new THREE.TorusGeometry(s, 0.35, 10, 40), MAT.moonRock); rim.rotation.x = -Math.PI / 2; rim.scale.set(1, 1, 0.35); rim.position.set(x, 0, z); rim.receiveShadow = true; envAdd(rim); });
    const pad = mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.16, 40), MAT.metalPlate); pad.position.set(6, 0.08, -6); envAdd(pad);
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(1.7, 0.08, 1.7)), position: new CANNON.Vec3(6, 0.08, -6), collisionFilterGroup: G_ENV, collisionFilterMask: ALL });
    b.userData = { kind: 'env' }; world.addBody(b); env.bodies.push(b);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.75, 64), MAT.ledCyan); ring.rotation.x = -Math.PI / 2; ring.position.set(6, 0.17, -6); envAdd(ring);
    standardProps();
  }
  const ENVS = {
    lab: { name: 'Test lab', desc: 'Concrete test bay with walls, a ramp and a platform', sky: 'linear-gradient(180deg,#2d2a39,#121017)', floor: '#5a5960', gravity: -9.82, build: buildLab },
    arena: { name: 'Neon arena', desc: 'Octagon cage with glowing walls and pillars', sky: 'linear-gradient(180deg,#1b1030,#060509)', floor: '#3b1d78', gravity: -9.82, build: buildArena },
    desert: { name: 'Desert range', desc: 'Open sand, boulders and cactus — no walls', sky: 'linear-gradient(180deg,#7fb2e0,#f3dcb0)', floor: '#cfa66d', gravity: -9.82, build: buildDesert },
    moon: { name: 'Moon base', desc: 'Low gravity: a sixth of Earth’s pull', sky: 'linear-gradient(180deg,#000004,#0d1124)', floor: '#8d8d92', gravity: -1.62, build: buildMoon },
  };
  function clearEnv() {
    env.objs.forEach((o) => { scene.remove(o); disposeObj(o); });
    env.objs = [];
    env.bodies.forEach(removeBody); env.bodies = [];
    env.mats.forEach((m) => m.dispose()); env.mats = [];
  }
  function setEnvironment(id) {
    const E = ENVS[id] || ENVS.lab;
    state.envId = ENVS[id] ? id : 'lab';
    clearDynamic(true);
    clearEnv();
    accents.forEach((a) => { a.intensity = 0; });
    world.gravity.set(0, E.gravity, 0);
    E.build();
    dummies.forEach((d) => d.reset());
    if (state.panel === 'world') renderWorld();
    if (state.panel === 'settings') renderSettings();
  }

  /* ------------------------------------------------------------------
     15. Props (crates, barrels, bowling balls, anvils)
     ------------------------------------------------------------------ */
  function makeAnvilMesh() {
    const g = new THREE.Group();
    GEO.anvil.forEach(([geo, p]) => { const m = mesh(geo, MAT.anvil); m.position.set(p[0], p[1], p[2]); g.add(m); });
    const horn = mesh(GEO.anvilHorn, MAT.anvil); horn.rotation.z = -Math.PI / 2; horn.position.set(0.46, 0.13, 0); g.add(horn);
    return g;
  }
  function makeBallMesh() {
    const g = new THREE.Group(); g.add(mesh(GEO.ball, MAT.ball));
    [[0, 0.17, 0.12], [0.05, 0.12, 0.165], [-0.05, 0.12, 0.165]].forEach(([x, y, z]) => {
      const h = new THREE.Mesh(GEO.sphere, MAT.ballHole); h.scale.setScalar(0.022); h.position.set(x, y, z).normalize().multiplyScalar(0.2); g.add(h);
    });
    return g;
  }
  function spawnProp(kind, pos, o) {
    o = o || {};
    let body, obj;
    const q = o.size || 0.3;
    if (kind === 'crate' || kind === 'chunk') {
      body = new CANNON.Body({ mass: (kind === 'chunk' ? 1 : 6) * Math.pow(q / 0.3, 3) * (kind === 'chunk' ? 8 : 1), shape: new CANNON.Box(new CANNON.Vec3(q, q, q)) });
      obj = mesh(GEO.box, MAT.crate); obj.scale.setScalar(q * 2);
    } else if (kind === 'barrel') {
      body = new CANNON.Body({ mass: 9 });
      const qq = new CANNON.Quaternion(); qq.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
      body.addShape(new CANNON.Cylinder(0.3, 0.3, 0.9, 14), new CANNON.Vec3(), qq);
      obj = mesh(GEO.barrel, [MAT.barrelSide, MAT.barrelTop, MAT.barrelTop]);
    } else if (kind === 'ball') {
      body = new CANNON.Body({ mass: 7, shape: new CANNON.Sphere(0.21) });
      obj = makeBallMesh();
    } else {
      body = new CANNON.Body({ mass: 70 });
      GEO.anvil.forEach(([geo, p]) => { const pr = geo.parameters; body.addShape(new CANNON.Box(new CANNON.Vec3(pr.width / 2, pr.height / 2, pr.depth / 2)), new CANNON.Vec3(p[0], p[1], p[2])); });
      obj = makeAnvilMesh();
    }
    body.position.set(pos.x, pos.y, pos.z);
    body.collisionFilterGroup = G_PROP; body.collisionFilterMask = ALL;
    body.linearDamping = 0.02; body.angularDamping = 0.08;
    body.allowSleep = true; body.sleepSpeedLimit = 0.15; body.sleepTimeLimit = 0.6;
    const rec = { kind, body, mesh: obj, life: o.life || Infinity, maxLife: o.life || Infinity, env: !!o.env, dead: false, armed: false, size: q };
    body.userData = { kind, prop: rec };
    body.addEventListener('collide', (e) => propCollide(rec, e));
    world.addBody(body);
    obj.userData.body = body;
    obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    scene.add(obj); props.push(rec); syncProp(rec);
    return rec;
  }
  function syncProp(rec) { rec.mesh.position.copy(rec.body.position); rec.mesh.quaternion.copy(rec.body.quaternion); }
  function removeProp(rec) {
    if (rec.removed) return;
    rec.dead = true; rec.removed = true;
    if (grab && grab.body === rec.body) releaseGrab();
    removeBody(rec.body); scene.remove(rec.mesh);
  }
  function propCollide(rec, e) {
    if (rec.dead) return;
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v < 2.5) return;
    if (rec.kind === 'barrel' && v > 9) detonateBarrel(rec, 0.03);
    else if (rec.kind === 'anvil') { Sound.clank(); if (v > 6) state.shake = Math.min(1, state.shake + 0.15); }
    else if (rec.kind === 'ball') Sound.thump(v * 0.7);
    else if (rec.kind === 'crate' || rec.kind === 'chunk') Sound.wood();
    else if (rec.kind === 'barrel') Sound.clank();
  }
  function detonateBarrel(rec, delay) {
    if (rec.dead || rec.armed) return;
    rec.armed = true;
    pending.push({ prop: rec, power: 1.25, delay });
  }
  function breakCrate(rec, center) {
    if (rec.dead || rec.kind !== 'crate') return;
    const p = rec.body.position, s = rec.size, px = p.x, py = p.y, pz = p.z;
    removeProp(rec);
    Sound.crack();
    for (let i = 0; i < 8; i++) {
      const ox = (i & 1 ? 1 : -1) * s * 0.5, oy = (i & 2 ? 1 : -1) * s * 0.5, oz = (i & 4 ? 1 : -1) * s * 0.5;
      const c = spawnProp('chunk', { x: px + ox, y: py + oy, z: pz + oz }, { size: s * 0.47, life: rand(6, 9) });
      const dx = px + ox - center.x, dy = py + oy - center.y + 0.5, dz = pz + oz - center.z, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const sp = rand(4, 8);
      c.body.velocity.set((dx / l) * sp, (dy / l) * sp + 2, (dz / l) * sp);
      c.body.angularVelocity.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    }
    puff({ x: px, y: py, z: pz }, 10, [0.55, 0.42, 0.3], 0.25, 1.1, 0.5);
  }

  /* ------------------------------------------------------------------
     16. Projectiles
     ------------------------------------------------------------------ */
  const Y_UP = new THREE.Vector3(0, 1, 0);
  function makeBoltMesh(coreMat, glow, scale) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(GEO.boltCore, coreMat); g.add(core);
    const sp = new THREE.Sprite(glow); sp.scale.setScalar(0.5 * scale); g.add(sp);
    return g;
  }
  function makeRocketMesh() {
    const g = new THREE.Group();
    g.add(mesh(GEO.rocketTube, MAT.rocketBody));
    const nose = mesh(GEO.rocketNose, MAT.rocketNose); nose.position.y = 0.26; g.add(nose);
    for (let i = 0; i < 4; i++) { const f = mesh(GEO.fin, MAT.rocketNose); const a = (i * Math.PI) / 2; f.position.set(Math.cos(a) * 0.07, -0.15, Math.sin(a) * 0.07); f.rotation.y = -a; g.add(f); }
    const flame = new THREE.Mesh(GEO.flame, MAT.flame); flame.rotation.x = Math.PI; flame.position.y = -0.34; g.add(flame); g.userData.flame = flame;
    const sp = new THREE.Sprite(MAT.glowOrange); sp.scale.setScalar(0.7); sp.position.y = -0.3; g.add(sp);
    return g;
  }
  const PROJ = {
    bolt: { speed: 62, grav: 0.04, life: 2, knock: 8, color: [0.78, 0.6, 1], make: () => makeBoltMesh(MAT.boltPurple, MAT.glowPurple, 1) },
    pellet: { speed: 48, grav: 0.3, life: 1.2, knock: 4.5, color: [1, 0.75, 0.35], make: () => makeBoltMesh(MAT.boltOrange, MAT.glowOrange, 0.7) },
    rocket: { speed: 24, grav: 0, life: 4, explode: 1.15, make: makeRocketMesh },
  };
  const rayResult = new CANNON.RaycastResult();
  const rayFrom = new CANNON.Vec3(), rayTo = new CANNON.Vec3();
  function fireRay(kind, origin, dir) {
    const cfg = PROJ[kind];
    const rec = { type: 'ray', kind, cfg, pos: origin.clone(), vel: dir.clone().multiplyScalar(cfg.speed), life: cfg.life, mesh: cfg.make(), dead: false };
    rec.mesh.position.copy(origin); rec.mesh.quaternion.setFromUnitVectors(Y_UP, dir);
    scene.add(rec.mesh); projectiles.push(rec);
    return rec;
  }
  function throwGrenade(origin, dir) {
    const body = new CANNON.Body({ mass: 0.9, shape: new CANNON.Sphere(0.085), collisionFilterGroup: G_PROJ, collisionFilterMask: ALL & ~G_PROJ, angularDamping: 0.3 });
    body.position.set(origin.x, origin.y, origin.z);
    body.velocity.set(dir.x * 13, dir.y * 13 + 3.2, dir.z * 13);
    body.angularVelocity.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    const g = new THREE.Group();
    g.add(mesh(GEO.grenade, MAT.grenade));
    const cap = mesh(GEO.grenadeCap, MAT.grenadeCap); cap.position.y = 0.09; g.add(cap);
    const led = new THREE.Sprite(MAT.glowRed); led.scale.setScalar(0.18); led.position.y = 0.12; g.add(led);
    const rec = { type: 'body', kind: 'grenade', body, mesh: g, led, life: 1.9, dead: false };
    body.userData = { kind: 'proj', proj: rec };
    body.addEventListener('collide', (e) => { if (Math.abs(e.contact.getImpactVelocityAlongNormal()) > 2) Sound.pin(); });
    world.addBody(body); scene.add(g); projectiles.push(rec);
    Sound.pin();
  }
  function removeProjectile(rec) {
    rec.dead = true;
    if (rec.body) removeBody(rec.body);
    scene.remove(rec.mesh);
  }
  function onRayHit(rec, body, p, n) {
    rec.dead = true;
    if (rec.cfg.explode) { explode({ x: p.x + n.x * 0.15, y: p.y + n.y * 0.15, z: p.z + n.z * 0.15 }, rec.cfg.explode); return; }
    sparks(p, 14, rec.cfg.color, 5, 0.05, 0.35);
    Sound.hit();
    const ud = (body && body.userData) || {};
    if (body && body.mass > 0) {
      body.wakeUp();
      const d = rec.vel.clone().normalize(), J = rec.cfg.knock * Math.min(body.mass, 6);
      body.applyImpulse(new CANNON.Vec3(d.x * J, d.y * J + J * 0.1, d.z * J), new CANNON.Vec3(p.x, p.y, p.z));
      if (ud.kind === 'dummy') { ud.dummy.hit(rec.cfg.knock * 0.3); if (Math.random() < 0.2) comic(pick(['ZAP!', 'ZING!', 'PEW!']), p, 'small'); }
      if (ud.kind === 'barrel') detonateBarrel(ud.prop, 0.05);
      if (ud.kind === 'crate' || ud.kind === 'chunk') puff(p, 3, [0.55, 0.42, 0.3], 0.12, 0.6, 0.5);
    } else {
      puff(p, 3, [0.45, 0.44, 0.48], 0.12, 0.7, 0.45);
    }
  }
  function updateProjectiles(dt) {
    for (const rec of projectiles) {
      if (rec.dead) continue;
      rec.life -= dt;
      if (rec.type === 'ray') {
        rec.vel.y += world.gravity.y * rec.cfg.grav * dt;
        const nx = rec.pos.x + rec.vel.x * dt, ny = rec.pos.y + rec.vel.y * dt, nz = rec.pos.z + rec.vel.z * dt;
        rayFrom.set(rec.pos.x, rec.pos.y, rec.pos.z); rayTo.set(nx, ny, nz);
        world.raycastClosest(rayFrom, rayTo, { collisionFilterMask: ALL & ~G_PROJ, skipBackfaces: true }, rayResult);
        if (rayResult.hasHit) {
          const hp = rayResult.hitPointWorld, hn = rayResult.hitNormalWorld;
          onRayHit(rec, rayResult.body, new THREE.Vector3(hp.x, hp.y, hp.z), hn);
          continue;
        }
        rec.pos.set(nx, ny, nz);
        rec.mesh.position.copy(rec.pos);
        rec.mesh.quaternion.setFromUnitVectors(Y_UP, tmpV.copy(rec.vel).normalize());
        if (rec.kind === 'rocket') {
          rec.mesh.userData.flame.scale.set(1, rand(0.7, 1.3), 1);
          const back = tmpV.copy(rec.vel).normalize().multiplyScalar(-0.35).add(rec.pos);
          puff(back, 1.5, [0.7, 0.68, 0.72], 0.16, 1.2, 0.5);
          fxAdd.spawn(back.x, back.y, back.z, rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5), 0.15, 0.18, 1, 0.6, 0.2, { grav: 0, drag: 2 });
          if (rec.life <= 0) { rec.dead = true; explode(rec.pos, rec.cfg.explode); }
        } else if (Math.random() < 0.6) {
          fxAdd.spawn(rec.pos.x, rec.pos.y, rec.pos.z, 0, 0, 0, 0.12, 0.05, rec.cfg.color[0], rec.cfg.color[1], rec.cfg.color[2], { grav: 0, drag: 0 });
        }
        if (rec.life <= 0) rec.dead = true;
      } else {
        rec.mesh.position.copy(rec.body.position); rec.mesh.quaternion.copy(rec.body.quaternion);
        const fast = rec.life < 0.6;
        rec.led.visible = Math.floor(rec.life * (fast ? 14 : 6)) % 2 === 0;
        if (rec.life <= 0) {
          rec.dead = true;
          const p = rec.body.position;
          explode({ x: p.x, y: p.y + 0.1, z: p.z }, 1.0);
        }
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const rec = projectiles[i];
      const p = rec.type === 'ray' ? rec.pos : rec.body.position;
      if (!rec.dead && (p.y < -20 || Math.abs(p.x) > 120 || Math.abs(p.z) > 120)) rec.dead = true;
      if (rec.dead) { removeProjectile(rec); projectiles.splice(i, 1); }
    }
  }

  /* ------------------------------------------------------------------
     17. Explosions and effects
     ------------------------------------------------------------------ */
  function explode(p, power) {
    power = power || 1;
    const R = 4.5 * Math.sqrt(power) + 0.5, dv = 15 * power;
    const hit = new Set(), toBreak = [];
    world.bodies.slice().forEach((b) => {
      if (b.mass <= 0) return;
      const dx = b.position.x - p.x, dy = b.position.y - p.y, dz = b.position.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > R) return;
      const f = 1 - d / R;
      let nx = 0, ny = 1, nz = 0;
      if (d > 1e-3) { nx = dx / d; ny = dy / d; nz = dz / d; }
      ny += 0.55;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
      const J = dv * f * Math.min(b.mass, 30);
      b.wakeUp();
      b.applyImpulse(new CANNON.Vec3(nx * J, ny * J, nz * J), b.position);
      b.angularVelocity.x += rand(-8, 8) * f; b.angularVelocity.y += rand(-8, 8) * f; b.angularVelocity.z += rand(-8, 8) * f;
      const ud = b.userData || {};
      if (ud.kind === 'dummy') hit.add(ud.dummy);
      else if (ud.kind === 'crate' && f > 0.3) toBreak.push(ud.prop);
      else if (ud.kind === 'barrel') detonateBarrel(ud.prop, 0.1 + rand(0, 0.12));
    });
    hit.forEach((d) => { d.hit(4 * power); d.ouch = 1; });
    toBreak.forEach((rec) => breakCrate(rec, p));
    explosionFX(p, power);
  }
  function explosionFX(p, power) {
    Sound.boom(power);
    const fl = flashes[flashIdx++ % flashes.length];
    fl.position.set(p.x, p.y + 0.6, p.z); fl.intensity = 7 * power; fl.color.set(0xffa040);
    const fb = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    fb.position.set(p.x, p.y, p.z); fb.scale.setScalar(0.2); scene.add(fb);
    fxObjs.push({ mesh: fb, t: 0, dur: 0.45, kind: 'fireball', size: 1.7 * power });
    const ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: 0xc9a8ff, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, Math.max(0.04, p.y - 0.25), p.z); scene.add(ring);
    fxObjs.push({ mesh: ring, t: 0, dur: 0.6, kind: 'ring', size: 6.5 * power });
    const m = state.particleMul;
    for (let i = 0; i < 90 * m; i++) {
      const d = randDir(), s = rand(2, 11) * power;
      fxAdd.spawn(p.x, p.y, p.z, d.x * s, d.y * s + 2, d.z * s, rand(0.3, 0.8), rand(0.18, 0.4) * power, 1, rand(0.5, 0.85), rand(0.15, 0.3), { grav: -2, drag: 2.5 });
    }
    sparks(p, 45, [1, 0.85, 0.45], 14 * power, 0.05, 1.1);
    for (let i = 0; i < 34 * m; i++) {
      const d = randDir(), s = rand(0.5, 3) * power, k = rand(0.18, 0.32);
      fxSmoke.spawn(p.x + d.x * 0.4, p.y + Math.abs(d.y) * 0.3, p.z + d.z * 0.4, d.x * s, Math.abs(d.y) * s + 1.2, d.z * s, rand(1.4, 3), rand(0.5, 0.8) * power, k, k * 0.95, k * 0.92, { grav: 1.0, drag: 1.4, grow: 2.4 * power, alpha: 0.6 });
    }
    if (p.y < 1.2) {
      const sc = new THREE.Mesh(GEO.plane, MAT.scorch.clone());
      sc.rotation.x = -Math.PI / 2; sc.rotation.z = rand(0, 6.28);
      const size = 3.2 * power; sc.scale.set(size, size, 1); sc.position.set(p.x, 0.012 + scorches.length * 0.0004, p.z);
      sc.renderOrder = 1; scene.add(sc); scorches.push({ mesh: sc, life: 25 });
      if (scorches.length > 14) { const old = scorches.shift(); scene.remove(old.mesh); old.mesh.material.dispose(); }
      puff({ x: p.x, y: 0.1, z: p.z }, 12, state.envId === 'desert' ? [0.78, 0.64, 0.45] : [0.5, 0.48, 0.47], 0.35, 1.6, 0.45);
    }
    const camD = camera.position.distanceTo(tmpV.set(p.x, p.y, p.z));
    state.shake = Math.min(1.2, state.shake + (0.9 * power) / Math.max(1, camD * 0.35));
    comic(pick(['BOOM!', 'KABOOM!', 'BLAM!']), p, 'big');
  }
  function updateFx(dt) {
    for (let i = fxObjs.length - 1; i >= 0; i--) {
      const o = fxObjs[i]; o.t += dt;
      const k = clamp(o.t / o.dur, 0, 1), ease = 1 - Math.pow(1 - k, 3);
      if (o.kind === 'fireball') { o.mesh.scale.setScalar(0.2 + o.size * ease); o.mesh.material.opacity = 1 - k; o.mesh.material.color.setRGB(1, 0.77 - 0.4 * k, 0.42 - 0.35 * k); }
      else { o.mesh.scale.setScalar(0.3 + o.size * ease); o.mesh.material.opacity = (1 - k) * 0.9; }
      if (k >= 1) { scene.remove(o.mesh); o.mesh.material.dispose(); fxObjs.splice(i, 1); }
    }
    flashes.forEach((l) => { l.intensity *= Math.exp(-dt * 9); if (l.intensity < 0.01) l.intensity = 0; });
    for (let i = scorches.length - 1; i >= 0; i--) {
      const s = scorches[i]; s.life -= dt;
      s.mesh.material.opacity = clamp(s.life / 6, 0, 1);
      if (s.life <= 0) { scene.remove(s.mesh); s.mesh.material.dispose(); scorches.splice(i, 1); }
    }
  }
  function processPending(dt) {
    const list = pending.splice(0, pending.length);
    list.forEach((p) => {
      p.delay -= dt;
      if (p.delay > 0) { pending.push(p); return; }
      let pos = p.pos;
      if (p.prop) {
        if (p.prop.removed) return;
        const b = p.prop.body.position; pos = { x: b.x, y: b.y, z: b.z };
        removeProp(p.prop);
      }
      explode(pos, p.power);
    });
  }

  /* ------------------------------------------------------------------
     18. Gravity well
     ------------------------------------------------------------------ */
  function spawnWell(p) {
    const g = new THREE.Group();
    g.position.set(p.x, Math.max(1.1, p.y + 1.0), p.z);
    const core = new THREE.Mesh(GEO.sphere, MAT.wellCore); core.scale.setScalar(0.22); g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 64), MAT.wellRing); ring.rotation.x = Math.PI / 2.4; g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.015, 8, 48), MAT.wellRing); ring2.rotation.x = Math.PI / 1.7; g.add(ring2);
    const glow = new THREE.Sprite(MAT.glowPurple); glow.scale.setScalar(1.8); g.add(glow);
    scene.add(g);
    wells.push({ group: g, ring, ring2, life: 4.5 });
    Sound.hum();
  }
  function wellForces() {
    wells.forEach((w) => {
      const c = w.group.position;
      world.bodies.forEach((b) => {
        if (b.mass <= 0) return;
        const dx = c.x - b.position.x, dy = c.y - b.position.y, dz = c.z - b.position.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > 9 || d < 1e-3) return;
        if (b.sleepState) b.wakeUp();
        const f = Math.min(b.mass * 60 / (d * d * 0.6 + 1), b.mass * 45);
        b.force.x += (dx / d) * f + (-dz / d) * f * 0.35;
        b.force.y += (dy / d) * f + b.mass * -world.gravity.y * 0.6;
        b.force.z += (dz / d) * f + (dx / d) * f * 0.35;
        if (d < 1) { b.velocity.x *= 0.98; b.velocity.y *= 0.98; b.velocity.z *= 0.98; }
        const ud = b.userData;
        if (ud && ud.kind === 'dummy') ud.dummy.stun = Math.max(ud.dummy.stun, 0.6);
      });
    });
  }
  function updateWells(dt) {
    for (let i = wells.length - 1; i >= 0; i--) {
      const w = wells[i]; w.life -= dt;
      w.ring.rotation.z += dt * 6; w.ring2.rotation.z -= dt * 9;
      const pulse = 1 + Math.sin(w.life * 18) * 0.08; w.group.scale.setScalar(pulse);
      const c = w.group.position;
      for (let k = 0; k < 5 * state.particleMul; k++) {
        const d = randDir(), r = rand(1.5, 3.2), px = c.x + d.x * r, py = c.y + d.y * r * 0.6, pz = c.z + d.z * r;
        const tx = (c.x - px) * 1.4 + (pz - c.z) * 1.2, ty = (c.y - py) * 1.4, tz = (c.z - pz) * 1.4 - (px - c.x) * 1.2;
        fxAdd.spawn(px, py, pz, tx, ty, tz, 0.6, 0.05, 0.7, 0.5, 1, { grav: 0, drag: 0 });
      }
      if (w.life <= 0) {
        scene.remove(w.group); disposeObj(w.group); wells.splice(i, 1);
        explode({ x: c.x, y: c.y, z: c.z }, 0.8);
      }
    }
  }

  /* ------------------------------------------------------------------
     19. Clearing / spawning dummies
     ------------------------------------------------------------------ */
  function clearDynamic(includeEnvProps) {
    if (grab) releaseGrab();
    props.slice().forEach((r) => { if (includeEnvProps || !r.env) removeProp(r); });
    for (let i = props.length - 1; i >= 0; i--) if (props[i].removed) props.splice(i, 1);
    projectiles.forEach(removeProjectile); projectiles.length = 0;
    wells.forEach((w) => { scene.remove(w.group); disposeObj(w.group); }); wells.length = 0;
    fxObjs.forEach((o) => { scene.remove(o.mesh); o.mesh.material.dispose(); }); fxObjs.length = 0;
    scorches.forEach((s) => { scene.remove(s.mesh); s.mesh.material.dispose(); }); scorches.length = 0;
    pending.length = 0;
    if (fxAdd) { fxAdd.clear(); fxSmoke.clear(); }
  }
  function resetScene() {
    clearDynamic(true);
    standardProps();
    dummies.forEach((d) => d.reset());
  }
  const SLOT_X = [0, -1.7, 1.7, -3.4, 3.4, 0];
  const SLOT_Z = [0, 0.4, 0.4, 0.9, 0.9, -1.6];
  function spawnDummy(params) {
    if (dummies.length >= DUMMY_BITS.length) { toast('Six dummies is the limit. Remove one first.'); return null; }
    const used = new Set(dummies.map((d) => d.bit));
    const slot = DUMMY_BITS.findIndex((b) => !used.has(b));
    const d = new Dummy(params, { x: SLOT_X[slot], z: SLOT_Z[slot] }, DUMMY_BITS[slot]);
    dummies.push(d);
    state.focus = dummies.length - 1;
    renderChips();
    return d;
  }
  function removeDummy(d) {
    if (dummies.length <= 1) { toast('Keep at least one dummy in the scene.'); return; }
    const i = dummies.indexOf(d);
    if (i < 0) return;
    d.destroy(); dummies.splice(i, 1);
    state.focus = clamp(state.focus, 0, dummies.length - 1);
    renderChips();
    if (state.panel === 'creator') renderCreator();
  }

  /* ------------------------------------------------------------------
     20. Picking, tools and input
     ------------------------------------------------------------------ */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function setNDC(x, y) { ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1); }
  function pickables() {
    const list = [ground];
    dummies.forEach((d) => Object.values(d.parts).forEach((p) => list.push(p.mesh)));
    props.forEach((r) => { if (!r.dead) list.push(r.mesh); });
    env.objs.forEach((o) => { if (o.isMesh) list.push(o); });
    return list;
  }
  function pickAt() {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables(), true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.body && !o.userData.env) o = o.parent;
      if (!o) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      return { point: h.point.clone(), normal: n, body: o.userData.body || null, dummy: o.userData.dummy || null };
    }
    return null;
  }
  function muzzle() {
    const o = camera.position.clone();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    return o.addScaledVector(right, 0.26).addScaledVector(up, -0.18).addScaledVector(fwd, 0.45);
  }
  function aim(origin) {
    const hit = pickAt();
    const target = hit ? hit.point : raycaster.ray.at(60, new THREE.Vector3());
    return target.sub(origin).normalize();
  }
  function muzzleFlash(o, color) {
    for (let i = 0; i < 6 * state.particleMul; i++) { const d = randDir(); fxAdd.spawn(o.x, o.y, o.z, d.x * 1.5, d.y * 1.5, d.z * 1.5, 0.1, 0.08, color[0], color[1], color[2], { grav: 0, drag: 4 }); }
  }

  const TOOLS = [
    { id: 'grab', name: 'Grab', icon: '✋', key: '1', hint: '<b>Grab:</b> drag a body part or prop, then let go to throw it.' },
    { id: 'punch', name: 'Punch', icon: '👊', key: '2', hint: '<b>Punch:</b> click anywhere on the dummy to smack it.' },
    { id: 'blaster', name: 'Plasma', icon: '🔫', key: '3', hint: '<b>Plasma blaster:</b> hold to fire a stream of energy bolts.' },
    { id: 'scatter', name: 'Scatter', icon: '✴️', key: '4', hint: '<b>Scatter blaster:</b> a wide spread of pellets per click.' },
    { id: 'rocket', name: 'Rocket', icon: '🚀', key: '5', hint: '<b>Rocket launcher:</b> explodes on contact.' },
    { id: 'grenade', name: 'Grenade', icon: '💣', key: '6', hint: '<b>Grenade:</b> bounces, then explodes after two seconds.' },
    { id: 'boom', name: 'Boom', icon: '💥', key: '7', hint: '<b>Boom:</b> an explosion exactly where you click.' },
    { id: 'well', name: 'Vortex', icon: '🌀', key: '8', hint: '<b>Gravity vortex:</b> sucks everything in, then pops.' },
    { id: 'ball', name: 'Bowling', icon: '🎳', key: '9', hint: '<b>Bowling ball:</b> drops from the sky onto your target.' },
    { id: 'anvil', name: 'Anvil', icon: '⚒️', key: '0', hint: '<b>Anvil:</b> 70 kg of falling iron.' },
    { id: 'crate', name: 'Crate', icon: '📦', key: '-', hint: '<b>Crate:</b> spawns a wooden crate. Explosions smash them.' },
    { id: 'barrel', name: 'Barrel', icon: '🛢️', key: '=', hint: '<b>Explosive barrel:</b> goes off when hit hard or shot.' },
  ];
  function setTool(id) {
    state.tool = id;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
    const t = TOOLS.find((x) => x.id === id);
    $('#hint').innerHTML = t ? t.hint + '<br>Right-drag to orbit, scroll to zoom.' : '';
    canvas.classList.toggle('grab', id === 'grab');
  }

  function startGrab(hit) {
    const b = hit.body;
    b.wakeUp();
    const mb = new CANNON.Body({ mass: 0, collisionFilterGroup: 0, collisionFilterMask: 0 });
    mb.position.set(hit.point.x, hit.point.y, hit.point.z);
    world.addBody(mb);
    const local = b.pointToLocalFrame(new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z));
    const c = new CANNON.PointToPointConstraint(b, local, mb, new CANNON.Vec3(0, 0, 0), 6000);
    world.addConstraint(c);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), hit.point);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([hit.point, hit.point]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.9 }));
    scene.add(line);
    grab = { body: b, mb, c, local, plane, dummy: hit.dummy, line };
    if (hit.dummy) { hit.dummy.grabbed = true; hit.dummy.ouch = 0.5; }
    canvas.classList.add('grabbing');
    Sound.tick();
  }
  function moveGrab() {
    if (!grab) return;
    raycaster.setFromCamera(ndc, camera);
    const p = raycaster.ray.intersectPlane(grab.plane, new THREE.Vector3());
    if (p) { p.y = Math.max(0.08, p.y); grab.mb.position.set(p.x, p.y, p.z); }
  }
  function releaseGrab() {
    if (!grab) return;
    world.removeConstraint(grab.c); removeBody(grab.mb);
    scene.remove(grab.line); grab.line.geometry.dispose(); grab.line.material.dispose();
    if (grab.dummy) { grab.dummy.grabbed = false; grab.dummy.stun = Math.max(grab.dummy.stun, 1.0); }
    grab = null;
    canvas.classList.remove('grabbing');
  }
  function updateGrabLine() {
    if (!grab) return;
    const w = grab.body.pointToWorldFrame(grab.local), a = grab.line.geometry.attributes.position;
    a.setXYZ(0, w.x, w.y, w.z); a.setXYZ(1, grab.mb.position.x, grab.mb.position.y, grab.mb.position.z); a.needsUpdate = true;
  }
  function doPunch(hit) {
    if (!hit) return;
    const dir = raycaster.ray.direction;
    if (hit.body && hit.body.mass > 0) {
      hit.body.wakeUp();
      const J = Math.min(hit.body.mass, 12) * 11;
      hit.body.applyImpulse(new CANNON.Vec3(dir.x * J, dir.y * J + J * 0.25, dir.z * J), new CANNON.Vec3(hit.point.x, hit.point.y, hit.point.z));
      if (hit.dummy) { hit.dummy.hit(3); comic(pick(['SMACK!', 'WHAP!', 'POW!', 'BAM!']), hit.point); }
      Sound.slap();
      sparks(hit.point, 12, [1, 1, 1], 3.5, 0.05, 0.3);
      if (hit.body.userData && hit.body.userData.kind === 'barrel') detonateBarrel(hit.body.userData.prop, 0.4);
    } else {
      Sound.thump(3);
      puff(hit.point, 5, [0.5, 0.48, 0.47], 0.15, 0.8, 0.5);
    }
  }
  function dropAt(hit, kind) {
    let x = 0, z = 0, y = 7;
    if (hit && hit.dummy) { const hp = hit.dummy.headPos(); x = hp.x; z = hp.z; y = hp.y + 5; }
    else if (hit) { x = hit.point.x; z = hit.point.z; y = hit.point.y + 6; }
    else { const hp = focusedDummy().headPos(); x = hp.x; z = hp.z; y = hp.y + 5; }
    const rec = spawnProp(kind, { x, y, z });
    rec.body.angularVelocity.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
    Sound.whoosh();
  }
  function toolDown() {
    const t = state.tool;
    if (t === 'blaster' || t === 'scatter' || t === 'rocket' || t === 'grenade') { fireTool(t); return; }
    const hit = pickAt();
    if (t === 'grab') { if (hit && hit.body && hit.body.mass > 0) startGrab(hit); return; }
    if (t === 'punch') { doPunch(hit); return; }
    if (t === 'boom') { if (hit) explode({ x: hit.point.x + hit.normal.x * 0.15, y: Math.max(0.15, hit.point.y + hit.normal.y * 0.15), z: hit.point.z + hit.normal.z * 0.15 }, 1); return; }
    if (t === 'well') { if (hit) spawnWell(hit.point); return; }
    if (t === 'ball' || t === 'anvil') { dropAt(hit, t); return; }
    if (t === 'crate' || t === 'barrel') {
      if (!hit) return;
      const rec = spawnProp(t, { x: hit.point.x, y: hit.point.y + 1.4, z: hit.point.z });
      rec.body.angularVelocity.set(rand(-1, 1), 0, rand(-1, 1));
      Sound.tick();
    }
  }
  function fireTool(t) {
    const o = muzzle(), d = aim(o);
    if (t === 'blaster') { fireRay('bolt', o, d); muzzleFlash(o, PROJ.bolt.color); Sound.zap(); }
    if (t === 'scatter') {
      for (let i = 0; i < 7; i++) { const dd = d.clone().add(new THREE.Vector3(rand(-0.06, 0.06), rand(-0.05, 0.05), rand(-0.06, 0.06))).normalize(); fireRay('pellet', o, dd); }
      muzzleFlash(o, PROJ.pellet.color); Sound.shot(); state.shake = Math.min(1, state.shake + 0.08);
    }
    if (t === 'rocket') { fireRay('rocket', o, d); Sound.whoosh(); puff(o, 4, [0.7, 0.7, 0.72], 0.15, 0.8, 0.5); }
    if (t === 'grenade') throwGrenade(o, d);
  }

  const pointer = { down: false, orbiting: false, lastX: 0, lastY: 0, fireCD: 0 };
  const touches = new Map();
  let pinch = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'touch' && touches.size >= 2) {
      pointer.down = false; releaseGrab();
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (e.button === 2 || e.button === 1 || (e.button === 0 && (e.altKey || e.ctrlKey))) {
      pointer.orbiting = true; pointer.lastX = e.clientX; pointer.lastY = e.clientY; return;
    }
    if (e.button !== 0) return;
    setNDC(e.clientX, e.clientY);
    if (state.panel === 'creator') { toast('Close the creator to start wacking'); return; }
    if (state.paused && state.tool !== 'grab') { toast('Paused. Press Space to resume.'); }
    pointer.down = true; pointer.fireCD = 0.11;
    toolDown();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      cam.radiusGoal = clamp(cam.radiusGoal * (pinch.d / Math.max(10, d)), 1.1, 26);
      cam.theta -= (cx - pinch.cx) * 0.006; cam.phi = clamp(cam.phi - (cy - pinch.cy) * 0.005, 0.2, 1.53);
      pinch = { d, cx, cy };
      return;
    }
    if (pointer.orbiting) {
      cam.theta -= (e.clientX - pointer.lastX) * 0.006;
      cam.phi = clamp(cam.phi - (e.clientY - pointer.lastY) * 0.005, 0.2, 1.53);
      pointer.lastX = e.clientX; pointer.lastY = e.clientY;
      return;
    }
    setNDC(e.clientX, e.clientY);
    if (grab) moveGrab();
  });
  const endPointer = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (touches.size === 0 || e.pointerType !== 'touch') { pointer.down = false; pointer.orbiting = false; releaseGrab(); }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.radiusGoal = clamp(cam.radiusGoal * Math.exp(e.deltaY * 0.0012), 1.1, 26); }, { passive: false });

  const keys = {};
  window.addEventListener('keydown', (e) => {
    if (state.inMenu) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape') { if (!$('#help').classList.contains('hidden')) hideHelp(); else closePanel(); return; }
    if (e.metaKey || e.ctrlKey) return;
    const t = TOOLS.find((x) => x.key === e.key);
    if (t) { setTool(t.id); return; }
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePause(); return; }
    if (k === 'r') { dummies.forEach((d) => d.reset()); toast('Dummies reset'); return; }
    if (k === 'f') { state.focus = (state.focus + 1) % dummies.length; renderChips(); if (state.panel === 'creator') openCreatorFor(); return; }
    if (k === 'c') { openPanel('creator'); return; }
    if (k === 'n') { settings.names = !settings.names; saveSettings(); return; }
    keys[k] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { Object.keys(keys).forEach((k) => { keys[k] = false; }); pointer.down = false; releaseGrab(); });

  /* ------------------------------------------------------------------
     21. Camera
     ------------------------------------------------------------------ */
  const cam = { theta: 0.42, phi: 1.24, radius: 6.5, radiusGoal: 5.6, target: new THREE.Vector3(0, 1, 0), saved: null };
  const camGoal = new THREE.Vector3();
  function updateCamera(dt) {
    const d = focusedDummy();
    if (keys.q || keys.arrowleft) cam.theta += dt * 1.6;
    if (keys.e || keys.arrowright) cam.theta -= dt * 1.6;
    if (keys.arrowup) cam.phi = clamp(cam.phi - dt * 1.2, 0.2, 1.53);
    if (keys.arrowdown) cam.phi = clamp(cam.phi + dt * 1.2, 0.2, 1.53);
    if (state.panel === 'creator' && d) {
      const hp = d.headPos(); camGoal.set(hp.x, hp.y - 0.12, hp.z);
    } else if (settings.follow && d) {
      const c = d.parts.chest.body.position; camGoal.set(c.x, clamp(c.y, 0.7, 8), c.z);
    } else camGoal.set(0, 1, 0);
    cam.target.lerp(camGoal, 1 - Math.exp(-dt * 4));
    cam.radius = lerp(cam.radius, cam.radiusGoal, 1 - Math.exp(-dt * 8));
    const r = cam.radius, s = Math.sin(cam.phi);
    camera.position.set(cam.target.x + r * s * Math.sin(cam.theta), cam.target.y + r * Math.cos(cam.phi), cam.target.z + r * s * Math.cos(cam.theta));
    if (camera.position.y < 0.15) camera.position.y = 0.15;
    if (state.shake > 0.001) {
      const k = state.shake * 0.22;
      camera.position.x += rand(-k, k); camera.position.y += rand(-k, k) * 0.7; camera.position.z += rand(-k, k);
      state.shake *= Math.exp(-dt * 5);
    }
    camera.lookAt(cam.target);
  }
  function updateViewOffset() {
    const W = window.innerWidth, H = window.innerHeight;
    if (state.panel && W > 720) camera.setViewOffset(W, H, (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 368) / 2 + 6, 0, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------------
     22. UI: chips, panels, creator, library, world, settings
     ------------------------------------------------------------------ */
  const toolbar = $('#toolbar');
  function renderToolbar() {
    toolbar.innerHTML = TOOLS.map((t) => `<button class="tool" data-tool="${t.id}" title="${t.name} (${t.key})"><span class="tool-key">${t.key}</span><span class="tool-icon">${t.icon}</span><span class="tool-name">${t.name}</span></button>`).join('');
    toolbar.addEventListener('click', (e) => { const b = e.target.closest('.tool'); if (b) { Sound.init(); setTool(b.dataset.tool); } });
    setTool(state.tool);
  }

  const chipsEl = $('#chips');
  function renderChips() {
    chipsEl.innerHTML = dummies.map((d, i) => {
      const col = d.params.type === 'robot' ? '#b9bec8' : d.params.type === 'crash' ? '#f2c21b' : d.params.skin;
      return `<div class="chip ${i === state.focus ? 'focused' : ''}" data-i="${i}" role="button" tabindex="0" title="Select ${escapeHtml(d.params.name)}"><span class="dot" style="background:${col}"></span>${escapeHtml(d.params.name)}${dummies.length > 1 ? `<button class="x" data-rm="${i}" aria-label="Remove ${escapeHtml(d.params.name)}">✕</button>` : ''}</div>`;
    }).join('') + (dummies.length < DUMMY_BITS.length ? '<button class="chip add" data-add="1" title="Add a random dummy">+ Add dummy</button>' : '');
  }
  chipsEl.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); removeDummy(dummies[+rm.dataset.rm]); return; }
    if (e.target.closest('[data-add]')) { spawnDummy(Math.random() < 0.7 ? randomCharacter() : pick(PRESETS)); return; }
    const c = e.target.closest('.chip');
    if (c && c.dataset.i !== undefined) { state.focus = +c.dataset.i; renderChips(); if (state.panel === 'creator') openCreatorFor(); }
  });
  chipsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('chip')) e.target.click(); });

  const panel = $('#panel');
  const PANEL_TITLES = { creator: 'Character creator', library: 'Character library', world: 'Environments', settings: 'Settings' };
  function openPanel(name) {
    if (state.panel === name) { closePanel(); return; }
    const wasCreator = state.panel === 'creator';
    state.panel = name;
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
    $('#panel-title').textContent = PANEL_TITLES[name];
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('show', v.dataset.view === name));
    document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    if (wasCreator && name !== 'creator') leaveCreator();
    if (name === 'creator') openCreatorFor();
    if (name === 'library') renderLibrary();
    if (name === 'world') renderWorld();
    if (name === 'settings') renderSettings();
    updateViewOffset();
  }
  function closePanel() {
    if (!state.panel) return;
    if (state.panel === 'creator') leaveCreator();
    state.panel = null;
    panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('[data-panel]').forEach((b) => b.classList.remove('active'));
    updateViewOffset();
  }
  document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => { Sound.init(); openPanel(b.dataset.panel); }));
  $('#panel-close').addEventListener('click', closePanel);

  const segBtns = (opts, cur) => Object.entries(opts).map(([k, v]) => `<button type="button" data-val="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('');
  const swatches = (list, cur) => list.map((c) => `<button type="button" class="sw ${c.toLowerCase() === String(cur).toLowerCase() ? 'on' : ''}" data-val="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('');
  const options = (opts, cur) => Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
  const sliderRow = (key, label, val) => `<div class="slider"><label for="s-${key}">${label}</label><input id="s-${key}" type="range" min="0" max="1" step="0.01" data-key="${key}" value="${val}"><output>${Math.round(val * 100)}</output></div>`;

  let edit = null, rebuildTimer = 0;
  function openCreatorFor() {
    const d = focusedDummy(); if (!d) return;
    d.reset();
    if (!cam.saved) cam.saved = { theta: cam.theta, phi: cam.phi, radius: cam.radiusGoal };
    cam.theta = 0.12; cam.phi = 1.42; cam.radiusGoal = 1.55;
    renderCreator();
  }
  function leaveCreator() {
    if (cam.saved) { cam.theta = cam.saved.theta; cam.phi = cam.saved.phi; cam.radiusGoal = cam.saved.radius; cam.saved = null; }
  }
  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { const d = focusedDummy(); if (d && edit) { d.rebuild(edit); renderChips(); } }, 70);
  }
  function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; }
  function renderCreator() {
    const d = focusedDummy(); if (!d) return;
    edit = deepClone(d.params);
    const P = edit, human = P.type === 'human', custom = P.type === 'human' || P.type === 'alien';
    const faceSliders = FACE_KEYS.map(([k, l]) => sliderRow('face.' + k, l, P.face[k])).join('');
    $('#view-creator').innerHTML = `
      <div class="field"><label for="c-name">Name above the head</label><input id="c-name" type="text" maxlength="24" value="${escapeHtml(P.name)}" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label>Type</label><div class="seg" data-key="type">${segBtns(TYPES, P.type)}</div></div>
      <div class="field ${custom ? '' : 'disabled'}"><label>Body</label><div class="seg" data-key="body">${segBtns({ male: 'Male', female: 'Female' }, P.body)}</div></div>
      <div class="field ${custom ? '' : 'disabled'}"><label>Skin tone</label><div class="swatches" data-key="skin">${swatches(P.type === 'alien' ? FANTASY_SKINS : SKINS, P.skin)}<input type="color" data-key="skin" value="${P.skin}" aria-label="Custom skin colour"></div></div>
      <div class="field ${human ? '' : 'disabled'}"><label for="c-hair">Hairstyle</label><select id="c-hair" data-key="hair">${options(HAIRSTYLES, P.hair)}</select></div>
      <div class="field ${human ? '' : 'disabled'}"><label>Hair colour</label><div class="swatches" data-key="hairColor">${swatches(HAIR_COLORS, P.hairColor)}</div></div>
      <div class="field ${human ? '' : 'disabled'}"><label for="c-facial">Facial hair</label><select id="c-facial" data-key="facial">${options(FACIAL, P.facial)}</select></div>
      <div class="field ${human ? '' : 'disabled'}"><label>Eye colour</label><div class="swatches" data-key="eyeColor">${swatches(EYE_COLORS, P.eyeColor)}</div></div>
      <details class="fold" ${custom ? 'open' : ''}><summary>Face shape</summary>${faceSliders}</details>
      <details class="fold" open><summary>Body</summary>${sliderRow('height', 'Height', P.height)}${sliderRow('build', 'Build', P.build)}</details>
      <div class="field ${custom ? '' : 'disabled'}"><label for="c-outfit">Outfit</label><select id="c-outfit" data-key="outfit">${options(OUTFITS, P.outfit)}</select></div>
      <div class="field ${human ? '' : 'disabled'}"><label for="c-hat">Hat</label><select id="c-hat" data-key="hat">${options(HATS, P.hat)}</select></div>
      <div class="field colors ${custom ? '' : 'disabled'}">
        <label><input type="color" data-key="shirt" value="${P.shirt}">Top</label>
        <label><input type="color" data-key="pants" value="${P.pants}">Bottoms</label>
        <label><input type="color" data-key="shoes" value="${P.shoes}">Shoes</label>
        <label><input type="color" data-key="hatColor" value="${P.hatColor}">Hat</label>
      </div>
      <details class="fold" ${P.modelId ? 'open' : ''}><summary>Realistic 3D model</summary>
        <p class="muted" style="margin:0 0 10px">Upload a rigged humanoid character as a .glb file, for example a Mixamo character exported from Blender. The ragdoll drives its skeleton, so it flops, flies and gets back up like any other dummy.</p>
        <div class="row" style="margin-bottom:10px"><label class="btn" for="c-model" role="button" tabindex="0">${P.modelId ? 'Replace .glb model' : 'Upload .glb model'}</label><input id="c-model" type="file" accept=".glb,model/gltf-binary" hidden>${P.modelId ? '<button class="btn" data-do="rmodel">Remove model</button>' : ''}</div>
        ${P.modelId ? `<p class="muted" style="margin:0 0 10px">Using ${escapeHtml(P.modelName || 'a custom model')}. Face, hair and outfit settings apply when you remove it.</p>` : ''}
      </details>
      <div class="row" style="margin:14px 0 8px">
        <button class="btn" data-do="rface">Random face</button>
        <button class="btn" data-do="rall">Random character</button>
      </div>
      <div class="row">
        <button class="btn" data-do="save">Save to library</button>
        <button class="btn primary" data-do="done">Done</button>
      </div>`;
  }
  const creatorEl = $('#view-creator');
  creatorEl.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('label[for="c-model"]')) { e.preventDefault(); $('#c-model').click(); } });
  creatorEl.addEventListener('input', (e) => {
    const t = e.target, key = t.dataset.key;
    if (t.id === 'c-name') { const d = focusedDummy(); edit.name = t.value; d.setName(t.value); renderChips(); return; }
    if (!key || !edit) return;
    if (t.type === 'range') { setPath(edit, key, parseFloat(t.value)); const out = t.parentElement.querySelector('output'); if (out) out.textContent = Math.round(t.value * 100); scheduleRebuild(); return; }
    if (t.type === 'color') { setPath(edit, key, t.value); scheduleRebuild(); }
  });
  creatorEl.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'c-model') {
      const file = t.files && t.files[0]; if (!file || !edit) return;
      if (file.size > 80 * 1024 * 1024) { toast('That file is over 80 MB. Try a lighter model.'); return; }
      const buf = await file.arrayBuffer();
      const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
      if (magic !== 'glTF') { toast('That isn’t a .glb file. Export your character as glTF Binary (.glb).'); return; }
      const id = 'm' + Date.now().toString(36) + (hashStr(file.name + file.size) % 1e6).toString(36);
      modelMem.set(id, buf);
      ModelStore.put(id, buf).catch(() => toast('Loaded for this visit only. Your browser blocked saving the model.'));
      edit.modelId = id; edit.modelName = file.name;
      const d = focusedDummy(); d.rebuild(edit); renderCreator(); renderChips();
      toast(`Loading ${file.name}…`);
      return;
    }
    if (t.tagName === 'SELECT' && t.dataset.key) { edit[t.dataset.key] = t.value; scheduleRebuild(); }
  });
  creatorEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !edit) return;
    const seg = b.closest('[data-key]');
    if (b.dataset.val && seg) {
      const key = seg.dataset.key;
      edit[key] = b.dataset.val;
      if (key === 'type' && b.dataset.val === 'alien' && !FANTASY_SKINS.includes(edit.skin)) edit.skin = FANTASY_SKINS[0];
      if (key === 'type' && b.dataset.val === 'human' && !SKINS.includes(edit.skin)) edit.skin = SKINS[4];
      seg.querySelectorAll('[data-val]').forEach((x) => x.classList.toggle('on', x === b));
      const d = focusedDummy(); d.rebuild(edit); renderChips();
      if (key === 'type') renderCreator();
      Sound.tick();
      return;
    }
    const act = b.dataset.do, d = focusedDummy();
    if (act === 'rmodel') { edit.modelId = null; edit.modelName = ''; d.rebuild(edit); renderCreator(); return; }
    if (act === 'rface') { edit.face = randomFace(); d.rebuild(edit); renderCreator(); }
    if (act === 'rall') { const keepName = edit.name; edit = randomCharacter(); edit.name = keepName; d.rebuild(edit); renderCreator(); renderChips(); }
    if (act === 'save') {
      const lib = store.get(LIB_KEY, []); lib.unshift(deepClone(d.params)); store.set(LIB_KEY, lib.slice(0, 40));
      toast(`Saved ${d.params.name} to your library`);
    }
    if (act === 'done') closePanel();
  });

  // Thumbnails: render a head into an offscreen target with the main renderer.
  let thumbRig = null;
  const thumbCache = new Map();
  function renderThumb(params) {
    const P = normalizeParams(params), key = JSON.stringify(P);
    if (thumbCache.has(key)) return thumbCache.get(key);
    const S = 160;
    if (!thumbRig) {
      const rt = new THREE.WebGLRenderTarget(S, S); rt.texture.encoding = THREE.sRGBEncoding;
      const sc = new THREE.Scene(); sc.environment = scene.environment;
      const k1 = new THREE.DirectionalLight(0xffffff, 2.2); k1.position.set(1, 1.5, 2); sc.add(k1);
      const k2 = new THREE.DirectionalLight(0xb48cff, 1.8); k2.position.set(-2, 1, -1.5); sc.add(k2);
      sc.add(new THREE.HemisphereLight(0xffffff, 0x302840, 0.5));
      thumbRig = { rt, sc, cam: new THREE.PerspectiveCamera(26, 1, 0.05, 10), cv: makeCanvas(S), buf: new Uint8Array(S * S * 4) };
    }
    const T = thumbRig, M = makeMats(P), H = buildHead(P, M);
    T.sc.add(H.group);
    const r = H.radius;
    T.cam.position.set(r * 1.4, r * 0.5, r * 6.6); T.cam.lookAt(0, -r * 0.05, 0);
    const prevClear = renderer.getClearColor(new THREE.Color()).getHex(), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(T.rt); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(T.sc, T.cam);
    renderer.readRenderTargetPixels(T.rt, 0, 0, S, S, T.buf);
    renderer.setRenderTarget(null); renderer.setClearColor(prevClear, prevAlpha);
    T.sc.remove(H.group); disposeObj(H.group); disposeMatsAndTex(M);
    const g = T.cv.getContext('2d'), img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) { const src = (S - 1 - y) * S * 4; img.data.set(T.buf.subarray(src, src + S * 4), y * S * 4); }
    g.putImageData(img, 0, 0);
    const url = T.cv.toDataURL('image/png');
    thumbCache.set(key, url);
    return url;
  }
  function libParams(id) {
    if (id[0] === 'p') return PRESETS[+id.slice(1)];
    return store.get(LIB_KEY, [])[+id.slice(1)];
  }
  const card = (p, id, del) => `<div class="card" data-id="${id}"><div class="thumb"><img alt="${escapeHtml(p.name)}" data-thumb="${id}"></div>
      <div class="card-name">${escapeHtml(p.name)}<small>${escapeHtml(p.look || TYPES[p.type] || '')}</small></div>
      <div class="card-actions"><button class="btn sm" data-act="load" title="Replace the selected dummy">Use</button><button class="btn sm" data-act="spawn" title="Add as a new dummy">Add</button>${del ? '<button class="btn sm icon danger" data-act="del" aria-label="Delete">✕</button>' : ''}</div></div>`;
  let thumbJob = 0;
  function renderLibrary() {
    const saved = store.get(LIB_KEY, []).map(normalizeParams);
    $('#view-library').innerHTML = `
      <h3 class="sub">Your characters</h3>
      ${saved.length ? `<div class="cards">${saved.map((p, i) => card(p, 's' + i, true)).join('')}</div>` : '<p class="muted" style="margin:0 0 18px">Characters you save from the creator appear here, ready to load into any scene.</p>'}
      <h3 class="sub">Presets</h3>
      <div class="cards">${PRESETS.map((p, i) => card(p, 'p' + i, false)).join('')}</div>`;
    const imgs = [...document.querySelectorAll('#view-library img[data-thumb]')];
    const job = ++thumbJob;
    (async () => {
      for (const img of imgs) {
        if (job !== thumbJob) return;
        await nextFrame();
        try { const p = libParams(img.dataset.thumb); if (p) { img.src = renderThumb(p); img.classList.add('ready'); } } catch (err) { console.warn('Thumbnail failed', err); }
      }
    })();
  }
  $('#view-library').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.card').dataset.id, p = libParams(id); if (!p) return;
    if (b.dataset.act === 'load') { const d = focusedDummy(); d.rebuild(p); d.reset(); renderChips(); toast(`Loaded ${p.name}`); }
    if (b.dataset.act === 'spawn') { if (spawnDummy(p)) toast(`Added ${p.name}`); }
    if (b.dataset.act === 'del') { const lib = store.get(LIB_KEY, []); lib.splice(+id.slice(1), 1); store.set(LIB_KEY, lib); renderLibrary(); toast('Deleted from library'); }
  });

  function renderWorld() {
    $('#view-world').innerHTML = Object.entries(ENVS).map(([id, E]) => `
      <button class="env-card ${id === state.envId ? 'on' : ''}" data-env="${id}">
        <div class="env-prev" style="background:${E.sky};--floor:${E.floor}"></div>
        <div class="env-info"><b>${E.name}</b><span>${E.desc}</span></div>
      </button>`).join('') + '<p class="muted">Switching worlds clears spawned props and resets every dummy.</p>';
  }
  $('#view-world').addEventListener('click', (e) => {
    const b = e.target.closest('[data-env]'); if (!b) return;
    setEnvironment(b.dataset.env); toast(`Welcome to the ${ENVS[b.dataset.env].name.toLowerCase()}`);
  });

  const toggleRow = (key, label) => `<label class="toggle"><input type="checkbox" data-set="${key}" ${settings[key] ? 'checked' : ''}><span class="track"><i></i></span><span>${label}</span></label>`;
  function renderSettings() {
    const g = (-world.gravity.y).toFixed(1);
    $('#view-settings').innerHTML = `
      <div class="group"><h3 class="sub">Graphics</h3>
        <div class="field"><label>Quality</label><div class="seg" data-set="quality">${segBtns({ low: 'Low', medium: 'Medium', high: 'High' }, settings.quality)}</div></div>
        ${toggleRow('showFps', 'Show frame rate')}
      </div>
      <div class="group"><h3 class="sub">Sound</h3>
        <div class="slider"><label for="set-vol">Volume</label><input id="set-vol" type="range" min="0" max="1" step="0.01" data-set="volume" value="${settings.volume}"><output>${Math.round(settings.volume * 100)}</output></div>
        ${toggleRow('muted', 'Mute all sound')}
      </div>
      <div class="group"><h3 class="sub">Simulation</h3>
        <div class="slider"><label for="set-grav">Gravity (m/s²)</label><input id="set-grav" type="range" min="0" max="25" step="0.1" data-set="gravity" value="${g}"><output>${g}</output></div>
        ${toggleRow('slowmo', 'Slow motion')}
        ${toggleRow('getUp', 'Dummies get back up')}
        ${toggleRow('names', 'Show names above heads')}
        ${toggleRow('follow', 'Camera follows the selected dummy')}
        <div class="row" style="margin-top:10px"><button class="btn" data-do="clear">Clear spawned props</button><button class="btn" data-do="reset">Reset scene</button></div>
      </div>
      <p class="credits">Built with three.js and cannon.js (both MIT licensed). Characters, textures, environments and sound effects are all generated in code, so there are no third-party art assets to credit.</p>`;
  }
  const settingsEl = $('#view-settings');
  settingsEl.addEventListener('input', (e) => {
    const t = e.target, k = t.dataset.set; if (!k) return;
    if (t.type === 'range') {
      const v = parseFloat(t.value); const out = t.parentElement.querySelector('output');
      if (k === 'volume') { settings.volume = v; Sound.applyVolume(); if (out) out.textContent = Math.round(v * 100); }
      if (k === 'gravity') { world.gravity.set(0, -v, 0); if (out) out.textContent = v.toFixed(1); return; }
    }
    if (t.type === 'checkbox') { settings[k] = t.checked; if (k === 'muted') Sound.applyVolume(); if (k === 'showFps') $('#fps').classList.toggle('show', t.checked); }
    saveSettings();
  });
  settingsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const seg = b.closest('[data-set]');
    if (seg && b.dataset.val) { settings.quality = b.dataset.val; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); saveSettings(); applyQuality(); return; }
    if (b.dataset.do === 'clear') { clearDynamic(false); toast('Cleared spawned props'); }
    if (b.dataset.do === 'reset') { resetScene(); toast('Scene reset'); }
  });

  function togglePause() {
    state.paused = !state.paused;
    $('#paused').classList.toggle('show', state.paused);
    $('#btn-pause').textContent = state.paused ? '▶' : '❚❚';
    $('#btn-pause').setAttribute('aria-label', state.paused ? 'Resume' : 'Pause');
  }
  $('#btn-pause').addEventListener('click', togglePause);
  $('#btn-reset').addEventListener('click', () => { resetScene(); toast('Scene reset'); });
  function showHelp() { $('#help').classList.remove('hidden'); $('#help-close').focus(); }
  function hideHelp() { $('#help').classList.add('hidden'); store.set('wmg.seenHelp', true); Sound.init(); }
  $('#btn-help').addEventListener('click', showHelp);
  $('#help-close').addEventListener('click', hideHelp);
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') hideHelp(); });

  function basePixelRatio() {
    const q = settings.quality, dpr = window.devicePixelRatio || 1;
    return q === 'low' ? Math.min(0.85, dpr) : q === 'medium' ? Math.min(1, dpr) : Math.min(1.5, dpr);
  }
  function applyQuality() {
    const q = settings.quality;
    renderer.setPixelRatio(basePixelRatio());
    renderer.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const shadows = q !== 'low';
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    }
    const ms = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    state.particleMul = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    onResize();
  }
  function onResize() {
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    updateViewOffset();
    const scale = (H * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    if (fxAdd) { fxAdd.mat.uniforms.uScale.value = scale; fxSmoke.mat.uniforms.uScale.value = scale; }
  }
  window.addEventListener('resize', onResize);

  /* ------------------------------------------------------------------
     23. Main loop
     ------------------------------------------------------------------ */
  function applyForces() {
    dummies.forEach((d) => d.stand());
    if (wells.length) wellForces();
  }
  function updateProps(dt) {
    for (let i = props.length - 1; i >= 0; i--) {
      const r = props[i];
      if (r.removed) { props.splice(i, 1); continue; }
      if (r.life !== Infinity) {
        r.life -= dt;
        if (r.life < 1) r.mesh.scale.setScalar(r.size * 2 * Math.max(0.01, r.life));
        if (r.life <= 0) { removeProp(r); props.splice(i, 1); continue; }
      }
      const p = r.body.position;
      if (p.y < -20 || Math.abs(p.x) > 110 || Math.abs(p.z) > 110) { removeProp(r); props.splice(i, 1); continue; }
      syncProp(r);
    }
  }
  function guardDummies() {
    dummies.forEach((d) => {
      const pel = d.parts.pelvis.body.position;
      if (pel.y < -10 || Math.abs(pel.x) > 90 || Math.abs(pel.z) > 90) { d.reset(); comic('RESPAWN!', d.headPos(), 'small'); return; }
      Object.values(d.parts).forEach((p) => {
        const v = p.body.velocity, s = v.norm();
        if (s > 45) { const k = 45 / s; v.x *= k; v.y *= k; v.z *= k; }
      });
    });
  }
  function updateLabels() {
    const W = window.innerWidth, H = window.innerHeight, fd = focusedDummy();
    dummies.forEach((d) => {
      const el = d.label;
      if (!settings.names) { el.style.display = 'none'; return; }
      const hp = d.headPos();
      tmpV.set(hp.x, hp.y + d.dims.hr + 0.17, hp.z).project(camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.3 || Math.abs(tmpV.y) > 1.3) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * H - 8).toFixed(1)}px) translate(-50%, -100%)`;
      el.classList.toggle('focused', d === fd && dummies.length > 1);
    });
  }

  let last = performance.now(), fpsAcc = 0, fpsFrames = 0, physAcc = 0, lastScoreUi = 0;
  const perf = { acc: 0, frames: 0 };
  const scoreEl = $('#score'), fpsEl = $('#fps');
  function frame(now) {
    requestAnimationFrame(frame);
    if (state.inMenu) { last = now; return; }
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const creatorFreeze = state.panel === 'creator';
    const active = !state.paused && !creatorFreeze;
    const ts = settings.slowmo ? 0.3 : 1;
    const simDt = active ? realDt * ts : 0;
    if (active) {
      physAcc = Math.min(physAcc + realDt, 4 / 60);
      const h = (1 / 60) * ts;
      while (physAcc >= 1 / 60) { applyForces(); world.step(h); state.simTime += h; physAcc -= 1 / 60; }
      processPending(simDt);
      updateProjectiles(simDt);
      updateWells(simDt);
      updateProps(simDt);
      updateFx(simDt);
      fxAdd.update(simDt); fxSmoke.update(simDt);
      guardDummies();
      if (pointer.down && state.tool === 'blaster') {
        pointer.fireCD -= realDt;
        if (pointer.fireCD <= 0) { fireTool('blaster'); pointer.fireCD = 0.11; }
      }
    }
    dummies.forEach((d) => { d.update(simDt, realDt); d.sync(); });
    updateGrabLine();
    updateCamera(realDt);
    updateLabels();
    if (scoreDirty && now - lastScoreUi > 160) { lastScoreUi = now; scoreEl.textContent = state.score.toLocaleString(); scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump'); scoreDirty = false; }
    renderer.render(scene, camera);
    perf.acc += realDt; perf.frames++;
    if (perf.acc >= 1.2) {
      const fps = perf.frames / perf.acc, cap = basePixelRatio();
      let pr = renderer.getPixelRatio();
      if (fps < 48 && pr > 0.6) pr = Math.max(0.6, pr - 0.15);
      else if (fps > 58 && pr < cap) pr = Math.min(cap, pr + 0.1);
      if (Math.abs(pr - renderer.getPixelRatio()) > 0.01) { renderer.setPixelRatio(pr); onResize(); }
      perf.acc = 0; perf.frames = 0;
    }
    if (settings.showFps) {
      fpsAcc += realDt; fpsFrames++;
      if (fpsAcc > 0.5) { fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} fps`; fpsAcc = 0; fpsFrames = 0; }
    }
  }

  /* ------------------------------------------------------------------
     25. Sessions + bridge to the main menu
     ------------------------------------------------------------------ */
  const SAVE_KEY = 'wmg.session';
  let engineReady = false, readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  function snapshot() {
    return { v: 1, env: state.envId, score: state.score, focus: state.focus, dummies: dummies.map((d) => deepClone(d.params)), time: Date.now() };
  }
  function saveNow() {
    if (!engineReady || state.inMenu || !dummies.length) return;
    store.set(SAVE_KEY, snapshot());
  }
  function getSave() {
    const s = store.get(SAVE_KEY, null);
    return s && Array.isArray(s.dummies) && s.dummies.length ? s : null;
  }
  function clearDummies() { dummies.slice().forEach((d) => d.destroy()); dummies.length = 0; state.focus = 0; }
  function resetCamera() { cam.theta = 0.42; cam.phi = 1.24; cam.radius = 6.5; cam.radiusGoal = 5.6; cam.saved = null; }
  function enterGame() {
    state.inMenu = false;
    if (state.paused) togglePause();
    last = performance.now();
    onResize();
    if (!store.get('wmg.seenHelp', false)) showHelp();
  }
  function startNew() {
    closePanel();
    clearDummies();
    setEnvironment(ENVS[settings.defaultWorld] ? settings.defaultWorld : 'lab');
    spawnDummy(PRESETS[0]);
    state.focus = 0; renderChips();
    state.score = 0; scoreDirty = true;
    resetCamera();
    enterGame();
    if (settings.autosave) saveNow();
  }
  function resume() {
    const s = getSave();
    if (!s) { startNew(); return; }
    closePanel();
    clearDummies();
    setEnvironment(ENVS[s.env] ? s.env : 'lab');
    const OLD = ['Buddy', 'Marcus', 'Aiko', 'Diego', 'Priya', 'Olu', 'Freya', 'Kai', 'Amara', 'Lars', 'Zorp', 'Bolt-9', 'Crash'].concat(NAMES);
    s.dummies.slice(0, DUMMY_BITS.length).forEach((p) => { if (OLD.includes(p.name)) p.name = 'MyGuyVR'; spawnDummy(p); });
    state.focus = clamp(s.focus | 0, 0, dummies.length - 1); renderChips();
    state.score = s.score | 0; scoreDirty = true;
    resetCamera();
    enterGame();
  }
  function toMenu() {
    if (settings.autosave) saveNow();
    closePanel(); hideHelp();
    pointer.down = false; releaseGrab();
    state.inMenu = true;
    if (window.WMGMenu) window.WMGMenu.show();
  }
  function applySettings(next) {
    Object.assign(settings, next);
    saveSettings();
    Sound.applyVolume();
    if (engineReady) applyQuality();
    $('#fps').classList.toggle('show', !!settings.showFps);
    if (state.panel === 'settings') renderSettings();
  }
  $('#btn-menu').addEventListener('click', toMenu);
  setInterval(() => { if (settings.autosave) saveNow(); }, 5000);
  window.addEventListener('pagehide', () => { if (settings.autosave) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && settings.autosave) saveNow(); });
  window.WMG = {
    ready, startNew, resume, getSave, toMenu, applySettings,
    clearSave: () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } },
    getSettings: () => deepClone(settings),
    worlds: Object.fromEntries(Object.entries(ENVS).map(([k, v]) => [k, v.name])),
    initSound: () => Sound.init(),
  };

  /* ------------------------------------------------------------------
     24. Boot
     ------------------------------------------------------------------ */
  async function init() {
    setLoading('Generating textures…'); await nextFrame();
    makeTextures();
    makeShared();
    setLoading('Lighting the test lab…'); await nextFrame();
    scene.environment = buildEnvMap();
    fxAdd = new Particles(3000, true);
    fxSmoke = new Particles(1000, false);
    setLoading('Building your dummy…'); await nextFrame();
    setEnvironment('lab');
    spawnDummy(PRESETS[0]);
    state.focus = 0;
    renderToolbar();
    renderChips();
    $('#fps').classList.toggle('show', settings.showFps);
    applyQuality();
    renderer.compile(scene, camera);
    loadingEl.classList.add('hide');
    requestAnimationFrame((t) => { last = t; frame(t); });
    engineReady = true;
    readyResolve();
  }
  window.addEventListener('error', (e) => { console.error(e.error || e.message); });
  init().catch((err) => { console.error(err); fatal('The simulator hit an error while starting: ' + (err && err.message ? err.message : err)); });
})();
