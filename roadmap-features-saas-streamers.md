# Roadmap features — SaaS streamers (classement final audité)

**Méthodologie** : 3 agents spécialisés (faisabilité IA, valeur marché, features nouvelles) + 3 agents adversariaux évaluateurs, ~60 recherches web (14 juillet 2026). Toutes les notes ci-dessous sont **post-audit adversarial**. Produit : cœur payant délai/kill-switch (app locale) + add-on serveur + tier gratuit d'acquisition + brand deals à la commission.

## Corrections majeures issues des audits (à connaître avant de lire le classement)

1. **Concurrence délai** : Antisnipe.com (4,99 $/mois : délai live + multistream 4 plateformes, app locale) et InstantDelay existent. Uniques à nous : kill switch scénarisé (purge du buffer + vidéo de remplacement) et drop protection serveur. → **Pricing d'attaque : 5,99 €/mois** (pas 8-12 €), add-on serveur +3 €, **prévente fondateurs 49 €/an à vie**.
2. **Eklipse a paywallé son gratuit le 01/06/2026** (3 highlights, payant dès 9,99 $) → l'auto-clips redevient l'arme d'acquisition n°1, à remettre en v1.5 (via agrégateur de publication type Ayrshare — ne jamais affronter soi-même les audits TikTok/Meta/quotas YouTube).
3. **M6 multistream sort de la v1** : adoption minoritaire chez les streamers moyens, Kick réduit le payout de 50 % pendant le multistream, faisabilité 3/10 (quota YouTube = jusqu'à 5 mois d'attente). En add-on « Studio » v1.5+, Twitch+Kick d'abord.
4. **Budget dev vidéo réel : 26-32 K€ année 1** (30-40 j-h à 650-800 €/j) — pas 12-18 K€. Le moat M1/M2 est du temps réel vidéo (PTS/DTS, reconnexions), pas du CRUD. Base : MediaMTX (pas DelayRelay, jouet 0-star). Piste maligne : recruter l'auteur d'un des 3 projets GitHub amateurs de délai.
5. **Coûts IA temps réel** : la vision cloud always-on est 15-100× plus chère qu'estimé (180-300 $/streamer/mois). Règle : **local + game APIs officielles (LoL Live Client Data, CS2 GSI) d'abord, OCR jamais en v1, aucune inférence GPU cloud always-on**. Whisper local en jeu = contention GPU (viable seulement sur 4070+, à détecter).
6. **Horloges à déposer semaine 1** (elles tournent indépendamment du code) : quota YouTube (jusqu'à 5 mois), audit TikTok (2-6 sem.), App Review Meta (2-4 sem.), **certificat de signature Windows** (~300-500 €/an, sinon SmartScreen bloque l'app), **soft-launch du bot Discord sur la communauté à J-30** (mur de vérification à 75-100 serveurs + privileged intents).

## Classement final (notes valeur × faisabilité post-audit)

### V1 — la prévente et le lancement (~14-18 semaines)
| Feature | Valeur | Faisabilité | Rôle |
|---|---|---|---|
| **M1 Délai + kill switch + vidéo de remplacement** | 9 | 2-3/10 (dev vidéo dédié 8-12 sem.) | LE produit. Pitch prévente : « Tu te fais snipe ? Un clic, les snipers regardent une vidéo, pas ton jeu. » 5,99 €/mois |
| **M2 Drop protection serveur** | 7 | 2/10 (v1.5 public, bêta fondateurs au lancement) | Add-on +3 €. La démo « je débranche le PC » = meilleur moment marketing, en bêta contrôlée |
| **M3+M5 Suite sponsors + preuve de diffusion PDF** | 7,5 | 7/10 (2-3 sem.) | Démontrable sem. 4-6 ; amorce le modèle commission brand deals |
| **P1 Discord clé en main 1 clic** | 7,5 | 7/10 (2-4 sem. + soft-launch J-30) | Acquisition gratuite, carburant anti-MEE6 (11,99 $/mois) |

