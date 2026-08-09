import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { SubscriberFacts } from '../db.js';
import { log } from '../log.js';
import { isDelivery } from '../tts/provider.js';
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

export async function generateRoast(
  trigger: RoastTrigger,
  profile: UserProfile,
  pastRoasts: string[],
  facts: SubscriberFacts | null = null,
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
    // Le system prompt est identique a chaque appel -> mis en cache, on ne le
    // repaie pas au prix fort a chaque sub.
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    output_config: outputConfig,
    messages: [{ role: 'user', content: buildUserPrompt(trigger, profile, pastRoasts, facts) }],
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
