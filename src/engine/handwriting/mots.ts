/**
 * Hexa — LEXIQUE EMBARQUÉ du mode écriture.
 *
 * Le reconnaisseur lit des lettres, une par une, et se trompe parfois : la
 * suite « SYNDPA » ou « 5YNDRA » est une lecture parfaitement honnête d'un
 * « SYNDRA » écrit à la souris en plein live. Ce fichier fournit la seule
 * chose qui manque pour trancher : SAVOIR QUELS MOTS EXISTENT.
 *
 * Trois règles ont guidé la rédaction des listes :
 *
 *  1. L'ORTHOGRAPHE EXACTE FAIT PARTIE DU MOT. Les apostrophes (Kai'Sa),
 *     les espaces (Lee Sin), les points (Dr. Mundo) et les majuscules
 *     internes (Rek'Sai, K'Sante) sont la raison d'être du lexique : on ne
 *     peut pas les écrire à la souris, et c'est justement l'outil qui les
 *     rétablit. La forme normalisée (§ normaliser) sert à la recherche, la
 *     forme écrite ici sert à l'affichage.
 *  2. RIEN D'INVENTÉ. Un nom dont l'orthographe est douteuse est un piège :
 *     il corrigerait un mot juste en un mot faux. Mieux vaut une liste plus
 *     courte et sûre — les mots manquants ne sont pas corrigés, ce qui est
 *     un non-événement, alors qu'une correction fantaisiste en plein live
 *     est humiliante.
 *  3. LA CASSE CANONIQUE EST CELLE QU'ON VEUT VOIR À L'ÉCRAN. Les mots
 *     longs sont capitalisés (« Ward », « Syndra »), les mots courts et les
 *     sigles restent CRIÉS (« GG », « MID », « ADC ») : c'est ainsi qu'on
 *     les écrit sur un écran de coaching, et ça évite le ridicule d'un
 *     « Gg » ou d'un « Adc ».
 *
 * Aucune ressource réseau : tout est ici, en dur, et pèse quelques kilo-octets.
 */

/** Catégories activables séparément dans les réglages. */
export type CategorieId = 'champions' | 'jeu' | 'francais' | 'perso'

/**
 * Les ~165 champions de League of Legends, orthographe officielle.
 * Écrits en toutes lettres — apostrophes, espaces et majuscules internes
 * comprises : c'est exactement ce que le lexique doit savoir rétablir.
 */
export const CHAMPIONS: readonly string[] = [
  'Aatrox',
  'Ahri',
  'Akali',
  'Akshan',
  'Alistar',
  'Ambessa',
  'Amumu',
  'Anivia',
  'Annie',
  'Aphelios',
  'Ashe',
  'Aurelion Sol',
  'Aurora',
  'Azir',
  'Bard',
  "Bel'Veth",
  'Blitzcrank',
  'Brand',
  'Braum',
  'Briar',
  'Caitlyn',
  'Camille',
  'Cassiopeia',
  "Cho'Gath",
  'Corki',
  'Darius',
  'Diana',
  'Dr. Mundo',
  'Draven',
  'Ekko',
  'Elise',
  'Evelynn',
  'Ezreal',
  'Fiddlesticks',
  'Fiora',
  'Fizz',
  'Galio',
  'Gangplank',
  'Garen',
  'Gnar',
  'Gragas',
  'Graves',
  'Gwen',
  'Hecarim',
  'Heimerdinger',
  'Hwei',
  'Illaoi',
  'Irelia',
  'Ivern',
  'Janna',
  'Jarvan IV',
  'Jax',
  'Jayce',
  'Jhin',
  'Jinx',
  "K'Sante",
  "Kai'Sa",
  'Kalista',
  'Karma',
  'Karthus',
  'Kassadin',
  'Katarina',
  'Kayle',
  'Kayn',
  'Kennen',
  "Kha'Zix",
  'Kindred',
  'Kled',
  "Kog'Maw",
  'LeBlanc',
  'Lee Sin',
  'Leona',
  'Lillia',
  'Lissandra',
  'Lucian',
  'Lulu',
  'Lux',
  'Malphite',
  'Malzahar',
  'Maokai',
  'Master Yi',
  'Milio',
  'Miss Fortune',
  'Mordekaiser',
  'Morgana',
  'Naafiri',
  'Nami',
  'Nasus',
  'Nautilus',
  'Neeko',
  'Nidalee',
  'Nilah',
  'Nocturne',
  'Nunu & Willump',
  'Olaf',
  'Orianna',
  'Ornn',
  'Pantheon',
  'Poppy',
  'Pyke',
  'Qiyana',
  'Quinn',
  'Rakan',
  'Rammus',
  "Rek'Sai",
  'Rell',
  'Renata Glasc',
  'Renekton',
  'Rengar',
  'Riven',
  'Rumble',
  'Ryze',
  'Samira',
  'Sejuani',
  'Senna',
  'Seraphine',
  'Sett',
  'Shaco',
  'Shen',
  'Shyvana',
  'Singed',
  'Sion',
  'Sivir',
  'Skarner',
  'Smolder',
  'Sona',
  'Soraka',
  'Swain',
  'Sylas',
  'Syndra',
  'Tahm Kench',
  'Taliyah',
  'Talon',
  'Taric',
  'Teemo',
  'Thresh',
  'Tristana',
  'Trundle',
  'Tryndamere',
  'Twisted Fate',
  'Twitch',
  'Udyr',
  'Urgot',
  'Varus',
  'Vayne',
  'Veigar',
  "Vel'Koz",
  'Vex',
  'Vi',
  'Viego',
  'Viktor',
  'Vladimir',
  'Volibear',
  'Warwick',
  'Wukong',
  'Xayah',
  'Xerath',
  'Xin Zhao',
  'Yasuo',
  'Yone',
  'Yorick',
  'Yuumi',
  'Zac',
  'Zed',
  'Zeri',
  'Ziggs',
  'Zilean',
  'Zoe',
  'Zyra',
]

