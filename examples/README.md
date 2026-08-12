# Démo — deux coachs qui se contredisent

Un corpus minuscule (deux leçons, deux formats) qui produit un cours complet en
quelques secondes, sans GPU et sans modèle : les réponses d'extraction sont déjà
fournies.

Sert à voir la forme des sorties avant de lancer 60 h de vidéo, et à vérifier que
l'installation fonctionne.

## Lancer

```bash
python -m hexa ingest examples/demo/kirei   --coach "Kirei"   --out build_demo
python -m hexa ingest examples/demo/coach_b --coach "Coach B" --out build_demo
python -m hexa blocks --out build_demo
cp examples/demo/*-b01.json build_demo/claims_raw/
python -m hexa load     --out build_demo
python -m hexa cluster  --out build_demo
python -m hexa conflicts --out build_demo
python -m hexa assemble --out build_demo
python -m hexa render   --out build_demo --title "Démo"
```

Puis ouvre `build_demo/COURS.html`.

Sous Windows, remplace `cp` par `copy examples\demo\*-b01.json build_demo\claims_raw\`.

## Ce que la démo montre

Les deux coachs sont en désaccord sur deux points, volontairement :

**Le freeze en retard.** Kirei dit de le faire, Coach B dit de ne jamais le
faire. Les deux ont raison : Kirei parle de soloQ jusqu'à Émeraude contre des
adversaires qui ne trackent pas la jungle, Coach B parle de jeu compétitif avec
une équipe coordonnée. Le pipeline le détecte par polarité opposée, remarque que
les deux ont un contexte explicite, et le marque comme *probablement conciliable*.

**Le timing de crash avant objectif.** 30 secondes contre 45. Détecté par
divergence numérique sur la même unité — un cas que le regroupement lexical seul
manque, puisque les deux phrases se ressemblent peu.

Les deux apparaissent dans `build_demo/_desaccords.md` avec leurs sources, et
dans le cours sous « Ce qui fait débat ». Aucun n'a été tranché automatiquement.

## Le fichier volontairement cassé

`examples/demo/coachb-001-b01.json` fourni ici est propre. Pour voir le
validateur travailler, ajoute une entrée avec un `domain` inexistant : elle est
rejetée et détaillée dans `build_demo/_rapport_claims.md`, sans bloquer les
autres.
