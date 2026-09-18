/* Psalmspelaren: orgelsampler, notrulle, text, transponering,
   mikrofonstämmare, MIDI-klaviatur och inläsning av egna MIDI-filer.

   All state ligger i mount() så att vyn kan monteras och rivas ner
   flera gånger under samma sidladdning. */

import { SONGS } from '../data/songs.js';
import { createPitchDetector, BUF_SIZE } from '../lib/pitch.js';
import { WHITE, noteName, roundRect } from '../lib/notes.js';
import { midiToSong } from '../lib/midi-read.js';
import { onThemeChange, palette } from '../theme.js';

const SMIDI = [36, 48, 60, 72, 84];        // samplade noter
const LOOK = 2.6;                          // sekunder framförhållning i rullen
const KEYS = ['C','Dess','D','Ess','E','F','Gess','G','Ass','A','B','H'];

/* Notrullens färger bor i css/tokens.css och byter värde med temat.
   Här står bara vilket token som hör till vilken roll. */
const ROLL = {
  grid:      '--roll-grid',
  mel:       '--roll-melody',   melEdge:  '--roll-melody-edge',
  acc:       '--roll-harmony',  accEdge:  '--roll-harmony-edge',
  syl:       '--roll-syllable',
  white:     '--roll-key',      whiteOn:  '--roll-key-on',
  black:     '--roll-key-black', blackOn: '--roll-key-black-on',
  border:    '--roll-key-line', label:    '--roll-key-label',
  hit:       '--roll-hit',
  voice:     '--roll-voice',    voiceRing:'--roll-voice-ring',
  midi:      '--roll-midi',     midiEdge: '--roll-midi-edge',
};

const detectPitch = createPitchDetector({ threshold: 0.12, rmsGate: 0.008, minHz: 60, maxHz: 1300 });

/* Egna inlästa MIDI-filer ligger kvar så länge fliken är öppen. */
const userSongs = [];

