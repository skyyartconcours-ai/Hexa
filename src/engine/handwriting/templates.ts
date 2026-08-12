/**
 * Hexa — gabarits de reconnaissance d'écriture.
 *
 * TOUT est généré par code : chaque caractère est décrit par un petit
 * programme de tracé (déplacements, segments, courbes de Bézier, arcs),
 * puis échantillonné à pas d'arc constant. Aucun point n'est saisi à la
 * main, et changer la finesse d'échantillonnage ne demande rien d'autre
 * que de changer une constante.
 *
 * Repère commun à tous les gabarits (boîte de capitale) :
 *   x = 0 au bord gauche, largeur naturelle propre à chaque lettre ;
 *   y = 0 en haut de capitale, y = 1 sur la ligne de base (y vers le bas).
 * Les proportions comptent : le reconnaisseur normalise par la HAUTEUR,
 * donc un « I » étroit et un « W » large restent discernables.
 */

export interface TplPoint {
  x: number
  y: number
}

/** Un gabarit = un nuage de points (l'ordre et le nombre de traits n'importent pas). */
export interface Template {
  /** caractère produit en sortie (majuscule, chiffre, signe) */
  char: string
  /** sous-tracés échantillonnés, dans la boîte de capitale */
  paths: TplPoint[][]
}

/* ------------------------------------------------------------------ */
/* Petit constructeur de tracé — sert uniquement à générer les nuages.  */
/* ------------------------------------------------------------------ */

const CURVE_STEPS = 14
const ARC_STEPS = 26

class Pen {
  private paths: TplPoint[][] = []
  private cur: TplPoint[] = []
  private cx = 0
  private cy = 0

  /** lever le crayon et le poser ailleurs */
  m(x: number, y: number): this {
    this.flush()
    this.cx = x
    this.cy = y
    this.cur = [{ x, y }]
    return this
  }

  /** segment droit */
  l(x: number, y: number): this {
    this.cur.push({ x, y })
    this.cx = x
    this.cy = y
    return this
  }

  /** courbe de Bézier cubique depuis le point courant */
  c(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    const x0 = this.cx
    const y0 = this.cy
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS
      const u = 1 - t
      const a = u * u * u
      const b = 3 * u * u * t
      const d = 3 * u * t * t
      const e = t * t * t
      this.cur.push({
        x: a * x0 + b * x1 + d * x2 + e * x,
        y: a * y0 + b * y1 + d * y2 + e * y,
      })
    }
    this.cx = x
    this.cy = y
    return this
  }

  /** arc d'ellipse — angles en degrés, 0 = droite, sens horaire (y vers le bas) */
  a(cx: number, cy: number, rx: number, ry: number, from: number, to: number): this {
    this.flush()
    const pts: TplPoint[] = []
    for (let i = 0; i <= ARC_STEPS; i++) {
      const ang = ((from + ((to - from) * i) / ARC_STEPS) * Math.PI) / 180
      pts.push({ x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry })
    }
    this.paths.push(pts)
    const last = pts[pts.length - 1]
    this.cx = last.x
    this.cy = last.y
    return this
  }

  /** ellipse complète */
  o(cx: number, cy: number, rx: number, ry: number): this {
    return this.a(cx, cy, rx, ry, 0, 360)
  }

  /** point (le point du i, du ! ou du ?) — un tout petit disque */
  dot(x: number, y: number, r = 0.055): this {
    return this.o(x, y, r, r)
  }

  private flush(): void {
    if (this.cur.length > 1) this.paths.push(this.cur)
    this.cur = []
  }

  done(): TplPoint[][] {
    this.flush()
    return this.paths
  }
}

const pen = (): Pen => new Pen()

/* ------------------------------------------------------------------ */
/* Alphabet — capitales simplifiées, chiffres, quelques signes.         */
/* ------------------------------------------------------------------ */

