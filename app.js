'use strict';
const $ = i => document.getElementById(i);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const A = $('audio'), T = [], cache = [];
let cur = -1, uid = 0, gen = 0, seeking = false;
const NOTE = '<svg viewBox="0 0 24 24"><path d="M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zm11-2a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
const AUDIO_RE = /\.(mp3|flac|m4a|mp4|aac|ogg|oga|opus|wav|wave|aiff?|alac|weba|webm)$/i;
const extOf = f => (f.name.split('.').pop() || '').toUpperCase();
let toastT; const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); };

/* ───────── Library ───────── */
function addFiles(list) {
  const fs = [...list].filter(f => (f.type || '').startsWith('audio/') || AUDIO_RE.test(f.name));
  if (!fs.length) return toast('No audio files found');
  const fresh = [];
  for (const f of fs) {
    if (T.some(t => t.file.name === f.name && t.file.size === f.size)) continue;
    const t = { id: ++uid, file: f, url: URL.createObjectURL(f), title: f.name.replace(/\.[^.]+$/, ''), artist: 'Unknown Artist', tags: {}, dur: 0 };
    T.push(t); fresh.push(t);
  }
  toast(fresh.length ? `Added ${fresh.length} file${fresh.length > 1 ? 's' : ''}` : 'Already in your library');
  renderList();
  if (cur < 0 && T.length) select(0, false);
  (async () => { for (const t of fresh) await hydrate(t); })();
}

const readTags = f => new Promise(res => {
  if (!window.jsmediatags) return res({});
  try { jsmediatags.read(f, { onSuccess: r => res((r && r.tags) || {}), onError: () => res({}) }); } catch (_) { res({}); }
});
const probeDuration = url => new Promise(res => {
  const a = new Audio(); const done = d => { a.src = ''; res(Number.isFinite(d) ? d : 0); };
  a.preload = 'metadata'; a.onloadedmetadata = () => done(a.duration); a.onerror = () => done(0); setTimeout(() => done(0), 5000); a.src = url;
});

async function hydrate(t) {
  try {
    const ab = await t.file.arrayBuffer();
    t.meta = getTrueAudioMetadata(ab);
    let tags = await readTags(t.file);
    if (/\.(opus|ogg|oga)$/i.test(t.file.name)) {
      const o = parseOggComments(new Uint8Array(ab)); tags = { ...o, ...tags };
      if (!normalizePicture(tags.picture) && o.picture) tags.picture = o.picture;
      for (const k of ['title', 'artist', 'album', 'genre', 'year']) if (!tags[k] && o[k]) tags[k] = o[k];
    }
    t.tags = tags; t.title = tags.title || t.title; t.artist = tags.artist || t.artist;
    const pic = normalizePicture(tags.picture) || extractEmbeddedPicture(ab, t.file.name);
    if (pic) { t.pic = pic; t.art = URL.createObjectURL(new Blob([pic.data], { type: pic.format })); }
  } catch (e) { console.warn('metadata', e); }
  if (!t.dur) t.dur = await probeDuration(t.url);
  renderList(); if (T[cur] === t) paintPlayer();
}

