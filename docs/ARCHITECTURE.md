# Architecture

Hexa is a pnpm monorepo. Each package owns one concern and depends only on
`@hexa/core` plus whatever it genuinely needs, which keeps the dependency graph
a DAG and makes every layer independently testable.

```
                     ┌──────────────┐
                     │  @hexa/cli   │  hexa gen / players / doctor / qa …
                     └──────┬───────┘
                            │
                     ┌──────▼────────┐
                     │ @hexa/pipeline│  resolve → select → cutout → detect →
                     └──┬─┬─┬─┬─┬─┬──┘  backplate → compile → render → qa → emit
        ┌───────────────┘ │ │ │ │ └───────────────┐
        │        ┌────────┘ │ │ └────────┐        │
   ┌────▼────┐ ┌─▼──────┐ ┌─▼─────┐ ┌────▼───┐ ┌──▼─────┐
   │  data   │ │ assets │ │vision │ │templates│ │   qa   │
   └────┬────┘ └───┬────┘ └──┬────┘ └────┬───┘ └───┬────┘
        │          │         │           │         │
        │      ┌───▼─────┐ ┌─▼──────┐ ┌──▼────┐ ┌──▼───┐
        │      │ layout  │ │   ai   │ │ type  │ │render│
        │      └────┬────┘ └───┬────┘ └───┬───┘ └──┬───┘
        └───────────┴──────────┴──────────┴────────┘
                            │
                     ┌──────▼───────┐
                     │  @hexa/core  │  types • colour • rng • geometry • errors
                     └──────────────┘
```

## Packages

| Package | Owns |
|---|---|
| `@hexa/core` | Domain types, OKLab colour maths, seeded RNG, geometry, typed errors, logger. No I/O, no dependencies. |
| `@hexa/data` | The roster: LCK (T1, HLE, Gen.G, KT, Dplus KIA) and LEC (Karmine Corp, G2) players and team brand kits, with fuzzy name resolution. |
| `@hexa/assets` | The reference photo library: manifest, ingestion, perceptual dedup, quality scoring, licence/provenance tracking, placeholder synthesis. |
| `@hexa/vision` | Face detection, 512-d embeddings, background segmentation with alpha matting. TypeScript client over an optional Python sidecar, with graceful fallbacks. |
| `@hexa/layout` | Normalised→pixel resolution, face-anchored subject fitting, bust cropping, aspect reflow, composition scoring, platform safe zones. |
| `@hexa/render` | The sharp/libvips compositor: layer stack, blend modes, rim light, light wrap, bloom, halation, 3D LUTs, grain, procedural generators. |
| `@hexa/type` | Esports typography: heavy condensed type, extrusion, strokes, gradient fills, auto-fit, versus marks, nameplates, legibility scoring. |
| `@hexa/templates` | The design library — declarative `LayoutSpec` + `StyleSpec` per thumbnail type. Pure data, no rendering. |
| `@hexa/ai` | The generative boundary. Backplates and identity-preserving edits only; refuses to generate faces. Multi-provider with an always-available offline provider. |
| `@hexa/qa` | The gates that can veto a render: identity, legibility at real display sizes, contrast, safe zones, face placement, clutter, colour harmony, licence. |
| `@hexa/pipeline` | Orchestration and the template→`RenderPlan` compiler. |
| `@hexa/cli` | The `hexa` command. |
| `services/vision` | Optional Python sidecar (FastAPI + InsightFace + rembg). |

## Two data structures carry the whole design

**`LayoutSpec`** is resolution-independent. Every rect is in normalised 0–1
canvas units, so one template serves 1280×720, 1920×1080 and 1080×1920 without
a rewrite. Pixels are resolved exactly once, in `@hexa/layout`.

**`RenderPlan`** is a fully-resolved, serialisable description of every layer to
composite — no closures, no promises. That makes a plan cacheable, diffable
between variants, replayable byte-identically from its seed, and shippable to a
remote worker. The plan is also the audit trail: `plan.meta.identityLayers`
tells QA where the faces are, and `plan.meta.faceRects` tells it where to crop.

## Determinism

Every stochastic decision — particle placement, variant jitter, crop nudges,
grain — draws from `createRng(plan.seed)`, forked per subsystem so one
subsystem's draws never perturb another's. The same request with the same seed
produces byte-identical output. This is what makes caching safe, makes visual
regression testing possible, and lets a user reproduce a thumbnail they liked
three months ago.

## Where quality actually comes from

The gap between a mediocre composite and a broadcast-grade one is not the
subject cutout. It is:

- **Directional rim lighting** that agrees with the background's light
  direction, in the *opposing* team's colour — this is what sells versus energy.
- **Light wrap**: heavily blurred background sampled into a thin band inside the
  subject's alpha edge, so the subject sits *in* the scene rather than on it.
- **Atmospheric separation**: haze and particles rendered both behind *and* in
  front of the subjects, so depth reads.
- **A real grade**: exposure → contrast → temperature → lift/gamma/gain →
  saturation → split-tone → LUT → bloom → halation → chromatic aberration →
  vignette → grain. Order matters; grain goes last so it isn't blurred, CA
  before vignette so darkened corners hide the fringing.
- **Typography with weight**: heavy condensed caps, tight tracking, hard
  outline or plate, and a size that survives being shrunk to 168×94.

Each of these is a first-class, individually testable function rather than a
side effect buried in a render routine.

## Failure philosophy

The pipeline is built to degrade, not to stop:

- No reference photo for a player? Synthesise a schematic placeholder, warn,
  keep rendering.
- Vision sidecar not running? Fall back to heuristic segmentation, and have the
  identity gate emit a **warning that verification did not happen** — never a
  silent pass.
- No AI provider configured? The `local` provider generates procedural
  backplates offline with no API key.
- A QA gate throws? It becomes a warning naming the gate; one broken gate never
  kills a render.

The only hard failures are the ones that should be hard: a player who isn't in
the roster, a template that doesn't exist, a licence requirement that isn't met,
and an identity check that actively fails.
