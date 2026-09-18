/* Appens stomme: hash-router, temaknapp och vylivscykel.

   Varje vy består av tre delar:
     views/<namn>.html   markup
     css/<namn>.css      stilar (scopade till vyns rotklass)
     js/views/<namn>.js  beteende – exporterar mount(root) som får
                         returnera en städfunktion.
   Vy-modulen och dess markup laddas först när rutten besöks. */

import { initTheme } from './theme.js';

const ROUTES = {
  '/': {
    title: 'Sjunga',
    markup: 'views/home.html',
    load: () => import('./views/home.js'),
  },
  '/psalmspelaren': {
    title: 'Psalmspelaren · Sjunga',
    markup: 'views/psalmspelaren.html',
    load: () => import('./views/psalmspelaren.js'),
  },
  '/mic-till-midi': {
    title: 'Mic → MIDI · Sjunga',
    markup: 'views/mic-till-midi.html',
    load: () => import('./views/mic-till-midi.js'),
  },
};
const DEFAULT_ROUTE = '/';

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const markupCache = new Map();

let unmount = null;      // städfunktion för vyn som visas
let renderId = 0;        // skyddar mot att en långsam vy hinner ifatt en nyare

function currentPath(){
  const hash = location.hash.slice(1);
  return Object.prototype.hasOwnProperty.call(ROUTES, hash) ? hash : DEFAULT_ROUTE;
}

async function markupFor(route){
  if (!markupCache.has(route.markup)){
    const res = await fetch(route.markup, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    markupCache.set(route.markup, await res.text());
  }
  return markupCache.get(route.markup);
}

function markActiveTab(path){
  tabs.querySelectorAll('a').forEach(a => {
    if (a.getAttribute('href') === '#' + path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function render(path){
  const route = ROUTES[path];
  const id = ++renderId;

  if (unmount){ unmount(); unmount = null; }
  view.dataset.state = 'loading';
  view.innerHTML = '<p class="loading">Laddar…</p>';
  document.documentElement.setAttribute('data-route', path);
  document.title = route.title;
  markActiveTab(path);

  try {
    const [html, mod] = await Promise.all([markupFor(route), route.load()]);
    if (id !== renderId) return;             // användaren hann byta vy
    view.innerHTML = html;
    view.dataset.state = 'ready';
    const cleanup = mod.mount(view);
    if (id !== renderId){ if (typeof cleanup === 'function') cleanup(); return; }
    unmount = typeof cleanup === 'function' ? cleanup : null;
  } catch (err){
    if (id !== renderId) return;
    view.dataset.state = 'error';
    view.innerHTML = '<p class="viewerror">Kunde inte ladda vyn. ' +
      'Ladda om sidan, eller kör den via en webbserver om du öppnat filen direkt från disk.</p>';
    console.error('Kunde inte ladda ' + path, err);
  }
}

function onRouteChange(){
  render(currentPath());
  window.scrollTo(0, 0);
}

initTheme(document.getElementById('theme'));

document.querySelector('.skip').addEventListener('click', ev => {
  ev.preventDefault();                       // hoppa utan att röra rutten
  view.setAttribute('tabindex', '-1');
  view.focus();
});

window.addEventListener('hashchange', onRouteChange);

onRouteChange();
