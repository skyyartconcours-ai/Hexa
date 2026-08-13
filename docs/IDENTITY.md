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
  request. A prompt asking for a person, a face, a portrait, or a named
  individual throws before it reaches any provider.
- `guardIdentityEdit()` requires that any image-to-image pass over a photo
  declares `preserve` regions covering the face and caps `strength`, so an edit
  can restyle the lighting around a subject but cannot repaint who they are.
- `@hexa/qa`'s `identityGate` crops the face out of the **finished render**,
  embeds it, and cosine-compares it against the player's reference gallery. If
  the similarity falls below threshold the render **fails QA** and the pipeline
  retries with a different reference asset.

That last point is what turns a promise into a guarantee. The tool does not
trust itself; it checks.

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
hexa assets coverage          # which players still have no references
hexa doctor                   # what else is missing
```

**Until you add photos, the tool still runs.** Every layout, effect, grade,
template and QA gate works against a generated placeholder silhouette, so you
can design and evaluate compositions immediately. The placeholders are
deliberately schematic — they never depict a fake person.

## Honest limitations

- **Identity verification needs the vision sidecar.** Face embedding requires
  the optional Python service (`services/vision/run.sh`). Without it, Hexa
  cannot verify likeness and says so — the gate emits a warning rather than
  quietly passing.
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
