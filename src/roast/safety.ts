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

/** Motifs plus fins que de simples mots. */
const PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'lien', regex: /https?:\/\/|www\.|\.(com|fr|net|gg|tv)\b/i },
  { label: 'mention_massive', regex: /(@\w+[\s,]*){3,}/ },
  { label: 'commande_chat', regex: /^\s*[!\/]\w+/ },
  // Une didascalie laissee dans le texte serait lue a voix haute par les TTS
  // qui ne les interpretent pas.
  { label: 'didascalie', regex: /[[\]]|\*[^*]+\*/ },
  { label: 'injection_prompt', regex: /\b(ignore|oublie)\s+(les|tes|toutes)\s+(instructions|consignes)/i },
  { label: 'apparence', regex: /\b(t(u|')?es|il est|elle est)\s+(gros|grosse|moche|laid|laide)\b/i },
  { label: 'argent_dispo', regex: /\b(radin|pingre|fauché|fauche|smicard)\b/i },
];

let extraBlocklist: string[] = [];

/** Permet au streamer d'ajouter ses propres mots interdits sans toucher au code. */
export function loadCustomBlocklist(): void {
  const file = path.join(DATA_DIR, 'blocklist.txt');
  if (!fs.existsSync(file)) return;
  extraBlocklist = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (extraBlocklist.length) {
    log.info(`Blocklist perso chargee : ${extraBlocklist.length} entree(s).`);
  }
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // 3v1t3 l3s c0nt0urn3m3nts basiques par leetspeak
    .replace(/[0]/g, 'o')
    .replace(/[1|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't');
}

export interface SafetyVerdict {
  ok: boolean;
  reason?: string;
}

const MAX_WORDS = 40;
const MAX_CHARS = 260;

export function checkRoast(draft: RoastDraft): SafetyVerdict {
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

  const haystack = normalise(text);
  const words = [...BASE_BLOCKLIST, ...extraBlocklist];
  for (const word of words) {
    const needle = normalise(word);
    if (!needle) continue;
    // Les expressions a espaces sont cherchees telles quelles, les mots isoles
    // avec des bornes pour eviter "sdf" dans "sdfgh".
    const found = needle.includes(' ')
      ? haystack.includes(needle)
      : new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}([^a-z0-9]|$)`).test(haystack);
    if (found) return { ok: false, reason: `mot interdit : "${word}"` };
  }

  for (const { label, regex } of PATTERNS) {
    if (regex.test(text)) return { ok: false, reason: `motif interdit : ${label}` };
  }

  return { ok: true };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Nettoyage des messages de chat AVANT de les envoyer au modele.
 * On ne veut ni liens, ni commandes, ni tentative d'injection de prompt dans
 * l'historique d'un viewer.
 */
export function sanitiseChatMessage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('!') || trimmed.startsWith('/')) return null;
  if (/https?:\/\/|www\./i.test(trimmed)) return null;
  if (trimmed.length > 300) return trimmed.slice(0, 300);
  return trimmed;
}