/**
 * Vocabulaire du jeu et du coaching. Les sigles et les mots de trois lettres
 * ou moins gardent leurs capitales : personne n'écrit « Adc » ni « Gg ».
 */
export const VOCABULAIRE_JEU: readonly string[] = [
  // objectifs et carte
  'Baron',
  'Nashor',
  'Drake',
  'Dragon',
  'Herald',
  'Héraut',
  'Grubs',
  'Tourelle',
  'Inhibiteur',
  'Nexus',
  'Plaque',
  'Rift',
  'Fosse',
  'Bush',
  'Mur',
  'Rivière',
  'Base',
  'Fontaine',
  'Boutique',
  // rôles et lignes
  'MID',
  'TOP',
  'BOT',
  'ADC',
  'Jungle',
  'Jungler',
  'Support',
  'Solo',
  'Duo',
  'Carry',
  'Tank',
  'Assassin',
  'Mage',
  // camps et buffs
  'Buff',
  'Bleu',
  'Rouge',
  'Camp',
  'Krug',
  'Gromp',
  'Raptor',
  'Loups',
  'Scuttle',
  // macro
  'Vision',
  'Ward',
  'Wards',
  'Balise',
  'Gank',
  'Contre-gank',
  'Roam',
  'Split',
  'Push',
  'Freeze',
  'Wave',
  'Vague',
  'Recall',
  'Reset',
  'Recul',
  'Siege',
  'Backdoor',
  'Objectif',
  'Tempo',
  'Rotation',
  'Timer',
  'Cooldown',
  'Setup',
  'Engage',
  'Disengage',
  'Peel',
  'Kite',
  'Poke',
  'Focus',
  'Trade',
  'Échange',
  'Pression',
  'Contrôle',
  'Priorité',
  'Avantage',
  'Teamfight',
  'Skirmish',
  'Scaling',
  'Farm',
  'Last hit',
  'Zoning',
  'Dive',
  'Flanc',
  'Piège',
  'Punir',
  // sorts d'invocateur et raccourcis usuels
  'Flash',
  'Teleport',
  'Ignite',
  'Exhaust',
  'Barrier',
  'Cleanse',
  'Ghost',
  'Smite',
  'Heal',
  'ULT',
  'Passif',
  'Combo',
  'Stun',
  'Shield',
  'Bouclier',
  // sigles et chiffres du coaching
  'CS',
  'XP',
  'HP',
  'MANA',
  'GG',
  'AFK',
  'MIA',
  'KDA',
  'LP',
  'ELO',
  // objets dont l'orthographe est sûre
  'Zhonya',
  'Rabadon',
  'Mejai',
  'Doran',
  'Trinity',
  'Botrk',
]