/** Table caractère → programme de tracé. */
const DRAWINGS: Record<string, () => TplPoint[][]> = {
  A: () => pen().m(0, 1).l(0.44, 0).l(0.88, 1).m(0.15, 0.68).l(0.73, 0.68).done(),
  B: () =>
    pen()
      .m(0, 0)
      .l(0, 1)
      .m(0, 0)
      .l(0.42, 0)
      .c(0.78, 0, 0.78, 0.48, 0.42, 0.48)
      .l(0, 0.48)
      .m(0.42, 0.48)
      .c(0.84, 0.48, 0.84, 1, 0.42, 1)
      .l(0, 1)
      .done(),
  C: () => pen().a(0.45, 0.5, 0.45, 0.5, 52, 308).done(),
  D: () => pen().m(0, 0).l(0, 1).m(0, 0).l(0.34, 0).c(0.88, 0, 0.88, 1, 0.34, 1).l(0, 1).done(),
  E: () => pen().m(0.74, 0).l(0, 0).l(0, 1).l(0.74, 1).m(0, 0.5).l(0.6, 0.5).done(),
  F: () => pen().m(0.74, 0).l(0, 0).l(0, 1).m(0, 0.48).l(0.6, 0.48).done(),
  G: () =>
    pen()
      .a(0.45, 0.5, 0.45, 0.5, 40, 308)
      .m(0.52, 0.56)
      .l(0.9, 0.56)
      .l(0.9, 0.86)
      .done(),
  H: () => pen().m(0, 0).l(0, 1).m(0.72, 0).l(0.72, 1).m(0, 0.5).l(0.72, 0.5).done(),
  I: () => pen().m(0.1, 0).l(0.1, 1).done(),
  J: () => pen().m(0.68, 0).l(0.68, 0.7).c(0.68, 1.04, 0.12, 1.04, 0.1, 0.68).done(),
  K: () => pen().m(0, 0).l(0, 1).m(0.72, 0).l(0.06, 0.56).m(0.22, 0.42).l(0.76, 1).done(),
  L: () => pen().m(0, 0).l(0, 1).l(0.64, 1).done(),
  M: () => pen().m(0, 1).l(0, 0).l(0.44, 0.66).l(0.88, 0).l(0.88, 1).done(),
  N: () => pen().m(0, 1).l(0, 0).l(0.74, 1).l(0.74, 0).done(),
  O: () => pen().o(0.45, 0.5, 0.45, 0.5).done(),
  P: () => pen().m(0, 0).l(0, 1).m(0, 0).l(0.42, 0).c(0.82, 0, 0.82, 0.52, 0.42, 0.52).l(0, 0.52).done(),
  Q: () => pen().o(0.45, 0.5, 0.45, 0.5).m(0.58, 0.68).l(0.96, 1.06).done(),
  R: () =>
    pen()
      .m(0, 0)
      .l(0, 1)
      .m(0, 0)
      .l(0.42, 0)
      .c(0.8, 0, 0.8, 0.52, 0.42, 0.52)
      .l(0, 0.52)
      .m(0.38, 0.52)
      .l(0.82, 1)
      .done(),
  S: () =>
    pen()
      .m(0.78, 0.16)
      .c(0.68, -0.05, 0.1, -0.05, 0.09, 0.28)
      .c(0.08, 0.55, 0.76, 0.5, 0.77, 0.76)
      .c(0.78, 1.06, 0.18, 1.06, 0.06, 0.84)
      .done(),
  T: () => pen().m(0, 0).l(0.8, 0).m(0.4, 0).l(0.4, 1).done(),
  U: () => pen().m(0, 0).l(0, 0.64).c(0, 1.06, 0.78, 1.06, 0.78, 0.64).l(0.78, 0).done(),
  V: () => pen().m(0, 0).l(0.4, 1).l(0.8, 0).done(),
  W: () => pen().m(0, 0).l(0.26, 1).l(0.5, 0.3).l(0.74, 1).l(1, 0).done(),
  X: () => pen().m(0, 0).l(0.72, 1).m(0.72, 0).l(0, 1).done(),
  Y: () => pen().m(0, 0).l(0.38, 0.52).l(0.76, 0).m(0.38, 0.52).l(0.38, 1).done(),
  Z: () => pen().m(0, 0).l(0.75, 0).l(0, 1).l(0.75, 1).done(),

  '0': () => pen().o(0.34, 0.5, 0.34, 0.5).done(),
  '1': () => pen().m(0.08, 0.22).l(0.4, 0).l(0.4, 1).done(),
  '2': () =>
    pen()
      .m(0.04, 0.24)
      .c(0.08, -0.06, 0.76, -0.06, 0.72, 0.3)
      .c(0.69, 0.56, 0.16, 0.72, 0.04, 1)
      .l(0.76, 1)
      .done(),
  '3': () =>
    pen()
      .m(0.05, 0.14)
      .c(0.22, -0.07, 0.76, 0, 0.68, 0.28)
      .c(0.63, 0.46, 0.42, 0.5, 0.3, 0.5)
      .c(0.5, 0.5, 0.79, 0.55, 0.72, 0.79)
      .c(0.65, 1.06, 0.16, 1.06, 0.05, 0.86)
      .done(),
  '4': () => pen().m(0.6, 0).l(0.04, 0.7).l(0.8, 0.7).m(0.6, 0.34).l(0.6, 1).done(),
  '5': () =>
    pen()
      .m(0.7, 0)
      .l(0.14, 0)
      .l(0.1, 0.42)
      .c(0.34, 0.28, 0.76, 0.42, 0.73, 0.7)
      .c(0.7, 1.03, 0.2, 1.06, 0.05, 0.88)
      .done(),
  '6': () =>
    pen()
      .m(0.68, 0.04)
      .c(0.34, 0.04, 0.07, 0.34, 0.07, 0.68)
      .c(0.07, 1.03, 0.7, 1.03, 0.7, 0.68)
      .c(0.7, 0.44, 0.19, 0.4, 0.07, 0.62)
      .done(),
  '7': () => pen().m(0.04, 0).l(0.78, 0).l(0.32, 1).done(),
  '8': () => pen().o(0.4, 0.26, 0.31, 0.26).o(0.4, 0.72, 0.37, 0.28).done(),
  '9': () =>
    pen()
      .m(0.12, 0.96)
      .c(0.46, 0.96, 0.73, 0.66, 0.73, 0.32)
      .c(0.73, -0.03, 0.1, -0.03, 0.1, 0.32)
      .c(0.1, 0.56, 0.61, 0.6, 0.73, 0.38)
      .done(),

  '!': () => pen().m(0.1, 0).l(0.08, 0.66).dot(0.09, 0.94).done(),
  '?': () =>
    pen()
      .m(0.06, 0.24)
      .c(0.06, -0.08, 0.7, -0.08, 0.66, 0.26)
      .c(0.63, 0.5, 0.34, 0.5, 0.34, 0.68)
      .dot(0.34, 0.94)
      .done(),
  '+': () => pen().m(0.06, 0.5).l(0.74, 0.5).m(0.4, 0.16).l(0.4, 0.84).done(),
}

