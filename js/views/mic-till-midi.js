/* Mic → MIDI: metronom, tonhöjdsdetektering, kvantisering mot taktnätet
   och export till .mid. All state ligger i mount() så att vyn kan rivas
   ner utan att lämna mikrofon eller ljudkontext igång. */

import { createPitchDetector, BUF_SIZE } from '../lib/pitch.js';
import { WHITE, noteName, roundRect } from '../lib/notes.js';
import { buildMIDI, downloadMIDI } from '../lib/midi-write.js';
import { onThemeChange, palette } from '../theme.js';

const LOOKAHEAD = 25, SCHEDULE_AHEAD = 0.12;
const SILENCE_GAP = 0.16, MIN_NOTE_SEC = 0.09, SMOOTH_N = 4;
const PPB = 64;                       // pixlar per slag
const PLAYHEAD_X_FRAC = 0.72;
const GUTTER = 34;
const LABEL_FONT = '500 11px Jost,system-ui,sans-serif';

/* Taktnätets färger bor i css/tokens.css och byter värde med temat.
   Här står bara vilket token som hör till vilken roll. */
const GRID = {
  rowWhite:   '--grid-row',        rowBlack:  '--grid-row-black',
  cLine:      '--grid-octave',     label:     '--grid-label',
  barLine:    '--grid-bar',        beatLine:  '--grid-beat',
  note:       '--grid-note',       noteOpen:  '--grid-note-open',
  noteText:   '--grid-note-text',  trace:     '--grid-trace',
  playhead:   '--grid-playhead',   playheadRec:'--grid-playhead-rec',
};

const detectPitch = createPitchDetector({ threshold: 0.15, rmsGate: 0.01, minHz: 70, maxHz: 1100 });

