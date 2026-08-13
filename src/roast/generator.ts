import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { SubscriberFacts } from '../db.js';
import { log } from '../log.js';
import { isDelivery } from '../tts/provider.js';
import { channelContext } from './channel.js';
import { ROAST_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import type { RoastDraft, RoastTrigger, UserProfile } from '../types.js';

const client = new Anthropic({
  ...(config.anthropic.apiKey ? { apiKey: config.anthropic.apiKey } : {}),
});

/** Haiku n'accepte pas output_config.effort : l'envoyer renvoie une 400. */
function supportsEffort(model: string): boolean {
  return !/haiku/i.test(model);
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
): Promise<RoastDraft> {
  const outputConfig: Record<string, unknown> = {
    format: { type: 'json_schema', schema: ROAST_SCHEMA },
  };
  if (supportsEffort(config.anthropic.model)) {
    outputConfig['effort'] = config.anthropic.effort;
  }

  const params = {
    model: config.anthropic.model,
    // max_tokens ne coute rien tant qu'il n'est pas consomme : on laisse de la
    // marge pour que la reflexion du modele ne rogne pas sur la reponse.
    max_tokens: 16000,
    // Les deux blocs sont identiques d'un sub a l'autre : le marqueur sur le
    // DERNIER les met tous les deux en cache, et on ne les repaie pas au prix
    // fort a chaque vanne. Ne rien interpoler de dynamique ici.
    system: buildSystem(),
    output_config: outputConfig,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(trigger, profile, pastRoasts, facts, sessionAngles),
      },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const response = await client.messages.create(params);

  if (response.stop_reason === 'refusal') {
    throw new RefusedError('Le modele a refuse de generer cette vanne.');
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
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
  draft.roast = draft.roast.replace(/^["«»\s]+|["«»\s]+$/g, '');
  // Une didascalie hors liste serait lue a voix haute par le TTS : on la jette
  // plutot que de la transmettre.
  if (!isDelivery(draft.delivery)) delete draft.delivery;

  const usage = response.usage;
  log.roast(
    `Vanne generee pour ${trigger.userName} (${draft.delivery ?? 'neutre'}, severite ${draft.severity}, ` +
      `${usage.input_tokens} in / ${usage.output_tokens} out, ` +
      `${usage.cache_read_input_tokens ?? 0} lus en cache)`,
  );

  return draft;
}
