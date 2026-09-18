/* Notnamn och klaviaturhjälp, delat av båda verktygen. */

export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

/** Vita tangenter som tonklasser (C D E F G A B). */
export const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);

/** MIDI-nummer till notnamn med oktav, t.ex. 60 → "C4". */
export function noteName(m){
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

/** Rundad rektangel på en 2D-kontext. Radien klipps mot bredd och höjd. */
export function roundRect(ctx, x, y, w, h, r){
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
