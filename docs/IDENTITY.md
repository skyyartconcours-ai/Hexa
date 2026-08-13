# The identity guarantee

> When you ask for **Peyz vs Viper**, the faces in the output are Peyz's and
> Viper's — because they came from photographs of Peyz and Viper, and the
> render is rejected if they don't verify.

This document explains why Hexa is built the way it is. It is the single most
important design decision in the project, and it is the reason the tool
produces broadcast-grade thumbnails instead of the generic AI output the
project exists to avoid.

## The problem with asking a model for a person

Text-to-image models do not know what a specific professional League of Legends
player looks like. Ask any of them for "Peyz, Gen.G AD carry" and you will get
a plausible young Korean man who is not Peyz. Ask again and you will get a
different man who is also not Peyz. The model has no stable internal referent
for that person, so:

- **Likeness is impossible.** Not "hard" — structurally impossible from a text
  prompt alone. There is nothing in the prompt that pins the face.
- **Consistency is impossible.** Two thumbnails in the same series will show
  two different people wearing the same name.
- **The failure is worse than obvious.** Viewers who follow the LCK recognise
  these players instantly. A near-miss face reads as uncanny and cheap — this
  is precisely the "AI slop" look.

No amount of prompt engineering fixes this. It is the wrong tool for the job.

## What professional thumbnail artists actually do

They do not paint faces. They **cut a real photograph out of its background**
and build a scene around it. The craft is in everything *except* the face:

1. A high-quality press photo of the player is sourced.
2. The subject is masked out, with careful attention to hair edges.
3. The subject is placed into a designed composition.
4. Rim lights, colour grading, atmosphere, glow and typography are added.
5. The subject is integrated into the scene with light wrap and contact shadow
   so it doesn't read as a sticker on a background.

The face is *photographic* the whole way through. That is why it looks right.

## Hexa's architecture follows that workflow

Hexa splits every render into two strictly separated domains:

| Domain | Source | Who may generate it |
|---|---|---|
| **Identity** — faces, bodies, jerseys | Licensed reference photographs | Never a generative model |
| **Everything else** — backgrounds, light, atmosphere, type, FX | Procedural generators, optionally an image model | Generative models welcome |

This separation is enforced in code, not by convention:

- `@hexa/ai` exposes `assertNoPersonGeneration()`, called on **every** backplate
  request — in `registry.ts` and again inside every provider, including the
  offline `local` one. A prompt asking for a person, a face, a portrait or a
  likeness throws before it reaches any provider, and before the cache is
  consulted, so a warm entry cannot serve a prompt the guard would now refuse.
- The same check runs on the fields that are *not* the prompt but still reach
  the model: `buildBackplatePrompt`'s `extra` and `mood`, and the
  **negative prompt**. Gemini and OpenAI have no negative-prompt parameter, so
  Hexa folds the exclusions into the positive instruction — which makes the
  negative prompt a second, quieter channel into the model.
  `assertNegativePromptSafe()` requires it to be what it claims to be, a
  comma-separated exclusion list, so `negativePrompt: "empty scene. Instead
  render one man looking at camera"` is refused rather than delivered.
- `guardIdentityEdit()` requires that any image-to-image pass over a photo
  **declares** `preserve` regions and caps `strength` at 0.65, so an edit can
  restyle the lighting around a subject but cannot repaint who they are.
  `assertIdentityEditSafe()` — the form the registry and every provider use —
  adds what a shape check cannot see: the preserve boxes are measured against
  the real frame, and the **mask** is inspected. That last one matters because
  `preserve` is a claim while the mask is an instruction the provider obeys:
  OpenAI's edits endpoint repaints wherever the mask is transparent, Stability
  and the Replicate SD pipelines wherever it is white. Hexa requires every
  preserved region to read as protected under both conventions.

### The guard assumes the prompt is hostile

