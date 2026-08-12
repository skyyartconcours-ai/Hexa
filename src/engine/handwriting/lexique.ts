/**
 * Hexa — CORRECTION LEXICALE du mot écrit à la main.
 *
 * Le module d'écriture (§ handwriting/index.ts) livre des LETTRES, chacune
 * avec sa confiance. Ce fichier fait la dernière étape : deviner le mot et
 * le réécrire dans sa forme correcte. « SYNDPA » → « Syndra », « KAISA » →
 * « Kai'Sa », « WARO » → « Ward ».
 *
 * ── RÈGLE D'OR ────────────────────────────────────────────────────────────
 * NE JAMAIS transformer un mot en un AUTRE mot sans une marge nette. Une
 * correction fantaisiste devant deux mille spectateurs est humiliante, alors
 * qu'une absence de correction ne coûte rien : le mot reste tel qu'il a été
 * lu. Tout le réglage de ce fichier penche donc du même côté — l'abstention.
 *
 * ── COMMENT ON MESURE LA DISTANCE ─────────────────────────────────────────
 * Une distance de Levenshtein ordinaire compte les lettres ; ici on compte
 * la VRAISEMBLANCE. Deux pondérations, toutes deux indispensables :
 *
 *  1. LA CONFIANCE DE CHAQUE LETTRE. Le reconnaisseur rend un score. Une
 *     lettre lue à 0,95 est presque certaine : la contredire doit coûter
 *     cher. Une lettre lue à 0,64, tout juste au-dessus du seuil, est un
 *     aveu d'hésitation : la corriger doit être quasi gratuit. Une lettre
 *     restée en gribouillis (score 0) est un joker.
 *  2. LA SIMILARITÉ VISUELLE. Confondre O et 0, ou S et 5, est une erreur
 *     que la machine commet vraiment ; confondre X et E, jamais. Le barème
 *     ci-dessous n'est pas inventé : il vient des confusions MESURÉES sur le
 *     banc d'essai du reconnaisseur (§ CONFUSIONS_MESUREES).
 *
 * Le tout est normalisé par la longueur du mot, comparé à un seuil qui se
 * resserre sur les mots courts (sur trois lettres, une erreur change tout),
 * et surtout soumis à une MARGE : si deux entrées du lexique se disputent le
 * mot, on n'en choisit aucune.
 */
import {
  ALIAS,
  CATEGORIES,
  CATEGORIES_DEFAUT,
  type CategorieId,
} from './mots'

/** Une lettre telle que le reconnaisseur l'a rendue. */
export interface LettreLue {
  /** caractère retenu ; chaîne vide si la lettre est restée en gribouillis */
  char: string
  /** confiance 0..1 */
  score: number
}

export interface OptionsLexique {
  /** interrupteur maître (réglage « corriger les mots avec le lexique ») */
  actif: boolean
  /** catégories retenues */
  categories: readonly CategorieId[]
  /** mots ajoutés par l'utilisateur (une entrée par ligne dans les réglages) */
  perso: readonly string[]
}

export const OPTIONS_DEFAUT: OptionsLexique = {
  actif: true,
  categories: CATEGORIES_DEFAUT,
  perso: [],
}

export type SourceCorrection =
  /** une entrée du lexique a gagné nettement : orthographe ET casse rétablies */
  | 'lexique'
  /** aucune entrée ne convient : simple mise en forme de la casse */
  | 'casse'
  /** rien à faire, le mot est déjà tel qu'il doit être */
  | 'inchange'

export interface Correction {
  /** texte final à afficher */
  texte: string
  /** ce qui a été lu, avant correction (les gribouillis comptent pour « · ») */
  brut: string
  source: SourceCorrection
  /** entrée du lexique retenue, ou null */
  entree: string | null
  /** distance normalisée de l'entrée retenue (0 = lecture exacte) */
  distance: number
  /** écart avec la meilleure entrée CONCURRENTE — c'est la marge de sécurité */
  marge: number
}

