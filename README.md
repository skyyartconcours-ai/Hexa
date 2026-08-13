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

```bash
pnpm install
pnpm build

# What's working, what's missing, and exactly how to fix it
node packages/cli/dist/bin.js doctor

# Browse what's in the box
node packages/cli/dist/bin.js players --team geng
node packages/cli/dist/bin.js templates --category versus

# Make one
node packages/cli/dist/bin.js gen Peyz Viper \
  --template versus-classic \
  --title "RIVALS" \
  --variants 4 \
  --out ./out
```

With no API keys, no Python and no photographs, that command still renders:
backplates come from the built-in offline provider and subjects come from
schematic placeholders. Add reference photos and the vision sidecar, and the
same command produces the real thing.

## Adding the pieces

**Reference photographs** — the part that makes likeness work:

```bash
hexa assets ingest ./lck-media-kit --player Peyz --kind portrait \
  --license press-kit --source "LCK Official Media Kit" --credit "LCK"
hexa assets coverage
```

Hexa ships no player imagery. See
[assets/library/README.md](assets/library/README.md) for where to legitimately
source it and what makes a good reference.

**The vision sidecar** — enables real cutouts and identity verification:

```bash
./services/vision/run.sh     # FastAPI + InsightFace + rembg on :8765
```

Optional. Without it, Hexa falls back to heuristic segmentation and the identity
gate reports that verification did not happen — it never silently passes.

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
