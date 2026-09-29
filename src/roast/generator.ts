import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { SubscriberFacts } from '../db.js';
import { log } from '../log.js';
import { isDelivery } from '../tts/provider.js';
import { channelContext } from './channel.js';
import { ROAST_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import type { RoastDraft, RoastTrigger, UserProfile } from '../types.js';

// Le SDK attend 10 min par tentative et relance 2 fois (429/5xx/timeouts) :
// un appel pendu tiendrait un des 3 slots de generation une demi-heure.
const client = new Anthropic({
  ...(config.anthropic.apiKey ? { apiKey: config.anthropic.apiKey } : {}),
  timeout: 25_000, // par tentative
  maxRetries: 1,
});
/** Plafond global, relance et attente comprises. */
const GENERATION_DEADLINE_MS = 45_000;

/** effort : 400 sur Haiku 4.5 et Sonnet 4.5. */
function supportsEffort(model: string): boolean {
  return !/haiku|sonnet-4-5/i.test(model);
}

/** Fallback serveur (beta, Claude API) : modeles a classifieurs de securite. */
function usesServerFallback(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

export class RefusedError extends Error {}

type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

/**
 * Prompt systeme + contexte de la chaine, s'il existe.
 *
 * Le contexte de chaine est ce qui fait la difference entre une vanne francaise
 * correcte et une vanne de CETTE chaine. Il est place apres le cadre general :
 * les regles d'abord, la couleur locale ensuite.
 */
function buildSystem(): SystemBlock[] {
  const blocks: SystemBlock[] = [{ type: 'text', text: SYSTEM_PROMPT }];

  const channel = channelContext();
  if (channel) {
    blocks.push({
      type: 'text',
      text:
        "# La chaine\nCe qui suit est ecrit par le streamer lui-meme : private jokes, vocabulaire du chat, ce qui marche et ce qui ne marche pas chez lui. Sers-t'en des que c'est pertinent — une vanne qui reprend une reference de la chaine vaut dix vannes generiques. Ca ne leve aucun interdit de la section precedente.\n\n" +
        channel,
    });
  }

  // Le marqueur va sur le dernier bloc : il met en cache tout ce qui precede.
  const last = blocks[blocks.length - 1];
  if (last) last.cache_control = { type: 'ephemeral' };
  return blocks;
}

export async function generateRoast(
  trigger: RoastTrigger,
  profile: UserProfile,
  pastRoasts: string[],
  facts: SubscriberFacts | null = null,
  sessionAngles: string[] = [],
  cancel?: AbortSignal,
): Promise<RoastDraft> {
  const model = config.anthropic.model;
  const response = await client.beta.messages.create(
    {
      model,
      max_tokens: 16000,
      // Les deux blocs sont identiques d'un sub a l'autre : le marqueur sur le
      // DERNIER les met tous les deux en cache. Ne rien interpoler de dynamique ici.
      system: buildSystem(),
      output_config: {
        format: { type: 'json_schema', schema: ROAST_SCHEMA },
        ...(supportsEffort(model) ? { effort: config.anthropic.effort } : {}),
      },
      // Refus d'un classifieur (ex. cyber sur un pseudo "H4ck3r") : l'API rejoue
      // la meme requete sur le modele recommande pour la categorie, dans le meme appel.
      ...(config.anthropic.serverFallback && usesServerFallback(model)
        ? { fallbacks: 'default' as const, betas: ['server-side-fallback-2026-07-01'] }
        : {}),
      messages: [
        { role: 'user', content: buildUserPrompt(trigger, profile, pastRoasts, facts, sessionAngles) },
      ],
    },
    {
      signal: cancel
        ? AbortSignal.any([AbortSignal.timeout(GENERATION_DEADLINE_MS), cancel])
        : AbortSignal.timeout(GENERATION_DEADLINE_MS),
    },
  );

  if (response.stop_reason === 'refusal') {
    throw new RefusedError(`Refus du modele (${response.stop_details?.category ?? 'sans categorie'}).`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Reponse tronquee (max_tokens).');
  }
  if (response.model !== model) {
    log.warn(`Vanne servie par ${response.model} apres un refus de ${model}.`);
  }

  // Opus 5 reflechit par defaut : un bloc `thinking` (vide) et/ou un bloc
  // `fallback` peuvent preceder le texte.
  const textBlock = response.content.find(
    (block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text',
  );
  if (!textBlock) {
    throw new Error('Reponse sans contenu texte.');
  }

  let draft: RoastDraft;
  try {
    draft = JSON.parse(textBlock.text) as RoastDraft;
  } catch {
    throw new Error(`Reponse JSON illisible : ${textBlock.text.slice(0, 200)}`);
  }

  if (typeof draft.roast !== 'string' || typeof draft.severity !== 'number') {
    throw new Error('Reponse JSON incomplete.');
  }
  draft.forbidden_topics_touched ??= [];
  draft.angle ??= '';
  draft.roast = draft.roast.replace(/^["«»“”„\s]+|["«»“”„\s]+$/g, '');
  // La casse des valeurs d'enum n'est pas garantie ("mock Serious") : on compare
  // en minuscules. Hors liste, on jette plutot que de transmettre au TTS.
  const delivery = typeof draft.delivery === 'string' ? draft.delivery.trim().toLowerCase() : undefined;
  if (isDelivery(delivery)) draft.delivery = delivery;
  else delete draft.delivery;

  const usage = response.usage;
  log.roast(
    `Vanne generee pour ${trigger.userName} (${draft.delivery ?? 'neutre'}, severite ${draft.severity}, ` +
      `${usage.input_tokens} in / ${usage.output_tokens} out, ` +
      `${usage.cache_read_input_tokens ?? 0} lus en cache)`,
  );

  return draft;
}
