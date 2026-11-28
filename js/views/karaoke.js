/* Karaoke: välj en låt, så spelas den och texten rullar förbi med
   orden ifyllda i takt med sången. En boll studsar över ordet som
   sjungs. Låtlistan finns i js/data/karaoke.js. */

import { SONGS } from '../data/karaoke.js';

const ICON = d => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
const PLAY = ICON('<path d="M8 5.5v13l10.5-6.5z"/>');
const PAUSE = ICON('<path d="M8.5 5.5v13M15.5 5.5v13"/>');
const FS_ON = ICON('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>');
const FS_OFF = ICON('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>');
const NOTE = ICON('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>');
const LEAD = 4;        // sekunder före första raden då nedräkningen visas
const FOCUS = 0.4;     // var på scenen (andel av höjden) den sjungna raden ligger
const HOP = 16;        // bollens studshöjd i px
const STORE = 'sing-karaoke-song';

const fmt = s => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};

export function mount(root){
  const $ = id => root.querySelector('#' + id);
  const audio = $('kaudio'), play = $('kplay'), seek = $('kseek');
  const player = $('kplayer'), stage = $('kstage'), roll = $('kroll');
  const ball = $('kball'), count = $('kcount'), list = $('klist');
  const fsBtn = $('kfs'), picker = $('kpicker');

  let alive = true, raf = 0, dragging = false;
  let lines = [], rows = [], items = [], centers = [], active = -2;
  let blobUrl = null, loadId = 0;

  // ---------- låtväljare ----------
  const cards = SONGS.map(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kcard';
    b.innerHTML = '<span class="kcard-icon">' + NOTE + '</span>' +
      '<span class="kcard-title"></span><span class="kcard-len">' + s.length + '</span>';
    b.querySelector('.kcard-title').textContent = s.title;
    b.addEventListener('click', () => choose(s, true));
    picker.append(b);
    return b;
  });

  async function choose(entry, autoplay){
    const id = ++loadId;
    cards.forEach((c, k) => c.setAttribute('aria-pressed', String(SONGS[k] === entry)));
    try { localStorage.setItem(STORE, entry.id); } catch (e) {}

    audio.pause();
    play.disabled = true;
    const { song } = await entry.load();
    if (!alive || id !== loadId) return;
    build(song);

    // Låten hämtas som blob: då går det att spola även när servern inte
    // stöder Range-förfrågningar (t.ex. python3 -m http.server).
    if (blobUrl){ URL.revokeObjectURL(blobUrl); blobUrl = null; }
    let src = song.audio;
    try {
      const r = await fetch(song.audio);
      if (!r.ok) throw new Error(r.status);
      const blob = await r.blob();
      if (!alive || id !== loadId) return;
      blobUrl = src = URL.createObjectURL(blob);
    } catch (e) {}
    if (!alive || id !== loadId) return;
    audio.src = src;
    play.disabled = false;
    if (autoplay) audio.play().catch(() => {});
  }

  // ---------- bygg rullen och listan för en låt ----------
  function build(song){
    $('ktitle').textContent = song.title;
    lines = song.lines;
    active = -2;
    roll.querySelectorAll('.krow').forEach(r => r.remove());
    list.replaceChildren();

    const jump = l => { audio.currentTime = Math.max(0, l.t - 0.3); audio.play(); };

    rows = lines.map(l => {
      const p = document.createElement('p');
      p.className = 'krow';
      l.w.forEach((w, k) => {
        const s = document.createElement('span');
        s.className = 'kw';
        s.textContent = w[2];
        p.append(s);
        if (k < l.w.length - 1) p.append(' ');
      });
      p.addEventListener('click', () => jump(l));
      roll.append(p);
      return { el: p, words: [...p.children] };
    });

    items = lines.map(l => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="kt">' + fmt(l.t) + '</span>';
      b.append(l.w.map(w => w[2]).join(' '));
      b.addEventListener('click', () => jump(l));
      li.append(b);
      list.append(li);
      return li;
    });

    seek.value = 0;
    $('know').textContent = '0:00';
    $('ktot').textContent = '0:00';
    measure();
  }

  // Radernas mittpunkter i rullen. Mäts om när storleken ändras
  // (typsnitt som laddas, fönsterbredd, helskärm).
  function measure(){
    centers = rows.map(r => r.el.offsetTop + r.el.offsetHeight / 2);
    tick();
  }
  const ro = new ResizeObserver(measure);
  ro.observe(roll);
  ro.observe(stage);

  // Rullens läge som ett flyttal: i + andel av vägen till nästa rad.
  // Linjärt från en rads start till nästa, så texten glider hela tiden.
  function position(t){
    const n = lines.length, first = lines[0].t;
    // Före första raden: glid in från strax under fokus.
    if (t < first) return -0.6 * (1 - Math.max(0, t) / first);
    let i = 0;
    while (i + 1 < n && lines[i + 1].t <= t) i++;
    const a = lines[i].t;
    const b = i + 1 < n ? lines[i + 1].t : a + (lines[n - 1].t - first) / Math.max(1, n - 1);
    return i + (t - a) / (b - a);
  }

  function lineAt(t){
    let i = -1;
    for (let k = 0; k < lines.length; k++){ if (lines[k].t <= t + 0.1) i = k; else break; }
    return i;
  }

  function setActive(i){
    rows.forEach((r, k) => {
      r.el.classList.toggle('past', k < i);
      r.el.classList.toggle('cur', k === i);
      if (k !== i){
        const v = k < i ? '100%' : '0%';
        r.words.forEach(w => w.style.setProperty('--p', v));
      }
    });
    items.forEach((li, k) => li.classList.toggle('on', k === i));
    active = i;
  }

  // Bollen: ligger över ordet som sjungs, studsar en gång per ord och
  // glider över till nästa ord under början av det.
  function placeBall(t, i){
    const line = lines[i];
    if (!line || t > line.e + 0.4){ ball.hidden = true; return; }
    let k = 0;
    while (k + 1 < line.w.length && line.w[k + 1][0] <= t) k++;
    const w = line.w[k], el = rows[i].words[k];
    const len = Math.max(0.12, w[1] - w[0]);
    const p = Math.min(1, Math.max(0, (t - w[0]) / len));
    const cx = el.offsetLeft + el.offsetWidth / 2;
    let x = cx;
    if (k > 0 && p < 0.35){
      const pe = rows[i].words[k - 1];
      const px = pe.offsetLeft + pe.offsetWidth / 2;
      x = px + (cx - px) * (p / 0.35);
    }
    const y = el.offsetTop - Math.sin(Math.PI * p) * HOP;
    ball.hidden = false;
    ball.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  }

  function tick(){
    if (!alive || !lines.length) return;
    const t = audio.currentTime;
    const i = lineAt(t);
    if (i !== active) setActive(i);

    if (i >= 0){
      lines[i].w.forEach((w, k) => {
        const p = t <= w[0] ? 0 : t >= w[1] ? 1 : (t - w[0]) / Math.max(0.05, w[1] - w[0]);
        rows[i].words[k].style.setProperty('--p', (p * 100).toFixed(1) + '%');
      });
    }
    placeBall(t, i);

    if (centers.length > 1){
      const f = position(t), n = centers.length;
      const k = Math.min(n - 2, Math.max(0, Math.floor(f)));
      const y = centers[k] + (f - k) * (centers[k + 1] - centers[k]);
      roll.style.transform = 'translateY(' + (stage.clientHeight * FOCUS - y).toFixed(1) + 'px)';
    }

    const until = lines[0].t - t;
    const showCount = until <= LEAD && until > 0 && !audio.paused;
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

  // ---------- helskärm ----------
  // Webbläsare utan Fullscreen API för element (iPhone) får en
  // CSS-variant som täcker fönstret i stället.
  const canFs = !!(player.requestFullscreen || player.webkitRequestFullscreen);
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFull = () => fsEl() === player || player.classList.contains('kfull');

  function setFsIcon(){
    const on = isFull();
    fsBtn.innerHTML = on ? FS_OFF : FS_ON;
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.setAttribute('aria-label', on ? 'Avsluta helskärm' : 'Helskärm');
    document.documentElement.classList.toggle('kfull-open', player.classList.contains('kfull'));
  }
  function toggleFs(){
    if (isFull()){
      if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      player.classList.remove('kfull');
    } else if (canFs){
      const req = player.requestFullscreen || player.webkitRequestFullscreen;
      Promise.resolve(req.call(player)).catch(() => player.classList.add('kfull')).finally(setFsIcon);
    } else {
      player.classList.add('kfull');
    }
    setFsIcon();
  }
  fsBtn.addEventListener('click', toggleFs);
  document.addEventListener('fullscreenchange', setFsIcon);
  document.addEventListener('webkitfullscreenchange', setFsIcon);

  // ---------- transport ----------
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
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space' && e.target.tagName !== 'BUTTON'){
      e.preventDefault();
      if (!play.disabled) audio.paused ? audio.play() : audio.pause();
    } else if (e.key === 'f' || e.key === 'F'){
      toggleFs();
    } else if (e.key === 'Escape' && player.classList.contains('kfull')){
      toggleFs();
    }
  };
  document.addEventListener('keydown', onKey);

  setPlayIcon();
  setFsIcon();

  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch (e) {}
  choose(SONGS.find(s => s.id === saved) || SONGS[0], false);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', setFsIcon);
    document.removeEventListener('webkitfullscreenchange', setFsIcon);
    if (fsEl() === player) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    document.documentElement.classList.remove('kfull-open');
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  };
}