/* ------------------------------------------------------------------ */
/* 1. Similarité visuelle entre deux caractères                        */
/* ------------------------------------------------------------------ */

/**
 * Confusions RÉELLEMENT observées sur le banc d'essai du reconnaisseur
 * (864 tracés, 36 classes, 13 paires fautives). Ce sont les seules erreurs
 * que la machine commet aujourd'hui ; les rendre peu coûteuses est ce qui
 * permet de rattraper « SYNDRA » lu « SYNDR0 » sans ouvrir la porte à des
 * corrections farfelues.
 */
const CONFUSIONS_MESUREES: readonly [string, string, number][] = [
  ['0', 'O', 0.95],
  ['8', 'B', 0.9],
  ['5', 'S', 0.9],
  ['M', 'N', 0.85],
  ['C', 'G', 0.8],
  ['C', 'O', 0.8],
  ['D', '0', 0.8],
  ['O', 'G', 0.8],
  ['S', 'G', 0.7],
  ['7', 'Z', 0.7],
]

/**
 * Voisinages de FORME que le banc n'a pas produits mais qu'une main humaine
 * produit : un I trop long devient un L, un U anguleux devient un V, un E
 * dont la barre du bas déborde devient un L… Volontairement plus faibles que
 * les confusions mesurées — ce sont des hypothèses, pas des observations.
 */
const VOISINS_DE_FORME: readonly [string, string, number][] = [
  ['I', '1', 0.85],
  ['I', 'L', 0.6],
  ['I', 'T', 0.5],
  ['1', 'L', 0.5],
  ['O', 'Q', 0.75],
  ['O', 'D', 0.6],
  ['O', 'U', 0.5],
  ['U', 'V', 0.65],
  ['V', 'Y', 0.6],
  ['U', 'Y', 0.5],
  ['E', 'F', 0.65],
  ['E', 'L', 0.45],
  ['F', 'T', 0.45],
  ['P', 'R', 0.65],
  ['P', 'D', 0.5],
  ['B', 'R', 0.5],
  ['B', 'P', 0.5],
  ['G', '6', 0.7],
  ['S', '8', 0.45],
  ['Z', '2', 0.7],
  ['N', 'H', 0.5],
  ['M', 'W', 0.55],
  ['K', 'X', 0.5],
  ['A', 'R', 0.4],
  ['J', 'I', 0.5],
  ['9', 'G', 0.5],
  ['4', 'A', 0.45],
  ['3', 'B', 0.5],
]

const SIMILARITE = new Map<string, number>()
const cleSim = (a: string, b: string): string => (a < b ? a + b : b + a)
for (const [a, b, v] of CONFUSIONS_MESUREES) SIMILARITE.set(cleSim(a, b), v)
for (const [a, b, v] of VOISINS_DE_FORME) {
  const k = cleSim(a, b)
  // une observation prime toujours sur une hypothèse
  if (!SIMILARITE.has(k)) SIMILARITE.set(k, v)
}

/** Similarité visuelle 0 (rien à voir) → 1 (indiscernables). */
export function similariteVisuelle(a: string, b: string): number {
  if (a === b) return 1
  return SIMILARITE.get(cleSim(a, b)) ?? 0
}

/* ------------------------------------------------------------------ */
/* 2. Normalisation : la clé de recherche                              */
/* ------------------------------------------------------------------ */

const ACCENTS: Readonly<Record<string, string>> = {
  À: 'A',
  Â: 'A',
  Ä: 'A',
  Á: 'A',
  Ç: 'C',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ë: 'E',
  Î: 'I',
  Ï: 'I',
  Í: 'I',
  Ô: 'O',
  Ö: 'O',
  Ó: 'O',
  Ù: 'U',
  Û: 'U',
  Ü: 'U',
  Ú: 'U',
  Ÿ: 'Y',
  Ñ: 'N',
}

