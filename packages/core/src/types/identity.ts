/**
 * Identity domain — players, teams, and the brand kits that drive palette
 * derivation. This is the layer the whole "make Peyz actually look like Peyz"
 * guarantee hangs off of: a Player is not just a name, it is a stable id that
 * binds a set of licensed reference photographs to a verifiable face embedding.
 */

export type Region = 'KR' | 'EU' | 'NA' | 'CN' | 'VN' | 'TW' | 'BR' | 'INT';

export type League = 'LCK' | 'LEC' | 'LCS' | 'LPL' | 'LFL' | 'WORLDS' | 'MSI' | 'OTHER';

export type Role = 'top' | 'jungle' | 'mid' | 'bot' | 'support' | 'coach' | 'staff';

/** Canonical role ordering used by lineup layouts (left → right on screen). */
export const ROLE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'bot', 'support'] as const;

export type PlayerId = string;
export type TeamId = string;

export interface BrandColors {
  /** Primary brand colour, hex `#RRGGBB`. Drives key light + dominant fills. */
  primary: string;
  /** Secondary brand colour. Drives rim light on the opposing side. */
  secondary: string;
  /** High-chroma accent for glows, strokes and energy FX. */
  accent: string;
  /** Deep shade used for vignette and background falloff. */
  dark: string;
  /** Near-white used for text on dark plates. */
  light: string;
}

export interface Team {
  id: TeamId;
  /** Full public name, e.g. "Hanwha Life Esports". */
  name: string;
  /** Short display name used in tight layouts, e.g. "Hanwha Life". */
  shortName: string;
  /** Uppercase competitive tag, e.g. "HLE". */
  tag: string;
  region: Region;
  league: League;
  colors: BrandColors;
  /** Relative path inside the asset library, if a logo has been ingested. */
  logoAsset?: string;
  slogan?: string;
  founded?: number;
  /** Alternate names/romanisations that should resolve to this team. */
  aliases?: string[];
}

export interface PlayerSocials {
  twitter?: string;
  instagram?: string;
  twitch?: string;
  youtube?: string;
  soop?: string;
  chzzk?: string;
}

export interface Player {
  id: PlayerId;
  /** In-game handle as displayed on the jersey, e.g. "Peyz". */
  handle: string;
  /** Alternate spellings/romanisations that should resolve to this player. */
  aliases: string[];
  /** Legal name in Latin script, family name first for KR players. */
  fullName: string;
  /** Native-script name where applicable (Hangul for KR players). */
  nativeName?: string;
  role: Role;
  teamId: TeamId;
  region: Region;
  nationality: string;
  jerseyNumber?: number;
  /** Champions the player is publicly identified with — used for FX theming. */
  signatureChampions: string[];
  /** Per-player accent that overrides the team accent when they are the focus. */
  accentColor?: string;
  careerHighlights: string[];
  socials?: PlayerSocials;
  /**
   * Search terms the asset ingestion CLI uses to locate licensed reference
   * photography. Deliberately explicit so ingestion is reproducible.
   */
  referenceQueries: string[];
  /** False for retired/benched players kept for historical thumbnails. */
  active: boolean;
  /** ISO date the player joined their current team, when known. */
  joinedAt?: string;
  /** Free-form tags: 'worlds-winner', 'rookie', 'veteran', 'faceofteam'. */
  tags?: string[];
}

/** A resolved subject: a player plus the assets chosen to represent them. */
export interface SubjectRef {
  player: Player;
  team: Team;
  /** Explicit asset id override; otherwise the best-scoring asset is chosen. */
  assetId?: string;
  /** Which side of a versus composition this subject occupies. */
  side?: 'left' | 'right' | 'center';
  /** Per-subject colour override, else derived from team. */
  accent?: string;
}
