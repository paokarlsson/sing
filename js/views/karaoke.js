/* Karaoke: spelar låten och fyller i texten ord för ord i takt med ljudet.
   Tiderna kommer från js/data/braskelibruskelibrang.js. */

import { song } from '../data/braskelibruskelibrang.js';

const PLAY = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const PAUSE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13"/></svg>';
const LEAD = 4;   // sekunder före första raden då nedräkningen visas

const fmt = s => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};

export function mount(root){
  const $ = id => root.querySelector('#' + id);
  const audio = $('kaudio'), play = $('kplay'), seek = $('kseek');
  const prev = $('kprev'), cur = $('kcur'), next = $('knext'), count = $('kcount');
  const list = $('klist');
  const lines = song.lines;

  $('ktitle').textContent = song.title;

  // Låten hämtas som blob: då går det att spola även när servern inte
  // stöder Range-förfrågningar (t.ex. python3 -m http.server).
  let blobUrl = null, alive = true;
  play.disabled = true;
  fetch(song.audio)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then(b => { if (!alive) return; blobUrl = URL.createObjectURL(b); audio.src = blobUrl; })
    .catch(() => { if (alive) audio.src = song.audio; })
    .finally(() => { play.disabled = false; });

  // Hela texten som klickbar lista.
  lines.forEach((l, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="kt">' + fmt(l.t) + '</span>';
    b.append(l.w.map(w => w[2]).join(' '));
    b.addEventListener('click', () => { audio.currentTime = Math.max(0, l.t - 0.3); audio.play(); });
    li.append(b);
    list.append(li);
  });
  const items = [...list.children];

  // Raden som visas: den senaste som börjat, men hoppa fram till nästa
  // när den inte ligger långt bort – då hinner man läsa den i förväg.
  function lineAt(t){
    let i = -1;
    for (let k = 0; k < lines.length; k++){ if (lines[k].t <= t + 0.15) i = k; else break; }
    if (i >= 0 && t > lines[i].e + 0.6 && i + 1 < lines.length && lines[i + 1].t - t < 3) i++;
    return i;
  }

  function wordsHtml(line){
    const frag = document.createDocumentFragment();
    line.w.forEach((w, k) => {
      const s = document.createElement('span');
      s.className = 'kw';
      s.textContent = w[2];
      frag.append(s);
      if (k < line.w.length - 1) frag.append(' ');
    });
    return frag;
  }
  const plain = l => (l ? l.w.map(w => w[2]).join(' ') : '');

  let shown = -2, words = [], raf = 0, dragging = false;

  function show(i){
    shown = i;
    prev.textContent = plain(lines[i - 1]);
    next.textContent = plain(lines[i + 1] || (i < 0 ? lines[1] : null));
    cur.replaceChildren(i >= 0 ? wordsHtml(lines[i]) : wordsHtml(lines[0]));
    cur.classList.toggle('waiting', i < 0);
    words = [...cur.querySelectorAll('.kw')];
    items.forEach((li, k) => li.classList.toggle('on', k === i));
    const li = items[i];
    if (li && !audio.paused){
      const r = li.getBoundingClientRect();
      if (r.top < 80 || r.bottom > innerHeight - 40) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function tick(){
    const t = audio.currentTime;
    const i = lineAt(t);
    if (i !== shown) show(i);
    if (i >= 0){
      lines[i].w.forEach((w, k) => {
        const p = t <= w[0] ? 0 : t >= w[1] ? 1 : (t - w[0]) / Math.max(0.05, w[1] - w[0]);
        words[k].style.setProperty('--p', (p * 100).toFixed(1) + '%');
      });
    }
    // Nedräkning före första raden.
    const until = lines[0].t - t;
    const showCount = i < 0 && until <= LEAD && until > 0 && !audio.paused;
    count.hidden = !showCount;
    if (showCount) count.textContent = Math.ceil(until);

    if (!dragging && audio.duration) seek.value = Math.round(t / audio.duration * 1000);
    $('know').textContent = fmt(t);
    if (!audio.paused) raf = requestAnimationFrame(tick);
  }

  function setPlayIcon(){
    const on = !audio.paused;
    play.innerHTML = on ? PAUSE : PLAY;
    play.setAttribute('aria-label', on ? 'Pausa' : 'Spela');
  }

  play.addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
  audio.addEventListener('play', () => { setPlayIcon(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  audio.addEventListener('pause', () => { setPlayIcon(); tick(); });
  audio.addEventListener('ended', setPlayIcon);
  audio.addEventListener('seeked', tick);
  audio.addEventListener('loadedmetadata', () => { $('ktot').textContent = fmt(audio.duration); });

  seek.addEventListener('input', () => {
    dragging = true;
    if (audio.duration) $('know').textContent = fmt(seek.value / 1000 * audio.duration);
  });
  seek.addEventListener('change', () => {
    dragging = false;
    if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration;
  });
  $('kvol').addEventListener('input', e => { audio.volume = e.target.value / 100; });

  const onKey = e => {
    if (e.code !== 'Space' || /INPUT|BUTTON|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  };
  document.addEventListener('keydown', onKey);

  setPlayIcon();
  show(-1);
  tick();

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  };
}
