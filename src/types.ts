import type { Delivery } from './tts/provider.js';

export type RoastEventType = 'sub' | 'resub' | 'gift' | 'gift_recipient';

/** Ce qui declenche une vanne : un evenement d'abonnement normalise. */
export interface RoastTrigger {
  type: RoastEventType;
  userId: string;
  userLogin: string;
  userName: string;
  /** Tier Twitch : 1000 / 2000 / 3000 / "Prime". */
  tier?: string;
  /** Resub : nombre de mois cumules. */
  cumulativeMonths?: number;
  /** Resub : streak en cours. */
  streakMonths?: number;
  /** Resub : le message ecrit par le viewer. */
  message?: string;
  /** Gift : nombre de subs offerts dans cette vague. */
  giftCount?: number;
  /** Gift : total de subs offerts par cette personne sur la chaine. */
  giftTotal?: number;
  /** Gift : le donateur a-t-il choisi l'anonymat. */
  anonymous?: boolean;
  /** Gift recipient : pseudo de celui qui a offert. */
  gifterName?: string;
}

/** Profil reconstruit depuis notre propre log de chat. */
export interface UserProfile {
  userId: string;
  userLogin: string;
  userName: string;
  messageCount: number;
  /**
   * Mois d'abonnement, lus sur le badge du dernier message. Seule anciennete
   * fiable dont on dispose : Twitch l'envoie, on ne la deduit pas.
   */
  subMonths: number | null;
  daysKnown: number;
  avgMessageLength: number;
  /** Mots qui reviennent le plus souvent chez cette personne. */
  signatureWords: string[];
  /** Heure de connexion la plus frequente (0-23), null si inconnu. */
  favouriteHour: number | null;
  /** Echantillon de messages recents, tronques. */
  recentMessages: string[];
}

/** Sortie structuree du modele. */
export interface RoastDraft {
  roast: string;
  angle: string;
  severity: number;
  forbidden_topics_touched: string[];
  /** Didascalie de jeu, transmise aux TTS qui la comprennent. */
  delivery?: Delivery;
}

export type RoastStatus = 'pending' | 'approved' | 'playing' | 'played' | 'rejected' | 'failed';

export interface QueuedRoast {
  id: string;
  status: RoastStatus;
  trigger: RoastTrigger;
  text: string;
  angle: string;
  severity: number;
  delivery: Delivery | null;
  audioPath: string | null;
  /**
   * Meme fichier que `audioPath`, vu depuis le navigateur. Sert a la
   * pre-ecoute en regie : le chemin disque ne veut rien dire pour un onglet.
   */
  audioUrl: string | null;
  createdAt: number;
  playedAt: number | null;
  /** Vanne jetee : son texte n'est plus affiche. */
  error?: string;
  /** Vanne valide mais a relire (juge injoignable). Le texte reste visible. */
  warning?: string;
}

export interface SessionState {
  active: boolean;
  startedAt: number | null;
  endsAt: number | null;
  autoPlay: boolean;
  roastsPlayed: number;
}
