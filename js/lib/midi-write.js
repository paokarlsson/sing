/* Skriva en Standard MIDI File (format 0) ur kvantiserade toner. */

const PPQ = 480;

function encodeVarLen(value){
  const bytes = [value & 0x7f]; value >>= 7;
  while (value > 0){ bytes.unshift((value & 0x7f) | 0x80); value >>= 7; }
  return bytes;
}

/**
 * @param {{midi:number,start:number,end:number}[]} notes start/end i slag
 * @returns {Uint8Array} en komplett .mid-fil
 */
export function buildMIDI(notes, bpm, beatsPerBar){
  const micro = Math.round(60000000 / bpm);
  const body = [];
  body.push(...encodeVarLen(0), 0xFF, 0x51, 0x03, (micro >> 16) & 0xFF, (micro >> 8) & 0xFF, micro & 0xFF);
  body.push(...encodeVarLen(0), 0xFF, 0x58, 0x04, beatsPerBar, 2, 24, 8);

  const evs = [];
  notes.forEach(n => {
    evs.push({ tick: Math.round(n.start * PPQ), type: 1, midi: n.midi });
    evs.push({ tick: Math.round(n.end * PPQ), type: 0, midi: n.midi });
  });
  evs.sort((a, b) => a.tick - b.tick || (a.type - b.type));

  let lastTick = 0;
  evs.forEach(e => {
    body.push(...encodeVarLen(e.tick - lastTick)); lastTick = e.tick;
    body.push(e.type ? 0x90 : 0x80, e.midi, e.type ? 90 : 0);
  });
  body.push(...encodeVarLen(0), 0xFF, 0x2F, 0x00);

  const header = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xFF, PPQ & 0xFF];
  const trackHead = [0x4D, 0x54, 0x72, 0x6B,
    (body.length >>> 24) & 0xFF, (body.length >>> 16) & 0xFF, (body.length >>> 8) & 0xFF, body.length & 0xFF];
  return new Uint8Array([...header, ...trackHead, ...body]);
}

/** Ladda ner en Uint8Array som .mid-fil i webbläsaren. */
export function downloadMIDI(data, filename){
  const blob = new Blob([data], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
