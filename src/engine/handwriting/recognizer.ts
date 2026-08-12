/**
 * Hexa — reconnaissance de caractères manuscrits ($P Point-Cloud Recognizer).
 *
 * Implémentation maison, sans aucune dépendance, de l'algorithme $P de
 * Vatavu, Anthony et Wobbrock : un caractère manuscrit est vu comme un
 * NUAGE DE POINTS, pas comme une suite de traits. Conséquence directe et
 * précieuse ici : le nombre de traits, leur ordre et leur sens n'ont aucune
 * importance. Un « E » tracé en quatre traits, dans n'importe quel ordre,
 * donne le même nuage qu'un « E » tracé en deux.
 *
 * Quatre écarts assumés par rapport au papier d'origine :
 *  1. la normalisation se fait par la HAUTEUR (et non dans un carré unité) :
 *     les proportions sont porteuses de sens pour des lettres — un « I »
 *     étroit ne doit jamais ressembler à un « O » ;
 *  2. un pré-filtrage par rapport de forme évite 80 % des comparaisons ;
 *  3. la confiance tient compte de la MARGE avec le deuxième candidat :
 *     deux gabarits ex æquo, c'est un doute, donc pas de transformation ;
 *  4. le nuage est doublé d'une CARTE DE DENSITÉ (zoning, 9 × 6 cases). $P
 *     seul est aveugle à « où se trouve la matière » : un G et un Q, un B et
 *     un 8, un I et un « ! » lui donnent des distances quasi identiques. La
 *     carte de densité, elle, voit tout de suite la case vide. Les deux
 *     mesures sont complémentaires et se combinent (mesuré : +5,7 points de
 *     reconnaissance exacte sur le banc d'essai des capitales).
 */
import { CLOUD_N, resampleCloud, templates, type TplPoint } from './templates'

export interface Candidate {
  char: string
  /** distance moyenne pondérée, en hauteurs de capitale (petit = bon) */
  dist: number
  /** confiance 0..1, marge avec le second candidat comprise */
  score: number
}

interface NormCloud {
  pts: TplPoint[]
  /** largeur / hauteur après normalisation */
  aspect: number
  /** carte de densité 9 × 6, somme = 1 */
  zone: Float32Array
}

/* ------------------------------------------------------------------ */
/* Carte de densité (zoning)                                           */
/* ------------------------------------------------------------------ */

/** colonnes de la carte : x normalisé couvre [-0,75 ; 0,75] */
const ZX = 9
/** lignes de la carte : y normalisé couvre [-0,5 ; 0,5] (cases carrées) */
const ZY = 6
const ZONE_HALF_W = 0.75

/**
 * Répartit la matière du nuage sur une grille, par éclaboussure bilinéaire
 * (un point n'appartient pas franchement à une case : il se partage entre
 * ses quatre voisines, sinon un tremblement d'un pixel ferait basculer la
 * mesure). La carte est ensuite ramenée à une somme de 1 : elle ne dépend ni
 * du nombre de points ni de l'épaisseur du trait.
 */
function zoneMap(pts: TplPoint[]): Float32Array {
  const z = new Float32Array(ZX * ZY)
  for (const p of pts) {
    // coordonnées en cases (le clamp ramène les formes très larges au bord)
    let gx = ((p.x + ZONE_HALF_W) / (ZONE_HALF_W * 2)) * (ZX - 1)
    let gy = (p.y + 0.5) * (ZY - 1)
    gx = gx < 0 ? 0 : gx > ZX - 1 ? ZX - 1 : gx
    gy = gy < 0 ? 0 : gy > ZY - 1 ? ZY - 1 : gy
    const ix = Math.floor(gx)
    const iy = Math.floor(gy)
    const fx = gx - ix
    const fy = gy - iy
    const ix1 = Math.min(ix + 1, ZX - 1)
    const iy1 = Math.min(iy + 1, ZY - 1)
    z[iy * ZX + ix] += (1 - fx) * (1 - fy)
    z[iy * ZX + ix1] += fx * (1 - fy)
    z[iy1 * ZX + ix] += (1 - fx) * fy
    z[iy1 * ZX + ix1] += fx * fy
  }
  let sum = 0
  for (let i = 0; i < z.length; i++) sum += z[i]
  if (sum > 0) for (let i = 0; i < z.length; i++) z[i] /= sum
  return z
}

/** Écart entre deux cartes de densité : demi-distance L1, donc 0..1. */
function zoneDistance(a: Float32Array, b: Float32Array): number {
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
  return d / 2
}

/**
 * Normalise un nuage : translation du centre de la boîte englobante à
 * l'origine, puis mise à l'échelle par la hauteur. Les formes très plates
 * (un tiret) sont mises à l'échelle par la largeur pour éviter l'explosion
 * numérique — elles restent alors franchement plates, donc loin de tout.
 */
function normalize(pts: TplPoint[]): NormCloud {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const w = maxX - minX
  const h = maxY - minY
  const s = Math.max(h, w * 0.3, 1e-4)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const out = pts.map((p) => ({ x: (p.x - cx) / s, y: (p.y - cy) / s }))
  return {
    pts: out,
    aspect: w / Math.max(h, 1e-4),
    zone: zoneMap(out),
  }
}

/**
 * Distance $P d'un nuage à l'autre par appariement glouton : on part du
 * point `start`, on lui associe le point libre le plus proche, et on avance.
 * Les premiers appariements pèsent plus lourd que les derniers (pondération
 * du papier), ce qui rend la mesure moins sensible aux points orphelins.
 */
