import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, config } from '../config.js';
import { log } from '../log.js';
import type { RoastDraft } from '../types.js';

/**
 * Filtre deterministe applique APRES le modele. Le prompt fait le gros du
 * travail, mais un prompt n'est pas une garantie : ce fichier l'est.
 * Regle : au moindre doute, on jette la vanne. Une vanne perdue ne coute rien,
 * une vanne blessante coute un viewer.
 */

/** Insultes et termes degradants courants en francais. */
const BASE_BLOCKLIST = [
  'connard', 'connasse', 'salope', 'salaud', 'pute', 'putain', 'enculé', 'encule',
  'batard', 'bâtard', 'abruti', 'crétin', 'cretin', 'debile', 'débile', 'attardé',
  'attarde', 'mongol', 'trisomique', 'autiste', 'schizo', 'psychopathe',
  'gros porc', 'grosse vache', 'boudin', 'thon', 'moche', 'laideron', 'obèse', 'obese',
  'anorexique', 'nain', 'naine',
  'pédé', 'pede', 'tapette', 'gouine', 'travelo', 'transsexuel',
  'negre', 'nègre', 'bougnoule', 'youpin', 'bicot', 'raton', 'chinetoque', 'facho', 'nazi',
  'terroriste', 'islamiste',
  'puceau', 'pucelle', 'incel', 'no life', 'nolife', 'chomeur', 'chômeur', 'rmiste',
  'cassos', 'clochard', 'sdf', 'alcoolique', 'drogué', 'drogue', 'toxico',
  'suicide', 'suicider', 'pends-toi', 'crève', 'creve', 'ferme ta gueule', 'ta gueule',
  'viol', 'violeur', 'pedophile', 'pédophile',
  'ta mere', 'ta mère', 'ton pere', 'ton père', 'orphelin',
];

/**
 * Motifs plus fins que de simples mots. Testes sur le texte brut ET sur le
 * texte replie (fold) : "ｗｗｗ．", "＠pseudo" ou "t’es" ne leur echappent plus.
 */
const PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'lien', regex: /https?:\/\/|www\.|\.(com|fr|net|org|io|gg|tv|ly|me|be|ch|eu|co|xyz|app|link|live|gl|to)\b/i },
  // Une adresse dictee a la voix ne ressemble pas a une URL.
  { label: 'lien_en_toutes_lettres', regex: /\b(point|dot)\s+(com|fr|net|org|io|gg|tv|ly|xyz|app)\b|\barobase\b|\bw\s*w\s*w\b|\bh\s*t\s*t\s*p\s*s?\b/i },
  // La vanne ne vise que la personne qui s'abonne, et la voix lirait "arobase".
  { label: 'mention', regex: /@\s*[\p{L}\p{N}_]/u },
  { label: 'commande_chat', regex: /^\s*[!\/]\w+/ },
  // Une didascalie laissee dans le texte serait lue a voix haute par les TTS
  // qui ne les interpretent pas.
  { label: 'didascalie', regex: /[[\]()<>]|\*[^*]+\*/ },
  // "c*nnard", "p#te" : un mot masque reste un mot interdit.
  { label: 'mot_masque', regex: /\p{L}[*#]+\p{L}/u },
  { label: 'injection_prompt', regex: /\b(ignore|oublie)\s+(les|tes|toutes)\s+(instructions|consignes)/i },
  { label: 'apparence', regex: /\b(t'?es|tu es|vous etes|vous êtes|il est|elle est)\s+(gros|grosse|moche|laid|laide)s?\b/i },
  { label: 'argent_dispo', regex: /\b(radin|pingre|fauché|fauche|smicard)(e|s|es)?\b/i },
];

// ── Normalisation ─────────────────────────────────────────────────────────

/**
 * Lettres d'autres alphabets et petites capitales qui s'affichent comme des
 * lettres latines. NFKC couvre deja la pleine chasse, les lettres
 * mathematiques et cerclees ; pas celles-ci. Replie AVANT les minuscules :
 * "Н" cyrillique se lit H, "η" grec se lit n.
 */
const CONFUSABLES: Record<string, string> = Object.fromEntries(
  [
    'аa Аa вb Вb еe Еe ёe Ёe кk Кk мm Мm нh Нh оo Оo рp Рp сc Сc тt Тt уy Уy хx Хx ѕs Ѕs іi Іi їi Їi јj Јj ԁd ԛq ԝw һh Һh',
    'αa Αa βb Βb εe Εe ηn Ηh ιi Ιi κk Κk μu Μm νv Νn οo Οo ρp Ρp τt Τt υu Υy χx Χx Ζz ϲc Ϲc',
    'øo Øo đd Đd łl Łl ıi ɑa ɡg ᴀa ʙb ᴄc ᴅd ᴇe ғf ɢg ʜh ɪi ᴊj ᴋk ʟl ᴍm ɴn ᴏo ᴘp ʀr ꜱs ᴛt ᴜu ᴠv ᴡw ʏy ᴢz',
  ]
    .join(' ')
    .split(' ')
    .map((pair) => [pair.slice(0, -1), pair.slice(-1)]),
);

/** Invisibles a l'ecran (ZWSP, cesure conditionnelle, BOM, balises, remplissage Hangul...). */
const INVISIBLE = /[\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]/gu;
/** Exactement ce que toSpeech() retire avant d'envoyer le texte a la voix. */
const PICTOGRAPHS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F\u20E3]/gu;

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't' };
/** Replis supplementaires, seulement ENTRE deux lettres : "8 mois" ou un "!" final restent intacts. */
const LEET_INNER: Record<string, string> = { '8': 'b', '9': 'g', '!': 'i', '€': 'e', '+': 't', '°': 'o', '¢': 'c', '£': 'l' };

/** Tout ce qui s'affiche comme une lettre latine redevient cette lettre. */
export function fold(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFKC')) out += CONFUSABLES[ch] ?? ch;
  return out
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\p{M}\p{Diacritic}]/gu, '') // tous les signes combinants, pas seulement les accents
    .replace(INVISIBLE, '')
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/g, ' ');
}

