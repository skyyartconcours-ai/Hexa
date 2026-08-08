import { config } from '../config.js';
import { log } from '../log.js';
import { sanitiseChatMessage } from '../roast/safety.js';
import type { ChatRecord } from '../db.js';

/**
 * Import du chat des VODs — le SEUL moyen de recuperer de l'historique
 * retroactivement.
 *
 * ⚠️ Ce fichier n'utilise PAS l'API officielle. Il n'existe aucun endpoint
 * Helix pour lire le chat passe, quel que soit le niveau de permission du
 * token (broadcaster inclus). Le rejeu de chat des VODs est servi par l'API
 * GraphQL interne du lecteur web Twitch, non documentee et sans garantie de
 * stabilite : elle peut changer ou disparaitre sans preavis.
 *
 * Consequences assumees, et pourquoi ca reste raisonnable ici :
 * - on ne lit que les VODs de TA chaine, dont le chat est deja public dans le
 *   lecteur ;
 * - c'est un import manuel et ponctuel, pas un scraper permanent ;
 * - le rythme est volontairement lent (pause entre chaque page) pour ne pas
 *   marteler l'endpoint.
 * Si l'import casse un jour, l'outil continue de fonctionner : il retombe
 * simplement sur le log en direct.
 */

const GQL_ENDPOINT = 'https://gql.twitch.tv/gql';
const OPERATION = 'VideoCommentsByOffsetOrCursor';
const PERSISTED_HASH = 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a';

/** Pause entre deux pages, pour rester poli avec l'endpoint. */
const PAGE_DELAY_MS = 250;
/** Garde-fou : une VOD de 12 h fait ~15 000 pages dans le pire des cas. */
const MAX_PAGES = 4000;

interface CommentNode {
  contentOffsetSeconds: number;
  createdAt: string;
  commenter: { id: string; login: string; displayName: string } | null;
  message: { fragments: Array<{ text: string | null }> | null } | null;
}

interface CommentsPage {
  data?: {
    video?: {
      comments?: {
        edges: Array<{ node: CommentNode }>;
        pageInfo: { hasNextPage: boolean };
      } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(videoId: string, offsetSeconds: number): Promise<CommentsPage> {
  const response = await fetch(GQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Client-Id': config.twitch.webClientId,
      'content-type': 'application/json',
    },
    body: JSON.stringify([
      {
        operationName: OPERATION,
        variables: { videoID: videoId, contentOffsetSeconds: offsetSeconds },
        extensions: { persistedQuery: { version: 1, sha256Hash: PERSISTED_HASH } },
      },
    ]),
  });

  if (!response.ok) {
    throw new Error(`GQL ${response.status} : ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as CommentsPage | CommentsPage[];
  const page = Array.isArray(payload) ? payload[0] : payload;
  if (!page) throw new Error('Reponse GQL vide.');
  if (page.errors?.length) throw new Error(`GQL : ${page.errors[0]?.message}`);
  return page;
}

function toRecord(node: CommentNode): ChatRecord | null {
  if (!node.commenter) return null;

  const text = (node.message?.fragments ?? [])
    .map((fragment) => fragment.text ?? '')
    .join('')
    .trim();

  const clean = text ? sanitiseChatMessage(text) : null;
  if (!clean) return null;

  const ts = Date.parse(node.createdAt);
  if (!Number.isFinite(ts)) return null;

  return {
    userId: node.commenter.id,
    userLogin: node.commenter.login,
    userName: node.commenter.displayName || node.commenter.login,
    text: clean,
    ts,
  };
}

/**
 * Parcourt tout le chat d'une VOD. `onBatch` est appele page par page pour
 * qu'on puisse ecrire au fil de l'eau plutot que de tout garder en memoire.
 */
export async function fetchVodChat(
  videoId: string,
  onBatch: (records: ChatRecord[]) => void,
): Promise<number> {
  let offset = 0;
  let pages = 0;
  let total = 0;

  while (pages < MAX_PAGES) {
    const page = await fetchPage(videoId, offset);
    const comments = page.data?.video?.comments;
    if (!comments || comments.edges.length === 0) break;

    const records: ChatRecord[] = [];
    for (const edge of comments.edges) {
      const record = toRecord(edge.node);
      if (record) records.push(record);
    }
    onBatch(records);
    total += records.length;
    pages += 1;

    if (!comments.pageInfo.hasNextPage) break;

    const last = comments.edges[comments.edges.length - 1];
    if (!last) break;
    const nextOffset = last.node.contentOffsetSeconds + 1;
    // L'offset doit progresser, sinon on boucle indefiniment sur la meme page.
    if (nextOffset <= offset) break;
    offset = nextOffset;

    await sleep(PAGE_DELAY_MS);
  }

  if (pages >= MAX_PAGES) {
    log.warn(`VOD ${videoId} : limite de ${MAX_PAGES} pages atteinte, import tronque.`);
  }
  return total;
}
