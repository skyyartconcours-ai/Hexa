import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { log } from '../log.js';

const client = new Anthropic({
  ...(config.anthropic.apiKey ? { apiKey: config.anthropic.apiKey } : {}),
});

/**
 * Le juge ne voit QUE le pseudo et la vanne finale.
 *
 * C'est tout l'interet. Le modele qui ecrit la vanne s'auto-note deja, mais il
 * note son propre travail : il vient de la trouver bonne, il a tout le contexte
 * qui la rend drole a ses yeux, et il connait ses propres intentions. Un lecteur
 * qui decouvre la phrase seule est dans la meme position que la personne visee
 * quand elle la relit le lendemain — c'est exactement le test qu'on cherche.
 */
const JUDGE_PROMPT = `Tu relis une vanne qui va etre lue a voix haute sur un stream Twitch francais, pour saluer un viewer qui vient de s'abonner.

Tu ne connais ni la personne, ni le contexte, ni les intentions de celui qui a ecrit la vanne. Tu es dans la position du viewer qui la relit seul chez lui le lendemain.

Une seule question : est-ce que cette phrase peut blesser la personne visee ?

Reponds :
- "non" : c'est une taquinerie, ca fait sourire, personne ne le prend mal.
- "incertain" : ca depend de qui recoit, ou tu n'es pas sur.
- "oui" : ca peut piquer pour de vrai, ou ca touche a quelque chose de personnel.

Fais attention a : le physique, l'origine, la religion, l'orientation, la sante, la sante mentale, la famille, le deuil, l'argent, le chomage, la solitude, l'age, le niveau scolaire, les insultes meme deguisees, la sexualisation, et tout ce qui suppose un fait sur la personne.

Une vanne qui se moque d'un comportement de chat (spam d'emotes, tics de langage, silence) est generalement inoffensive. Une vanne qui se moque de ce que la personne EST ne l'est pas.

Dans le doute, reponds "incertain". Ce n'est pas a toi de decider si la vanne passe : ton doute est une information utile, pas un echec.`;

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['non', 'incertain', 'oui'],
      description: 'Est-ce que cette phrase peut blesser la personne visee.',
    },
    raison: {
      type: 'string',
      description: 'En moins de 15 mots, ce qui motive ce verdict.',
    },
  },
  required: ['verdict', 'raison'],
  additionalProperties: false,
} as const;

export interface Verdict {
  /** Vrai uniquement sur "non". "incertain" est traite comme un refus. */
  ok: boolean;
  verdict: 'non' | 'incertain' | 'oui';
  reason: string;
  /** Le juge n'a pas pu se prononcer : a arbitrer par un humain. */
  unavailable?: boolean;
}

/**
 * Deuxieme avis, independant, sur la vanne finale.
 *
 * En cas de panne on ne bloque pas la session — mais on ne laisse pas passer
 * silencieusement non plus : `unavailable` force le passage en regie meme en
 * lecture automatique. Un juge muet ne doit jamais ressembler a un juge
 * satisfait.
 */
export async function judgeRoast(userName: string, roast: string): Promise<Verdict> {
  if (!config.judge.enabled) return { ok: true, verdict: 'non', reason: 'juge desactive' };

  try {
    const response = await client.messages.create({
      model: config.judge.model,
      // Le verdict tient en deux champs : rien ne justifie plus de marge, et
      // ce plafond garde l'appel court pendant un hype train.
      max_tokens: 256,
      // Pas de cache_control ici, contrairement au prompt de generation : Haiku
      // n'accepte en cache qu'un prefixe d'au moins 4096 tokens, et celui-ci en
      // fait dix fois moins. Le marqueur ne provoquerait aucune erreur, il ne
      // cacherait simplement jamais rien — autant ne pas le laisser croire.
      system: [{ type: 'text', text: JUDGE_PROMPT }],
      output_config: { format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `<pseudo>${userName}</pseudo>\n<vanne>${roast}</vanne>\n\nCette phrase peut-elle blesser ${userName} ?`,
        },
      ],
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    if (response.stop_reason === 'refusal') {
      return { ok: false, verdict: 'oui', reason: 'le juge a refuse de se prononcer' };
    }

    const block = response.content.find(
      (item): item is Anthropic.TextBlock => item.type === 'text',
    );
    if (!block) throw new Error('reponse sans contenu');

    const parsed = JSON.parse(block.text) as { verdict?: string; raison?: string };
    const verdict = parsed.verdict === 'non' || parsed.verdict === 'oui' ? parsed.verdict : 'incertain';

    return {
      ok: verdict === 'non',
      verdict,
      reason: typeof parsed.raison === 'string' ? parsed.raison : '',
    };
  } catch (error) {
    log.warn('Juge indisponible :', error instanceof Error ? error.message : error);
    return {
      ok: true,
      verdict: 'incertain',
      reason: 'juge injoignable, validation humaine requise',
      unavailable: true,
    };
  }
}
