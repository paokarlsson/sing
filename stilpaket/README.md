# Teak & Terrakotta

Ett stilpaket för webb med 60-talskänsla utan att bli kuliss. Grunden är modern
och tråkig på rätt sätt — läsbar text, riktiga kontroller, generöst luftrum — och
nostalgin ligger i ytskiktet: geometriska rubriker, varma dämpade färger, runda
former och pillerformade knappar. Ungefär 80 % modern UX, 20 % retrosignaler. Om
du tar bort färgerna och typsnitten ska sidan fortfarande fungera.

## Principer

1. **Ingen ren vit, ingen ren svart.** Botten är `surface`, texten är `ink`.
   Rent vitt och rent svart läser som skärm; den brutna tonen läser som tryck.
2. **Form före mönster.** Rundade hörn (`radius-lg`) och piller
   (`radius-pill`) bär stilen. Tapetmönster används högst en gång per sida.
3. **En accent i taget.** `clay` är huvudaccenten. `mustard` och `olive` är
   gäster — ett block var, inte i samma vy som varandra om det går att undvika.
4. **Kanter, inte skuggor.** Avgränsa med 1px `hairline` eller med ett byte av
   bottenfärg till `surface-deep`. Paketet definierar medvetet inga skuggor.
5. **Retro i ytan, aldrig i funktionen.** Kontrast, tangentbordsordning,
   träffytor och responsivitet följer nutida praxis.

## Färg

Tio färger, ett tema. `surface` och `surface-deep` är de enda bottenfärgerna för
längre text. Accenterna har två roller:

| Vill du | Använd |
| --- | --- |
| Färga en stor yta eller en rubrik från 24px | `clay` |
| Färga en länk eller accenttext under 24px | `clay-deep` |
| Fylla en primärknapp | `clay-deep` med `surface` som etikett |
| Markera ett ord eller en tagg | `mustard` med `ink` ovanpå |
| Lägga ett mörkt fält, t.ex. sidfot | `olive` med `surface` som text |

`hairline` är för linjer, aldrig för text. `teak` är trätonen — dekorlinjer,
ikoner, och den klarar brödtext på `surface` om du vill ha en mjukare andraton
än `ink-muted`.

## Typografi

Två familjer, båda från Google Fonts:

- **Jost** (`display`) — geometrisk grotesk i Futuras släkt. Bär hela
  60-talssignalen. Används till `display-xl`, `display`, `title` och `eyebrow`.
- **Newsreader** (`text`) — varm serif för brödtext. Används till `lead`,
  `body` och `small`.

`eyebrow` sätts alltid i versaler via CSS (`text-transform: uppercase`); spärren
på 0.16em finns redan i stilen. Sätt aldrig `body` i Jost och aldrig en rubrik
över 28px i Newsreader — det är växlingen mellan dem som gör känslan.

Radlängd: max ca 68 tecken för `body`, ca 60 för `lead`.

## Mått och form

Spacingskalan är 4 / 8 / 16 / 24 / 40 / 64 / 104. Allt avstånd hämtas därifrån;
inga mellanvärden. Sektioner separeras med `space-7`, sidmarginalen på desktop
är `space-6` och krymper till `space-4` på mobil.

Radier: `radius-sm` för fält och taggar, `radius-lg` för kort och bildrutor,
`radius-pill` för knappar och navigering. Blanda inte `radius-sm` och
`radius-lg` på samma yta.

## Ikoner

Inga emoji. Ikoner ritas som inline-SVG med `stroke` i `currentColor`, 1.5px
linje, 24px ruta och runda ändar (`stroke-linecap="round"`) så de matchar
formspråket. Ikonknappar utan text behöver `aria-label`.

## Tillgänglighet

Varje färgkombination i tabellen ovan är kontrollerad: text når 4,5:1 mot sin
botten och 3:1 vid 24px och uppåt. Två fällor att undvika:

- `clay` som brödtext på `surface` når 3,8:1 och underkänns — använd
  `clay-deep`.
- `surface` som text på `clay` når 4,5:1 med minsta möjliga marginal — fyll
  knappar med `clay-deep` istället.

Träffytor minst 44×44px. Fokusring: 2px `clay-deep` med 2px mellanrum till
elementet.

## Vad paketet inte innehåller

Inga komponenter i kod ännu, inga logotyper, inga bilder och inget mörkt tema.
Färgerna, typografin och måtten är satta från grunden för det här projektet —
det finns ingen befintlig brand att utgå från, så allt här är ett förslag att
justera.
