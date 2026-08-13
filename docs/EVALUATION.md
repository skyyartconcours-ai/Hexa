# Evaluation

An adversarial review of Hexa against its own claims, from the point of view of
someone who would have to put the output on a channel.

**Evaluated at** commit `fc588a5`, 2026-08-13, on Node 22.22.2 / sharp 0.34.5 /
libvips 8.17.3, with no API keys, no vision sidecar and an empty asset library —
the configuration the README's quick start describes. The repository was under
concurrent edit during this review; where a result was time-sensitive it is
marked.

**Reproduce it:**

```bash
pnpm build
npx tsx scripts/showcase.ts     # 33 templates × 14 categories → out/showcase/
npx tsx scripts/proof.ts        # best/worst at YouTube display sizes
```

---

## Verdict

**Not shippable next to a professional's work. Two separate reasons, and only
one of them is about design.**

1. **The headline promise cannot fire.** Nothing in the product ever computes a
   reference embedding, so the identity gate has nothing to compare against —
   not "not yet", but *no code path at all*. Across 33 renders the gate returned
   0 passes, 0 failures and 79 warnings. Adding photographs does not change
   this. Starting the sidecar does not change this. See
   [The identity guarantee does not run](#the-identity-guarantee-does-not-run).

2. **The designs are not good enough yet.** All 33 renders fail the tool's own
   quality gates — QA mean **49.8/100**, no render above 65. 268 hard failures,
   192 of them legibility. The gates are right. See
   [Design quality](#design-quality).

The engineering underneath is genuinely strong: the render stack, the QA gates,
the roster, the placeholder honesty and the vision sidecar's documentation are
all better than they need to be. The gap is not competence. It is that several
seams between good components were never closed, and nobody has yet sat down
with the output and art-directed it.

---

## What works

Verified by running it, not by reading it.

| | Evidence |
|---|---|
| **Everything renders.** 33/33 templates across all 14 categories produced a real image with zero photographs, zero API keys and no Python. | `out/showcase/index.json` |
| **The placeholder path is honest.** No render can be mistaken for a real person — see [below](#the-placeholder-path-is-honest). | every render in `out/showcase/` |
| **Determinism holds.** Same request, same seed, byte-identical PNG (`sha256 ad502436…` twice). | measured |
| **The QA gates are excellent** — specific, quantified, actionable, and correctly damning about this output. | `legibility`, `contrast`, `face-placement` findings in `index.json` |
| **The prompt guard blocks the obvious attacks.** `assertNoPersonGeneration` runs in `registry.ts` *and* in every provider including the offline `local` one. | `packages/ai/src/guard.ts`, verified by call |
| **`guardIdentityEdit` enforces what it claims** about `preserve` and `strength ≤ 0.65`. | `packages/ai/src/guard.ts:299` |
| **Licence tracking is real.** Ingest requires `--source`, assets land `cleared:false`, the licence gate names the uncleared asset, and a credit line is emitted. | verified end-to-end with a synthetic library |
| **The roster is sourced and dated.** `ROSTER_SOURCED_AT`, `ROSTER_SOURCES`, per-file source URLs. 61 players, fuzzy resolution works. | `packages/data/src/roster.ts` |
| **The vision sidecar's README is the best document in the repo** — including a "what was and was not runtime-verified" section that is accurate. | cross-checked against `pipeline.py` |
| **Failure degradation works.** Missing photos, missing sidecar, missing provider, throwing gate — each degrades with a named warning rather than stopping. | verified |

### The placeholder path is honest

This deserves credit because it is the easiest place to cheat and the product
does not. With no photograph, a subject renders as an egg-shaped head carrying a
crosshair and a `?`, a flat shoulder silhouette, a dashed slot frame, the
player's handle, and the caption **NO LICENSED REFERENCE**. There is no face, no
skin detail, no attempt at a person. Nobody could mistake it for Peyz, and
nobody could publish it by accident.

Evidence: any render in `out/showcase/`, e.g.
`out/showcase/hero/hero-portrait-faker.png`.

The corresponding cost is that **every design judgement below is made against a
silhouette**, not a photograph. Where that changes the verdict, it is said so.

---

## The identity guarantee does not run

This is the finding that matters. It is not "unexercised for lack of photos".
The mechanism is incomplete.

### The chain

`identityGate` compares the rendered face against `GateSubject.referenceEmbeddings`.
Those come from `buildReferenceGallery()`, which reads `ReferenceAsset.embedding`
off library assets. **Nothing ever writes that field.**

- `packages/assets/src/ingest.ts:11` — leaves `embedding` undefined "on purpose.
  A later enrichment pass…"
- `packages/assets/src/library.ts:400` — only *preserves* an embedding that is
  already there.
- `packages/pipeline/src/adapters/vision.ts:118` — `embedBatch()` exists and is
  **imported by nothing**. Dead code.
- There is no `hexa assets embed` command. `grep "command('embed"` in
  `packages/cli/src/commands/assets.ts` returns nothing.

### Measured

Ingested two synthetic reference images through the documented command, with a
sidecar answering on `127.0.0.1:8765` and both `HEXA_VISION_URL` and
`HEXA_VISION_ENDPOINT` set:

- manifest entry contains no `embedding`, no `embeddingModel`, no `faceBox`
- the sidecar received **zero requests** (`HITS []`)
- rendering with that library still produced:
  `WARN Peyz has no reference embeddings, so the rendered face cannot be verified`

Across all 33 showcase renders the identity gate scored:

```
identity    0 pass    79 warn    0 fail    mean gate score 0.400
```

Zero verifications and zero rejections is the *only* result this gate can
currently produce.

### Consequences

- The identity retry in `generate.ts` is unreachable: `identityFailures` is
  always empty.
- The threshold, the cosine maths, the model-mismatch check, the gallery
  grouping — all correct, all never executed.
- The QA gate's own remedy is unactionable. It says
  `hexa assets embed --player <handle>`; that command does not exist
  (`packages/qa/src/gates/identity.ts:237` and `:380`).
- The pipeline's warning says "Re-run ingestion with the vision sidecar running
  to embed the photos already on file" — ingestion never contacts the sidecar,
  so this cannot be satisfied.

### To close it

1. Add an enrichment pass — `hexa assets embed [--player X]` — that walks the
   library, calls `vision.embedBatch()` on each source image, and writes
   `embedding` + `embeddingModel` back through `library.update()`. The
   TypeScript client and the sidecar endpoint both already exist; the wiring is
   perhaps 60 lines.
2. Call it automatically from `hexa assets ingest` when the sidecar is
   reachable, and say so in the output.
3. Fix the two remedy strings once the command is real.

---

## The sidecar cannot be found on its documented port

Second-order, but it means the guarantee would still not fire even after the
embedding gap is closed.

| Component | Port | Env var |
|---|---|---|
| `services/vision/run.sh` / `app.py` | **8765** | `HEXA_VISION_PORT` |
| `@hexa/vision` `VisionClient` | **8765** | `HEXA_VISION_ENDPOINT` |
| `@hexa/pipeline` `resolveVisionEndpoint` | **8000** | `HEXA_VISION_URL` |
| `@hexa/cli` `doctor` / `--vision` | **8000** | `HEXA_VISION_URL` |
| `.env.example` | 8765 | `HEXA_VISION_URL` |
| `services/vision/README.md` | 8765 | `HEXA_VISION_ENDPOINT` |

Two ports, two variable names, and the pipeline never falls through to
`@hexa/vision`'s own default because it always passes an explicit endpoint.

Measured, with a real HTTP server answering `/health` on 8765:

```
sidecar up on 8765, no env set             → "not reachable at http://127.0.0.1:8000"   (0 requests)
sidecar up on 8765, HEXA_VISION_ENDPOINT   → "not reachable at http://127.0.0.1:8000"   (0 requests)
sidecar up on 8765, HEXA_VISION_URL        → "reachable at http://127.0.0.1:8765"       (1 request)
```

So a user who follows either README exactly gets no sidecar and no warning that
they have misconfigured anything — `doctor` reports it as simply absent.

**Fix:** one constant. `resolveVisionEndpoint` should default to `8765` and read
both variable names.

**Also:** copying `.env.example` to `.env` does nothing. Nothing in the
repository loads a `.env` file — no `dotenv` dependency, no `--env-file`, no
parser. The variables must be exported.

---

## The prompt guard has a hole where the names go

`docs/IDENTITY.md` claimed the guard refuses "a named individual". It does not,
because the list of names is never populated.

`registerProtectedNames()` exists in `packages/ai/src/guard.ts:238`. Its own
docstring says "The roster package calls this at startup". Nothing calls it —
`@hexa/data` does not even depend on `@hexa/ai`. `listProtectedNames()` returns
`0` entries in a real process.

Measured against `assertNoPersonGeneration`:

| prompt | verdict |
|---|---|
| `portrait of a korean esports player` | blocked |
| `a man who looks like Faker` | blocked |
| `Faker sitting at a gaming desk, stage lighting` | **allowed** |
| `Lee Sang-hyeok on stage, dramatic light` | **allowed** |
| `Peyz and Viper facing each other in an arena` | **allowed** |
| `a young korean male, sharp jaw, staring at camera` | **allowed** |

The last one slips through because `male` is not in `PERSON_TERMS` (`man` is).
`generateBackplate()` accepts all four of the allowed prompts and returns an
image. With the offline provider that is only a procedural arena; with a hosted
provider configured, that prompt reaches the image model — which is precisely
the failure the product exists to prevent, reachable through the documented
`--bg-prompt` flag.

**Fix:** call `registerProtectedNames(PLAYERS.flatMap(p => [p.handle, p.fullName,
p.nativeName, ...p.aliases]))` from the pipeline or CLI bootstrap, and add
`male`/`female`/`person's` variants to `PERSON_TERMS`.

---

## Other defects found

Each of these is reproducible; none are in `docs/**`, so they are reported, not
fixed.

### 1. The wrong name under the wrong face — `lineup-hero-flank`

The most reputation-damaging bug in the set, and it gets **worse** with real
photographs, not better.

`assignSubjects()` binds subjects to slots by index, then side, then order.
`deriveFromSubjects()` fills `left-name` from `subjects.find(s => s.side === 'left')`
— the *first* left-side subject, regardless of which slot it landed in.

Measured on `lineup-hero-flank` with KC (left) vs G2 (right):

```
big left slot  : subject-3-star-left   (Caliste)     563×677
big right slot : subject-7-star-right  (Hans Sama)   562×678
text-left-name : "CANNA"        (subject 0)
text-right-name: "BROKENBLADE"  (subject 4)
```

Render: `out/showcase/team-versus/lineup-hero-flank-kc-g2.png`.

**Fix:** derive names from the *slot assignment*, not from the subject list.

### 2. The retry returns the wrong image with the right report

`packages/pipeline/src/generate.ts`, end of `renderWithIdentityRetry`:

```js
if (second.report.score < assessed.report.score && second.identityFailures.length > 0) {
  warnings.push('Retry scored lower than the original; kept the original render.');
  return { image: rendered.buffer, plan, qa: assessed.report, ... };
}
```

`rendered` and `plan` were already reassigned to the retry. The returned image
is the **retry**, paired with the **original's** QA report. The emitted PNG and
its report describe different images. Latent today (the retry is unreachable),
but it is on the identity-critical path.

**Fix:** keep the first render's buffer and plan in separate bindings.

### 3. `hexa assets coverage` gives a false all-clear on an empty library

```
$ hexa assets coverage
✔ Every player in scope has references.        # library is empty; 61 players have none
$ hexa assets coverage --team t1
 Doran  0  0  0  no-assets                     # correct
$ hexa doctor
 ! Reference coverage   7 team(s) with gaps    # correct
```

`coverageRows()` calls `library.coverage()` with no roster, which enumerates
players *present in the library*. Empty library → zero rows → the "nothing to
report" success branch. The bare form is the one the README, this doc and
`assets/library/README.md` all tell you to run.

**Fix:** default the roster to every active player rather than to the library's
contents.

### 4. Badge and date slots render an empty plate

`textColorFor()` returns `palette.accent` for `badge`/`kicker`/`stat`/`rank`.
When the accent is pale (`#ffd873`, `#fd8d7d`) and the slot has a light plate
behind it, the text disappears and a blank white pill is composited instead.

The product's own contrast gate confirms it:
`drama-reaction "badge" — text #c6dedb on #ecebe9 = 1.19:1, needs 3:1`.

Visible as an empty white box in `drama-reaction`, `controversy-split`,
`shorts-versus`, `podcast-panel`, `watchparty-live`, `trophy-lift`.

**Fix:** choose badge text colour by contrast against the plate, as `left-name`
already does via `readableOn()`.

### 5. Font weights collapse to one file per family

`inferWeight()` in `packages/type/src/fonts.ts` matches only word tokens
(`bold`, `black`, `light`…) and never numeric suffixes. With the conventional
`Family-700.ttf` naming actually used in `assets/fonts/`:

```
4 Oswald files on disk (400/500/600/700) → 1 registration: "Oswald" weight 400 → Oswald-700.ttf
4 Teko files                             → 1 registration: "Teko"   weight 400 → Teko-700.ttf
3 Barlow Condensed files                 → 1 registration: weight 400 → BarlowCondensed-800.ttf
```

Every weight request in a family resolves to the same file, so the typographic
weight contrast the templates are designed around does not exist. (Measurement
still matches what is drawn, so this does not clip — see the note on fonts
below.)

### 6. The safe-zone gate flags text for occupying text zones

76% of safe-zone findings (45 of 59) are false positives. Templates declare
zones whose stated purpose is to exclude *subjects* — `type-column` ("keep the
cutout out of it"), `headline-block` ("keep heads below it") — and the gate
tests only text and mark rects against them. Result: the headline is flagged for
being in the headline block, at 100% intrusion, on 24 of 33 renders. The real
violations (progress-bar overlap) are buried in the noise.

**Fix:** give `SafeZone` an `excludes: 'subjects' | 'text' | 'all'` field and
honour it.

### 7. `simulateSizes` calls everything legible

Every one of the ten renders proofed — including `lineup-5v5`, which is visually
mush at 168×94 — is reported `legible … holds up`. The docstring is honest that
this is an image-level structural check, not a text check, but "holds up" reads
as approval and directly contradicts the `legibility` gate's 192 failures on the
same images.

**Fix:** rename the verdict, or have `simulateSizes` accept text rects.

### 8. Test suite is not green

At `fc588a5`: `@hexa/type` **3 failed / 146 passed** (`test/fonts.test.ts`).
All other packages pass (core 22, data 43, assets 176, vision 50, layout 304,
render 164, templates 226, ai 277, qa 95, pipeline 99, cli 116). `pnpm test`
bails at the first failing package, so it does not show you the rest.

---

## Design quality

### Measured

33 renders, 14 categories, one variant each except `versus-classic` (4).
Full data in `out/showcase/index.json`; contact sheets in `out/showcase/sheets/`.

```
renders          33/33
QA score         mean 49.8   median 50   range 39–65
appeal score     mean 79.5   median 80   range 64–93
passed QA        0 / 33
hard failures    268
time per case    median 8.5s  (range 5.4–42.4s, single variant unless noted)
```

Per gate, across all 33:

| gate | pass | warn | fail | mean score |
|---|---:|---:|---:|---:|
| legibility | 20 | 0 | **192** | 0.233 |
| contrast | 75 | 9 | **72** | 0.206 |
| banding | 0 | 33 | 0 | 0.078 |
| safe-zone | 8 | 63 | 0 | 0.377 |
| identity | 0 | 79 | 0 | 0.400 |
| face-placement | 53 | 23 | 4 | 0.696 |
| color-harmony | 23 | 10 | 0 | 0.742 |
| clutter | 25 | 8 | 0 | 0.813 |
| licence / duplicate | 33 | 0 | 0 | 1.000 |

Note the gap between **QA 49.8** and **appeal 79.5**. The appeal heuristic likes
these thumbnails; the gates that measure whether anyone can read them do not.
Anyone reading only the appeal number would conclude the product is working.

### Scores

1–10, "could this ship on a real channel". Judged against silhouettes — where a
real photograph would obviously change the answer, it is noted.

| template | score | the one-line problem |
|---|---:|---|
| `hero-portrait` | **7** | genuinely clean; face too small to recognise at 168×94 |
| `mvp-card` | **7** | best type in the library; the card tint is so heavy it would erase a real likeness |
| `champion-pool` | **6** | works, but generic — nothing an editor would not have made faster by hand |
| `versus-fire-ice` | **6** | strongest versus energy; nameplates pile up at the bottom |
| `analysis-callout` | **5** | good discipline, one stray empty plate, five slots is one too many |
| `versus-classic` | **5** | competent and forgettable; badges are pale-on-pale |
| `podcast-panel` | **5** | fine structure, empty badge box, all three subjects the same hue |
| `hero-godray` | **4** | right 40% of the frame is empty; the godray barely reads |
| `versus-minimal` | **4** | the two subjects are wildly different sizes — reads as a bug, not restraint |
| `champion-crowned` | **4** | the CROWNED band lies straight across the subject's chest |
| `roster-reveal` | **4** | five identical figures in a row; no hierarchy |
| `stat-record` | **4** | numeral treatment is strong, the layout around it is not |
| `transfer-alert` | **4** | breaking-news geometry works; subhead runs into the progress-bar zone |
| `drama-reaction` | **4** | the highest-CTR format in the library, and the badge is an empty white pill |
| `tierlist-grid` | **3** | the grid wash flattens all 8 subjects to one value |
| `ranking-podium` | **3** | podium block covers the winner's nameplate; only 1 of 3 ranks numbered |
| `breakdown-split` | **3** | subject blown out to a white ghost |
| `trophy-lift` | **3** | "CHAMPIONS" breaks mid-word as CHAMPI/ONS |
| `versus-split-portrait` | **3** | brown vs olive — two mud colours, zero opposition |
| `hero-fullbody` | **3** | "UNTOUCHABLE" breaks as UNTOU/CHABLE |
| `versus-clash` | **3** | red vs red; G2 renders in T1's colour |
| `bracket-clash` | **3** | 16 hard failures; ladder band eats the kicker |
| `pickban-duel` | **3** | champion panels are empty — no product art ships |
| `stat-compare` | **2** | both subjects ghosted to 15% opacity; no focal point |
| `crest-clash` | **2** | a crest-led layout with no crests; DERBY band swallows the nameplate |
| `shorts-hero` | **2** | headline lands on top of the face |
| `lineup-5v5` | **2** | ten 12px blobs; dies completely in the sidebar |
| `tournament-preview` | **2** | four subjects behind a type block, none of them readable |
| `controversy-split` | **2** | headline crosses both panels; name text collides with nameplates |
| `lineup-hero-flank` | **2** | best colour separation in the set, wrong names on the faces |
| `shorts-versus` | **2** | headline on the face, subjects overlapping the VS mark |
| `versus-diagonal-shatter` | **1** | no shatter, one white diagonal, name jammed in the corner |
| `watchparty-live` | **1** | two empty white boxes and a floating salmon rectangle |

### The worst five, specifically

**1. `versus-diagonal-shatter` — 1/10.**
`out/showcase/versus/versus-diagonal-shatter-faker-chovy.png`. The "steep
corner-to-corner tear with shattered glass" is a single unmodulated white
diagonal line. There is no tear, no glass, no shards. "FAKER" is jammed into the
top-left corner on top of the T1 badge; "GAME 5" and "CHOVY" fight each other
along the bottom edge; an empty white badge plate floats top-right. 17 hard
failures — the most in the library. This template does not implement its own
description.

**2. `watchparty-live` — 1/10.**
`out/showcase/stream/watchparty-live-caps.png`. Two empty white boxes (badge and
date, invisible accent text). The subject is a small salmon rectangle in a red
frame floating in the lower left, at maybe 18% of frame height. The right third
is three stacked pills, one of which is one of the empty boxes. There is no
focal point anywhere in the frame. QA 40, appeal 64 — the lowest combined score.

**3. `lineup-5v5` — 2/10.**
`out/showcase/team-versus/lineup-5v5-t1-geng.png`. Structurally the band
composition is sound. But ten subjects across 1280px gives each about 120px, and
at the 168×94 sidebar each becomes a 12px blob. The proof sheet
(`out/showcase/proof/lineup-5v5-t1-geng.proof.png`) shows only "THE CLASSICO"
surviving; "LCK SUMMER FINAL" is a smear and the T1/GEN badges are smudges. This
is the format that most needs a small-size sanity check and it is the one that
fails it hardest. A 5v5 thumbnail should show two crests and two faces, not ten
of anything.

**4. `stat-compare` — 2/10.**
`out/showcase/stat/stat-compare-peyz-viper.png`. Both subjects are rendered at
roughly 15% opacity in grey-blue — T1's red and HLE's orange are gone entirely.
The headline band sits across both nameplates. The perspective grid behind them
is the highest-contrast object in the frame, so the eye goes to the floor. For a
template whose whole job is "two columns of figures divided by a centre rule",
the figures are the least visible thing present.

**5. `controversy-split` — 2/10.**
`out/showcase/drama/controversy-split-faker-chovy.png`. "THE FALLOUT" runs
across both panels and over the left subject's head. The `left-name` text lands
directly on top of the placeholder's own nameplate. A large cream rectangle —
another empty slot plate — sits over the right subject's chest. Appeal scores
this 93, the second-highest in the library, which is a useful demonstration of
how far the appeal heuristic can be from the truth.

### Systemic problems, not template-by-template

- **Palette collapse on the headline use case.** LCK brands are all warm.
  Measured OKLab separation: Peyz/Viper **0.159**, Zeus/Kiin **0.156**,
  Ruler/Gumayusi **0.156**, Faker/Chovy **0.247**. Cross-region pairings reach
  0.354–0.357 and look dramatically better. The code meets its own
  `MIN_SIDE_SEPARATION = 0.14` — the threshold is simply too low for a versus
  layout. Red-vs-orange is not an opposition. The fix is calibration (raise to
  ~0.30) plus a hue-rotation or secondary-colour fallback when two brands land
  in the same family.
- **Faces are too small.** `face-placement` fails outright on `lineup-hero-flank`
  ("6.7% of canvas height … roughly 6px in the sidebar"). Even the best layout,
  `hero-portrait`, puts the face at about 25% of height — around 24px in the
  sidebar. For a product whose entire premise is *that is really Peyz*, the face
  should own 35–45% of frame height in every single-subject layout.
- **Heavy tints erase the subject.** `tierlist-grid`, `mvp-card`,
  `breakdown-split` and `stat-compare` all wash the subject region hard enough
  that a photograph would lose its likeness. This is exactly what the identity
  gate exists to catch, and it is exactly the gate that cannot run.
- **Mid-word line breaks.** "CHAMPI/ONS", "UNTOU/CHABLE". No hyphenation, no
  fallback to a smaller size, no rebalance.
- **Duplicate naming.** Every layout with a name slot draws the handle twice in
  placeholder mode — once from the template, once baked into the placeholder
  plate — and they collide. This disappears with real photographs, so it is a
  placeholder-mode artefact rather than a template fault, but it makes every
  contact sheet harder to read than it should be.

### A note on fonts

Contact sheets from a run at 22:20 show severe text clipping — "VIPER" as
"VIPEI", "LCK FINALS" as "LCK FINAL:", "FIVE WORLDS TITLES" as "FIVE WORLDS TIT",
"10,000" as "1…" plus three orphan boxes. The design faces landed in
`assets/fonts/` at 22:28 (concurrent work by another agent) and the 22:36 re-run
is largely free of clipping.

Two things worth recording. The clipping was **not** a measurement bug —
`resolveFace()` already walks the whole font stack and measures what will be
drawn. It was simply a machine without the fonts, and `doctor` warned about it
correctly. And installing them did **not** improve quality: QA mean moved
51.2 → 49.8, and contrast failures rose from 44 to 72 as heavier glyphs put more
ink on pale plates. The typography was never the thing holding this back.

---

## Small-size behaviour

`proofSheet` / `simulateSizes` from `@hexa/qa`, on the five best and five worst
by QA score. Sheets in `out/showcase/proof/`.

**Can you tell who is who at 168×94?** No — and not only because of the
placeholders. In the best render, `hero-portrait`, the head occupies roughly
24×24 pixels in the sidebar box. A real photograph at that size carries hair
colour and jersey colour, and nothing else. Recognition needs roughly double
that.

**Can you read the headline at 168×94?** Sometimes, and only the headline.

| render | 168×94 reality |
|---|---|
| `hero-portrait` | "THE GOAT" reads. "T1 MID" and "FIVE WORLDS TITLES" are grey smears. |
| `hero-fullbody` | "UNTOU/CHABLE" reads as two words. Subject is a yellow slab. |
| `lineup-5v5` | Only "THE CLASSICO". Ten subjects are indistinguishable blobs. |
| `tournament-preview` | Nothing reads. 35% edge density — noise. |
| `watchparty-live` | "WATCHING LEC" survives; the right-hand pills merge into one bar. |

The measured numbers say every one of these is `legible`, `holds up`. Looking at
the sheets, that is not true for at least three of them. The image-level check
and the text-level gate disagree by 192 findings, and the image-level one is the
optimist.

Where the legibility gate is right, it is very specific and worth quoting:

```
"left-name" is 6.9px of cap height in the sidebar box (168×94) — below the
  ~7px where strokes stop resolving
"left-team" is camouflaged at sidebar: the background around it is 59% edge
  pixels and the type is only 0.31× busier, so it reads as more texture
```

That is better small-size diagnostics than most commercial tools ship. It is
being ignored by the templates that produce the images.

---

## Documentation audit

Every command in the README quick start, `docs/ARCHITECTURE.md`,
`docs/IDENTITY.md`, `assets/library/README.md` and `.env.example` was run.

### Fixed in this review (files I own)

`docs/IDENTITY.md` and `docs/ARCHITECTURE.md` have been corrected. The
substantive edits:

- IDENTITY: removed the claim that the guard refuses "a named individual";
  replaced with what the guard actually blocks and a pointer to the unwired
  `registerProtectedNames`.
- IDENTITY: the identity-gate section now says plainly that no code path
  computes reference embeddings, so the gate cannot currently fire.
- IDENTITY: `guardIdentityEdit` requires that preserve regions be *declared*,
  not that they *cover the face* — it has no way to know where the face is.
- IDENTITY: a failing identity gate does not stop the image being written unless
  `--strict` is passed.
- IDENTITY: corrected `hexa assets ingest`/`coverage` guidance and dropped the
  non-existent `hexa assets embed`.
- ARCHITECTURE: removed "one template serves 1280×720, 1920×1080 and 1080×1920
  without a rewrite". Measured: asking any of the 31 non-`shorts` templates for
  `aspect: 'shorts'` silently renders **1280×720** with a warning. Only 2 of 33
  templates support vertical, and those support nothing else.
- ARCHITECTURE: the vision endpoint disagreement is now recorded.
- ARCHITECTURE: plans are byte-identical between runs only if `now` is injected;
  `plan.meta.createdAt` otherwise differs. Pixels are byte-identical
  unconditionally (verified).

### Reported, not fixed (other owners)

**`README.md`** — every quick-start command runs. Issues:

- "Add reference photos and the vision sidecar, and the same command produces
  the real thing." Not true today: no embedding pass exists, so identity is
  never verified however many photos are added.
- "if it doesn't match, the render is rejected and retried." The retry is real
  but unreachable, and without `--strict` a rejected render is still written.
- `./services/vision/run.sh` starts the sidecar on 8765; the pipeline looks on
  8000. The quick start should set `HEXA_VISION_URL` or the default should
  change.
- `hexa assets coverage` is recommended and currently reports a false all-clear.
- The `hexa` binary is only on `PATH` after a link; the examples mix
  `node packages/cli/dist/bin.js` and bare `hexa`.

**`assets/library/README.md`** —

- Directory example uses `players/geng-peyz/` and `players/hle-viper/`. The
  roster has Peyz on **T1** and the real layout is `players/<playerId>/<kind>/`,
  e.g. `players/peyz/portrait/` (verified by ingesting). Both the org prefix and
  the nesting are wrong.
- "Face boxes and embeddings are filled in by a second enrichment pass once the
  vision sidecar is available." There is no such pass. This is the clearest
  single statement of the gap.
- `hexa assets coverage` — same false all-clear.

**`.env.example`** —

- "copy to .env" implies it is loaded. Nothing loads it.
- `HEXA_VISION_URL=http://127.0.0.1:8765` is the combination that works, which
  is good, but it silently contradicts the code default of 8000 and the vision
  README's `HEXA_VISION_ENDPOINT`.
- `ANTHROPIC_API_KEY` is listed under backplate providers; there is a
  `providers/anthropic.ts`, but `hexa providers` reports only `local` and `stub`
  as configured on a clean machine, so the list overstates what is wired.

**`services/vision/README.md`** — the strongest document here. Checked claim by
claim against `app.py` and `pipeline.py`: constants (`MAX_PIXELS` 64MP,
`buffalo_l`, `isnet-general-use`, det size 640), the bust anthropometry
(0.50/0.79 eye-mouth ratios, `3.42 × emd`, `shoulder_ratio` 1.9, `width_ratio`
2.05), lazy model loading, the structured error contract, and the omission of
`quality` from `/metrics` — all accurate. The "what was and was not
runtime-verified" section is exactly the kind of honesty this review is looking
for. Two corrections:

- The error table omits `ENCODE_FAILED` and `NO_EMBEDDING`, both raised by
  `pipeline.py`.
- "On the TypeScript side, `HEXA_VISION_ENDPOINT` overrides the default
  `http://127.0.0.1:8765`." True for `@hexa/vision` used directly, false for any
  render — the pipeline and CLI ignore that variable entirely. Verified: with
  only `HEXA_VISION_ENDPOINT` set and a live server on 8765, the sidecar
  received zero requests.

The service could not be started here (no network for `pip`), so the Python was
checked by `py_compile` (both files pass) and `bash -n run.sh` (passes), plus a
line-by-line read against the README.

---

## What a user must supply before this is usable for real

1. **Licensed reference photographs**, 3–5 per player, per
   `assets/library/README.md`'s quality guidance. Hexa ships none, correctly.
2. **The vision sidecar**, on a machine with ~850MB of wheels and weights — and
   for now, `HEXA_VISION_URL` pointed at port 8765 by hand.
3. **The design fonts** in `assets/fonts/` (they are present in this tree now,
   but `doctor` will tell you if they are not).
4. **An embedding pass that does not exist yet.** Until someone writes it, items
   1 and 2 buy better cutouts and face-anchored placement — real improvements —
   but not the identity guarantee.
5. **Art direction.** The templates need a pass by someone who will look at the
   contact sheets and fix the palette separation, the face sizes, the empty
   badge plates and the five worst layouts.

## What would close the gap

In the order I would do it:

1. `hexa assets embed` + automatic enrichment on ingest. Turns the identity
   guarantee from architecture into behaviour. ~60 lines against APIs that
   already exist.
2. One constant: default the vision endpoint to 8765 and accept both variable
   names. Without this, (1) still does not fire.
3. Wire `registerProtectedNames` to the roster and add the missing person terms.
4. Fix the name/slot derivation in `lineup-hero-flank` and anywhere else names
   are derived by side rather than by assignment.
5. Raise `MIN_SIDE_SEPARATION` to ~0.30 with a hue-rotation fallback, and raise
   minimum face height to 35% of canvas in single-subject layouts. These two
   changes alone should move the QA mean substantially, because
   `legibility` and `face-placement` are where the failures are.
6. Fix badge text colour, then delete or rebuild the five worst templates.
7. Fix the safe-zone gate's subject/text confusion so the reports are readable
   again.

Steps 1–4 are seams between working components — each is small, and each closes
a gap between what the documentation says and what the code does. Step 5 onward
is design work, and it is the larger of the two jobs.

---

## Appendix — artefacts

| path | what |
|---|---|
| `scripts/showcase.ts` | renders the 33-template matrix and the per-category contact sheets |
| `scripts/proof.ts` | runs `proofSheet`/`simulateSizes` over the best and worst renders |
| `out/showcase/index.json` | every QA finding, gate score, warning and timing |
| `out/showcase/sheets/*.png` | one contact sheet per category, plus `all-templates.png` |
| `out/showcase/proof/*.png` | the same renders at 168×94 / 210×118 / 320×180 / 360×202 |
