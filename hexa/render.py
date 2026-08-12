"""Étape 8 - Rendu HTML autonome.

Un seul fichier, aucune dépendance externe, ouvrable hors ligne.
Recherche instantanée, filtres par coach / rôle / niveau, et chaque affirmation
garde son timecode d'origine.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from .util import read_json

CSS = """
:root{--bg:#faf9f7;--fg:#1f1e1c;--muted:#6b6862;--line:#e3e0da;--card:#fff;
--accent:#7c5cff;--warm:#c2410c;--ok:#0f766e}
@media(prefers-color-scheme:dark){:root{--bg:#16151a;--fg:#eceaf3;--muted:#9c98a8;
--line:#2c2a35;--card:#1e1d24;--accent:#a58cff;--warm:#fb923c;--ok:#5eead4}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:2rem 1.25rem 6rem}
header h1{font-size:1.9rem;margin:0 0 .35rem;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0 0 1.5rem}
.stats{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1.5rem}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;
padding:.5rem .8rem;font-size:.85rem}
.stat b{display:block;font-size:1.3rem;line-height:1.2}
.controls{position:sticky;top:0;background:var(--bg);padding:.75rem 0;
border-bottom:1px solid var(--line);z-index:5;margin-bottom:1.5rem}
input[type=search]{width:100%;padding:.7rem .9rem;border:1px solid var(--line);
border-radius:10px;background:var(--card);color:var(--fg);font-size:1rem}
.filters{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.6rem}
.chip{border:1px solid var(--line);background:var(--card);color:var(--muted);
border-radius:999px;padding:.25rem .7rem;font-size:.8rem;cursor:pointer}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.module{margin:2.5rem 0 0}
.module>h2{font-size:1.35rem;border-bottom:2px solid var(--accent);
padding-bottom:.4rem;display:inline-block}
.lesson{background:var(--card);border:1px solid var(--line);border-radius:12px;
padding:1.1rem 1.25rem;margin:1rem 0}
.lesson h3{margin:0 0 .5rem;font-size:1.05rem;line-height:1.4}
.meta{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.75rem}
.tag{font-size:.72rem;padding:.15rem .5rem;border-radius:6px;
background:var(--bg);border:1px solid var(--line);color:var(--muted)}
.tag.consensus{color:var(--ok);border-color:var(--ok)}
.sect{margin:.9rem 0 0}
.sect>h4{margin:0 0 .4rem;font-size:.78rem;text-transform:uppercase;
letter-spacing:.06em;color:var(--muted)}
.claim{border-left:2px solid var(--line);padding:.15rem 0 .15rem .8rem;margin:.5rem 0}
.claim p{margin:0 0 .25rem}
.why{color:var(--muted);font-size:.92rem}
.cond{font-size:.85rem;color:var(--warm)}
.src{font-size:.76rem;color:var(--muted);font-family:ui-monospace,monospace}
.debate{border:1px solid var(--warm);border-radius:10px;padding:.8rem 1rem;margin:.9rem 0 0}
.debate>h4{margin:0 0 .5rem;font-size:.78rem;text-transform:uppercase;
letter-spacing:.06em;color:var(--warm)}
.pos{margin:.4rem 0}
.pos b{color:var(--fg)}
.hidden{display:none}
mark{background:var(--accent);color:#fff;border-radius:3px;padding:0 .15em}
"""

JS = """
const state={q:'',coach:null,role:null,level:null};
const norm=s=>s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();
function apply(){
  const q=norm(state.q.trim());
  let shown=0;
  document.querySelectorAll('.lesson').forEach(el=>{
    const okQ=!q||norm(el.dataset.text).includes(q);
    const okC=!state.coach||el.dataset.coaches.split('|').includes(state.coach);
    const okR=!state.role||el.dataset.roles.split('|').includes(state.role);
    const okL=!state.level||el.dataset.level===state.level;
    const ok=okQ&&okC&&okR&&okL;
    el.classList.toggle('hidden',!ok);
    if(ok)shown++;
  });
  document.querySelectorAll('.module').forEach(m=>{
    m.classList.toggle('hidden',!m.querySelector('.lesson:not(.hidden)'));
  });
  document.getElementById('count').textContent=shown;
}
document.getElementById('q').addEventListener('input',e=>{state.q=e.target.value;apply()});
document.querySelectorAll('.chip').forEach(chip=>{
  chip.addEventListener('click',()=>{
    const k=chip.dataset.k,v=chip.dataset.v;
    const active=state[k]===v;
    document.querySelectorAll(`.chip[data-k="${k}"]`).forEach(c=>c.classList.remove('on'));
    state[k]=active?null:v;
    if(!active)chip.classList.add('on');
    apply();
  });
});
apply();
"""


def esc(text: str) -> str:
    return html.escape(str(text or ""))


def render(out: Path, title: str = "Cours fusionné") -> Path:
    course = read_json(out / "course.json")
    stats = course["stats"]

    coaches = stats["coaches"]
    roles, levels = set(), set()
    for module in course["modules"]:
        for lesson in module["lessons"]:
            levels.add(str(lesson["level"]))
            for section in lesson["sections"]:
                for claim in section["claims"]:
                    roles.update(claim["roles"])

    parts = [
        f"<title>{esc(title)}</title>",
        f"<style>{CSS}</style>",
        '<div class="wrap"><header>',
        f"<h1>{esc(title)}</h1>",
        f'<p class="sub">Fusion de {len(coaches)} masterclass — {esc(", ".join(coaches))}</p>',
        "</header>",
        '<div class="stats">',
        f'<div class="stat"><b>{stats["n_lessons"]}</b>leçons</div>',
        f'<div class="stat"><b>{stats["n_claims"]}</b>affirmations sourcées</div>',
        f'<div class="stat"><b>{stats["n_consensus_lessons"]}</b>en consensus</div>',
        f'<div class="stat"><b>{stats["n_debates"]}</b>débats</div>',
        "</div>",
        '<div class="controls">',
        '<input type="search" id="q" placeholder="Rechercher une notion, un mot, un coach…">',
        '<div class="filters">',
    ]
    for coach in coaches:
        parts.append(f'<button class="chip" data-k="coach" data-v="{esc(coach)}">{esc(coach)}</button>')
    for role in sorted(roles):
        parts.append(f'<button class="chip" data-k="role" data-v="{esc(role)}">{esc(role)}</button>')
    for level in sorted(levels):
        parts.append(f'<button class="chip" data-k="level" data-v="{esc(level)}">niveau {esc(level)}</button>')
    parts += ["</div></div>", '<p class="sub"><span id="count">0</span> leçons affichées</p>']

    for module in course["modules"]:
        parts.append('<section class="module">')
        parts.append(f'<h2>{esc(module["label"])}</h2>')
        for lesson in module["lessons"]:
            searchable = " ".join(filter(None, [
                lesson["title"], lesson["subdomain_label"], " ".join(lesson["coaches"]),
                *[c["statement"] + " " + c["explanation"] + " " + " ".join(c["conditions"])
                  for s in lesson["sections"] for c in s["claims"]],
            ]))
            lesson_roles = sorted({r for s in lesson["sections"] for c in s["claims"] for r in c["roles"]})
            parts.append(
                f'<article class="lesson" data-text="{esc(searchable)}" '
                f'data-coaches="{esc("|".join(lesson["coaches"]))}" '
                f'data-roles="{esc("|".join(lesson_roles))}" '
                f'data-level="{lesson["level"]}">'
            )
            parts.append(f'<h3>{esc(lesson["title"])}</h3>')
            parts.append('<div class="meta">')
            parts.append(f'<span class="tag">{esc(lesson["subdomain_label"])}</span>')
            parts.append(f'<span class="tag">niveau {lesson["level"]}</span>')
            if lesson["consensus"]:
                parts.append(f'<span class="tag consensus">consensus · {esc(" + ".join(lesson["coaches"]))}</span>')
            else:
                parts.append(f'<span class="tag">{esc(lesson["coaches"][0])}</span>')
            parts.append("</div>")

            for section in lesson["sections"]:
                parts.append('<div class="sect">')
                parts.append(f'<h4>{esc(section["label"])}</h4>')
                for claim in section["claims"]:
                    parts.append('<div class="claim">')
                    parts.append(f'<p>{esc(claim["statement"])}</p>')
                    if claim["explanation"]:
                        parts.append(f'<p class="why">{esc(claim["explanation"])}</p>')
                    if claim["conditions"]:
                        parts.append(f'<p class="cond">Quand : {esc(" · ".join(claim["conditions"]))}</p>')
                    parts.append(
                        f'<p class="src">{esc(claim["coach"])} — {esc(claim["lesson"])} '
                        f'{esc(" ".join(claim["anchors"]))}</p>'
                    )
                    parts.append("</div>")
                parts.append("</div>")

            for debate in lesson["debates"]:
                parts.append('<div class="debate"><h4>Ce qui fait débat</h4>')
                if debate["context_dependent"]:
                    parts.append('<p class="why">Les deux positions tiennent, dans des contextes différents.</p>')
                for pos in debate["positions"]:
                    cond = f' — <span class="cond">{esc(" · ".join(pos["conditions"]))}</span>' if pos["conditions"] else ""
                    parts.append(f'<p class="pos"><b>{esc(pos["coach"])}</b> : {esc(pos["statement"])}{cond}</p>')
                parts.append("</div>")
            parts.append("</article>")
        parts.append("</section>")

    parts.append("</div>")
    parts.append(f"<script>{JS}</script>")

    target = out / "COURS.html"
    target.write_text("\n".join(parts), encoding="utf-8")
    print(f"\n  -> {target}")
    return target


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="hexa render", description="Rend le cours en HTML autonome.")
    ap.add_argument("--out", type=Path, default=Path("build"))
    ap.add_argument("--title", default="Cours fusionné")
    args = ap.parse_args(argv)
    render(args.out, args.title)
    return 0