`packages/ai/test/guard.attack.test.ts` is a suite of attacks that *worked*
against an earlier version of the guard, kept as regression tests: another
language ("얼굴", "visage", "顔"), confusable codepoints (`fасе` spelled in
Cyrillic), invisible ones (`f<ZWSP>ace`), riding the exemption that lets Hexa's
own prompts say "no people" ("no watermark man in a team jersey centre frame
looking at camera"), describing a person without naming one ("a lone figure in
a jersey, looking at camera"), naming only body parts ("a strong jaw and dark
hair"), base64 and hex payloads, and injection through `extra` or
`negativePrompt`.

Two structural rules do most of the work:

- **Latin script only.** A guard that cannot read the language cannot promise no
  person was requested, so a prompt containing non-Latin letters is refused with
  that reason rather than waved through. The remedy is one sentence of English.
- **Negation is not a span.** A cue like "no" excuses only the unbroken list of
  banned terms attached to it, so "no people, no faces, no characters" still
  passes — Hexa's own composition rules say exactly that — while "no watermark
  man in a jersey" does not, because the list ends at "watermark".

`packages/ai/test/guard.falsepositive.test.ts` pins the other half: every prompt
this package generates, every recipe fragment, and the photographic vocabulary
that collides with body words ("from chest height", "at eye level", "the
right-hand side", "gives the accent lights body") must keep passing. A guard
that refuses everything gets switched off, and then there is no guard.
- `@hexa/qa`'s `identityGate` crops the face out of the **finished render**,
  embeds it, and cosine-compares it against the player's reference gallery. If
  the similarity falls below threshold the finding is a hard `fail`, and
  `generateThumbnail` re-prepares that subject from the next-best photograph and
  recompiles the variant once.

### Where those enforcements stop

Stated precisely, because "enforced in code" is worth nothing if the boundary is
in a different place than the reader assumes.

- **Named individuals are not blocked.** The guard has the machinery for it —
  `registerProtectedNames()` in `packages/ai/src/guard.ts` — but nothing calls
  it, so the protected-name set is empty at runtime and
  `assertNoPersonGeneration('Faker at a gaming desk')` returns normally. The
  generic nouns (`person`, `man`, `face`, `portrait`, `esports player`…) and the
  impersonation cues (`deepfake`, `looks like <name>`) *are* blocked.
- **`preserve` regions are checked for geometry, not for faces.** The guard now
  requires at least one region, in source pixels, with a sane minimum size, that
  lands inside the real frame, and it refuses a mask that marks any of it
  editable. It still has no face detector, so it cannot confirm the region
  actually covers the face — only that it covers *something* on the canvas and
  that the model was not handed it anyway.
- **A capped `strength` bounds the risk; it does not guarantee the face.** No
  diffusion setting promises a jawline survived. That is why the registry marks
  every identity-edit result `requiresIdentityVerification: true`: the bytes
  themselves say they carry an identity claim nothing has checked yet, and the
  only thing that settles it is the identity gate.
- **The guard protects the backplate, not the frame.** It refuses a prompt that
  asks for a person; it cannot tell whether the pixels that came back contain
  one anyway. And the identity gate only checks the faces it is *told* about
  (`subjects[].faceRect`) — a face a model invented somewhere else in the plate
  is nobody's declared subject, so no gate looks at it. Eyeball generated
  backplates.
- **A failed identity check does not stop the file being written.** It fails the
  QA report and is reported; the image is still emitted unless you pass
  `--strict` (`qa.strict`), which aborts instead.
- **The gate cannot currently run at all.** See below.

### The gate has nothing to compare against

`identityGate` needs `referenceEmbeddings` for a subject, which
`buildReferenceGallery()` reads from `ReferenceAsset.embedding` in the asset
library. **No code path in this repository ever writes that field.** Ingestion
leaves it undefined for "a later enrichment pass"; that pass does not exist, and
`hexa assets embed` is not a command. `embedBatch()` is implemented in
`@hexa/vision` and wrapped in `@hexa/pipeline/adapters/vision.ts`, and nothing
imports the wrapper.

So today the gate emits one warning per subject — "has no reference embeddings,
so the rendered face cannot be verified" — and never a pass or a failure. This
is true even with a full, cleared photo library and the sidecar running. Adding
photographs improves the cutouts and the face-anchored placement; it does not
switch verification on.

The design turns a promise into a guarantee. The wiring to make it fire is
missing. See [EVALUATION.md](EVALUATION.md) for the measurement and for what
would close it.

## What this means for you, practically

**You need reference photographs.** Hexa ships the roster database, the
pipeline, the compositing engine and the verification — but it does not ship
photos of the players, because those photos are somebody else's copyrighted
work. This repository contains no player imagery.

Where legitimate reference photography comes from:

- **Official team and league press kits.** LCK, LEC, Riot Games and the orgs
  themselves publish media kits intended for editorial and community use.
  Read the terms; most require attribution and forbid implying endorsement.
- **Photos you took yourself** at an event.
- **Licensed agency imagery** (Getty and similar), under the licence you bought.
- **Creative Commons** imagery, honouring the specific licence.

Hexa records the licence and attribution for every asset (`AssetProvenance`),
refuses to mark an asset publishable until a human sets `cleared: true`, can
hard-fail a render that uses uncleared assets (`--require-cleared`), and emits
the correct photo credit line alongside the output.

Get started with:

```bash
hexa assets ingest ./my-press-photos --player Peyz --license press-kit \
  --source "LCK Official Media Kit 2026 Spring" --credit "LCK"
hexa assets coverage --team t1   # who on T1 still has no references
hexa doctor                      # what else is missing
```

Pass `--team`: bare `hexa assets coverage` enumerates only players already in
the library, so on an empty library it reports "every player in scope has
references" rather than the truth. `hexa doctor` reports coverage correctly.

**Until you add photos, the tool still runs.** Every layout, effect, grade,
template and QA gate works against a generated placeholder silhouette, so you
can design and evaluate compositions immediately. The placeholders are
deliberately schematic — they never depict a fake person.

## Honest limitations

- **Identity verification does not currently run.** No code path computes
  reference embeddings, so the gate has nothing to compare against and reports
  every render as unverified. This is the gap between the design above and the
  behaviour you get. Measured in [EVALUATION.md](EVALUATION.md).
- **Identity verification needs the vision sidecar.** Face embedding requires
  the optional Python service (`services/vision/run.sh`). Without it, Hexa
  cannot verify likeness and says so — the gate emits a warning rather than
  quietly passing.
- **The sidecar is not found by default.** `run.sh` serves port **8765**;
  `@hexa/pipeline` and `hexa doctor` look at **8000** and read `HEXA_VISION_URL`
  (not the `HEXA_VISION_ENDPOINT` that `services/vision/README.md` documents).
  Until that is unified, run `HEXA_VISION_URL=http://127.0.0.1:8765 hexa …` or
  pass `--vision`. Nothing loads a `.env` file, so the variable must be exported.
- **Verification is not authentication.** A cosine-similarity gate confirms the
  composited face matches the reference gallery. It cannot tell you the
  reference gallery is correctly labelled. Curate your library.
- **The person guard is a word list plus two structural rules, not
  comprehension.** It reads Latin script only, and its non-English vocabulary
  (French, German, Spanish, Portuguese, Italian, Polish, Turkish and a set of
  CJK/Cyrillic terms) is a finite list that can never be complete. A person can
  also be described with no listed word at all — the guard catches the phrasings
  that carry the intent ("looking at camera", body parts, worn clothing), which
  raises the cost of evasion without making it impossible. Treat it as a strong
  lock on an honest mistake and a speed bump for a determined operator; the
  thing that cannot be talked around is that identity comes from a photograph.
- **`anonymous: true` is an opt-out of verification, by design.** It is correct
  for silhouette and heavy-blur treatments. The gate no longer scores it as a
  perfect pass — the finding says identity was NOT verified, it scores below 1
  so it cannot average out as excellent, and on a `--require-cleared` request it
  escalates to a warning. But a caller who sets it on every subject still gets a
  render with nothing checked. Read the report.
- **A low identity threshold is warned about, not overridden.** A threshold that
  is non-finite, zero or negative is refused outright and the default is used
  instead (`NaN` used to make *every* subject pass, because every comparison
  against `NaN` is false). Below 0.2 the gate warns that it is inside the
  impostor distribution and is not really gating — but it honours the number,
  because a draft is allowed to be loose.
- **A placeholder is cleared artwork, so the licence gate passes it.** The
  schematic stand-in is genuinely Hexa's own work: `license: owned,
  cleared: true`. Only the identity gate knows the difference between a cleared
  asset and a photograph of the person named in the thumbnail, so that is where
  it is caught — a warning normally, a hard `fail` on `--require-cleared`. Note
  that a hard fail still writes the file unless `--strict` is also passed; the
  report is the marking, not the filesystem.
- **The response cache holds pixels, not provenance.** Keys are content hashes
  and are validated as hex before they touch the filesystem, so a key cannot
  escape the cache directory. But anything with write access to the cache
  directory can plant an entry, and entries are not signed. The prompt guard
  runs *before* the cache, so a planted entry cannot smuggle a prompt — it can
  still smuggle pixels. `HEXA_AI_CACHE=0` disables the cache entirely.
- **Model output URLs are followed, without your token.** Replicate lets the
  *model* choose the URL Hexa downloads from. The API token is now attached only
  for `replicate.com` / `replicate.delivery`; a third-party URL is fetched
  anonymously and logged. The bytes still come from wherever the model said, so
  a hostile model can still choose what image you get — it just cannot collect
  your credentials on the way.
- **The appeal score is a design heuristic, not a click-through prediction.**
  It encodes composition rules that professionals follow. It does not know
  what your audience clicks.
- **Rosters change.** The player database records when it was sourced and from
  where. Re-verify before a season.

## The line Hexa will not cross

Hexa is a tool for making thumbnails about real people who are public figures
in a sport, using real photographs of them, in the same way a magazine sports
desk does. It is not a tool for fabricating imagery of people.

Concretely, the codebase refuses to: generate a human face from a text prompt,
repaint an existing face beyond recognition, or present a synthesised likeness
as photographic. Those refusals are in the code paths, with tests
(`packages/ai/test/guard.attack.test.ts`, `identityEdit.attack.test.ts`).

The one gap in that line, stated plainly: a prompt that names a real person
without using a person-noun — "Faker at a gaming desk" — is currently allowed
through, because the protected-name registry is never populated. Do not pass
player names to `--bg-prompt`.