function unleet(text: string): string {
  return text
    .replace(/(?<=\p{L})[89!€+°¢£](?=\p{L})/gu, (c) => LEET_INNER[c] ?? c)
    .replace(/[01|34@5$7]/g, (c) => LEET[c] ?? c);
}

/** 1. Le texte tel qu'il s'affiche. */
function asShown(text: string): string {
  return unleet(fold(text));
}

/**
 * 2. Le texte tel que la voix le decoupe (spokenPseudo + toSpeech) : leet
 * replie dans les mots, CamelCase, chiffres et _-.~ separent, emoji retires.
 * "SuperC0nnard" -> "super connard", "Connard2000" -> "connard".
 */
function asSpoken(text: string): string {
  return fold(
    text
      .replace(PICTOGRAPHS, '')
      .replace(/(?<=\p{L})\d+(?=\p{L})/gu, (d) => [...d].map((c) => LEET[c] ?? c).join(''))
      .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'),
  ).replace(/[\p{N}_\-.~]+/gu, ' ');
}

/** 3. Les mots epeles ou coupes : "c o n n a r d", "con.nard", "con🔥nard". */
function asGlued(text: string): string {
  return asShown(text.replace(PICTOGRAPHS, ''))
    .replace(/(?<![\p{L}\p{N}])\p{L}(?:[ .\-_*~]\p{L}){2,}(?![\p{L}\p{N}])/gu, (m) => m.replace(/[ .\-_*~]/g, ''))
    .replace(/(?<=\p{L})[.\-_*~]+(?=\p{L})/gu, '');
}

const VARIANTS = [asShown, asSpoken, asGlued];

/**
 * Chaque lettre peut etre repetee ("connnnard"), les mots d'une expression
 * colles ou espaces n'importe comment ("tagueule", "ta  gueule"), et un mot
 * isole accepte le feminin et le pluriel ("abrutie", "connards").
 */