/**
 * Clé de recherche d'un mot : capitales, sans accent, sans rien qui ne
 * s'écrive pas à la souris. C'est LA raison pour laquelle « KAISA » retrouve
 * « Kai'Sa » et « LEESIN » retrouve « Lee Sin » : l'apostrophe et l'espace
 * ne sont pas des fautes de l'utilisateur, ce sont des signes qu'il ne peut
 * physiquement pas tracer.
 */
export function normaliser(mot: string): string {
  let out = ''
  for (const c of mot.toUpperCase()) {
    const d = ACCENTS[c] ?? c
    if ((d >= 'A' && d <= 'Z') || (d >= '0' && d <= '9')) out += d
  }
  return out
}

/**
 * Comme `normaliser`, mais garde l'indice d'origine de chaque caractère
 * retenu. Sert à la transition visuelle : savoir que le 4ᵉ caractère de la
 * clé « KAISA » est le 5ᵉ de « Kai'Sa » permet de faire glisser chaque
 * lettre déjà posée vers sa place définitive au lieu de tout refaire.
 */
export function normaliserAvecOrigine(mot: string): { cle: string; origine: number[] } {
  let cle = ''
  const origine: number[] = []
  const maj = mot.toUpperCase()
  for (let i = 0; i < maj.length; i++) {
    const d = ACCENTS[maj[i]] ?? maj[i]
    if ((d >= 'A' && d <= 'Z') || (d >= '0' && d <= '9')) {
      cle += d
      origine.push(i)
    }
  }
  return { cle, origine }
}

/* ------------------------------------------------------------------ */
/* 3. Index du lexique (reconstruit seulement quand les réglages bougent) */
/* ------------------------------------------------------------------ */

interface Entree {
  /** clé de recherche */
  cle: string
  /** forme canonique affichée */
  mot: string
}

interface Index {
  /** entrées groupées par longueur de clé, pour ne comparer que le plausible */
  parLongueur: Map<number, Entree[]>
  /** recherche exacte immédiate */
  exact: Map<string, string>
  taille: number
}

let indexCache: Index | null = null
let cleCache = ''

function cleOptions(o: OptionsLexique): string {
  return [...o.categories].sort().join(',') + '|' + o.perso.join('')
}

function construireIndex(o: OptionsLexique): Index {
  const exact = new Map<string, string>()
  const parLongueur = new Map<number, Entree[]>()
  const ajouter = (mot: string): void => {
    const cle = normaliser(mot)
    if (cle.length === 0) return
    // le premier inscrit gagne : les champions passent avant le vocabulaire
    if (exact.has(cle)) return
    exact.set(cle, mot)
    const l = parLongueur.get(cle.length)
    if (l) l.push({ cle, mot })
    else parLongueur.set(cle.length, [{ cle, mot }])
  }
  for (const cat of CATEGORIES) {
    if (!o.categories.includes(cat.id)) continue
    for (const mot of cat.entrees) ajouter(mot)
  }
  // les mots de l'utilisateur sont prioritaires : ce sont les siens
  if (o.categories.includes('perso')) {
    for (const mot of o.perso) {
      const cle = normaliser(mot)
      if (cle.length === 0) continue
      exact.delete(cle)
      const l = parLongueur.get(cle.length)
      if (l) {
        const i = l.findIndex((e) => e.cle === cle)
        if (i >= 0) l.splice(i, 1)
      }
      ajouter(mot)
    }
  }
  // les alias ne sont ajoutés que si leur cible est effectivement chargée
  for (const [brut, cible] of Object.entries(ALIAS)) {
    const cle = normaliser(brut)
    if (exact.has(cle)) continue
    if (!exact.has(normaliser(cible))) continue
    exact.set(cle, cible)
    const l = parLongueur.get(cle.length)
    if (l) l.push({ cle, mot: cible })
    else parLongueur.set(cle.length, [{ cle, mot: cible }])
  }
  return { parLongueur, exact, taille: exact.size }
}

