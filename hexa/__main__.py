"""Point d'entrée : python -m hexa <commande>"""
from __future__ import annotations

import sys

COMMANDS = {
    "ingest": ("hexa.ingest", "Normalise une source de transcripts vers le corpus"),
    "blocks": ("hexa.blocks", "Découpe le corpus en blocs ancrés"),
    "packs": ("hexa.extract", "Génère les packs d'extraction à donner à Claude"),
    "load": ("hexa.claims", "Charge, valide et dédoublonne les unités extraites"),
    "cluster": ("hexa.cluster", "Regroupe les unités en notions"),
    "conflicts": ("hexa.conflicts", "Signale les désaccords entre coachs"),
    "assemble": ("hexa.assemble", "Assemble le cours fusionné"),
    "render": ("hexa.render", "Rend le cours en HTML autonome"),
    "status": ("hexa.status", "État d'avancement du pipeline"),
}


def usage() -> int:
    print("hexa — fusion de masterclass en un cours unique\n")
    print("Usage : python -m hexa <commande> [options]\n")
    width = max(len(c) for c in COMMANDS)
    for name, (_, desc) in COMMANDS.items():
        print(f"  {name:<{width}}  {desc}")
    print("\nChaque commande accepte --help.")
    return 1


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        return usage()
    command = sys.argv[1]
    if command not in COMMANDS:
        print(f"Commande inconnue : {command}\n")
        return usage()
    module_name = COMMANDS[command][0]
    module = __import__(module_name, fromlist=["main"])
    return module.main(sys.argv[2:])


if __name__ == "__main__":
    raise SystemExit(main())
