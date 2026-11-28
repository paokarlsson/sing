/* Låtarna i karaoken. Varje låt bor i en egen datamodul som laddas
   först när låten väljs. Modulen exporterar { song } med title, audio
   och lines (se js/data/braskelibruskelibrang.js för formatet). */

export const SONGS = [
  {
    id: 'bla-hulken',
    title: 'Blå Hulken',
    length: '2:01',
    load: () => import('./bla-hulken.js'),
  },
  {
    id: 'braskelibruskelibrang',
    title: 'Braskelibruskelibräng',
    length: '5:18',
    load: () => import('./braskelibruskelibrang.js'),
  },
];