### V1.1-V1.5 (mois 4-8)
| Feature | Valeur | Note | Détail |
|---|---|---|---|
| **P3+P10 Starter pack visuel + écrans** | 7 | 6/10 | Chemin critique = commande designer (5-10 thèmes) dès sem. 1 ; socle browser sources partagé avec M3 |
| **P6+P7 Récap coaching IA + radar catégories** | 6,5 | 7/10 | Rétention D+1 ; exige la collecte pendant le live (socle B) |
| **M7/P2 Auto-clips (réhabilité post-paywall Eklipse)** | 5,5 | 4-5/10 | v1 = export « prêt à poster » ; publication via agrégateur ; JAMAIS d'audits API en direct |
| **Ange Gardien rescopé** (nouvelle n°1) | 8 | 5/10 | Détection notifications/popups/doxx par OCR local + template matching sur le buffer retardé M1 (toasts Windows/Discord = UI régulières, quasi zéro faux positif). Mode alerte par défaut, auto-action opt-in. JAMAIS de promesse NSFW auto-blur. Impossible à copier sans reconstruire M1 |
| **Bookmaker assisté** (nouvelle n°2) | 7 | 7/10 | Predictions Twitch suggérées + résolution en confirmation 1 clic, via LoL Live Client Data API (pas d'OCR). ToS vérifié OK. Jamais full-auto (résolution irréversible) |
| **Habillage Broadcast** (nouvelle n°3) | 6,5 | 6/10 | Lower-thirds rédigés par IA sur le bus d'événements game APIs ; erreur = une ligne de texte, pas un incident |
| **M4 Media kit vivant** | 4,5 | 7/10 | Gratuit, au service de la commission (Beacons a tué la valeur d'abonnement) |
| **M6 Multistream + chat unifié Twitch+Kick** | 6 | 3/10 | Add-on « Studio » ; YouTube quand Google accordera le quota ; monitoring webhooks Kick obligatoire (désabonnement après 3 échecs) |

### V2+ (si traction)
P4 planificateur (Discord par défaut, X coûte 0,20 $/post avec lien), P9 matchmaking (quand base installée), M8 dashboard revenus (« estimations » — Twitch n'expose aucun montant), M10 optimiseur (recadré « alertes », pas « A/B testing »), Clips Polyglottes (dépend de M7 + labels IA obligatoires partout), Arène du Chat, Replay 1 clic sur le buffer (jamais auto-incrusté).

### À ne jamais construire
| Feature | Raison |
|---|---|
| P5 bot de chat | Wizebot : 1,5 M de streamers, FR, gratuit, mod IA shippée 2025-2026 (tue aussi M9 → 3,5) |
| P8 lien unique | Linktree/Beacons gratuits |
| Pilote BRB (IA anime le stream sans le streamer) | DANGER : ToS en durcissement + chat adversarial garanti + personne pour appuyer sur le kill switch — incohérence totale avec le produit |
| La Voix (caster IA) | COGS réel 10-25 $/mois (Questie vend ~0,60-0,80 $/h), marché saturé (Questie, ai_licia, Streamlabs Agent) |
| Passerelle Babel | Traduction = commodity sherlockable par Twitch |
| Mémoire Vive | ai_licia le fait déjà ; RGPD disproportionné |

## Plan de déploiement (14-18 semaines, budget ~35-45 K€)

**Semaine 0 (avant tout code)** : landing + **prévente fondateurs 49 €/an à vie** annoncée en public sur le stream. Seuil : 200-300 préventes → sinon pivot sans avoir rien construit.

**Semaine 1** (si seuil atteint) : contractualiser le dev vidéo (30-40 j-h fermes, 26-32 K€ — ou equity/rev-share, ou recruter un des auteurs GitHub) ; commander les thèmes au motion designer (~3-5 K€) ; déposer TOUTES les horloges (quota YouTube, audit TikTok, review Meta, certificat Windows) ; créer les apps Twitch/Kick.

**Semaines 1-6 — piste web (toi + Claude Code)** : socle browser sources → M3 suite sponsors (démo publique sem. 4-6) ; socle OAuth/EventSub Twitch ; soft-launch bot Discord sur ta communauté ; P7 radar en quick win public « construit en live ».

**Semaines 2-12 — piste vidéo (dev dédié)** : M1 app locale (base MediaMTX, signature Windows), puis socle serveur.

**Semaines 10-14** : bêta fermée M1 sur 50-100 streamers de ta communauté (le vrai test = la diversité des setups OBS) ; M2 en bêta fondateurs ; démo kill switch en live.

**Semaines 14-18** : lancement payant public (M1 à 5,99 €, add-on M2 +3 €, P1+M3 inclus). Liste d'attente sur l'add-on serveur pour lisser la charge. Monitoring Kick/support = les 2 postes sous-estimés.

**Économie cible à 12 mois** (si prévente validée) : 500-2 000 abonnés à ~6-9 € = **3-18 K€ MRR**, COGS <15 %, + la marketplace brand deals à la commission comme étage suivant.