function needlePattern(needle: string): RegExp | null {
  const parts = needle.trim().split(' ').filter(Boolean);
  if (!parts.length) return null;
  const body = parts.map((part) => [...part].map((ch) => `${escapeRegex(ch)}+`).join('')).join('\\s*');
  const inflection = parts.length === 1 ? '(?:e|s|es|x)?' : '';
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${inflection}(?![\\p{L}\\p{N}])`, 'u');
}

interface Needle {
  word: string;
  patterns: Array<RegExp | null>;
}

function compile(words: string[]): Needle[] {
  return words.map((word) => ({ word, patterns: VARIANTS.map((variant) => needlePattern(variant(word))) }));
}

const BASE_NEEDLES = compile(BASE_BLOCKLIST);
let extraNeedles: Needle[] = [];

/** Permet au streamer d'ajouter ses propres mots interdits sans toucher au code. */
export function loadCustomBlocklist(): void {
  const file = path.join(DATA_DIR, 'blocklist.txt');
  if (!fs.existsSync(file)) return;
  const extra = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  extraNeedles = compile(extra);
  if (extra.length) {
    log.info(`Blocklist perso chargee : ${extra.length} entree(s).`);
  }
}

/** Premier mot interdit trouve dans le texte, sous l'une de ses trois lectures. */
export function findBlocked(text: string): string | null {
  const haystacks = VARIANTS.map((variant) => variant(text));
  for (const { word, patterns } of [...BASE_NEEDLES, ...extraNeedles]) {
    if (patterns.some((regex, i) => regex !== null && regex.test(haystacks[i] ?? ''))) return word;
  }
  return null;
}

export interface SafetyVerdict {
  ok: boolean;
  reason?: string;
}

/** Ce que la file sait de la vanne en plus de son texte. */
export interface RoastContext {
  /** Texte reellement envoye a la voix (toSpeech) : controle comme le texte affiche. */
  spoken?: string;
  /** Personnes citees par le viewer (@mentions, pseudos du chat) : la vanne ne les vise pas. */
  otherPeople?: string[];
  /** Texte ecrit par le viewer : la vanne ne le recopie pas. */
  viewerText?: string[];
}

const MAX_WORDS = 40;
const MAX_CHARS = 260;
/** Au-dela de ce nombre de mots d'affilee repris du viewer, c'est une citation, pas une vanne. */
const MAX_COPIED_WORDS = 4;

export function checkRoast(draft: RoastDraft, context: RoastContext = {}): SafetyVerdict {
  const text = draft.roast.trim();

  if (!text) return { ok: false, reason: 'vanne vide' };

  if (text.length > MAX_CHARS) {
    return { ok: false, reason: `trop longue (${text.length} caracteres)` };
  }

  const wordCount = text.split(/\s+/).length;
  if (wordCount > MAX_WORDS) {
    return { ok: false, reason: `trop longue (${wordCount} mots)` };
  }

  if (draft.severity > config.session.maxSeverity) {
    return { ok: false, reason: `severite ${draft.severity} > ${config.session.maxSeverity}` };
  }

  if (draft.forbidden_topics_touched.length > 0) {
    return {
      ok: false,
      reason: `sujet interdit signale par le modele : ${draft.forbidden_topics_touched.join(', ')}`,
    };
  }

  const blocked = findBlocked(text);
  if (blocked) return { ok: false, reason: `mot interdit : "${blocked}"` };
  // La voix ne lit pas le meme texte : toSpeech() reecrit le pseudo et retire les emoji.
  const spokenBlocked = context.spoken ? findBlocked(context.spoken) : null;
  if (spokenBlocked) return { ok: false, reason: `mot interdit dans le texte lu : "${spokenBlocked}"` };

  const folded = fold(text);
  for (const { label, regex } of PATTERNS) {
    if (regex.test(text) || regex.test(folded)) return { ok: false, reason: `motif interdit : ${label}` };
  }

  const other = citedPerson(text, context.otherPeople ?? []);
  if (other) return { ok: false, reason: `vise quelqu'un d'autre : ${other}` };

  if (copiesViewerText(text, context.viewerText ?? [])) {
    return { ok: false, reason: 'recopie le texte du viewer' };
  }

  return { ok: true };
}

/** Le pseudo s'affiche sur la carte et se lit a voix haute : meme blocklist que la vanne. */
export function checkName(name: string, spoken?: string): SafetyVerdict {
  const blocked = findBlocked(name) ?? (spoken ? findBlocked(spoken) : null);
  return blocked ? { ok: false, reason: `pseudo refuse : "${blocked}"` } : { ok: true };
}

// "@" d'abord retire : le leet le lirait "a" ("@kevin" -> "akevin").
const words = (text: string): string[] =>
  unleet(fold(text).replace(/@/g, ' ')).split(/[^\p{L}\p{N}']+/u).filter(Boolean);

function citedPerson(text: string, people: string[]): string | null {
  const haystack = ` ${words(text).join(' ')} `;
  for (const person of people) {
    const needle = words(person).join(' ');
    if (needle.length >= 3 && haystack.includes(` ${needle} `)) return person;
  }
  return null;
}

function copiesViewerText(text: string, sources: string[]): boolean {
  const n = MAX_COPIED_WORDS + 1;
  const grams = new Set<string>();
  for (const source of sources) {
    const w = words(source);
    for (let i = 0; i + n <= w.length; i += 1) grams.add(w.slice(i, i + n).join(' '));
  }
  const r = words(text);
  for (let i = 0; i + n <= r.length; i += 1) {
    if (grams.has(r.slice(i, i + n).join(' '))) return true;
  }
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Nettoyage des messages de chat AVANT de les envoyer au modele.
 * On ne veut ni liens ni commandes dans l'historique d'un viewer. Les
 * consignes cachees dans le texte, elles, ne se filtrent pas ici : le prompt
 * les traite comme des donnees et checkRoast() controle ce qui en sort.
 */
export function sanitiseChatMessage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('!') || trimmed.startsWith('/')) return null;
  if (/https?:\/\/|www\./i.test(trimmed)) return null;
  if (trimmed.length > 300) return trimmed.slice(0, 300);
  return trimmed;
}
