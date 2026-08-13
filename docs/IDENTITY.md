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
  likeness throws before it reaches any provider.
- `guardIdentityEdit()` requires that any image-to-image pass over a photo
  **declares** `preserve` regions and caps `strength` at 0.65, so an edit can
  restyle the lighting around a subject but cannot repaint who they are.
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
- **`preserve` regions are declared, not verified.** The guard has no access to
  a face detector, so it checks that at least one region exists and has positive
  area. It cannot confirm the region actually covers the face.
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
as photographic. Those refusals are in the code paths, with tests.