/**
 * Français courant du commentaire live. Ce sont les mots qu'un coach jette
 * à l'écran entre deux flèches ; ils sont volontairement peu nombreux et
 * très fréquents, pour ne jamais entrer en concurrence avec un nom de
 * champion.
 */
export const MOTS_FRANCAIS: readonly string[] = [
  'Attention',
  'Ici',
  'Là',
  'Regarde',
  'Erreur',
  'Bien joué',
  'Trop tard',
  'Trop lent',
  'Recule',
  'Avance',
  'Ensemble',
  'Groupe',
  'Seul',
  'Doucement',
  'Patience',
  'Maintenant',
  'Jamais',
  'Toujours',
  'Danger',
  'Attends',
  'Vite',
  'Stop',
  'Non',
  'Oui',
  'OK',
  'Bien',
  'Mieux',
  'Mauvais',
  'Faute',
  'Timing',
  'Place-toi',
  'Suis-moi',
  'Reviens',
  'Continue',
  'Prépare',
  'Anticipe',
  'Rappel',
  'Note',
  'Exemple',
  'Idée',
  'Question',
  'Réponse',
  'Avant',
  'Après',
  'Début',
  'Fin',
]

/**
 * Raccourcis d'écriture courants → forme canonique. Ils permettent d'écrire
 * moins de lettres (donc de se tromper moins) tout en obtenant le mot juste.
 * La clé est écrite telle qu'on la trace ; elle est normalisée comme tout le
 * reste, l'accentuation et la casse n'ont donc aucune importance ici.
 */
export const ALIAS: Readonly<Record<string, string>> = {
  JARVAN: 'Jarvan IV',
  J4: 'Jarvan IV',
  YI: 'Master Yi',
  MF: 'Miss Fortune',
  TF: 'Twisted Fate',
  ASOL: 'Aurelion Sol',
  KENCH: 'Tahm Kench',
  NUNU: 'Nunu & Willump',
  MUNDO: 'Dr. Mundo',
  RENATA: 'Renata Glasc',
  SEJU: 'Sejuani',
  BLITZ: 'Blitzcrank',
  CAIT: 'Caitlyn',
  MORDE: 'Mordekaiser',
  HEIMER: 'Heimerdinger',
  FIDDLE: 'Fiddlesticks',
  TRYND: 'Tryndamere',
  VLAD: 'Vladimir',
  CASSIO: 'Cassiopeia',
  GP: 'Gangplank',
  WW: 'Warwick',
  MAOK: 'Maokai',
  XIN: 'Xin Zhao',
  LEE: 'Lee Sin',
  DRAG: 'Drake',
  HERAUT: 'Herald',
  BARON: 'Baron',
  TP: 'Teleport',
  BJ: 'Bien joué',
}

export interface Categorie {
  id: CategorieId
  /** libellé affiché dans les réglages */
  nom: string
  /** une ligne d'explication, affichée sous le libellé */
  detail: string
  /** entrées avec leur orthographe et leur casse définitives */
  entrees: readonly string[]
}

/**
 * Les catégories livrées. « perso » est vide ici : elle est remplie à chaud
 * par les mots que l'utilisateur ajoute dans les réglages — un coach a son
 * propre vocabulaire (pseudos de joueurs, noms d'équipes, jargon maison).
 */
export const CATEGORIES: readonly Categorie[] = [
  {
    id: 'champions',
    nom: 'Champions LoL',
    detail: `${CHAMPIONS.length} noms, apostrophes et espaces compris (Kai'Sa, Lee Sin)`,
    entrees: CHAMPIONS,
  },
  {
    id: 'jeu',
    nom: 'Vocabulaire de jeu',
    detail: `${VOCABULAIRE_JEU.length} termes de macro et de coaching (ward, drake, tempo)`,
    entrees: VOCABULAIRE_JEU,
  },
  {
    id: 'francais',
    nom: 'Français courant',
    detail: `${MOTS_FRANCAIS.length} mots du commentaire live (attention, regarde, recule)`,
    entrees: MOTS_FRANCAIS,
  },
  {
    id: 'perso',
    nom: 'Mes mots',
    detail: 'Les mots ajoutés ci-dessous',
    entrees: [],
  },
]

/** Catégories actives par défaut. */
export const CATEGORIES_DEFAUT: readonly CategorieId[] = ['champions', 'jeu', 'francais', 'perso']
