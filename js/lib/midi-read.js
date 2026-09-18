/* Läsa Standard MIDI File (.mid/.kar) och göra om den till ett psalmobjekt
   med samma form som psalmerna i js/data/songs.js. */

function decodeText(bytes){
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
}

/** Plocka isär en SMF till spår med råa händelser. */
export function parseSMF(buf){
  const dv = new DataView(buf); let p = 0;
  const tag = () => { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(dv.getUint8(p++)); return s; };
  const vlq = () => { let v = 0, b; do { b = dv.getUint8(p++); v = (v << 7) | (b & 0x7F); } while (b & 0x80); return v; };

  if (tag() !== 'MThd') throw new Error('Filen är inte en MIDI-fil');
  const hlen = dv.getUint32(p); p += 4;
  p += 2;                                    // format
  const ntrk = dv.getUint16(p); p += 2;
  const div = dv.getUint16(p); p += 2;
  if (div & 0x8000) throw new Error('SMPTE-tidkod stöds inte');
  p += hlen - 6;

  const tracks = [];
  for (let i = 0; i < ntrk && p < buf.byteLength; i++){
    if (tag() !== 'MTrk') break;
    const len = dv.getUint32(p); p += 4;
    const end = p + len; let tick = 0, running = 0; const ev = [];
    while (p < end){
      tick += vlq();
      let st = dv.getUint8(p);
      if (st & 0x80){ p++; running = st; } else st = running;
      if (st === 0xFF){
        const type = dv.getUint8(p++), l = vlq();
        ev.push({ tick, meta: type, bytes: new Uint8Array(buf.slice(p, p + l)) }); p += l;
      } else if (st === 0xF0 || st === 0xF7){ const l = vlq(); p += l; }
      else {
        const cmd = st & 0xF0, d1 = dv.getUint8(p++);
        const d2 = (cmd === 0xC0 || cmd === 0xD0) ? 0 : dv.getUint8(p++);
        ev.push({ tick, cmd, d1, d2 });
      }
    }
    p = end; tracks.push(ev);
  }
  return { div, tracks };
}

/** SMF → psalmobjekt {notes, syl, verses, …}. Kastar vid trasig fil. */
export function midiToSong(buf, filename){
  const { div, tracks } = parseSMF(buf);

  // tempokarta
  const tempos = [];
  tracks.forEach(tr => tr.forEach(e => {
    if (e.meta === 0x51 && e.bytes.length === 3)
      tempos.push({ tick: e.tick, us: (e.bytes[0] << 16) | (e.bytes[1] << 8) | e.bytes[2] });
  }));
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, us: 500000 });
  const marks = [{ tick: 0, sec: 0, us: tempos[0].us }];
  for (let i = 1; i < tempos.length; i++){
    const prev = marks[marks.length - 1];
    marks.push({
      tick: tempos[i].tick,
      sec: prev.sec + (tempos[i].tick - prev.tick) / div * (prev.us / 1e6),
      us: tempos[i].us,
    });
  }
  const toSec = tk => {
    let m = marks[0];
    for (const x of marks){ if (x.tick <= tk) m = x; else break; }
    return m.sec + (tk - m.tick) / div * (m.us / 1e6);
  };

  // noter per spår
  const perTrack = tracks.map(tr => {
    const open = new Map(), out = [];
    for (const e of tr){
      if (e.cmd === 0x90 && e.d2 > 0){
        if (!open.has(e.d1)) open.set(e.d1, []);
        open.get(e.d1).push(e.tick);
      } else if (e.cmd === 0x80 || (e.cmd === 0x90 && e.d2 === 0)){
        const st = open.get(e.d1);
        if (st && st.length){
          const t0 = st.shift();
          out.push({ tick: t0, m: e.d1, t: toSec(t0), d: Math.max(toSec(e.tick) - toSec(t0), 0.05) });
        }
      }
    }
    return out.sort((a, b) => a.tick - b.tick || a.m - b.m);
  });

  // melodispår: det med flest lyric-events, annars högst medeltonhöjd
  const lyrCount = tracks.map(tr => tr.filter(e => e.meta === 0x05).length);
  let mi = lyrCount.indexOf(Math.max(...lyrCount));
  if (lyrCount[mi] === 0){
    let best = -1; mi = 0;
    perTrack.forEach((ns, i) => {
      if (!ns.length) return;
      const avg = ns.reduce((a, n) => a + n.m, 0) / ns.length;
      if (avg > best){ best = avg; mi = i; }
    });
  }
  if (!perTrack[mi] || !perTrack[mi].length) throw new Error('Hittade inga toner i filen');

  // stavelser mot melodinoter
  const lyr = [];
  tracks[mi].forEach(e => {
    if (e.meta === 0x05 || (e.meta === 0x01 && lyrCount[mi] === 0))
      lyr.push({ tick: e.tick, x: decodeText(e.bytes) });
  });
  lyr.sort((a, b) => a.tick - b.tick);

  const tol = div / 4;
  const notes = [], syl = []; let lines = 0, li = 0;
  perTrack[mi].forEach(n => {
    let idx = -1;
    while (li < lyr.length && lyr[li].tick < n.tick - tol) li++;
    if (li < lyr.length && lyr[li].tick <= n.tick + tol){
      let text = lyr[li].x; li++;
      const br = /^[\r\n/\\]+/.exec(text);
      if (br){ text = text.slice(br[0].length); if (syl.length) lines++; }
      if (text.trim() !== ''){ idx = syl.length; syl.push({ t: +n.t.toFixed(4), x: text, line: lines, v: 1 }); }
    }
    notes.push({ t: +n.t.toFixed(4), d: +n.d.toFixed(4), m: n.m, h: 0, s: idx });
  });
  perTrack.forEach((ns, i) => {
    if (i === mi) return;
    ns.forEach(n => notes.push({ t: +n.t.toFixed(4), d: +n.d.toFixed(4), m: n.m, h: 1, s: -1 }));
  });
  notes.sort((a, b) => a.t - b.t);

  // titel och tonart
  let title = '';
  tracks.forEach(tr => tr.forEach(e => { if (e.meta === 0x03 && !title) title = decodeText(e.bytes).trim(); }));
  if (!title) title = filename.replace(/\.(midi?|kar)$/i, '');

  let keyPc = null;
  tracks.forEach(tr => tr.forEach(e => {
    if (e.meta === 0x59 && e.bytes.length === 2 && e.bytes[1] === 0){
      const sf = (e.bytes[0] << 24 >> 24); keyPc = ((sf * 7) % 12 + 12) % 12;
    }
  }));
  if (keyPc === null){                    // ingen tonartsangivelse: gissa på slutackordets baston
    const last = Math.max(...notes.map(n => n.t));
    const fin = notes.filter(n => n.t > last - 0.05).map(n => n.m);
    keyPc = fin.length ? ((Math.min(...fin) % 12) + 12) % 12 : 0;
  }

  const end = Math.max(...notes.map(n => n.t + n.d));
  return {
    id: 'egen' + Date.now(), nr: 950, nrLabel: 'egen', title, keyPc, bpm: 0,
    credit: 'Inläst ur <b>' + filename + '</b>', source: 'din egen MIDI-fil',
    notes, syl, nLines: lines + 1, end: +end.toFixed(3), verses: [],
  };
}
