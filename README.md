<div align="center">

# Hexa

**A cinematic esports thumbnail engine where the faces are actually the players.**

Composites licensed reference photography into broadcast-grade layouts,
then verifies the likeness before it lets the render out the door.

</div>

---

## The short answer to "can this be done?"

Yes — but not by asking an image model for "Peyz vs Viper". Ask any text-to-image
model for a specific pro player and you get a stranger who happens to be the
right nationality, different every time. That is the "AI slop" look, and it is
structural: nothing in a text prompt pins a real person's face.

Real thumbnail artists don't paint faces. They cut a real photograph out of its
background and build a scene around it — rim lights, atmosphere, grade,
typography. The face stays photographic the whole way through. That is why it
looks right.

**Hexa automates that workflow.** Photographs supply identity. Generative and
procedural systems supply everything else — and are blocked in code from
touching a face. Then the finished render's face is embedded and compared back
against the player's reference gallery; if it doesn't match, the render is
rejected and retried.

See [docs/IDENTITY.md](docs/IDENTITY.md) for the full reasoning, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it's put together.

## Quick start

You need **Node 20.11 or newer** and **pnpm**. That is the whole list: no API
keys, no Python, and no photographs. Every step below runs offline.

**1 — Get the code and build it.** The build compiles twelve packages and takes
a minute or two.

```bash
git clone https://github.com/skyyartconcours-ai/Hexa.git
cd Hexa

corepack enable          # installs the pnpm version this repo pins
pnpm install
pnpm build
```

**2 — Give yourself the `hexa` command.** The CLI is not published to npm, so
point a shell alias at the built entry point. Everything below assumes it.

```bash
alias hexa="node $PWD/packages/cli/dist/bin.js"
```

<sub>Prefer not to alias? `pnpm --silent hexa <args>` does the same thing.
Keep the `--silent`: without it pnpm prints a banner that lands in `--json`
output.</sub>

**3 — Check the install.** `doctor` is the command that saves you an hour. It
tests each part — including encoding a real image — and every line that is not
`✔` names the exact command that fixes it.

```bash
hexa doctor
```

On a fresh clone it exits `0` with a handful of warnings. That is expected and
correct: no photographs, no vision sidecar and no AI keys all degrade quality
without stopping a render. It exits `1` only for something that genuinely blocks
rendering, so CI can gate on it.

**4 — Make a thumbnail.** Two player names is the whole command.

```bash
hexa gen Peyz Viper --title "RIVALS" --variants 2 --plan --out ./out/first
```

About fifteen seconds later you have `out/first/thumbnail-v01.png` and
`-v02.png` at 1280×720, each with its `RenderPlan` beside it (`--plan`), and a
report saying which variant scored best.

**Expect the QA gates to complain on this first run.** Both subjects rendered as
schematic placeholder silhouettes, because you have no reference photography yet
— the run tells you so, and says what to ingest. The picture is real; the
likeness is not there yet.

**5 — Look at what you got.**

```bash
hexa qa ./out/first/thumbnail-v01.png    # every gate, scored, with fixes
hexa players --team geng                 # who else is in the roster
hexa templates --category versus         # what else it can make
hexa preview hero-portrait --out ./out/first   # try a template with no arguments
```

`hexa qa` exits `9` when an image does not pass, which is what a publish job
should block on. Full exit-code table: `hexa --help` and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Everything supports `--json` for scripting (stdout carries the document and
nothing else), `--no-color`, and `NO_COLOR`.

## Adding the pieces

**Reference photographs** — the part that makes likeness work:

```bash
hexa assets ingest ./lck-media-kit --player Peyz --kind portrait \
  --license press-kit --source "LCK Official Media Kit" --credit "LCK"
hexa assets coverage --missing     # who still has nothing
hexa doctor                        # coverage, per team
```

`--source` is required and `--license` matters: nothing becomes publish-grade
until a human passes `--cleared`, having read the terms. Hexa ships no player
imagery — see [assets/library/README.md](assets/library/README.md) for where to
source it legitimately and what makes a good reference.

**The vision sidecar** — enables alpha-matted cutouts, face-anchored placement
and identity verification:

```bash
./services/vision/run.sh                      # FastAPI + InsightFace + rembg
export HEXA_VISION_URL=http://127.0.0.1:8765  # the address run.sh serves on
hexa doctor                                   # confirms it is reachable
```

Optional, and it needs Python 3.10+. Without it Hexa falls back to heuristic
segmentation and the identity gate reports that verification did not happen — it
never silently passes. If the sidecar is running but Hexa cannot see it,
`hexa doctor` goes looking on the usual ports and tells you which one to set.

## Who's in the roster

| League | Orgs |
|---|---|
| LCK | T1 · Hanwha Life Esports · Gen.G · KT Rolster · Dplus KIA |
| LEC | Karmine Corp · G2 Esports |

Players resolve by handle, alias, real name or Hangul, fuzzily — `hexa gen peyz viper`
works, and so does a typo.

## Licence and use

Hexa is a tool for making thumbnails about public figures in a sport, from real
photographs of them, the way a magazine sports desk does. It will not generate a
human face from a prompt, will not repaint an existing face beyond recognition,
and tracks the licence and credit for every photograph it uses.

You are responsible for holding the rights to the photographs you ingest.
