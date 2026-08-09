import { DELIVERIES } from '../tts/provider.js';
import type { SubscriberFacts } from '../db.js';
import type { RoastTrigger, UserProfile } from '../types.js';

/**
 * Ce bloc est stable d'un appel a l'autre : c'est lui qu'on met en cache
 * cote Anthropic (cache_control). Ne rien y interpoler de dynamique.
 */
export const SYSTEM_PROMPT = `Tu es "Hexa", l'IA vanne d'un stream Twitch francais. Ton unique job : ecrire UNE punchline courte, drole et BIENVEILLANTE pour saluer un viewer qui vient de s'abonner ou d'offrir des subs.

# L'esprit
C'est un roast entre potes, pas une attaque. Le viewer doit rire et se sentir vu, jamais vise. Test simple : si la vanne pouvait blesser la personne qui la relit seule chez elle le lendemain, elle est ratee. Tu tapes sur le pseudo et les habitudes, jamais sur la personne.

# Ou trouver la matiere, par ordre de preference
1. Le pseudo : jeu de mots, sonorite, sens litteral, decalage entre le pseudo et le comportement.
2. Le comportement en chat : tics de langage, mots qui reviennent, spam d'emotes, longueur des messages, heure de connexion, silence prolonge.
3. L'historique d'abonnement : anciennete, streak, retour apres une absence, nombre de subs offerts.
Si tu n'as aucune matiere, fais une vanne sur le pseudo seul. N'invente JAMAIS un fait sur la personne : pas de metier, pas de ville, pas d'age, pas d'anecdote sortie de nulle part.

# Interdit absolu, aucune exception
- physique, poids, taille, apparence, voix
- origine, nationalite, couleur de peau, religion
- orientation sexuelle, identite de genre
- sante, handicap, sante mentale, addictions
- famille, deuil, situation amoureuse, celibat
- argent, chomage, metier devalorise, etudes ratees
- insultes, grossieretes, sexualisation, menaces meme "pour rire"
- allusion a un drame reel ou a un fait divers
- se moquer du montant offert, du tier, ou du fait de donner peu
- toute reference a un autre streamer ou a un drama

# Style
- 1 a 2 phrases, 25 mots maximum. Ca doit tenir en 6 secondes a l'oral.
- Francais parle, rythme, culture stream. Pas d'emoji, pas de hashtag, pas de didascalie, pas de guillemets autour de la vanne.
- Ecris le pseudo tel quel, sans majuscules ajoutees. S'il est imprononcable, tourne la phrase pour le contourner.
- La chute doit rechauffer : ca pique au milieu, ca fait sourire a la fin.
- Ne commence jamais par "Ah", "Alors", "Tiens", "Eh bien".
- Pas de texte a lire a voix haute qui ne soit pas la vanne elle-meme.
- N'ecris AUCUNE didascalie dans le champ "roast" : pas de crochets, pas de
  parentheses de jeu, pas d'indication de ton. Le ton se choisit uniquement
  dans le champ "delivery" prevu pour ca.

# Auto-controle
Tu notes ta propre vanne de 1 a 5 :
1 = compliment deguise, 2 = taquinerie douce, 3 = vraie vanne de pote,
4 = ca peut piquer, 5 = ca peut blesser.
Vise 2 ou 3. Si ta vanne merite 4 ou 5, reecris-la avant de repondre.

Tu reponds uniquement via le schema JSON demande.`;

const TIER_LABEL: Record<string, string> = {
  '1000': 'tier 1',
  '2000': 'tier 2',
  '3000': 'tier 3',
  Prime: 'Prime',
};

function describeEvent(trigger: RoastTrigger): string {
  const tier = trigger.tier ? (TIER_LABEL[trigger.tier] ?? trigger.tier) : null;

  switch (trigger.type) {
    case 'sub':
      return `Nouvel abonnement${tier ? ` (${tier})` : ''}.`;

    case 'resub': {
      const parts = ['Reabonnement'];
      if (tier) parts.push(`(${tier})`);
      if (trigger.cumulativeMonths) parts.push(`- ${trigger.cumulativeMonths} mois cumules`);
      if (trigger.streakMonths) parts.push(`- ${trigger.streakMonths} mois d'affilee`);
      return `${parts.join(' ')}.`;
    }

    case 'gift': {
      const count = trigger.giftCount ?? 1;
      const parts = [`A offert ${count} sub${count > 1 ? 's' : ''}${tier ? ` ${tier}` : ''}`];
      if (trigger.giftTotal) parts.push(`- ${trigger.giftTotal} subs offerts en tout sur la chaine`);
      if (trigger.anonymous) parts.push('- donateur anonyme, tu ne connais pas son pseudo');
      return `${parts.join(' ')}.`;
    }

    case 'gift_recipient':
      return `A recu un sub offert${trigger.gifterName ? ` par ${trigger.gifterName}` : ''}${tier ? ` (${tier})` : ''}.`;
  }
}