function index(o: OptionsLexique): Index {
  const k = cleOptions(o)
  if (!indexCache || k !== cleCache) {
    indexCache = construireIndex(o)
    cleCache = k
  }
  return indexCache
}

/** Nombre de mots effectivement chargés (affiché dans les réglages). */
export function tailleLexique(o: OptionsLexique): number {
  return index(o).taille
}

/* ------------------------------------------------------------------ */
/* 4. Distance pondérée                                                */
/* ------------------------------------------------------------------ */

/** seuil de confiance en dessous duquel le reconnaisseur ne rend rien */
const SEUIL_LETTRE = 0.62

/**
 * Ce que coûte le fait de CONTREDIRE une lettre lue. Une lettre à peine
 * au-dessus du seuil ne pèse presque rien, une lettre quasi certaine pèse
 * son poids plein. C'est la pondération n°1 de l'énoncé.
 */
function poids(l: LettreLue): number {
  if (!l.char) return 0.16 // gribouillis non transformé : joker
  const t = Math.min(1, Math.max(0, (l.score - SEUIL_LETTRE) / 0.33))
  return 0.34 + 0.66 * t
}

/**
 * Lettre écrite par l'utilisateur mais absente de l'entrée — et l'inverse.
 * Volontairement PLUS CHERS qu'une substitution : le reconnaisseur se trompe
 * sur la FORME d'une lettre, presque jamais sur leur NOMBRE. Un écart de
 * longueur est donc le signe le plus fiable qu'il s'agit d'un autre mot.
 */
const FACTEUR_SUPPRESSION = 1.3
const COUT_INSERTION = 1.1
/** deux lettres voisines interverties (« SYDNRA ») */
const FACTEUR_TRANSPOSITION = 0.85
/**
 * En dessous de cette similarité, la confusion n'a JAMAIS été observée et
 * n'est même pas plausible géométriquement.
 */
const SIM_PLAUSIBLE = 0.3
/**
 * … et contredire une lettre nette sur une confusion pareille coûte alors le
 * double. C'est le garde-fou qui a le plus servi : sans lui, le banc
 * détournait 6 % des mots ABSENTS du lexique (« ECRAN » → « Doran »,
 * « PIZZA » → « Fizz », « LUCAS » → « Lucian »). Le raisonnement est simple :
 * le reconnaisseur est juste 98 fois sur 100 : une lettre lue avec une
 * confiance franche, et qui ne ressemble pas à ce qu'on voudrait mettre à sa
 * place, a presque sûrement raison contre le dictionnaire.
 */
const PENALITE_INVRAISEMBLABLE = 2.4

/**
 * Distance pondérée entre la suite de lettres lues et la clé d'une entrée.
 * Levenshtein–Damerau, où chaque opération est facturée selon la confiance
 * de la lettre touchée et la similarité visuelle des deux caractères.
 */
