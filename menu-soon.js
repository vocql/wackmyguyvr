/* Wack MyGuyVR — coming soon menu (reuses the original menu look) */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const menu = $('#menu');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===== EDIT THESE ===== */
  // Your GitHub Release page (or paste the direct .exe asset link).
  const DOWNLOAD_URL = 'https://github.com/vocql/wackmyguyvr/releases/latest';
  const DEMO_URL = 'play-single-file.html';
  /* ====================== */

  let actx = null, lastBlip = 0;
  function blip(f1, f2, dur, type) {
    const now = performance.now(); if (now - lastBlip < 40) return; lastBlip = now;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { /* audio unavailable */ }
  }

  /* ---------- floating background shapes ---------- */
  const SHAPES = [
    { t: 'circle', c: '#FFD633', x: '4%', y: '10%', s: 64 }, { t: 'ring', c: '#4099F0', x: '40%', y: '5%', s: 70 },
    { t: 'star', c: '#FF8B18', x: '88%', y: '8%', s: 78 }, { t: 'squiggle', c: '#FFFFFF', x: '58%', y: '14%', s: 110 },
    { t: 'tri', c: '#EB469F', x: '93%', y: '46%', s: 64 }, { t: 'circle', c: '#EB469F', x: '46%', y: '82%', s: 44 },
    { t: 'plus', c: '#FFD633', x: '36%', y: '42%', s: 40 }, { t: 'dot', c: '#FFFFFF', x: '12%', y: '74%', s: 16 },
    { t: 'dot', c: '#FFFFFF', x: '70%', y: '90%', s: 12 }, { t: 'ring', c: '#FFD633', x: '82%', y: '80%', s: 56 },
    { t: 'star', c: '#4099F0', x: '3%', y: '52%', s: 52 }, { t: 'squiggle', c: '#FF8B18', x: '20%', y: '90%', s: 96 },
    { t: 'circle', c: '#4099F0', x: '66%', y: '58%', s: 30 }, { t: 'dot', c: '#FFD633', x: '52%', y: '30%', s: 14 },
    { t: 'plus', c: '#EB469F', x: '28%', y: '6%', s: 34 }, { t: 'tri', c: '#FFD633', x: '96%', y: '22%', s: 40 },
  ];
  function shapeSVG(t, c) {
    if (t === 'star') return `<svg viewBox="0 0 100 100"><path d="M50 4 L62 36 L96 38 L69 59 L79 93 L50 73 L21 93 L31 59 L4 38 L38 36 Z" fill="${c}" stroke="#080808" stroke-width="7" stroke-linejoin="round"/></svg>`;
    if (t === 'tri') return `<svg viewBox="0 0 100 100"><path d="M50 8 L94 88 L6 88 Z" fill="${c}" stroke="#080808" stroke-width="8" stroke-linejoin="round"/></svg>`;
    if (t === 'squiggle') return `<svg viewBox="0 0 120 40"><path d="M6 24 Q18 4 30 20 T54 20 T78 20 T102 20 T114 16" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/></svg>`;
    if (t === 'plus') return `<svg viewBox="0 0 100 100"><path d="M38 6 h24 v32 h32 v24 h-32 v32 h-24 v-32 h-32 v-24 h32 z" fill="${c}" stroke="#080808" stroke-width="7" stroke-linejoin="round"/></svg>`;
    return '';
  }
  const bg = $('#menu-bg');
  bg.innerHTML = SHAPES.map((s, i) => {
    const d = 6 + (i % 5) * 1.7, fx = ((i * 37) % 30) - 15, fy = -14 - ((i * 13) % 22), spin = (i % 2 ? 1 : -1) * (10 + (i * 7) % 25), r = (i * 29) % 360;
    return `<div class="shape ${s.t}" style="--x:${s.x};--y:${s.y};--s:${s.s}px;--c:${s.c};--d:${d}s;--dl:${-i * 0.7}s;--fx:${fx}px;--fy:${fy}px;--spin:${spin}deg;--r:${r}deg">${shapeSVG(s.t, s.c)}</div>`;
  }).join('');

  /* ---------- mascot idle life ---------- */
  const mascot = $('#mascot');
  const pupils = [...mascot.querySelectorAll('.m-pupil')];
  const bubble = $('#m-bubble');
  const LINES = ['Ready when you are!', 'Stay cool.', 'Quack.', 'Hey, mind the shades!', 'Try the demo!', 'Too cool to wack.', 'Do your worst!'];
  let lineIdx = 0;
  function blinkLoop() {
    if (!menu.classList.contains('gone')) {
      mascot.classList.add('blink');
      setTimeout(() => mascot.classList.remove('blink'), 130);
      if (Math.random() < 0.25) setTimeout(() => { mascot.classList.add('blink'); setTimeout(() => mascot.classList.remove('blink'), 120); }, 260);
    }
    setTimeout(blinkLoop, 2200 + Math.random() * 3200);
  }
  setTimeout(blinkLoop, 1800);
  menu.addEventListener('pointermove', (e) => {
    const r = mascot.getBoundingClientRect();
    const kx = r.width / 600, ky = r.height / 620;
    pupils.forEach((p) => {
      const ex = r.left + (+p.dataset.cx) * kx, ey = r.top + (+p.dataset.cy) * ky;
      const dx = e.clientX - ex, dy = e.clientY - ey, dist = Math.hypot(dx, dy) || 1, k = Math.min(1, dist / 260);
      const mx = +p.dataset.max || 15;
      p.setAttribute('transform', `translate(${((dx / dist) * mx * k).toFixed(1)} ${((dy / dist) * mx * 1.15 * k).toFixed(1)})`);
    });
  });
  mascot.addEventListener('click', () => {
    mascot.classList.remove('squish'); void mascot.getBoundingClientRect(); mascot.classList.add('squish');
    lineIdx = (lineIdx + 1 + Math.floor(Math.random() * (LINES.length - 1))) % LINES.length;
    bubble.textContent = LINES[lineIdx];
    bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
    blip(320, 760, 0.16, 'square');
    setTimeout(() => blip(540, 260, 0.14, 'square'), 90);
  });
  mascot.addEventListener('animationend', (e) => { if (e.animationName === 'squish') mascot.classList.remove('squish'); });
  /* ---------- buttons ---------- */
  const btnDl = $('#m-download'), btnDemo = $('#m-demo'), note = $('#m-note');
  [btnDl, btnDemo].forEach((b) => b.addEventListener('pointerenter', () => { if (!b.disabled) blip(660, 880, 0.06); }));
  btnDemo.addEventListener('click', () => { blip(300, 900, 0.18, 'square'); setTimeout(() => { location.href = DEMO_URL; }, 120); });
  btnDl.addEventListener('click', () => { if (btnDl.disabled) return; blip(420, 980, 0.2, 'square'); location.href = DOWNLOAD_URL; });

  note.textContent = 'Download the full game or try the free demo.';
  setTimeout(() => menu.classList.remove('intro'), 1600);
})();
