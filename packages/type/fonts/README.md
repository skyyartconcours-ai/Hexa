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

Text still renders. Two fallbacks engage:

1. **Measurement** falls back to the calibrated advance-width tables in
   `src/metrics.ts` — per-class approximations for a heavy condensed face, a
   normal grotesque and a generic sans. A full uppercase headline measures
   within a few percent of the real face, which is enough for `autoFit` to
   place it. Individual glyphs can be off by more.
2. **Rendering** falls back through the CSS stack `fontStack()` emits:
   `Anton, "Bebas Neue", Oswald, Teko, "Archivo Narrow", Impact,
   Haettenschweiler, "Arial Narrow", "Liberation Sans Narrow",
   "DejaVu Sans Condensed", sans-serif`. On a bare Linux box that lands on
   Liberation or DejaVu — not the design intent, but not broken either.

Register a real file and measurement becomes exact: the font is parsed with
opentype.js and measured from true glyph advances, with cap height and
ascent/descent read from the OS/2 table.

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