export function mount(root){
  const $ = sel => root.querySelector(sel);
  let disposed = false;

  /* ---------- ljud & metronom ---------- */
  let AC = null, master = null;
  let bpm = 90, beatsPerBar = 4, subdiv = 2;
  let running = false, t0 = 0, beatNumber = 0, nextBeatTime = 0, schedulerId = null;

  const secPerBeat = () => 60 / bpm;

  async function ensureAudio(){
    if (!AC){
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
    }
    if (AC.state === 'suspended') await AC.resume();
    return AC;
  }

  function clickAt(time, accent){
    const osc = AC.createOscillator(), g = AC.createGain();
    osc.type = 'sine'; osc.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(accent ? 0.32 : 0.18, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    osc.connect(g); g.connect(master);
    osc.start(time); osc.stop(time + 0.07);
  }

  function scheduler(){
    while (nextBeatTime < AC.currentTime + SCHEDULE_AHEAD){
      clickAt(nextBeatTime, beatNumber % beatsPerBar === 0);
      nextBeatTime += secPerBeat();
      beatNumber++;
    }
  }
  function stopMetronome(){
    running = false;
    if (schedulerId){ clearInterval(schedulerId); schedulerId = null; }
  }

  /* ---------- mikrofon ---------- */
  let analyser = null, mbuf = null, micStream = null, micOn = false, micSrcNode = null;

  function releaseMic(){
    if (micSrcNode){ try { micSrcNode.disconnect(); } catch (e) {} micSrcNode = null; }
    if (analyser){ try { analyser.disconnect(); } catch (e) {} analyser = null; }
    if (micStream) micStream.getTracks().forEach(x => x.stop());
    micStream = null; mbuf = null;
  }

  function stopMic(){
    micOn = false;
    if (recording || running) stopRecording();      // lämna inget hängande igång
    releaseMic();
    const b = $('#mic');
    b.classList.remove('on'); b.textContent = 'Mikrofon av'; b.setAttribute('aria-pressed', 'false');
    $('#rec').disabled = true;
    setPitchReadout(null, null);
    setStatus('');
    hideWarn();
  }

  async function micToggle(){
    const b = $('#mic');
    if (micOn){ stopMic(); return; }

    try {
      b.textContent = 'väntar på tillstånd…';
      // getUserMedia FÖRST, direkt i klick-eventet — inga await:s före,
      // så användargesten bevaras (samma ordning som i Psalmspelaren).
      micStream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (disposed){ micStream.getTracks().forEach(x => x.stop()); micStream = null; return; }
      await ensureAudio();
      if (AC.state === 'suspended') await AC.resume();
      micSrcNode = AC.createMediaStreamSource(micStream);
      analyser = AC.createAnalyser(); analyser.fftSize = BUF_SIZE;
      mbuf = new Float32Array(analyser.fftSize);
      micSrcNode.connect(analyser);      // ingen koppling till destination = ingen rundgång
      micOn = true;
      b.classList.add('on'); b.textContent = 'Mikrofon på'; b.setAttribute('aria-pressed', 'true');
      $('#rec').disabled = false;
      hideWarn(); setStatus('');
    } catch (e){
      b.textContent = 'Mikrofon av';
      showWarn('Fel: <code>' + (e.name || 'okänt') + '</code> — ' + (e.message || '') +
        '<br>secureContext: <code>' + window.isSecureContext + '</code>' +
        ' · protokoll: <code>' + location.protocol + '</code>' +
        ' · mediaDevices: <code>' + (!!navigator.mediaDevices) + '</code>');
    }
    b.disabled = false;
  }

  function showWarn(html){
    $('#warnText').innerHTML = html;
    $('#warnBanner').hidden = false;
    setStatus('');
  }
  function hideWarn(){ $('#warnBanner').hidden = true; }

  /* ---------- notsegmentering & kvantisering ---------- */
  let recording = false;
  let activeNote = null, pitchBuf = [], silenceSince = null;
  let rawTrace = [];               // {t, m|null} absolut AC-tid
  let notes = [];                  // {midi, start, end} i beat-enheter
  let loMidi = 55, hiMidi = 76;

  function mode(arr){
    const counts = {}; let best = arr[0], bestC = 0;
    for (const v of arr){ counts[v] = (counts[v] || 0) + 1; if (counts[v] >= bestC){ bestC = counts[v]; best = v; } }
    return best;
  }
  function extendRange(m){
    if (m < loMidi + 2) loMidi = Math.floor(m) - 2;
    if (m > hiMidi - 2) hiMidi = Math.ceil(m) + 2;
  }
  const beatAt = t => (t - t0) / secPerBeat();
  const quantizeBeat = b => Math.round(b * subdiv) / subdiv;

  function pushQuantized(midi, tStart, tEnd){
    const sb = quantizeBeat(beatAt(tStart));
    let eb = quantizeBeat(beatAt(tEnd));
    if (eb <= sb) eb = sb + 1 / subdiv;
    const last = notes[notes.length - 1];
    if (last && last.midi === midi && Math.abs(last.end - sb) < 1e-6){
      last.end = eb;
    } else {
      notes.push({ midi, start: sb, end: eb });
    }
    extendRange(midi);
    renderNoteList();
    updateExportState();
  }

  function closeActiveNote(t){
    if (!activeNote) return;
    if (t - activeNote.startT >= MIN_NOTE_SEC) pushQuantized(activeNote.nominal, activeNote.startT, t);
    activeNote = null;
  }

  function trimTrace(){ while (rawTrace.length > 1400) rawTrace.shift(); }

  function pitchFrame(t){
    if (!recording || t < t0){ rawTrace.push({ t, m: null }); trimTrace(); return; }
    analyser.getFloatTimeDomainData(mbuf);
    const f = detectPitch(mbuf, AC.sampleRate);

    if (f < 0){
      rawTrace.push({ t, m: null });
      if (silenceSince === null) silenceSince = t;
      if (activeNote && (t - silenceSince) > SILENCE_GAP) closeActiveNote(t);
      pitchBuf.length = 0;
      setPitchReadout(null, null);
    } else {
      silenceSince = null;
      const m = 69 + 12 * Math.log2(f / 440);
      rawTrace.push({ t, m });
      extendRange(m);
      pitchBuf.push(Math.round(m));
      if (pitchBuf.length > SMOOTH_N) pitchBuf.shift();
      const nominal = mode(pitchBuf);
      if (!activeNote){
        activeNote = { nominal, startT: t };
      } else if (nominal !== activeNote.nominal){
        if (pitchBuf.length >= SMOOTH_N && pitchBuf.every(x => x === nominal)){
          closeActiveNote(t);
          activeNote = { nominal, startT: t };
        }
      }
      setPitchReadout(m, f);
    }
    trimTrace();
  }

  function setPitchReadout(m, f){
    const noteEl = $('#pitchNote'), hzEl = $('#pitchHz');
    if (m === null){
      noteEl.textContent = '–'; noteEl.classList.remove('pitch-on'); hzEl.textContent = '–'; return;
    }
    noteEl.textContent = noteName(Math.round(m)); noteEl.classList.add('pitch-on');
    hzEl.textContent = Math.round(f) + ' Hz';
  }

  /* ---------- inspelning: styrning ---------- */
  let countInId = null;

  async function startRecording(){
    if (!micOn || recording) return;
    await ensureAudio();
    if (disposed) return;
    $('#rec').disabled = true;
    $('#bpm').disabled = true;
    $('#tsig').disabled = true;
    $('#subdiv').disabled = true;
    $('#stop').disabled = false;

    const spb = secPerBeat(), startDelay = 0.12, now = AC.currentTime;
    for (let i = 0; i < beatsPerBar; i++) clickAt(now + startDelay + i * spb, i === 0);
    t0 = now + startDelay + beatsPerBar * spb;
    beatNumber = 0; nextBeatTime = t0; running = true;
    schedulerId = setInterval(scheduler, LOOKAHEAD);

    let left = beatsPerBar;
    setStatus('räknar in… ' + left);
    countInId = setInterval(() => {
      left--;
      if (left <= 0){
        clearInterval(countInId); countInId = null;
        recording = true; setStatus('spelar in');
        $('#rec').classList.add('active');
        $('#rec').textContent = 'Inspelning pågår';
      } else setStatus('räknar in… ' + left);
    }, spb * 1000);
  }

  function stopRecording(){
    if (countInId){ clearInterval(countInId); countInId = null; }
    if (activeNote && AC) closeActiveNote(AC.currentTime);
    recording = false;
    stopMetronome();
    const rec = $('#rec');
    rec.disabled = !micOn; rec.classList.remove('active'); rec.textContent = 'Spela in';
    $('#stop').disabled = true;
    $('#bpm').disabled = false;
    $('#tsig').disabled = false;
    $('#subdiv').disabled = false;
    setStatus(notes.length ? 'stoppad' : 'stoppad – inga toner hördes');
    setPitchReadout(null, null);
  }

  function setStatus(s){ $('#statusText').textContent = s; }

  /* ---------- lista & redigering ---------- */
  function renderNoteList(){
    const el = $('#notelist');
    $('#noteCount').textContent = notes.length;
    $('#undo').disabled = notes.length === 0;
    $('#clear').disabled = notes.length === 0;
    if (!notes.length){
      el.innerHTML = '<div class="empty">Inga toner ännu. Spela in för att börja.</div>'; return;
    }
    el.innerHTML = '';
    notes.forEach((n, i) => {
      const row = document.createElement('div'); row.className = 'noterow';
      const dur = (n.end - n.start).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      row.innerHTML = '<span class="nm">' + noteName(n.midi) + '</span>' +
        '<span class="beats">slag ' + n.start.toFixed(2) + ' → ' + n.end.toFixed(2) +
        '  (' + dur + ' slag)</span>';
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕';
      del.setAttribute('aria-label', 'Ta bort ton');
      del.addEventListener('click', () => { notes.splice(i, 1); renderNoteList(); updateExportState(); });
      row.appendChild(del);
      el.appendChild(row);
    });
  }
  function updateExportState(){
    $('#exportBtn').disabled = notes.length === 0;
    $('#play').disabled = notes.length === 0 || recording;
  }

  /* ---------- uppspelning ---------- */
  function playBack(){
    if (!notes.length || recording) return;
    ensureAudio().then(() => {
      if (disposed) return;
      const spb = secPerBeat(), start = AC.currentTime + 0.15;
      const lastBeat = Math.max(...notes.map(n => n.end));
      const bars = Math.ceil(lastBeat / beatsPerBar) + 1;
      for (let i = 0; i < bars * beatsPerBar; i++) clickAt(start + i * spb, i % beatsPerBar === 0);
      notes.forEach(n => {
        const t1 = start + n.start * spb, t2 = start + n.end * spb;
        const osc = AC.createOscillator(), g = AC.createGain();
        osc.type = 'triangle'; osc.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12);
        g.gain.setValueAtTime(0.0001, t1);
        g.gain.linearRampToValueAtTime(0.28, t1 + 0.02);
        g.gain.setValueAtTime(0.24, Math.max(t1 + 0.02, t2 - 0.05));
        g.gain.linearRampToValueAtTime(0.0001, t2);
        osc.connect(g); g.connect(master);
        osc.start(t1); osc.stop(t2 + 0.02);
      });
    });
  }

  /* ---------- export ---------- */
  function exportMIDI(){
    if (!notes.length) return;
    downloadMIDI(buildMIDI(notes, bpm, beatsPerBar), 'melodi.mid');
  }

  /* ---------- canvas ---------- */
  const cv = $('#c'), ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1, lastBeatShown = 0, rafId = 0;

  let P = palette(GRID);
  const offTheme = onThemeChange(() => { P = palette(GRID); });

  function resize(){
    const r = cv.parentElement.getBoundingClientRect();
    DPR = Math.max(1, window.devicePixelRatio || 1);
    W = Math.round(r.width); H = cv.clientHeight || 280;
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  const ro = new ResizeObserver(resize); ro.observe(cv.parentElement);

  const midiY = m => H - ((m - loMidi) / (hiMidi - loMidi)) * H;
  const rr = (x, y, w, h, r) => roundRect(ctx, x, y, w, h, r);

  function currentBeatNow(){
    if (running) return Math.max(0, (AC.currentTime - t0) / secPerBeat());
    return lastBeatShown;
  }

  function draw(){
    if (!W) resize();
    ctx.clearRect(0, 0, W, H);

    const curBeat = currentBeatNow(); lastBeatShown = curBeat;
    const playheadX = W * PLAYHEAD_X_FRAC;
    const beatToX = b => playheadX - (curBeat - b) * PPB;

    // pitchrader
    const rowH = H / Math.max(1, (hiMidi - loMidi));
    for (let m = loMidi; m < hiMidi; m++){
      const y0 = midiY(m + 1), y1 = midiY(m);
      ctx.fillStyle = WHITE.has(((m % 12) + 12) % 12) ? P.rowWhite : P.rowBlack;
      ctx.fillRect(GUTTER, y0, W - GUTTER, y1 - y0);
      if (((m % 12) + 12) % 12 === 0){
        ctx.strokeStyle = P.cLine; ctx.beginPath();
        ctx.moveTo(GUTTER, y0); ctx.lineTo(W, y0); ctx.stroke();
        ctx.fillStyle = P.label; ctx.font = LABEL_FONT;
        ctx.fillText('C' + (Math.floor(m / 12) - 1), 6, y0 + 3);
      }
    }

    // taktnät
    const firstBeat = Math.floor(curBeat - (playheadX - GUTTER) / PPB) - 1;
    const lastBeatX = curBeat + (W - playheadX) / PPB + 1;
    for (let b = Math.max(0, firstBeat); b <= lastBeatX; b++){
      const x = beatToX(b); if (x < GUTTER - 2 || x > W) continue;
      const bar = b % beatsPerBar === 0;
      ctx.strokeStyle = bar ? P.barLine : P.beatLine;
      ctx.lineWidth = bar ? 1.2 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // färdiga toner
    ctx.font = LABEL_FONT;
    notes.forEach(n => {
      const x1 = beatToX(n.start), x2 = beatToX(n.end);
      if (x2 < GUTTER || x1 > W) return;
      const y = midiY(n.midi + 0.5), h = Math.max(6, rowH * 0.72);
      ctx.fillStyle = P.note;
      rr(Math.max(x1, GUTTER), y - h / 2, Math.min(x2, W) - Math.max(x1, GUTTER), h, 3);
      ctx.fill();
      if (x2 - x1 > 26){
        ctx.fillStyle = P.noteText; ctx.fillText(noteName(n.midi), Math.max(x1, GUTTER) + 4, y + 3.5);
      }
    });

    // pågående ton (ej stängd)
    if (activeNote){
      const x1 = beatToX(beatAt(activeNote.startT)), x2 = beatToX(curBeat);
      const y = midiY(activeNote.nominal + 0.5), h = Math.max(6, rowH * 0.72);
      ctx.fillStyle = P.noteOpen;
      rr(Math.max(x1, GUTTER), y - h / 2, Math.max(2, Math.min(x2, W) - Math.max(x1, GUTTER)), h, 3);
      ctx.fill();
    }

    // rå tonhöjdslinje
    ctx.strokeStyle = P.trace; ctx.lineWidth = 1.6; ctx.beginPath();
    let started = false;
    for (const p of rawTrace){
      if (p.m === null){ started = false; continue; }
      const x = beatToX(beatAt(p.t));
      if (x < GUTTER || x > W){ started = false; continue; }
      const y = midiY(p.m);
      if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
    }
    ctx.stroke();

    // playhead
    ctx.strokeStyle = recording ? P.playheadRec : P.playhead;
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(playheadX, 0); ctx.lineTo(playheadX, H); ctx.stroke();

    // beatposition-text
    const bar = Math.floor(curBeat / beatsPerBar) + 1, beatInBar = (Math.floor(curBeat) % beatsPerBar) + 1;
    $('#beatPos').textContent = running ? (bar + ' · ' + beatInBar) : '–';
  }

  /* En loop för både tonhöjdsavläsning och ritning. */
  function loop(){
    if (disposed) return;
    if (AC && micOn) pitchFrame(AC.currentTime);
    draw();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- koppla ihop ---------- */
  const bpmEl = $('#bpm'), bpmNum = $('#bpmNum');
  bpmEl.addEventListener('input', () => { bpm = +bpmEl.value; bpmNum.textContent = bpm; });
  $('#tsig').addEventListener('change', e => { beatsPerBar = +e.target.value; });
  $('#subdiv').addEventListener('change', e => { subdiv = +e.target.value; });

  $('#mic').addEventListener('click', micToggle);
  $('#rec').addEventListener('click', startRecording);
  $('#stop').addEventListener('click', stopRecording);
  $('#play').addEventListener('click', playBack);
  $('#undo').addEventListener('click', () => { notes.pop(); renderNoteList(); updateExportState(); });
  $('#clear').addEventListener('click', () => {
    notes = []; rawTrace = []; activeNote = null; loMidi = 55; hiMidi = 76;
    renderNoteList(); updateExportState();
  });
  $('#exportBtn').addEventListener('click', exportMIDI);

  resize();
  renderNoteList();
  rafId = requestAnimationFrame(loop);

  /* ---------- riv ner ---------- */
  return function unmount(){
    disposed = true;
    cancelAnimationFrame(rafId);
    if (countInId){ clearInterval(countInId); countInId = null; }
    recording = false;
    stopMetronome();
    releaseMic();
    micOn = false;
    ro.disconnect();
    offTheme();
    if (AC){ AC.close().catch(() => {}); AC = null; master = null; }
  };
}