export function distancePonderee(lettres: readonly LettreLue[], cible: string): number {
  const n = lettres.length
  const m = cible.length
  const w = lettres.map(poids)
  // D[j] pour la ligne courante
  let prev2: number[] = []
  let prev: number[] = new Array(m + 1)
  let cur: number[] = new Array(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j * COUT_INSERTION
  for (let i = 1; i <= n; i++) {
    cur[0] = prev[0] + w[i - 1] * FACTEUR_SUPPRESSION
    for (let j = 1; j <= m; j++) {
      const a = lettres[i - 1].char
      const b = cible[j - 1]
      let sub = 0
      if (a !== b) {
        const sim = similariteVisuelle(a, b)
        sub = w[i - 1] * (1 - 0.75 * sim)
        // le joker (gribouillis non transformé) échappe à la pénalité : il
        // n'affirme rien, donc il ne contredit rien
        if (a && sim < SIM_PLAUSIBLE) sub *= PENALITE_INVRAISEMBLABLE
        if (!a) sub += 0.04
      }
      let best = prev[j - 1] + sub
      const del = prev[j] + w[i - 1] * FACTEUR_SUPPRESSION
      if (del < best) best = del
      const ins = cur[j - 1] + COUT_INSERTION
      if (ins < best) best = ins
      if (
        i > 1 &&
        j > 1 &&
        lettres[i - 1].char === cible[j - 2] &&
        lettres[i - 2].char === cible[j - 1]
      ) {
        const tr = prev2[j - 2] + Math.min(w[i - 1], w[i - 2]) * FACTEUR_TRANSPOSITION
        if (tr < best) best = tr
      }
      cur[j] = best
    }
    prev2 = prev
    prev = cur
    cur = new Array(m + 1)
  }
  return prev[m]
}

/* ------------------------------------------------------------------ */
/* 5. Décision                                                         */
/* ------------------------------------------------------------------ */

/**
 * Seuil de distance normalisée, par longueur de mot. Sur trois lettres, une
 * erreur c'est un tiers du mot : on n'accepte que l'EXACT.
 *
 * Les valeurs viennent de la mesure et non de l'intuition : sur le banc, un
 * mot vraiment issu du lexique arrive à 0,03–0,10 (une confusion mesurée
 * coûte 0,36 sur un mot de huit lettres, soit 0,045 ; une lettre illisible
 * 0,20, soit 0,025). Un mot ÉTRANGER, lui, part de 0,45. Le seuil se place
 * donc largement au-dessus des vrais et très en dessous des faux — et surtout
 * en dessous d'UNE substitution invraisemblable (0,27 sur huit lettres), ce
 * qui interdit « NOTATION » → « Rotation ».
 */
function seuil(n: number): number {
  if (n <= 3) return 0
  if (n <= 5) return 0.22
  if (n <= 7) return 0.24
  return 0.22
}

/** Marge minimale entre la meilleure entrée et sa première concurrente. */
const MARGE_MIN = 0.14
/** écart de longueur toléré (au-delà, ce n'est plus le même mot) */
function ecartLongueur(n: number): number {
  if (n <= 4) return 1
  if (n <= 6) return 2
  return 3
}

/**
 * Mise en forme de secours, quand le lexique n'a rien à proposer :
 * capitale initiale, reste en minuscules — sauf si l'utilisateur a
 * manifestement voulu CRIER. Un mot de trois lettres ou moins écrit en
 * capitales est presque toujours un sigle (GG, MID, ADC, TOP, ULT) : le
 * remettre en « Gg » serait absurde.
 */
export function formaterCasse(brut: string): string {
  if (brut.length === 0) return brut
  if (brut.length <= 3) return brut.toUpperCase()
  let chiffres = 0
  for (const c of brut) if (c >= '0' && c <= '9') chiffres++
  // « 4 » ou « 15 » : rien à capitaliser
  if (chiffres === brut.length) return brut
  return brut[0].toUpperCase() + brut.slice(1).toLowerCase()
}

/**
 * Devine le mot et rend sa forme correcte.
 *
 * Renvoie TOUJOURS quelque chose d'affichable : au pire le mot lu, remis en
 * forme. La source dit ce qui s'est passé, et c'est elle qui décide si on
 * montre ou non le petit chip « corrigé » à l'écran.
 */
export function corrigerMot(lettres: readonly LettreLue[], o: OptionsLexique): Correction {
  const brut = lettres.map((l) => l.char).join('')
  const rien: Correction = {
    texte: brut,
    brut,
    source: 'inchange',
    entree: null,
    distance: 1,
    marge: 0,
  }
  if (lettres.length === 0) return rien

  const casse = formaterCasse(brut)
  const parDefaut: Correction = {
    ...rien,
    texte: casse,
    source: casse === brut ? 'inchange' : 'casse',
  }
  // une seule lettre n'est jamais un mot : on n'y touche pas
  if (!o.actif || lettres.length < 2) return parDefaut

  const idx = index(o)
  const cle = normaliser(brut)
  // toutes les lettres lues, sans trou : lecture exacte, aucun risque
  if (cle.length === lettres.length) {
    const exact = idx.exact.get(cle)
    if (exact) {
      return {
        texte: exact,
        brut,
        source: exact === brut ? 'inchange' : 'lexique',
        entree: exact,
        distance: 0,
        marge: 1,
      }
    }
  }

  const n = lettres.length
  const ecart = ecartLongueur(n)
  const s = seuil(n)
  if (s <= 0) return parDefaut

  let meilleur: Entree | null = null
  let dMeilleur = Infinity
  let dSecond = Infinity
  for (let m = Math.max(1, n - ecart); m <= n + ecart; m++) {
    const liste = idx.parLongueur.get(m)
    if (!liste) continue
    for (const e of liste) {
      const cout = distancePonderee(lettres, e.cle)
      const d = cout / Math.max(n, m)
      if (d < dMeilleur) {
        // l'ancien meilleur devient le concurrent — sauf s'il donne le MÊME
        // mot (deux alias de « Jarvan IV » ne se font pas concurrence)
        if (meilleur && meilleur.mot !== e.mot) dSecond = dMeilleur
        meilleur = e
        dMeilleur = d
      } else if (d < dSecond && (!meilleur || meilleur.mot !== e.mot)) {
        dSecond = d
      }
    }
  }

  if (!meilleur) return parDefaut
  const marge = dSecond - dMeilleur
  if (dMeilleur > s || marge < MARGE_MIN) {
    return { ...parDefaut, entree: null, distance: dMeilleur, marge }
  }
  return {
    texte: meilleur.mot,
    brut,
    source: meilleur.mot === brut ? 'inchange' : 'lexique',
    entree: meilleur.mot,
    distance: dMeilleur,
    marge,
  }
}

/* ------------------------------------------------------------------ */
/* 6. Alignement, pour la transition visuelle                          */
/* ------------------------------------------------------------------ */

/**
 * Fait correspondre chaque lettre LUE à sa place dans le mot corrigé.
 * Renvoie un tableau de la longueur du mot lu : l'indice du caractère
 * correspondant dans `apres`, ou null si la lettre disparaît.
 *
 * C'est ce qui permet à la correction d'être une TRANSITION et non un
 * remplacement : les lettres justes glissent vers leur position finale
 * pendant que les fausses se dissolvent.
 */
export function aligner(avant: string, apres: string): (number | null)[] {
  const { cle, origine } = normaliserAvecOrigine(apres)
  const n = avant.length
  const m = cle.length
  const D: number[][] = []
  for (let i = 0; i <= n; i++) {
    D.push(new Array(m + 1).fill(0))
    D[i][0] = i
  }
  for (let j = 0; j <= m; j++) D[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const a = avant[i - 1].toUpperCase()
      const b = cle[j - 1]
      // une lettre visuellement proche « glisse » plutôt qu'elle ne disparaît
      const sub = a === b ? 0 : 1 - 0.4 * similariteVisuelle(a, b)
      D[i][j] = Math.min(D[i - 1][j - 1] + sub, D[i - 1][j] + 1, D[i][j - 1] + 1)
    }
  }
  const out: (number | null)[] = new Array(n).fill(null)
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const a = avant[i - 1].toUpperCase()
    const b = cle[j - 1]
    const sub = a === b ? 0 : 1 - 0.4 * similariteVisuelle(a, b)
    if (Math.abs(D[i][j] - (D[i - 1][j - 1] + sub)) < 1e-9) {
      out[i - 1] = origine[j - 1]
      i--
      j--
    } else if (Math.abs(D[i][j] - (D[i - 1][j] + 1)) < 1e-9) {
      i--
    } else {
      j--
    }
  }
  return out
}
