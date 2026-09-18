/* Håller skärmen tänd medan man sjunger.

   Man håller inte i telefonen när man sjunger, så skärmen hinner slockna mitt
   i en psalm. Knappen i topplisten begär ett skärmlås (Screen Wake Lock) och
   minns valet mellan besök, precis som temaknappen.

   Två saker gör det lite mer än en boolean:

   1. Webbläsaren släpper låset så fort fliken göms. Vi tar det därför på nytt
      när den syns igen.
   2. Låset kan nekas — oftast för att det vill ha en klickning bakom sig, till
      exempel när valet återtas vid sidladdning. Då behåller vi användarens val
      och försöker igen vid nästa klick i stället för att tyst slå av det.

   Knappen är dold när webbläsaren saknar stödet; initWakeLock visar den. */

const KEY = 'sing-wakelock';
const supported = 'wakeLock' in navigator;

let wanted = false;   // användarens val
let lock = null;      // aktivt skärmlås, eller null
let waiting = false;  // väntar på en klickning för att få låset
let button = null;

function stored(){
  try { return localStorage.getItem(KEY) === 'on'; } catch (e) { return false; }
}
function remember(on){
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* privat läge */ }
}

/* Ikoner enligt stilpaketet: inline-SVG, 1,5px linje i currentColor.
   Samma skärm i båda lägena, överstruken när den får slockna. */
const SCREEN = '<rect x="2.8" y="4.3" width="18.4" height="12.4" rx="2.4"/>' +
  '<path d="M12 16.7v3.4M8.6 20.1h6.8"/>';
const AWAKE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + SCREEN + '</svg>';
const ASLEEP = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + SCREEN +
  '<path d="M4.2 3.4 19.8 20.6"/></svg>';

function sync(){
  button.innerHTML = wanted ? AWAKE : ASLEEP;
  button.setAttribute('aria-pressed', String(wanted));
  button.title = wanted ? 'Skärmen hålls tänd' : 'Skärmen får slockna';
}

/* Väntar in nästa klick eller tangenttryck och försöker då igen.
   En omgång per gest — misslyckas den laddar vi om fällan. */
function retryOnGesture(){
  if (waiting) return;
  waiting = true;
  const once = () => {
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    waiting = false;
    acquire();
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

async function acquire(){
  if (lock || !wanted || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    // Systemet släpper låset självt när fliken göms eller batteriet tryter.
    lock.addEventListener('release', () => { lock = null; });
  } catch (err){
    lock = null;
    retryOnGesture();
  }
}

async function release(){
  const held = lock;
  lock = null;
  if (held){ try { await held.release(); } catch (e) { /* redan släppt */ } }
}

function setWanted(on){
  wanted = on;
  remember(on);
  sync();
  if (on) acquire(); else release();
}

export function initWakeLock(btn){
  if (!supported) return;   // knappen förblir dold
  button = btn;
  button.hidden = false;

  wanted = stored();
  sync();

  button.addEventListener('click', () => setWanted(!wanted));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });

  acquire();                // återta valet från förra besöket
}
