# Reference asset library

This directory holds the photographs Hexa composites from. **Nothing in here is
committed to git** (see `.gitignore`) — reference photography is licensed
material and belongs on your disk, not in a public repository.

## Layout

```
assets/library/
├── manifest.json          # the index — schema is AssetManifest in @hexa/core
├── players/
│   ├── geng-peyz/
│   │   ├── src/           # original photographs as ingested
│   │   └── cutout/        # cached alpha cutouts, regenerable
│   └── hle-viper/
├── teams/                 # crests and logos
└── backplates/            # your own background plates
```

## Adding photos

```bash
hexa assets ingest ./downloads/lck-media-kit \
  --player Peyz \
  --kind portrait \
  --license press-kit \
  --source "LCK Official Media Kit 2026 Spring" \
  --credit "LCK / Riot Games"
```

Ingestion computes real dimensions, sharpness, brightness and contrast, hashes
each image perceptually to skip near-duplicates, and records provenance. Face
boxes and embeddings are filled in by a second enrichment pass once the vision
sidecar is available.

## Clearing for publication

Assets land with `cleared: false`. A human has to confirm the licence permits
what you're about to do:

```bash
hexa assets clear <assetId>       # after you have read the licence
hexa assets coverage              # who still has no usable references
```

Renders run with uncleared assets by default (so you can prototype), but
`--require-cleared` makes the licence gate a hard failure. Use it for anything
you publish.

## What makes a good reference photo

Roughly in order of impact on the final thumbnail:

1. **Face size.** The face should occupy a large fraction of the frame. A
   1000px-wide photo where the head is 80px tall will look soft once scaled up.
2. **Sharp focus on the eyes.** Everything else can be soft.
3. **Even, non-directional lighting**, or lighting that matches the scene you
   intend to build. Hexa can add rim light; it cannot remove a hard shadow
   across half a face.
4. **A clean separation from the background** — hair against a busy crowd is the
   hardest possible matte.
5. **Head slightly turned.** For versus layouts, a subject angled toward the
   camera's left or right lets the compositor point them inward naturally.
6. **Neutral or intense expression.** Mid-blink and mid-word are unusable.
7. **Visible jersey.** Team identity reads instantly and saves you a nameplate.

Aim for 3–5 usable references per player across different angles. The pipeline
picks the best one per slot and falls back to the next when the identity gate
is unhappy.