/**
 * Variantes d'écriture pour les lettres réellement ambiguës. $P accepte
 * plusieurs exemplaires par classe : c'est la façon la plus honnête de
 * gagner en robustesse sans rien tordre. On n'en ajoute que là où le terrain
 * l'exige (G confondu avec O, R avec P, U avec V…), jamais « au cas où ».
 *
 * Chaque variante ci-dessous correspond à une FAÇON D'ÉCRIRE réellement
 * répandue, pas à un cas de test : le banc d'essai (voir le rapport S2) sert
 * à mesurer le gain, jamais à dessiner les gabarits.
 */
const ALTERNATES: { char: string; draw: () => TplPoint[][] }[] = [
  // G d'un seul trait : la boucle se referme puis remonte vers la barre
  {
    char: 'G',
    draw: () => pen().a(0.45, 0.5, 0.45, 0.5, 60, 305).m(0.68, 0.93).l(0.92, 0.56).l(0.5, 0.56).done(),
  },
  // G « à crochet » : la boucle finit en bas à droite, remonte au coin, puis
  // la barre rentre vers l'intérieur — le tracé le plus rapide, et celui qui
  // ressemble le plus à un Q. Sans ce gabarit, un G sur deux part en Q.
  {
    char: 'G',
    draw: () =>
      pen().a(0.45, 0.5, 0.45, 0.5, -60, -315).m(0.77, 0.82).l(0.94, 0.56).l(0.5, 0.56).done(),
  },
  // R à jambe droite, partant plus haut sous la panse
  {
    char: 'R',
    draw: () =>
      pen().m(0, 0).l(0, 1).m(0, 0).l(0.4, 0).c(0.76, 0, 0.76, 0.5, 0.4, 0.5).l(0, 0.5).m(0.3, 0.5).l(0.84, 1).done(),
  },
  // R d'un seul trait : la jambe repart du FÛT (la barre médiane est donc
  // parcourue deux fois), ce qui alourdit la gauche et le fait passer pour un P
  {
    char: 'R',
    draw: () =>
      pen().m(0.02, 1).l(0.02, 0).l(0.4, 0).c(0.76, 0, 0.76, 0.5, 0.4, 0.5).l(0.02, 0.5).l(0.8, 1).done(),
  },
  // G d'un seul geste, barre comprise. Décisif : quand le crayon ne se lève
  // pas, la barre ne pèse que 13 % du nuage ; un gabarit en deux morceaux lui
  // en accorde 26 %, et le G se fait alors battre par le O. Ici, même tracé
  // continu que la main, donc même répartition des points.
  {
    char: 'G',
    draw: () =>
      pen()
        .m(0.86, 0.16)
        .c(0.6, -0.06, 0.06, 0.08, 0.06, 0.5)
        .c(0.06, 0.94, 0.62, 1.06, 0.88, 0.82)
        .l(0.92, 0.56)
        .l(0.52, 0.56)
        .done(),
  },
  // U anguleux (fond presque plat), très courant à la main
  { char: 'U', draw: () => pen().m(0, 0).l(0.04, 0.72).l(0.24, 0.98).l(0.56, 1).l(0.76, 0.72).l(0.78, 0).done() },
  // D à panse très ronde
  { char: 'D', draw: () => pen().m(0, 0).l(0, 1).m(0, 0.02).c(0.72, 0.02, 0.72, 0.98, 0, 0.98).done() },
  // D dont la panse ne rejoint pas tout à fait le bas du fût — le coin
  // inférieur gauche reste ouvert, exactement comme un « 0 ». C'est le D
  // tracé vite, et sans ce gabarit il part en chiffre une fois sur deux.
  {
    char: 'D',
    draw: () =>
      pen()
        .m(0.02, 0)
        .l(0.02, 1)
        .m(0.03, 0.02)
        .c(0.6, -0.02, 0.86, 0.26, 0.84, 0.52)
        .c(0.82, 0.8, 0.54, 1.0, 0.18, 0.99)
        .done(),
  },
  // S plus anguleux
  {
    char: 'S',
    draw: () => pen().m(0.76, 0.12).l(0.3, 0.02).l(0.1, 0.24).l(0.45, 0.48).l(0.76, 0.66).l(0.6, 0.96).l(0.08, 0.88).done(),
  },
  // O ouvert en haut (boucle non refermée)
  { char: 'O', draw: () => pen().a(0.45, 0.5, 0.45, 0.5, -80, 250).done() },

  /* --- formes à empattements : la façon d'écrire des capitales isolées --- */
  // I sérifé — celui que tout le monde trace pour ne pas le confondre avec un l
  { char: 'I', draw: () => pen().m(0.3, 0).l(0.3, 1).m(0.02, 0).l(0.58, 0).m(0.02, 1).l(0.58, 1).done() },
  // 1 avec socle
  { char: '1', draw: () => pen().m(0.06, 0.24).l(0.4, 0).l(0.4, 1).m(0.1, 1).l(0.72, 1).done() },
  // J avec barre haute
  {
    char: 'J',
    draw: () => pen().m(0.3, 0).l(0.76, 0).m(0.66, 0).l(0.66, 0.72).c(0.66, 1.02, 0.16, 1.02, 0.08, 0.72).done(),
  },

  /* --- tracés « sans lever le crayon » : une partie est parcourue 2 fois --- */
  // B continu : le trait remonte le fût, fait les deux panses et repasse par
  // la barre médiane (d'où sa densité double au milieu — sinon lu « 8 »)
  {
    char: 'B',
    draw: () =>
      pen()
        .m(0.02, 1)
        .l(0.02, 0)
        .l(0.4, 0)
        .c(0.76, 0, 0.76, 0.48, 0.4, 0.48)
        .l(0.04, 0.5)
        .l(0.44, 0.5)
        .c(0.86, 0.5, 0.86, 1, 0.44, 1)
        .l(0.02, 1)
        .done(),
  },
  // T d'un seul trait : barre, retour au milieu, puis fût
  { char: 'T', draw: () => pen().m(0, 0).l(0.8, 0.02).l(0.4, 0.02).l(0.4, 1).done() },
  // E d'un seul trait : contour puis retour pour la barre médiane
  {
    char: 'E',
    draw: () => pen().m(0.76, 0).l(0.02, 0).l(0.02, 1).l(0.78, 1).m(0.02, 0.5).l(0.62, 0.5).done(),
  },

  /* --- variantes de proportions --- */
  // M pointu, jambes écartées (le M « à la main » le plus fréquent)
  { char: 'M', draw: () => pen().m(0, 1).l(0.14, 0).l(0.46, 0.72).l(0.78, 0).l(0.94, 1).done() },
  // W arrondi en bas
  {
    char: 'W',
    draw: () => pen().m(0.02, 0).l(0.2, 0.88).c(0.28, 1.04, 0.44, 1, 0.5, 0.32).c(0.56, 1, 0.72, 1.04, 0.8, 0.88).l(0.98, 0).done(),
  },
  // Q dont la queue part de l'intérieur de la boucle et la traverse
  { char: 'Q', draw: () => pen().o(0.45, 0.5, 0.45, 0.5).m(0.62, 0.7).l(0.96, 1.04).done() },
  // 5 à panse très fermée (proche du S : c'est justement le cas à couvrir)
  {
    char: '5',
    draw: () =>
      pen().m(0.72, 0.02).l(0.14, 0.02).l(0.1, 0.46).l(0.3, 0.45).a(0.42, 0.72, 0.34, 0.28, -110, 120).done(),
  },
  // 0 étroit et pointu (l'ovale du chiffre, plus serré que la lettre O)
  { char: '0', draw: () => pen().o(0.3, 0.5, 0.3, 0.5).done() },
]