function renderList() {
  document.body.classList.toggle('has-files', T.length > 0);
  $('lib-count').textContent = T.length ? `${T.length} track${T.length > 1 ? 's' : ''} · ${(T.reduce((s, t) => s + t.file.size, 0) / 1048576).toFixed(1)} MiB` : 'No files yet';
  $('clear-btn').hidden = !T.length;
  $('list').innerHTML = T.map((t, i) => `<div class="row ${i === cur ? 'cur' : ''}" data-i="${i}" style="--d:${Math.min(i, 12) * 35}ms">
    <div class="th">${t.art ? `<img src="${t.art}" alt="">` : NOTE}${i === cur && !A.paused ? '<div class="eq"><b></b><b></b><b></b></div>' : ''}</div>
    <div class="tx"><b>${esc(t.title)}</b><span>${esc(t.artist)}${t.tags.album ? ' · ' + esc(t.tags.album) : ''}</span></div>
    <span class="tag ${t.meta && t.meta.isLossless ? 'hi' : ''}">${esc(extOf(t.file))}</span><span class="du">${t.dur ? formatTime(t.dur) : '–'}</span>
    <button class="rm" data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
}
$('list').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]'); if (rm) { e.stopPropagation(); return remove(+rm.dataset.rm); }
  const row = e.target.closest('.row'); if (!row) return;
  select(+row.dataset.i, true); Dock.go(2);
});
function remove(i) {
  const t = T[i]; if (!t) return;
  [t.url, t.art].forEach(u => u && URL.revokeObjectURL(u)); T.splice(i, 1);
  if (i === cur) { A.pause(); cur = -1; if (T.length) select(Math.min(i, T.length - 1), false); else resetUI(); }
  else if (i < cur) cur--;
  renderList();
}
function resetUI() { gen++; A.removeAttribute('src'); A.load(); paintPlayer(); showInfo(null); spCtx.clearRect(0, 0, spec.width, spec.height); }
$('clear-btn').onclick = () => { while (T.length) remove(T.length - 1); };
$('add-btn').onclick = () => $('file-input').click();
$('file-input').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
['dragenter', 'dragover'].forEach(n => addEventListener(n, e => { e.preventDefault(); document.body.classList.add('drag'); }));
['dragleave', 'drop'].forEach(n => addEventListener(n, e => { e.preventDefault(); if (n === 'drop' || !e.relatedTarget) document.body.classList.remove('drag'); }));
addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { addFiles(e.dataTransfer.files); Dock.go(0); } });

/* ───────── Selection / Player ───────── */
function select(i, play) {
  if (i < 0 || i >= T.length) return; cur = i; const t = T[i];
  if (A.getAttribute('src') !== t.url) A.src = t.url;
  if (play) A.play().catch(() => {});
  paintPlayer(); renderList(); analyze(t);
}
function paintPlayer() {
  const t = T[cur];
  $('p-title').textContent = t ? t.title : 'Nothing playing';
  $('p-artist').textContent = t ? t.artist : 'Import a file to begin';
  const img = $('art'); if (t && t.art) { img.src = t.art; img.hidden = false; $('note').hidden = true; } else { img.removeAttribute('src'); img.hidden = true; $('note').hidden = false; }
  const amb = $('ambient'); amb.classList.toggle('has-art', !!(t && t.art)); amb.style.setProperty('--art', t && t.art ? `url(${t.art})` : 'none');
  syncTime();
  if ('mediaSession' in navigator && t) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.tags.album || '', artwork: t.art ? [{ src: t.art, sizes: '512x512' }] : [] });
}
const step = d => { if (!T.length) return; select((cur + d + T.length) % T.length, true); };
$('prev').onclick = () => (A.currentTime > 3 ? (A.currentTime = 0) : step(-1));
$('next').onclick = () => step(1);
$('play').onclick = () => { if (cur < 0) return toast('Import a file first'); A.paused ? A.play().catch(() => toast('Playback blocked or unsupported')) : A.pause(); };
A.onplay = A.onpause = () => {
  $('i-play').hidden = !A.paused; $('i-pause').hidden = A.paused; document.body.classList.toggle('playing', !A.paused); renderList();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = A.paused ? 'paused' : 'playing';
};
A.onended = () => { if (T.length > 1) step(1); };
function syncTime() {
  const d = A.duration || (T[cur] && T[cur].dur) || 0, c = A.currentTime || 0;
  $('t-cur').textContent = formatTime(c); $('t-rem').textContent = '-' + formatTime(Math.max(0, d - c));
  if (!seeking) { const p = d ? c / d * 1000 : 0; $('bar').value = p; $('bar').style.setProperty('--p', p / 10 + '%'); }
}
A.ontimeupdate = A.onloadedmetadata = syncTime;
$('bar').oninput = e => { seeking = true; const d = A.duration; e.target.style.setProperty('--p', e.target.value / 10 + '%'); if (d) { A.currentTime = e.target.value / 1000 * d; } syncTime(); };
$('bar').onchange = () => { seeking = false; };
$('volume').oninput = e => { A.volume = +e.target.value; e.target.style.setProperty('--p', e.target.value * 100 + '%'); };
$('volume').style.setProperty('--p', '100%');
if ('mediaSession' in navigator) for (const [a, f] of [['play', () => A.play()], ['pause', () => A.pause()], ['previoustrack', () => step(-1)], ['nexttrack', () => step(1)]]) try { navigator.mediaSession.setActionHandler(a, f); } catch (_) {}

/* ───────── Media info + spectrogram ───────── */
const spec = $('spec'), spCtx = spec.getContext('2d', { alpha: false });
const ov = (on, txt, pct, err) => { $('ov').classList.toggle('off', !on); if (txt) { $('ov-t').textContent = txt; $('ov-t').style.color = err ? '#fda4af' : '#c7d2fe'; } $('ov-fill').style.width = (pct || 0) + '%'; };
$('seg').onclick = e => {
  const m = e.target.dataset && e.target.dataset.m; if (!m) return;
  [...$('seg').children].forEach(b => b.classList.toggle('on', b === e.target));
  ['general', 'audio', 'image'].forEach(k => $('m-' + k).hidden = k !== m);
};
function showInfo(t) {
  $('i-title').textContent = t ? t.title : 'Media Info'; $('i-sub').textContent = t ? `${t.artist} · ${(t.file.size / 1048576).toFixed(2)} MiB` : 'Select a track from Library';
  $('badges').innerHTML = ''; ['general', 'audio', 'image'].forEach(k => $('m-' + k).textContent = t ? 'Analyzing…' : '');
  $('y-axis').innerHTML = $('x-axis').innerHTML = ''; if (!t) ov(true, 'Waiting for a track…');
}
function axes(info) {
  $('x-axis').innerHTML = Array.from({ length: 6 }, (_, i) => `<span>${formatTime(info.dur / 5 * i)}</span>`).join('');
  $('y-axis').innerHTML = Array.from({ length: 6 }, (_, i) => `<span>${(info.sr / 2 / 5 * (5 - i) / 1000).toFixed(1)}k</span>`).join('');
}
async function analyze(t) {
  const g = ++gen; showInfo(t);
  if (t.spec) { spec.width = t.spec.width; spec.height = t.spec.height; spCtx.putImageData(t.spec, 0, 0); axes(t.info); buildInfo(t); return ov(false); }
  ov(true, 'Decoding audio…', 0); spCtx.fillStyle = '#000'; spCtx.fillRect(0, 0, spec.width, spec.height);
  try {
    const ab = await t.file.arrayBuffer(), AC = window.AudioContext || window.webkitAudioContext; let ac;
    try { ac = new AC(t.meta && t.meta.sampleRate ? { sampleRate: t.meta.sampleRate } : undefined); } catch (_) { ac = new AC(); }
    const buf = await new Promise((ok, no) => ac.decodeAudioData(ab, ok, () => no(new Error('This browser could not decode this audio format.'))));
    ac.close().catch(() => {}); if (g !== gen) return;
    t.info = { sr: buf.sampleRate, ch: buf.numberOfChannels, dur: buf.duration }; t.dur = buf.duration;
    buildInfo(t); axes(t.info); renderList(); draw(buf, t, g);
  } catch (e) { if (g === gen) { ov(true, '⚠ ' + (e.message || e), 0, true); buildInfo(t); } }
}
function draw(buf, t, g) {
  const N = 4096, B = N / 2, W = 1000, pcm = buf.getChannelData(0), range = Math.max(0, pcm.length - N), fft = new FFT(N);
  spec.width = W; spec.height = B; const im = spCtx.createImageData(W, B), d = im.data; let x0 = 0;
  (function chunk() {
    if (g !== gen) return;
    const x1 = Math.min(x0 + 12, W);
    for (let x = x0; x < x1; x++) {
      const s = Math.round(x / (W - 1) * range), sl = new Float32Array(N); sl.set(pcm.subarray(s, Math.min(s + N, pcm.length)));
      applyHannWindow(sl); const mg = fft.forward(sl);
      for (let y = 0; y < B; y++) { const c = getRGB(mg[y]), i = ((B - 1 - y) * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
    }
    x0 = x1; ov(true, 'Painting acoustic spectrum…', x0 / W * 100);
    if (x0 < W) return requestAnimationFrame(chunk);
    spCtx.putImageData(im, 0, 0); t.spec = im; cache.push(t); if (cache.length > 3) delete cache.shift().spec; ov(false);
  })();
}
function buildInfo(t) {
  const f = t.file, m = t.meta || {}, i = t.info, p = s => String(s).padEnd(22), dur = i ? i.dur : t.dur;
  const br = dur ? Math.round(f.size * 8 / dur / 1000) : 0, fx = extOf(f), lossless = m.isLossless || ['FLAC', 'WAV', 'ALAC', 'AIFF'].includes(fx);
  let bd = m.bitDepth || (lossless && i ? (i.sr > 96000 ? 32 : br > 1300 || i.sr > 48000 ? 24 : 16) : 0);
  const q = !i ? '' : lossless ? (i.sr > 48000 || bd > 16 ? 'HI-RES' : 'CD QUALITY') : br >= 256 ? 'HIGH' : 'STANDARD';
  $('badges').innerHTML = i ? `<span class="tag ${q === 'HI-RES' ? 'hi' : ''}">${q}</span><span class="tag">${fx}</span><span>${(i.sr / 1000).toFixed(1)} kHz${bd && lossless ? ' / ' + bd + '-bit' : ''} · ${br} kbps</span>` : '';
  const tg = t.tags || {}; let g = `${p('Complete name')}: ${f.name}\n${p('Format')}: ${fx === 'MP3' ? 'MPEG Audio' : fx}\n${p('File size')}: ${(f.size / 1048576).toFixed(1)} MiB\n${p('Duration')}: ${dur ? formatTime(dur) : 'Unknown'}\n${p('Overall bit rate')}: ${br} kb/s\n`;
  for (const [k, l] of [['title', 'Title'], ['album', 'Album'], ['artist', 'Performer'], ['genre', 'Genre'], ['year', 'Recorded date']]) if (tg[k]) g += `${p(l)}: ${tg[k]}\n`;
  $('m-general').textContent = g;
  $('m-audio').textContent = i ? `${p('Format')}: ${fx}\n${p('Duration')}: ${formatTime(i.dur)}\n${p('Bit rate')}: ${br} kb/s\n${p('Channel(s)')}: ${i.ch}\n${p('Sampling rate')}: ${(i.sr / 1000).toFixed(1)} kHz\n${bd ? p('Bit depth') + ': ' + bd + ' bits\n' : ''}${p('Compression mode')}: ${lossless ? 'Lossless' : 'Lossy / unknown'}\n` : 'Audio could not be decoded by this browser.';
  if (t.art) { $('m-image').textContent = 'Reading embedded cover art…'; const im = new Image(); im.onload = () => { if (T[cur] === t) $('m-image').textContent = `${p('Type')}: Cover\n${p('Format')}: ${String(t.pic.format).toUpperCase().replace('IMAGE/', '')}\n${p('Width')}: ${im.naturalWidth} pixels\n${p('Height')}: ${im.naturalHeight} pixels\n`; }; im.src = t.art; }
  else $('m-image').textContent = 'No embedded cover art found in this file.';
}

/* ───────── Liquid glass dock with bubble physics ───────── */
const Dock = (() => {
  const TABS = [['import', 'Import', '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/>'], ['info', 'Media Info', '<path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2"/>'], ['player', 'Player', '<path d="M9 18V6l11-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zm11-2a3 3 0 11-6 0 3 3 0 016 0z"/>']];
  const dock = $('dock'), bub = $('bubble'), lens = $('lens'), btns = $('btns'), pad = 6;
  const html = TABS.map(([, l, ic]) => `<button><svg viewBox="0 0 24 24">${ic}</svg><span>${l}</span></button>`).join('');
  btns.innerHTML = lens.innerHTML = html;
  const fxDock = Glass.apply($('dock-glass'), { bezel: 18, scale: 26, blur: 1.2, sat: 1.7 });
  const fxBub = Glass.apply(bub, { bezel: 20, scale: 70, blur: .6, sat: 1.9, aberr: .1 });
  let W = 1, x = 0, v = 0, tx = 0, press = 0, pv = 0, drag = false, grab = 0, raf = 0, last = 0, active = 0;
  const measure = () => { W = (dock.clientWidth - pad * 2) / 3; bub.style.width = W + 'px'; lens.style.width = W * 3 + 'px'; if (!drag) x = tx = active * W; render(); };
  function render() {
    const s = Math.min(.42, Math.abs(v) / 2000), p = 1 + press * .24;
    bub.style.transform = `translate3d(${x}px,0,0) scale(${(1 + s) * p},${(1 - s * .5) * p})`;
    lens.style.transform = `translate3d(${-x}px,0,0)`;
    bub.style.setProperty('--hl', Math.max(-40, Math.min(40, v / 14)));
    fxBub.setScale(70 + press * 55);
  }
  function loop(t) {
    const dt = Math.min(.032, (t - last) / 1000 || .016); last = t;
    const k = drag ? 560 : 240, c = drag ? 36 : 14;           // underdamped release = jelly wobble
    v += (-k * (x - tx) - c * v) * dt; x += v * dt;
    pv += (-260 * (press - (drag ? 1 : 0)) - 15 * pv) * dt; press += pv * dt;
    render();
    if (!drag && Math.abs(v) < .4 && Math.abs(x - tx) < .25 && Math.abs(pv) < .02 && Math.abs(press) < .004) { x = tx; v = 0; press = pv = 0; render(); raf = 0; return; }
    raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  function go(i, bounce) {
    i = Math.max(0, Math.min(2, i)); active = i; tx = i * W;
    document.querySelectorAll('.tab').forEach((s, n) => s.classList.toggle('on', n === i));
    [...lens.children].forEach((b, n) => b.classList.toggle('on', n === i));
    if (bounce) pv += 3; kick(); scrollTo({ top: 0 });
  }
  const px = e => e.clientX - dock.getBoundingClientRect().left - pad;
  dock.addEventListener('pointerdown', e => {
    dock.setPointerCapture(e.pointerId); const p = px(e);
    if (p >= x && p <= x + W) { drag = true; grab = p - x; } else { go(Math.floor(p / W), true); return; }
    kick();
  });
  dock.addEventListener('pointermove', e => { if (drag) tx = Math.max(-10, Math.min(2 * W + 10, px(e) - grab)); });
  const up = () => { if (!drag) return; drag = false; go(Math.round((x + v * .12) / W)); };
  dock.addEventListener('pointerup', up); dock.addEventListener('pointercancel', up);
  new ResizeObserver(measure).observe(dock); measure(); go(0);
  return { go: i => go(i, true) };
})();

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
showInfo(null); paintPlayer();
