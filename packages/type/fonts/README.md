# Fonts

Hexa **deliberately does not bundle fonts.**

Typefaces are software with their own licences. Even permissive ones (SIL OFL)
carry conditions — reserved font names, a requirement that the licence travel
with the file, a prohibition on selling the font by itself. Vendoring them into
a repo that gets forked, mirrored and published as a package means those
conditions travel to places nobody has read them. So `@hexa/type` ships the
*metrics* and leaves the *files* to you.

Nothing here downloads anything. `ensureFonts()` only looks at what is already
on disk.

## What to drop in

Put `.ttf` or `.otf` files in this directory (`assets/fonts/` at the repo root
also works, and is the default `ensureFonts()` scans). All six below are
SIL Open Font License 1.1 and free for commercial use:

| Family | Role in Hexa | Where |
| --- | --- | --- |
| **Anton** | The default headline and player-name face. Heavy condensed grotesque — the genre's house style. | Google Fonts |
| **Bebas Neue** | Team tags and all-caps kickers. Slightly lighter and more geometric than Anton. | Google Fonts |
| **Archivo Black** | Normal-width headline alternative for short copy that would look starved condensed. | Google Fonts |
| **Teko** | Stat values. Tall, narrow, numerals designed to stack. | Google Fonts |
| **Chakra Petch** | Date badges and technical chrome. Squared-off, reads "competitive". | Google Fonts |
| **Oswald** | Labels, roles, metadata. The workhorse for anything small. | Google Fonts |

Filenames are matched loosely, so `Anton-Regular.ttf`, `Anton.ttf` and
`Anton%5Bwght%5D.ttf` all register as `Anton`. Weight and italic are inferred
from the filename (`-Bold`, `-Black`, `-Italic`, …).

```
assets/fonts/
  Anton-Regular.ttf
  BebasNeue-Regular.ttf
  ArchivoBlack-Regular.ttf
  Teko-Bold.ttf
  ChakraPetch-Bold.ttf
  Oswald-SemiBold.ttf
```

Then:

```ts
import { ensureFonts } from '@hexa/type';

const { available, missing } = await ensureFonts();
// available: ['Anton', 'Bebas Neue', ...]
// missing:   ['Chakra Petch']
```

`ensureFonts()` also scans `/usr/share/fonts`, `/usr/local/share/fonts`,
`/System/Library/Fonts`, `/Library/Fonts` and `C:\Windows\Fonts`, so a face
installed system-wide is picked up without copying it here.

## What happens when they are missing

Text still renders, and — importantly — it still *fits*. Two fallbacks engage:

1. **Rendering** falls back through the CSS stack `fontStack()` emits:
   `Anton, "Bebas Neue", Oswald, Teko, "Archivo Narrow", Impact,
   Haettenschweiler, "Arial Narrow", "Liberation Sans Narrow",
   "DejaVu Sans Condensed", "Liberation Sans", "DejaVu Sans", FreeSans,
   sans-serif`. On a bare Linux box that lands on Liberation or DejaVu — not
   the design intent, but not broken either.

2. **Measurement follows rendering down that same stack.** This is the part
   that matters. `resolveFace` does not measure the family you asked for; it
   measures the first family in the stack that is actually available, because
   that is the one the rasteriser will draw. Measuring Anton's condensed
   metrics while librsvg draws Liberation Sans understates every width by
   roughly a third, and the symptom is not a subtly wrong layout — it is
   headlines clipped mid-word and right-aligned nameplates running off their
   plates, visible only after rasterisation.

   Only when *nothing* in the stack is registered do the calibrated
   advance-width tables in `src/metrics.ts` take over — per-class
   approximations for a heavy condensed face, a normal grotesque and a generic
   sans. A full uppercase headline measures within a few percent of the real
   face there; individual glyphs can be off by more.

The practical consequence: call `ensureFonts()` at startup. Even when it finds
none of the six design faces, registering the system grotesques it *does* find
is what makes measurement exact for the font that will actually be drawn.

Register a real design file and you get both: exact metrics *and* the intended
look.

You can also register a face directly, bypassing discovery:

```ts
import { registerFont } from '@hexa/type';
registerFont({ family: 'Anton', path: '/opt/brand/Anton-Regular.ttf', weight: 400 });
```

## Licensing note

If you ship rendered thumbnails, you are distributing *images*, not fonts —
which the OFL explicitly permits. If you ship the font files themselves
(bundling them into a container, a Lambda layer, a desktop app), the OFL
copyright notice and licence must travel with them. Keep the original
`OFL.txt` next to the `.ttf` when you do.