/* ------------------------------------------------------------------ */
/* Ré-échantillonnage à pas d'arc constant                              */
/* ------------------------------------------------------------------ */

function pathLength(pts: TplPoint[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return d
}

/** Redistribue `n` points le long d'un sous-tracé, à intervalle constant. */
export function resamplePath(pts: TplPoint[], n: number): TplPoint[] {
  if (pts.length === 0) return []
  if (n <= 1 || pts.length === 1) return [{ ...pts[0] }]
  const total = pathLength(pts)
  if (total <= 1e-6) return Array.from({ length: n }, () => ({ ...pts[0] }))
  const step = total / (n - 1)
  const out: TplPoint[] = [{ ...pts[0] }]
  let acc = 0
  let prev = pts[0]
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i]
    let seg = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    while (acc + seg >= step && out.length < n) {
      const t = (step - acc) / seg
      const np = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t }
      out.push(np)
      prev = np
      seg = Math.hypot(cur.x - prev.x, cur.y - prev.y)
      acc = 0
      cur = pts[i]
    }
    acc += seg
    prev = cur
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] })
  return out
}

/**
 * Répartit `n` points sur un ensemble de sous-tracés (jamais moins de 2 par
 * sous-tracé, sinon la barre du « t » ou le point du « i » disparaîtraient).
 *
 * La part de chaque sous-tracé suit sa longueur ÉLEVÉE À LA PUISSANCE 0,72 et
 * non sa longueur brute. Raison mesurée : ce qui distingue un G d'un Q, un R
 * d'un P ou un « ! » d'un « I », c'est un petit trait — 12 % de la longueur
 * totale, donc 12 % des points, donc presque aucun poids dans la distance.
 * L'exposant redonne de la voix aux détails décisifs sans pour autant faire
 * exister un point d'accent autant qu'une hampe (valeur balayée au banc).
 */
