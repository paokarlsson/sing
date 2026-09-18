/* Gemensamt färgtema för hela appen.
   Sätter data-theme på <html>, minns valet och låter vyer prenumerera
   så att canvas-paletter kan följa med. */

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

export function initTheme(button){
  const saved = stored();
  const prefersLight = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(saved || (prefersLight ? 'light' : 'dark'), { persist: false });

  const sync = () => {
    button.textContent = current === 'light' ? '☀' : '☾';
    button.setAttribute('aria-pressed', String(current === 'light'));
  };
  sync();
  onThemeChange(sync);
  button.addEventListener('click', () => setTheme(current === 'light' ? 'dark' : 'light'));
}