export function mount(root){
  const $ = sel => root.querySelector(sel);
  const songs = SONGS.concat(userSongs);
  let D = songs[0];
  let disposed = false;

  /* ---------- orgelsampler ---------- */
  let AC = null, master = null, audioReady = null;
  const buffers = {}, offsets = {};

  function b64buf(s){
    const b = atob(s), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u.buffer;
  }
  function makeIR(ctx, sec){
    const n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++){
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    return buf;
  }
  async function setupAudio(){
    const { SAMPLES } = await import('../data/samples.js');
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain(); gain.gain.value = 0.9; gain.connect(ctx.destination);
    const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, 2.4);
    const wet = ctx.createGain(); wet.gain.value = 0.32; conv.connect(wet); wet.connect(ctx.destination);
    gain.connect(conv);
    await Promise.all(SMIDI.map(async m => {
      buffers[m] = await ctx.decodeAudioData(b64buf(SAMPLES[m]));
      const d = buffers[m].getChannelData(0); let i = 0;
      while (i < d.length && Math.abs(d[i]) < 0.004) i++;
      offsets[m] = i / buffers[m].sampleRate;
    }));
    if (disposed){ ctx.close().catch(() => {}); throw new Error('vyn stängdes'); }
    AC = ctx; master = gain;
  }
  function initAudio(){
    if (!audioReady) audioReady = setupAudio().catch(err => { audioReady = null; throw err; });
    return audioReady;
  }

  function nearest(m){
    let best = SMIDI[0];
    for (const s of SMIDI) if (Math.abs(s - m) < Math.abs(best - m)) best = s;
    return best;
  }
  let voices = [];
  function voice(midi, when, dur, hand){
    const s = nearest(midi), src = AC.createBufferSource(), g = AC.createGain();
    src.buffer = buffers[s]; src.playbackRate.value = Math.pow(2, (midi - s) / 12);
    const lvl = hand ? 0.20 : 0.30;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(lvl, when + 0.035);
    g.gain.setValueAtTime(lvl, when + Math.max(dur, 0.1));
    g.gain.linearRampToValueAtTime(0.0001, when + Math.max(dur, 0.1) + 0.14);
    src.connect(g); g.connect(master);
    src.start(when, offsets[s]); src.stop(when + Math.max(dur, 0.1) + 0.18);
    voices.push(src); src.onended = () => { voices = voices.filter(v => v !== src); };
  }
  function allOff(){ voices.forEach(v => { try { v.stop(); } catch (e) {} }); voices = []; }

  /* ---------- transport ---------- */
  let playing = false, t0 = 0, paused = -LOOK, rate = 1, shift = 0,
      nextIdx = 0, timer = null, frozen = 0;

  function pieceTime(){ return playing && AC ? (AC.currentTime - t0) * rate : paused; }
  function locate(pt){ nextIdx = 0; while (nextIdx < D.notes.length && D.notes[nextIdx].t < pt) nextIdx++; }
  function schedule(){
    const horizon = AC.currentTime + 0.25;
    while (nextIdx < D.notes.length){
      const n = D.notes[nextIdx], when = t0 + n.t / rate;
      if (when > horizon) break;
      voice(n.m + shift, Math.max(when, AC.currentTime), n.d / rate, n.h);
      nextIdx++;
    }
    if (pieceTime() >= D.end){            // runt igen från vers 1
      t0 += D.end / rate; locate(0); shown = -2; hist.length = 0;
    }
  }
  async function start(){
    try { await initAudio(); } catch (e) { return; }
    if (disposed) return;
    if (AC.state === 'suspended') await AC.resume();
    if (paused >= D.end) paused = -LOOK;
    t0 = AC.currentTime + 0.08 - paused / rate;
    locate(paused); playing = true; setBtn(true);
    timer = setInterval(schedule, 25); schedule();
  }
  function stop(reset){
    playing = false; clearInterval(timer); timer = null;
    if (AC) allOff();
    setBtn(false);
    paused = reset ? -LOOK : Math.min(frozen, D.end);
    if (reset) shown = -2;
  }
  const ICON_PLAY = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M8 5.2 19 12 8 18.8Z"/></svg>';
  const ICON_PAUSE = '<svg class="icon pause" viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="7" y="5" width="3.6" height="14" rx="1.4"/>' +
    '<rect x="13.4" y="5" width="3.6" height="14" rx="1.4"/></svg>';

  function setBtn(on){
    const b = $('#play');
    b.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    b.setAttribute('aria-label', on ? 'Pausa' : 'Spela');
  }
  function toggle(){ if (playing){ frozen = pieceTime(); stop(false); } else start(); }
  function seekTo(pt){
    const was = playing;
    if (playing){ frozen = pieceTime(); stop(false); }
    paused = pt; shown = -2; hist.length = 0;
    if (was) start();
  }

  /* ---------- färgtema ---------- */
  let P = palette(ROLL);
  const offTheme = onThemeChange(() => { P = palette(ROLL); });

  /* ---------- grafik ---------- */
  const cv = $('#c'), ctx = cv.getContext('2d');
  let whites = [], wIndex = new Map(), lo = 0, hi = 0;
  let W = 0, H = 0, KEYW = 0, WH = 0, BH = 0, HIT = 0;

  function buildRange(){
    lo = Math.min(...D.notes.map(n => n.m)) + shift;
    hi = Math.max(...D.notes.map(n => n.m)) + shift;
    while (!WHITE.has(((lo % 12) + 12) % 12)) lo--;
    while (!WHITE.has(((hi % 12) + 12) % 12)) hi++;
    whites = []; for (let m = lo; m <= hi; m++) if (WHITE.has(m % 12)) whites.push(m);
    wIndex = new Map(whites.map((m, i) => [m, i]));
    resize();
  }
  function resize(){
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !whites.length) return;
    cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = r.width; H = r.height;
    KEYW = Math.round(Math.max(50, Math.min(86, W * 0.17)));
    HIT = KEYW + Math.round(Math.min(96, W * 0.19));
    WH = H / whites.length; BH = WH * 0.62;
  }
  const ro = new ResizeObserver(resize); ro.observe(cv);

  function keyY(m){
    if (WHITE.has(m % 12)){ const i = wIndex.get(m); return [H - (i + 1) * WH, H - i * WH]; }
    const cy = H - (wIndex.get(m - 1) + 1) * WH; return [cy - BH / 2, cy + BH / 2];
  }
  const rr = (x, y, w, h, r) => roundRect(ctx, x, y, w, h, r);

  function draw(t){
    ctx.clearRect(0, 0, W, H);
    const pps = (W - HIT) / LOOK;
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    for (const m of whites) if (m % 12 === 0){
      const [, y1] = keyY(m);
      ctx.beginPath(); ctx.moveTo(KEYW, Math.round(y1) + .5); ctx.lineTo(W, Math.round(y1) + .5); ctx.stroke();
    }
    const active = new Set();
    for (const n of D.notes){
      const x0 = HIT + (n.t - t) * pps, x1 = x0 + n.d * pps;
      if (x1 < KEYW || x0 > W) continue;
      const m = n.m + shift;
      if (t >= n.t && t < n.t + n.d) active.add(m);
      const [y0, y1] = keyY(m), h = y1 - y0, pad = h * 0.11;
      const bx0 = Math.max(x0, KEYW), bx1 = Math.min(x1, W);
      ctx.fillStyle = n.h ? P.acc : P.mel;
      rr(bx0, y0 + pad, bx1 - bx0, h - 2 * pad, 3); ctx.fill();
      ctx.strokeStyle = n.h ? P.accEdge : P.melEdge; ctx.stroke();
      if (n.s >= 0){
        const s = D.syl[n.s].x.trim();
        if (s){
          ctx.font = '500 12px Newsreader,Georgia,serif'; ctx.textBaseline = 'middle';
          if (bx1 - bx0 > ctx.measureText(s).width + 9){
            ctx.fillStyle = P.syl; ctx.fillText(s, bx0 + 5, (y0 + y1) / 2 + 1);
          }
        }
      }
    }
    ctx.textBaseline = 'alphabetic';
    for (const m of whites){
      const [y0, y1] = keyY(m), on = active.has(m);
      ctx.fillStyle = held.has(m) ? P.midi : (on ? P.whiteOn : P.white);
      ctx.fillRect(0, y0, KEYW, y1 - y0 - 1);
      ctx.strokeStyle = P.border; ctx.lineWidth = 1;
      ctx.strokeRect(.5, Math.round(y0) + .5, KEYW - 1, Math.round(y1 - y0 - 1));
      if (m % 12 === 0 && WH > 11){
        ctx.font = '500 10px Jost,system-ui,sans-serif'; ctx.fillStyle = P.label; ctx.textAlign = 'right';
        ctx.fillText('C' + (Math.floor(m / 12) - 1), KEYW - 4, y1 - 4); ctx.textAlign = 'left';
      }
    }
    for (let m = lo; m <= hi; m++){
      if (WHITE.has(m % 12)) continue;
      const [y0, y1] = keyY(m), on = active.has(m);
      ctx.fillStyle = held.has(m) ? P.midi : (on ? P.blackOn : P.black);
      ctx.fillRect(0, y0, KEYW * 0.62, y1 - y0);
    }
    ctx.fillStyle = P.hit; ctx.fillRect(HIT - 1, 0, 2, H);
    drawPlayed(t, pps);
    drawVoice(t, pps);
  }

  /* ---------- mikrofon ---------- */
  let micStream = null, analyser = null, mbuf = null, micOn = false;
  const hist = [];

  function posOfInt(m){                      // vertikal position i vita tangenter
    if (WHITE.has(((m % 12) + 12) % 12)){ const i = wIndex.get(m); return i === undefined ? null : i + 0.5; }
    const i = wIndex.get(m - 1); return i === undefined ? null : i + 1;
  }
  function yForPitch(m){
    const lo2 = Math.floor(m), fr = m - lo2;
    const a = posOfInt(lo2), b = posOfInt(lo2 + 1);
    if (a === null || b === null) return null;
    return H - (a + (b - a) * fr) * WH;
  }
  function fold(m){                          // vik in i klaviaturens omfång
    while (m < lo - 0.5) m += 12;
    while (m > hi + 0.5) m -= 12;
    return m;
  }
  function targetAt(t){
    for (const n of D.notes) if (n.h === 0 && t >= n.t && t < n.t + n.d) return n.m + shift;
    return null;
  }

  function drawVoice(t, pps){
    if (!micOn) return;
    ctx.lineWidth = 2.5; ctx.strokeStyle = P.voice; ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false, lastY = null;
    for (const h of hist){
      const x = HIT + (h.t - t) * pps;
      if (x < KEYW || x > W){ started = false; continue; }
      const y = yForPitch(fold(h.m));
      if (y === null){ started = false; continue; }
      if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      lastY = y;
    }
    if (started) ctx.stroke();
    if (lastY !== null){
      ctx.beginPath(); ctx.arc(HIT, lastY, 4.5, 0, 6.284);
      ctx.fillStyle = P.voice; ctx.fill();
      ctx.strokeStyle = P.voiceRing; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  const tunerEl = $('#tuner'), tNote = $('#tnote'), tCents = $('#tcents');
  function readVoice(t){
    if (!micOn || !analyser || !AC) return;
    analyser.getFloatTimeDomainData(mbuf);
    const f = detectPitch(mbuf, AC.sampleRate);
    if (f < 0){
      if (hist.length && t - hist[hist.length - 1].t > 0.25){
        tNote.textContent = '–'; tCents.textContent = 'tyst'; tunerEl.className = 'tuner';
      }
      return;
    }
    const m = 69 + 12 * Math.log2(f / 440);
    hist.push({ t: t, m: m });
    while (hist.length > 400) hist.shift();
    const heldKeys = [...held.keys()];
    const target = heldKeys.length ? heldKeys[heldKeys.length - 1] : targetAt(t);
    const mot = heldKeys.length ? 'mot tangent' : 'mot noten';
    const name = noteName(Math.round(m));
    if (target === null){
      tNote.textContent = name; tCents.textContent = Math.round(f) + ' Hz'; tunerEl.className = 'tuner';
      return;
    }
    const diff = m - target, oct = Math.round(diff / 12), cents = Math.round((diff - 12 * oct) * 100);
    const ab = Math.abs(cents);
    tunerEl.className = 'tuner' + (ab <= 25 ? ' good' : ab <= 50 ? ' near' : '');
    tNote.textContent = name;
    tCents.textContent = (ab <= 12 ? 'rent' : (cents > 0 ? '+' : '') + cents + ' cent')
      + (oct ? '  ·  ' + (oct > 0 ? '+' : '') + oct + ' okt' : '') + '  ·  ' + mot;
  }

  async function micToggle(){
    const b = $('#mic');
    if (micOn){
      micOn = false; hist.length = 0;
      if (micStream) micStream.getTracks().forEach(x => x.stop());
      micStream = null; analyser = null;
      b.classList.remove('on'); b.textContent = 'Mikrofon av'; b.setAttribute('aria-pressed', 'false');
      tNote.textContent = '–'; tCents.textContent = 'sjung med'; tunerEl.className = 'tuner';
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
      tCents.textContent = 'mikrofon kräver https'; return;
    }
    try {
      b.textContent = 'väntar på tillstånd…';
      await initAudio();
      if (disposed) return;
      if (AC.state === 'suspended') await AC.resume();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (disposed){ micStream.getTracks().forEach(x => x.stop()); return; }
      const srcNode = AC.createMediaStreamSource(micStream);
      analyser = AC.createAnalyser(); analyser.fftSize = BUF_SIZE;
      mbuf = new Float32Array(analyser.fftSize);
      srcNode.connect(analyser);                 // ingen koppling till destination = ingen rundgång
      micOn = true;
      b.classList.add('on'); b.textContent = 'Mikrofon på'; b.setAttribute('aria-pressed', 'true');
      tCents.textContent = 'sjung med';
    } catch (e){
      b.textContent = 'Mikrofon av'; tCents.textContent = 'åtkomst nekad';
    }
  }

  /* ---------- MIDI-klaviatur ---------- */
  let midiOn = false, midiAccess = null;
  const held = new Map();        // midinot -> {t0, src}
  const played = [];             // {m, t0, t1}

  function liveNote(midi){
    const sm = nearest(midi), src = AC.createBufferSource(), g = AC.createGain();
    src.buffer = buffers[sm]; src.playbackRate.value = Math.pow(2, (midi - sm) / 12);
    const now = AC.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.30, now + 0.03);
    src.connect(g); g.connect(master);
    src.start(now, offsets[sm]);
    return { stop(){
      const t = AC.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.18);
      try { src.stop(t + 0.22); } catch (e) {}
    } };
  }
  function keyDown(m){
    if (held.has(m)) return;
    const rec = { t0: pieceTime(), src: liveNote(m) };
    held.set(m, rec);
    played.push({ m: m, t0: rec.t0, t1: null });
    while (played.length > 60) played.shift();
  }
  function keyUp(m){
    const rec = held.get(m); if (!rec) return;
    rec.src.stop(); held.delete(m);
    for (let i = played.length - 1; i >= 0; i--)
      if (played[i].m === m && played[i].t1 === null){ played[i].t1 = pieceTime(); break; }
  }
  function onMIDI(e){
    const [st, d1, d2] = e.data, cmd = st & 0xF0;
    if (cmd === 0x90 && d2 > 0) keyDown(d1);
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) keyUp(d1);
    else if (cmd === 0xB0 && d1 === 123) { [...held.keys()].forEach(keyUp); }
  }
  function attachMIDI(){
    let n = 0; const names = [];
    midiAccess.inputs.forEach(inp => { inp.onmidimessage = onMIDI; n++; names.push(inp.name); });
    const b = $('#midi');
    b.textContent = n ? 'MIDI: ' + names[0].slice(0, 18) : 'MIDI på (ingen enhet)';
    return n;
  }
  async function midiToggle(){
    const b = $('#midi');
    if (midiOn){
      midiOn = false; [...held.keys()].forEach(keyUp); played.length = 0;
      if (midiAccess) midiAccess.inputs.forEach(i => { i.onmidimessage = null; });
      b.classList.remove('on'); b.textContent = 'MIDI av'; b.setAttribute('aria-pressed', 'false');
      return;
    }
    if (!navigator.requestMIDIAccess){ b.textContent = 'MIDI stöds ej här'; return; }
    try {
      b.textContent = 'väntar på tillstånd…';
      await initAudio();
      if (disposed) return;
      if (AC.state === 'suspended') await AC.resume();
      midiAccess = await navigator.requestMIDIAccess();
      if (disposed){ midiAccess.inputs.forEach(i => { i.onmidimessage = null; }); return; }
      midiAccess.onstatechange = () => { if (midiOn) attachMIDI(); };
      midiOn = true; attachMIDI();
      b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
    } catch (e){ b.textContent = 'MIDI nekad'; }
  }

  function drawPlayed(t, pps){
    if (!midiOn) return;
    for (const pn of played){
      const end = pn.t1 === null ? t : pn.t1;
      const x0 = HIT + (pn.t0 - t) * pps, x1 = HIT + (end - t) * pps;
      if (x1 < KEYW || x0 > W) continue;
      const pos = posOfInt(pn.m); if (pos === null) continue;
      const y0 = H - (pos + 0.42) * WH, h = WH * 0.84;
      const bx0 = Math.max(x0, KEYW), bx1 = Math.max(Math.min(x1, W), bx0 + 2);
      ctx.fillStyle = P.midi; ctx.globalAlpha = 0.85;
      rr(bx0, y0, bx1 - bx0, h, 3); ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = P.midiEdge; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  /* ---------- text ---------- */
  const l0 = $('#l0'), l1 = $('#l1'), vlab = $('#vlabel');
  let shown = -2;
  function lyrics(t){
    let idx = -1;
    for (let i = 0; i < D.syl.length; i++){ if (D.syl[i].t <= t) idx = i; else break; }
    const line = idx < 0 ? 0 : D.syl[idx].line;
    const nv = D.syl.length ? D.syl[D.syl.length - 1].v : 1;
    vlab.textContent = (nv > 1 && idx >= 0) ? 'Vers ' + D.syl[idx].v + ' av ' + nv : '';
    if (line !== shown){
      shown = line;
      const render = (el, ln) => {
        el.innerHTML = '';
        if (ln >= D.nLines) return;
        D.syl.filter(s => s.line === ln).forEach(s => {
          const sp = document.createElement('span'); sp.className = 'syl';
          sp.dataset.t = s.t; sp.textContent = s.x; el.appendChild(sp);
        });
      };
      render(l0, line); render(l1, line + 1);
    }
    l0.querySelectorAll('.syl').forEach(sp => {
      const st = parseFloat(sp.dataset.t);
      sp.classList.toggle('sung', t >= st);
      sp.classList.toggle('now', idx >= 0 && D.syl[idx].t === st && t >= st);
    });
  }

  /* ---------- loop och reglage ---------- */
  const fmt = s => Math.floor(Math.max(s, 0) / 60) + ':' +
                   String(Math.floor(Math.max(s, 0) % 60)).padStart(2, '0');
  const seek = $('#seek'), nowEl = $('#now');
  let scrubbing = false, rafId = 0;

  function frame(){
    if (disposed) return;
    const t = pieceTime();
    if (playing) frozen = t;
    readVoice(t);
    draw(t); lyrics(t);
    if (!scrubbing){ seek.value = Math.max(0, Math.min(1, t / D.end)) * 1000; nowEl.textContent = fmt(t); }
    rafId = requestAnimationFrame(frame);
  }

  function setKeyLabel(){
    const el = $('#keyname');
    const name = KEYS[((D.keyPc + shift) % 12 + 12) % 12] + '-dur';
    const tag = shift === 0 ? 'original' : (shift > 0 ? '+' : '−') + Math.abs(shift) + ' halvtoner';
    el.innerHTML = name + '<em>' + tag + '</em>';
    $('#down').disabled = shift <= -12;
    $('#up').disabled = shift >= 12;
  }
  function transpose(d){
    const nxt = Math.max(-12, Math.min(12, shift + d));
    if (nxt === shift) return;
    shift = nxt; setKeyLabel(); buildRange();
    if (playing){ const pt = pieceTime(); allOff(); locate(pt); }
  }

  function onKey(e){
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space'){ e.preventDefault(); toggle(); }
    if (e.code === 'ArrowUp'){ e.preventDefault(); transpose(1); }
    if (e.code === 'ArrowDown'){ e.preventDefault(); transpose(-1); }
  }

  /* ---------- psalmhylla ---------- */
  const sel = $('#song'), loadMsg = $('#loadmsg');
  function buildShelf(){
    sel.innerHTML = '';
    songs.forEach((s, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = (s.nrLabel || s.nr) + '  ·  ' + s.title;
      sel.appendChild(o);
    });
  }
  function load(i){
    if (playing){ frozen = pieceTime(); stop(false); }
    D = songs[i]; shift = 0; paused = -LOOK; frozen = -LOOK; shown = -2; hist.length = 0;
    sel.value = i;
    $('#title').textContent = D.title;
    $('#credit').innerHTML = D.credit;
    $('#tot').textContent = fmt(D.end);
    $('#src').textContent = 'Melodi transkriberad ur ' + D.source + '.';
    const v = $('#verses'); v.innerHTML = '';
    D.verses.forEach(x => {
      const d = document.createElement('div');
      d.innerHTML = '<h2>' + x.h + '</h2><p>' + x.lines.join('<br>') + '</p>';
      v.appendChild(d);
    });
    setKeyLabel(); buildRange();
  }

  async function onFile(ev){
    const f = ev.target.files[0]; if (!f) return;
    loadMsg.className = ''; loadMsg.textContent = 'läser…';
    try {
      const song = midiToSong(await f.arrayBuffer(), f.name);
      userSongs.push(song); songs.push(song);
      buildShelf(); load(songs.length - 1);
      loadMsg.textContent = song.notes.length + ' toner, ' + song.syl.length + ' stavelser';
    } catch (e){
      loadMsg.className = 'err'; loadMsg.textContent = e.message || 'kunde inte läsa filen';
    }
    ev.target.value = '';
  }

  /* ---------- koppla ihop ---------- */
  $('#play').addEventListener('click', toggle);
  seek.addEventListener('input', () => { scrubbing = true; nowEl.textContent = fmt(D.end * seek.value / 1000); });
  seek.addEventListener('change', () => { scrubbing = false; seekTo(D.end * seek.value / 1000); });
  $('#down').addEventListener('click', () => transpose(-1));
  $('#up').addEventListener('click', () => transpose(1));
  root.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-r]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const pt = pieceTime(); rate = parseFloat(b.dataset.r);
    if (playing){ allOff(); t0 = AC.currentTime - pt / rate; locate(pt); } else { paused = pt; }
  }));
  $('#mic').addEventListener('click', micToggle);
  $('#midi').addEventListener('click', midiToggle);
  $('#midifile').addEventListener('change', onFile);
  sel.addEventListener('change', () => load(+sel.value));
  document.addEventListener('keydown', onKey);

  buildShelf();
  load(0);
  setBtn(false);
  rafId = requestAnimationFrame(frame);

  /* ---------- riv ner ---------- */
  return function unmount(){
    disposed = true;
    cancelAnimationFrame(rafId);
    clearInterval(timer); timer = null;
    playing = false;
    document.removeEventListener('keydown', onKey);
    ro.disconnect();
    offTheme();
    if (micStream) micStream.getTracks().forEach(x => x.stop());
    micStream = null; analyser = null;
    if (midiAccess){
      midiAccess.onstatechange = null;
      midiAccess.inputs.forEach(i => { i.onmidimessage = null; });
      midiAccess = null;
    }
    if (AC){ AC.close().catch(() => {}); AC = null; master = null; }
  };
}
