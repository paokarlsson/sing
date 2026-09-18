/* Gemensamt färgtema för hela appen.
   Sätter data-theme på <html>, minns valet och låter vyer prenumerera
   så att canvas-paletter kan följa med.

   Färgerna själva bor i css/tokens.css. Ritkoden hämtar sina via
   palette() i stället för att ha egna hårdkodade värden. */

const KEY = 'sing-theme';
const listeners = new Set();
let current = 'dark';

function stored(){
  try { return localStorage.getItem(KEY); } catch (e) { return null; }
}
function remember(name){
  try { localStorage.setItem(KEY, name); } catch (e) { /* privat läge */ }
}

export function getTheme(){ return current; }

/** Läser en uppsättning färgtokens ur CSS.
    map är {nyckel: '--token'} och resultatet {nyckel: 'färgvärde'}.
    Anropa om vid temabyte — tokens byter värde med data-theme. */
export function palette(map){
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const key in map) out[key] = cs.getPropertyValue(map[key]).trim();
  return out;
}

export function setTheme(name, { persist = true } = {}){
  current = name === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', current);
  if (persist) remember(current);
  listeners.forEach(fn => fn(current));
}

/** Prenumerera på temabyten. Anropas direkt med nuvarande tema.
    Returnerar en funktion som avslutar prenumerationen. */
export function onThemeChange(fn){
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/* Ikoner enligt stilpaketet: inline-SVG, 1,5px linje i currentColor. */
const MOON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z"/></svg>';
const SUN = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2' +
  'M6.5 6.5 5 5M19 19l-1.5-1.5M17.5 6.5 19 5M5 19l1.5-1.5"/></svg>';

export function initTheme(button){
  const saved = stored();
  const prefersLight = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(saved || (prefersLight ? 'light' : 'dark'), { persist: false });

  const sync = () => {
    button.innerHTML = current === 'light' ? SUN : MOON;
    button.setAttribute('aria-pressed', String(current === 'light'));
  };
  sync();
  onThemeChange(sync);
  button.addEventListener('click', () => setTheme(current === 'light' ? 'dark' : 'light'));
}