function describeProfile(profile: UserProfile): string {
  if (profile.messageCount === 0) {
    return "On n'a aucun historique de chat pour cette personne : elle ne parle pas, ou elle vient d'arriver. C'est une matiere en soi.";
  }

  const lines = [
    `Messages enregistres : ${profile.messageCount}`,
    `Connu depuis : ${profile.daysKnown} jour(s)`,
    `Longueur moyenne d'un message : ${profile.avgMessageLength} caracteres`,
  ];

  if (profile.signatureWords.length) {
    lines.push(`Mots qui reviennent chez lui/elle : ${profile.signatureWords.join(', ')}`);
  }
  if (profile.favouriteHour !== null) {
    lines.push(`Heure ou il/elle parle le plus : ${profile.favouriteHour}h`);
  }
  if (profile.recentMessages.length) {
    lines.push('', 'Derniers messages (du plus ancien au plus recent) :');
    for (const message of profile.recentMessages) lines.push(`- ${message}`);
  }

  return lines.join('\n');
}

export function buildUserPrompt(
  trigger: RoastTrigger,
  profile: UserProfile,
  pastRoasts: string[],
  facts: SubscriberFacts | null = null,
): string {
  const blocks = [
    `<pseudo>${trigger.userName}</pseudo>`,
    `<evenement>${describeEvent(trigger)}</evenement>`,
  ];

  if (trigger.message) {
    blocks.push(
      `<message_du_viewer>Il/elle a accompagne son resub de ce message : "${trigger.message.slice(0, 300)}"</message_du_viewer>`,
    );
  }

  if (facts) {
    const lines: string[] = [];
    if (facts.tier) lines.push(`Palier : ${TIER_LABEL[facts.tier] ?? facts.tier}`);
    if (facts.isGift && facts.gifterName) {
      lines.push(`Son abonnement lui a ete OFFERT par ${facts.gifterName}`);
    } else if (facts.isGift) {
      lines.push('Son abonnement lui a ete offert par quelqu\'un');
    }
    lines.push(`Present dans la liste des abonnes depuis ${facts.knownAsSubForDays} jour(s) au moins`);
    blocks.push(`<abonnement>\n${lines.join('\n')}\n</abonnement>`);
  }

  blocks.push(`<profil_chat>\n${describeProfile(profile)}\n</profil_chat>`);

  if (pastRoasts.length) {
    blocks.push(
      `<deja_dit>Vannes deja passees sur cette personne, ne les repete pas et ne recycle pas le meme angle :\n${pastRoasts
        .map((text) => `- ${text}`)
        .join('\n')}\n</deja_dit>`,
    );
  }

  blocks.push('Ecris la punchline.');
  return blocks.join('\n\n');
}

/** Schema JSON impose au modele (structured outputs). */
export const ROAST_SCHEMA = {
  type: 'object',
  properties: {
    roast: {
      type: 'string',
      description: 'La punchline a lire a voix haute. 25 mots maximum, pas de guillemets.',
    },
    angle: {
      type: 'string',
      description: 'En 5 mots, sur quoi porte la vanne (ex: "jeu de mot sur le pseudo").',
    },
    severity: {
      type: 'integer',
      description: 'De 1 (tres gentil) a 5 (peut blesser). Vise 2 ou 3.',
    },
    forbidden_topics_touched: {
      type: 'array',
      items: { type: 'string' },
      description: 'Sujets interdits effleures par la vanne. Doit rester vide.',
    },
    delivery: {
      type: 'string',
      enum: [...DELIVERIES],
      description:
        'Comment la voix doit dire la vanne. deadpan = pince-sans-rire, ' +
        'amused = amuse, laughing = en riant, mock serious = faussement grave, ' +
        'warm = chaleureux, excited = enthousiaste. Choisis ce qui sert la chute : ' +
        'une vanne absurde gagne souvent a etre dite deadpan.',
    },
  },
  required: ['roast', 'angle', 'severity', 'forbidden_topics_touched', 'delivery'],
  additionalProperties: false,
} as const;
