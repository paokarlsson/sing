# Sjunga

Två verktyg för rösten, samlade i en ensidesapp (SPA):

* **Psalmspelaren** – spelar upp fria melodier ur den svenska psalmboken med
  text, transponering, tempo, mikrofonstämmare och MIDI-klaviatur.
* **Mic → MIDI** – metronom och inspelning som kvantiserar det du sjunger till
  noter och exporterar en .mid-fil.

## Så är det byggt

`index.html` är hela sidans skal: topplist, temaknapp och en tom `<main>`.
Resten laddas in av en liten hash-router när rutten besöks.

```
index.html              skalet: topplist, <main id="view"> och footer
css/base.css            färgtokens, typografi, topplist, sidlayout
css/home.css            startvyn
css/psalmspelaren.css   psalmspelaren (scopad till .psalm)
css/mic-till-midi.css   mic → midi (scopad till .mic)
views/*.html            markup för respektive vy
js/app.js               hash-router och vylivscykel
js/theme.js             mörkt/ljust tema, sparas i localStorage
js/lib/pitch.js         YIN-tonhöjdsdetektering
js/lib/notes.js         notnamn, vita tangenter, rundade rektanglar
js/lib/midi-read.js     läsa .mid/.kar → psalmobjekt
js/lib/midi-write.js    skriva .mid
js/views/*.js           beteendet i varje vy
js/data/songs.js        psalmdata
js/data/samples.js      orgelsamplingar (laddas först när ljudet startar)
```

Rutter: `#/` (start), `#/psalmspelaren`, `#/mic-till-midi`. De gamla
adresserna `psalmspelaren.html` och `mic-till-midi.html` pekar vidare till
motsvarande vy.

Varje vymodul exporterar `mount(root)` och får returnera en städfunktion.
Routern anropar den innan nästa vy monteras, så rAF-loopar, timers,
mikrofon och ljudkontext stängs av vid vybyte.

## Köra lokalt

Appen använder ES-moduler och hämtar sin markup med `fetch`, så den behöver
serveras över http – att öppna `index.html` direkt från disk fungerar inte:

```sh
python3 -m http.server 8000
# öppna http://localhost:8000/
```

Mikrofon och MIDI kräver https (eller localhost).
