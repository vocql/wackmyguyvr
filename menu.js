/* =====================================================================
   Wack MyGuyVR — main menu
   Talks to the simulator only through window.WMG (defined in script.js).
   ===================================================================== */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const menu = $('#menu');
  if (!menu) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const api = () => window.WMG;

  const WORLD_NAMES = { lab: 'Test lab', arena: 'Neon arena', desert: 'Desert range', moon: 'Moon base' };
  const DEFAULTS = { quality: 'high', volume: 0.7, muted: false, names: true, getUp: true, slowmo: false, showFps: false, follow: true, defaultWorld: 'lab', autosave: true };

  /* ---------- settings + save access (works even if the engine failed to load) ---------- */
  function readSettings() {
    if (api()) return api().getSettings();
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('wmg.settings') || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function writeSettings(patch) {
    if (api()) { api().applySettings(patch); return; }
    try { localStorage.setItem('wmg.settings', JSON.stringify(Object.assign(readSettings(), patch))); } catch (e) { /* storage blocked */ }
  }
  function getSave() {
    if (api()) return api().getSave();
    try { const s = JSON.parse(localStorage.getItem('wmg.session') || 'null'); return s && s.dummies && s.dummies.length ? s : null; } catch (e) { return null; }
  }
  function clearSave() {
    if (api()) api().clearSave();
    else { try { localStorage.removeItem('wmg.session'); } catch (e) { /* ignore */ } }
  }
  function ago(t) {
    const s = Math.max(0, (Date.now() - (t || 0)) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago');
  }

  /* ---------- tiny menu sound ---------- */
  let actx = null, lastBlip = 0;
  function blip(f1, f2, dur, type) {
    const st = readSettings();
    if (st.muted || !st.volume) return;
    const now = performance.now(); if (now - lastBlip < 40) return; lastBlip = now;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.2 * st.volume), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
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
  const LINES = ['Ready when you are!', 'Stay cool.', 'Quack.', 'Hey, mind the shades!', 'Press START!', 'Too cool to wack.', 'Do your worst!'];
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
  const btnStart = $('#m-start'), btnResume = $('#m-resume'), btnSettings = $('#m-settings'), btnWorst = $('#m-worst');
  const resumeSub = $('#m-resume-sub'), note = $('#m-note');
  function refreshResume() {
    const s = getSave();
    btnResume.disabled = !s;
    resumeSub.textContent = s
      ? `${WORLD_NAMES[s.env] || 'Test lab'}, ${s.dummies.length} ${s.dummies.length === 1 ? 'dummy' : 'dummies'}, saved ${ago(s.time)}`
      : 'No saved session yet';
    note.textContent = readSettings().autosave ? 'Your session saves automatically on this device.' : 'Auto-save is off. Turn it on in Settings to keep your progress.';
  }
  [btnStart, btnResume, btnSettings, btnWorst].filter(Boolean).forEach((b) => b.addEventListener('pointerenter', () => { if (!b.disabled) blip(660, 880, 0.06); }));

  let busy = false;
  function hideMenu(fromEl) {
    return new Promise((res) => {
      const r = fromEl.getBoundingClientRect();
      menu.style.setProperty('--cx', (r.left + r.width / 2) + 'px');
      menu.style.setProperty('--cy', (r.top + r.height / 2) + 'px');
      menu.classList.add('is-out');
      setTimeout(() => { menu.classList.add('gone'); menu.setAttribute('aria-hidden', 'true'); menu.inert = true; res(); }, reduceMotion ? 320 : 720);
    });
  }
  function showMenu() {
    closeSettings(true);
    refreshResume();
    menu.classList.remove('gone'); menu.removeAttribute('aria-hidden'); menu.inert = false;
    requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.remove('is-out')));
    setTimeout(() => btnStart.focus({ preventScroll: true }), reduceMotion ? 50 : 500);
    busy = false;
  }
  async function launch(kind, btn) {
    if (busy || btn.disabled) return;
    busy = true;
    blip(420, 980, 0.14);
    const W = api();
    if (!W) { await hideMenu(btn); return; } // the loading screen shows why the engine is missing
    W.initSound();
    let isReady = false;
    W.ready.then(() => { isReady = true; });
    await Promise.resolve();
    const run = () => { try { if (kind === 'resume') W.resume(); else W.startNew(); } catch (err) { console.error(err); } };
    if (isReady) { run(); await hideMenu(btn); }
    else { await hideMenu(btn); await W.ready; run(); }
  }
  btnStart.addEventListener('click', () => launch('start', btnStart));
  btnResume.addEventListener('click', () => launch('resume', btnResume));
  btnSettings.addEventListener('click', () => { blip(500, 760, 0.1); openSettings(); });
  if (btnWorst) btnWorst.addEventListener('click', async () => {
    if (busy) return;
    busy = true; blip(300, 900, 0.18, 'square');
    await hideMenu(btnWorst);
    const link = document.createElement('a');
    link.href = btnWorst.dataset.href; link.target = /^https?:/.test(link.href) && !link.href.startsWith(location.origin) ? '_top' : '_self';
    document.body.appendChild(link); link.click();
    setTimeout(() => { busy = false; showMenu(); }, 1500);
  });

  /* ---------- settings panel ---------- */
  const sheet = $('#m-sheet'), body = $('#m-set-body'), btnDelete = $('#m-delete');
  const sw = (key, label, hint, checked) => `<div class="m-row"><div class="m-row-label" id="lbl-${key}">${label}${hint ? `<small>${hint}</small>` : ''}</div><label class="m-switch"><input type="checkbox" data-key="${key}" aria-labelledby="lbl-${key}" ${checked ? 'checked' : ''}><span></span></label></div>`;
  function renderSettings() {
    const s = readSettings(), vol = Math.round((s.volume || 0) * 100);
    const worlds = (api() && api().worlds) || WORLD_NAMES;
    body.innerHTML = `
      <section class="m-section" style="--c:#4099F0"><h3>Audio</h3>
        <div class="m-row"><label class="m-row-label" for="m-vol">Master volume<small id="m-vol-out">${vol}%</small></label><input class="m-range" id="m-vol" type="range" min="0" max="100" step="1" value="${vol}" data-key="volume" style="--v:${vol}%"></div>
        ${sw('sound', 'Sound effects', 'Hits, blasters, explosions and menu sounds', !s.muted)}
      </section>
      <section class="m-section" style="--c:#FF8B18"><h3>Graphics</h3>
        <div class="m-row"><div class="m-row-label">Quality<small>Low turns off shadows and trims particles</small></div>
          <div class="m-seg" role="group" aria-label="Quality">${['low', 'medium', 'high'].map((q) => `<button type="button" data-q="${q}" class="${s.quality === q ? 'on' : ''}" aria-pressed="${s.quality === q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div></div>
        ${sw('showFps', 'Frame rate counter', 'Shows FPS in the corner while you play', s.showFps)}
      </section>
      <section class="m-section" style="--c:#FFD633"><h3>Gameplay</h3>
        <div class="m-row"><label class="m-row-label" for="m-world">Starting world<small>Where START drops you</small></label>
          <select class="m-select" id="m-world" data-key="defaultWorld">${Object.entries(worlds).map(([k, v]) => `<option value="${k}" ${s.defaultWorld === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${sw('getUp', 'Dummies get back up', 'They recover a moment after a big hit', s.getUp)}
        ${sw('names', 'Name tags', 'Show each dummy’s name above its head', s.names)}
        ${sw('slowmo', 'Slow motion', 'Runs the physics at 30% speed', s.slowmo)}
        ${sw('follow', 'Camera follows the dummy', 'Keeps your selected dummy centred', s.follow)}
        ${sw('autosave', 'Auto-save progress', 'Saves your session on this device every few seconds', s.autosave)}
      </section>`;
    const has = !!getSave();
    btnDelete.disabled = !has;
    btnDelete.classList.remove('armed');
    btnDelete.textContent = has ? 'Delete saved session' : 'No saved session';
  }
  let lastFocus = null;
  function openSettings() {
    lastFocus = document.activeElement;
    renderSettings();
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    setTimeout(() => $('#m-close').focus(), 60);
  }
  function closeSettings(instant) {
    if (sheet.hidden) return;
    sheet.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; }, instant || reduceMotion ? 0 : 250);
    refreshResume();
    if (!instant && lastFocus) lastFocus.focus();
  }
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'm-vol') {
      const v = +t.value; t.style.setProperty('--v', v + '%'); $('#m-vol-out').textContent = v + '%';
      writeSettings({ volume: v / 100 });
    }
  });
  body.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset.key;
    if (t.id === 'm-vol') { blip(600, 800, 0.08); return; }
    if (k === 'sound') { writeSettings({ muted: !t.checked }); if (t.checked) blip(500, 900, 0.1); return; }
    if (k === 'defaultWorld') { writeSettings({ defaultWorld: t.value }); blip(500, 700, 0.06); return; }
    if (t.type === 'checkbox' && k) { writeSettings({ [k]: t.checked }); blip(t.checked ? 620 : 420, t.checked ? 880 : 300, 0.07); if (k === 'autosave') refreshResume(); }
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    writeSettings({ quality: b.dataset.q });
    body.querySelectorAll('[data-q]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    blip(560, 760, 0.07);
  });
  btnDelete.addEventListener('click', () => {
    if (!btnDelete.classList.contains('armed')) { btnDelete.classList.add('armed'); btnDelete.textContent = 'Click again to delete'; return; }
    clearSave(); blip(400, 160, 0.2, 'square');
    btnDelete.classList.remove('armed'); btnDelete.textContent = 'Saved session deleted'; btnDelete.disabled = true;
    refreshResume();
  });
  $('#m-close').addEventListener('click', () => closeSettings());
  $('#m-done').addEventListener('click', () => closeSettings());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSettings(); });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) { e.stopPropagation(); closeSettings(); }
    if (e.key === 'Tab' && !sheet.hidden) {
      const f = [...sheet.querySelectorAll('button:not(:disabled), input, select')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  /* ---------- boot ---------- */
  refreshResume();
  setInterval(() => { if (!menu.classList.contains('gone')) refreshResume(); }, 30000);
  setTimeout(() => menu.classList.remove('intro'), 1700);
  window.WMGMenu = { show: showMenu };
})();