function cloudDistance(a: TplPoint[], b: TplPoint[], start: number, limit: number): number {
  const n = a.length
  const used = new Uint8Array(n)
  // abandon anticipé : inutile de finir un appariement déjà plus mauvais que
  // le meilleur connu. C'est ce qui rend la reconnaissance instantanée.
  const cap = limit * (n / 2)
  let sum = 0
  let i = start
  let k = 0
  do {
    let best = Infinity
    let bestJ = -1
    for (let j = 0; j < n; j++) {
      if (used[j]) continue
      const dx = a[i].x - b[j].x
      const dy = a[i].y - b[j].y
      const d = dx * dx + dy * dy
      if (d < best) {
        best = d
        bestJ = j
      }
    }
    if (bestJ < 0) break
    used[bestJ] = 1
    const weight = 1 - k / n
    sum += weight * Math.sqrt(best)
    if (sum > cap) return Infinity
    k++
    i = (i + 1) % n
  } while (i !== start)
  // la somme des poids vaut n/2 : on ramène à une distance moyenne
  return sum / (n / 2)
}

/**
 * Meilleure distance entre deux nuages. `cap` est un plafond : au-delà, la
 * valeur exacte ne nous intéresse pas (le gabarit est déjà hors course), on
 * renvoie le plafond. Le classement des deux premiers reste exact.
 */
function matchDistance(ink: TplPoint[], tpl: TplPoint[], cap: number): number {
  const n = ink.length
  const step = Math.max(1, Math.round(n / 4))
  const lim = cap * 2
  let a = lim
  let b = lim
  for (let i = 0; i < n; i += step) {
    const d1 = cloudDistance(ink, tpl, i, a)
    if (d1 < a) a = d1
    const d2 = cloudDistance(tpl, ink, i, b)
    if (d2 < b) b = d2
  }
  // MOYENNE des deux sens, et non le minimum comme dans le papier : le
  // minimum récompense les gabarits « sous-ensembles » (un P se glisse dans
  // un R, un P n'a rien à opposer à la jambe du R). La moyenne, si.
  return Math.min(cap, (a + b) / 2)
}

/** Cache des gabarits normalisés (générés puis normalisés une seule fois). */
let normalized: { char: string; cloud: NormCloud }[] | null = null

function normalizedTemplates(): { char: string; cloud: NormCloud }[] {
  if (normalized) return normalized
  normalized = templates().map((t) => ({
    char: t.char,
    cloud: normalize(resampleCloud(t.paths, CLOUD_N)),
  }))
  return normalized
}

/**
 * Reconnaît un caractère à partir de ses sous-tracés bruts (coordonnées
 * écran). Renvoie les meilleurs candidats, le plus sûr d'abord.
 */
export function recognizeChar(paths: TplPoint[][], max = 3): Candidate[] {
  const sampled = resampleCloud(paths, CLOUD_N)
  if (sampled.length < CLOUD_N) return []
  const ink = normalize(sampled)

  const scored: { char: string; dist: number }[] = []
  let bestP = P_LIMIT
  for (const t of normalizedTemplates()) {
    // pré-filtre 1 : un rapport de forme trop éloigné ne peut pas être la
    // bonne lettre, et coûte 1 000 fois moins cher à écarter ici qu'à comparer.
    const ra = Math.log((ink.aspect + 0.25) / (t.cloud.aspect + 0.25))
    if (Math.abs(ra) > 1.05) continue
    // pré-filtre 2 : la carte de densité, calculée en 54 additions, élimine
    // les gabarits dont la matière n'est manifestement pas au même endroit.
    const z = zoneDistance(ink.zone, t.cloud.zone)
    if (z > 0.62) continue
    const d = matchDistance(ink.pts, t.cloud.pts, Math.min(P_LIMIT, bestP * 1.9))
    if (d < bestP) bestP = d
    scored.push({ char: t.char, dist: (d + ZONE_W * z) * (DIGITS.has(t.char) ? DIGIT_BIAS : 1) })
  }
  if (scored.length === 0) return []
  scored.sort((a, b) => a.dist - b.dist)
  // plusieurs variantes d'une même lettre : on ne garde que la meilleure
  const seen = new Set<string>()
  const uniq = scored.filter((s) => (seen.has(s.char) ? false : (seen.add(s.char), true)))
  scored.length = 0
  scored.push(...uniq)

  const out: Candidate[] = []
  const d1 = scored[0].dist
  const d2 = scored.length > 1 ? scored[1].dist : d1 * 1.9
  // marge relative : deux gabarits au coude à coude = doute assumé
  const margin = clamp01(((d2 - d1) / Math.max(d1, 1e-3)) * 3.2)
  for (let i = 0; i < Math.min(max, scored.length); i++) {
    const base = clamp01(1 - scored[i].dist / DIST_LIMIT)
    const score = i === 0 ? base * (0.62 + 0.38 * margin) : base * 0.6
    out.push({ char: scored[i].char, dist: scored[i].dist, score })
  }
  return out
}

/**
 * Léger désavantage donné aux CHIFFRES. Ce n'est pas un artifice : le mode
 * écriture sert à poser des mots (« SYNDRA », « TOP », « WARD »), et les
 * couples O/0, D/0, I/1, S/5, B/8 sont indécidables sur la seule forme. À
 * égalité de dessin, la lettre est le bon pari. 8 % suffisent à trancher les
 * ex æquo sans jamais empêcher un chiffre franc d'être reconnu.
 */
const DIGIT_BIAS = 1.08
const DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

/** Plafond de la seule distance $P (unités = hauteur de capitale). */
const P_LIMIT = 0.46
/** poids de la carte de densité dans la distance combinée (réglé au banc) */
const ZONE_W = 0.24
/** Distance combinée au-delà de laquelle la confiance tombe à zéro. */
const DIST_LIMIT = 0.54

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
