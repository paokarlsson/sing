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
stilpaket/              brandboken och tokens i json-form (se Utseende)
css/tokens.css          alla färger, mått, radier och typsnitt
css/base.css            typografi, topplist, knappar, sidlayout
css/home.css            startvyn
css/psalmspelaren.css   psalmspelaren (scopad till .psalm)
css/mic-till-midi.css   mic → midi (scopad till .mic)
views/*.html            markup för respektive vy
js/app.js               hash-router och vylivscykel
js/theme.js             mörkt/ljust tema + palette() som läser färgtokens
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

## Utseende

Sidan följer stilpaketet **Teak & Terrakotta**: Jost till rubriker, Newsreader
till brödtext, pillerformade knappar, rundade kort, kanter i stället för
skuggor och en accent i taget. Brandboken med färgreglerna ligger i
`stilpaket/README.md`.

Alla värden bor i `css/tokens.css`, som har tre lager:

1. **Paketet** – tokens från `stilpaket/tokens.json`, oförändrade
   (`--surface`, `--ink`, `--clay`, `--space-4`, `--radius-pill` …).
2. **Tillägg** – det paketet inte har: ljusare syskontoner för det mörka
   temat, en mörkare mustard och en larmfärg.
3. **Roller** – `--bg`, `--text`, `--accent`, `--line` och så vidare. Det är
   de enda variablerna resten av CSS:en rör, och de byter värde med temat.

Så länge du håller dig till rollerna behöver ingen vy-CSS veta om sidan är
ljus eller mörk, och inga hårdkodade färger behöver skrivas någonstans.
Paketet har inget mörkt tema av sig självt – det mörka temat här är ett
tillägg i samma färgfamilj, med kontrasterna kontrollerade mot samma krav
(4,5:1 för text, 3:1 för grafik och text från 24px).

Canvasytorna hämtar sina färger ur samma tokens via `palette()` i
`js/theme.js`, så notrullen och taktnätet följer temat utan egna paletter.

Typsnitten hämtas från Google Fonts. Utan nät faller sidan tillbaka på
Futura/Century Gothic respektive Georgia, och formen håller.

## Köra lokalt

Appen använder ES-moduler och hämtar sin markup med `fetch`, så den behöver
serveras över http – att öppna `index.html` direkt från disk fungerar inte:

```sh
python3 -m http.server 8000
# öppna http://localhost:8000/
```

Mikrofon och MIDI kräver https (eller localhost).