const SAMPLE_POW = 0.72

export function resampleCloud(paths: TplPoint[][], n: number): TplPoint[] {
  const usable = paths.filter((p) => p.length > 0)
  if (usable.length === 0) return []
  const lens = usable.map((p) => Math.max(pathLength(p), 1e-4))
  const weights = lens.map((l) => Math.pow(l, SAMPLE_POW))
  const total = weights.reduce((a, b) => a + b, 0)
  const counts = weights.map((w) => Math.max(2, Math.round((w / total) * n)))
  // ajuste pour retomber exactement sur n
  let sum = counts.reduce((a, b) => a + b, 0)
  while (sum > n) {
    let idx = 0
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[idx]) idx = i
    if (counts[idx] <= 2) break
    counts[idx]--
    sum--
  }
  while (sum < n) {
    let idx = 0
    for (let i = 1; i < counts.length; i++) if (lens[i] / counts[i] > lens[idx] / counts[idx]) idx = i
    counts[idx]++
    sum++
  }
  const out: TplPoint[] = []
  for (let i = 0; i < usable.length; i++) out.push(...resamplePath(usable[i], counts[i]))
  return out
}

/** Nombre de points par nuage. 48 discrimine nettement mieux les lettres
 *  proches (R/P, G/O) que les 32 du papier, pour ~10 ms par lettre. */
export const CLOUD_N = 48

let cache: Template[] | null = null

/** Gabarits prêts à l'emploi (générés une seule fois, à la première demande). */
export function templates(): Template[] {
  if (cache) return cache
  cache = Object.keys(DRAWINGS).map((char) => ({ char, paths: DRAWINGS[char]() }))
  for (const a of ALTERNATES) cache.push({ char: a.char, paths: a.draw() })
  return cache
}

/** Les caractères reconnus, dans l'ordre de la table (utile aux tests/démos). */
export function alphabet(): string[] {
  return Object.keys(DRAWINGS)
}
