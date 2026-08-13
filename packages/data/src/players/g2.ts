/**
 * G2 Esports — LEC. Roster as of the 2026 LEC season. G2 retained all five
 * starters and the full coaching staff from 2025.
 *
 * ROSTERS CHANGE. Re-verify before a season, after any trade window, and any
 * time a render surprises you. See `../roster.ts` for the full provenance
 * block and the re-verification procedure.
 *
 * sourcedAt: 2026-08-13
 * sources:
 *  - https://www.sheepesports.com/en/all/articles/lol-g2-esports-completed-2026-lec-roster/en
 *  - https://esports-news.co.uk/2025/11/25/g2-esports-retain-lol-roster-for-lec-2026/
 *  - https://win.gg/g2-esports-comeback-karmine-corp-win-lec-spring-2026/
 *  - https://egamersworld.com/lol/news/32882/lec-versus-2026-finals-recap-g2-esports-claim-titl--PtJZ8KyV
 *  - https://esports.gg/news/league-of-legends/mikyx-part-ways-with-g2-esports/
 *  - https://liquipedia.net/leagueoflegends/G2_Esports
 */

import type { Player } from '@hexa/core';

export const G2_PLAYERS: Player[] = [
  {
    id: 'brokenblade',
    handle: 'BrokenBlade',
    aliases: ['g2-brokenblade', 'Broken Blade', 'Sergen Celik', 'Sergen Çelik'],
    fullName: 'Sergen Çelik',
    role: 'top',
    teamId: 'g2',
    region: 'EU',
    nationality: 'Germany',
    signatureChampions: ['Rumble', 'Gnar', "K'Sante", 'Jax', 'Aatrox', 'Renekton'],
    careerHighlights: [
      'LEC Versus 2026 and LEC Spring 2026 champion',
      'Multiple-time LEC champion across his G2 tenure',
      'Worlds 2025 quarter-finalist with G2 — the org’s best result since 2020',
      'Entering his fifth season with G2 Esports',
    ],
    referenceQueries: [
      'BrokenBlade G2 Esports LEC 2026 press photo',
      'Sergen Celik BrokenBlade G2 portrait lolesports',
      'BrokenBlade G2 Esports LEC Spring 2026 champion photo',
      'BrokenBlade G2 media day 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2021-11',
    tags: ['starter', 'veteran'],
  },
  {
    id: 'skewmond',
    handle: 'SkewMond',
    aliases: ['g2-skewmond', 'Skewmond', 'Rudy Semaan'],
    fullName: 'Rudy Semaan',
    role: 'jungle',
    teamId: 'g2',
    region: 'EU',
    nationality: 'France',
    signatureChampions: ['Maokai', 'Vi', 'Xin Zhao', 'Sejuani', 'Wukong'],
    careerHighlights: [
      'LEC Versus 2026 and LEC Spring 2026 champion',
      'Worlds 2025 quarter-finalist with G2 Esports',
      'Won the G2 starting jungle role for 2025 and kept it through the 2026 renewal',
    ],
    referenceQueries: [
      'SkewMond G2 Esports LEC 2026 press photo',
      'Rudy Semaan SkewMond G2 portrait lolesports',
      'SkewMond G2 Esports jungler LEC media kit 2026',
      'SkewMond G2 LEC Spring 2026 champion photo',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter'],
  },
  {
    id: 'caps',
    handle: 'Caps',
    aliases: ['g2-caps', 'Rasmus Winther', 'Rasmus Borregaard Winther', 'Baby Faker'],
    fullName: 'Rasmus Winther',
    role: 'mid',
    teamId: 'g2',
    region: 'EU',
    nationality: 'Denmark',
    signatureChampions: ['Sylas', 'LeBlanc', 'Azir', 'Twisted Fate', 'Ahri', 'Orianna'],
    careerHighlights: [
      'Worlds 2019 runner-up and MSI 2019 champion with G2 Esports',
      'Worlds 2018 runner-up with Fnatic — the only player to reach a Worlds final with two different organisations',
      'The most decorated player in LEC history by domestic titles',
      'LEC Versus 2026 and LEC Spring 2026 champion; contracted to G2 through 2027',
    ],
    socials: {
      twitter: 'G2Caps',
    },
    referenceQueries: [
      'Caps G2 Esports LEC 2026 press photo',
      'Rasmus Winther Caps G2 portrait lolesports',
      'Caps G2 Esports LEC Spring 2026 champion photo',
      'Caps G2 media day 2026 jersey portrait',
      'Caps G2 Esports LEC official media kit headshot',
    ],
    active: true,
    joinedAt: '2018-11',
    tags: ['starter', 'veteran', 'faceofteam', 'legend'],
  },
  {
    id: 'hans-sama',
    handle: 'Hans Sama',
    aliases: ['g2-hans-sama', 'HansSama', 'Hans sama', 'Steven Liv'],
    fullName: 'Steven Liv',
    role: 'bot',
    teamId: 'g2',
    region: 'EU',
    nationality: 'France',
    signatureChampions: ['Zeri', 'Jinx', "Kai'Sa", 'Aphelios', 'Ezreal'],
    careerHighlights: [
      'LEC Versus 2026 and LEC Spring 2026 champion',
      'Multiple-time LEC champion with G2 Esports',
      'Worlds 2025 quarter-finalist with G2',
      'Entering his fourth season with G2 after a career with Rogue and Team Liquid',
    ],
    socials: {
      twitter: 'Hanssama',
    },
    referenceQueries: [
      'Hans Sama G2 Esports LEC 2026 press photo',
      'Steven Liv Hans Sama G2 portrait lolesports',
      'Hans Sama G2 Esports bot laner LEC media kit 2026',
      'Hans Sama G2 LEC Spring 2026 champion photo',
    ],
    active: true,
    joinedAt: '2022-11',
    tags: ['starter', 'veteran'],
  },
  {
    id: 'labrov',
    handle: 'Labrov',
    aliases: ['g2-labrov', 'Labros Papoutsakis'],
    fullName: 'Labros Papoutsakis',
    role: 'support',
    teamId: 'g2',
    region: 'EU',
    nationality: 'Greece',
    signatureChampions: ['Rakan', 'Nautilus', 'Rell', 'Alistar', 'Braum'],
    careerHighlights: [
      'LEC Versus 2026 and LEC Spring 2026 champion',
      'Worlds 2025 quarter-finalist with G2 Esports',
      'Took over the G2 support role for 2025 after Mikyx’s departure',
    ],
    referenceQueries: [
      'Labrov G2 Esports LEC 2026 press photo',
      'Labros Papoutsakis Labrov G2 portrait lolesports',
      'Labrov G2 Esports support LEC media kit 2026',
      'Labrov G2 LEC Spring 2026 champion photo',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter'],
  },
  {
    id: 'dylan-falco',
    handle: 'Dylan Falco',
    aliases: ['g2-dylan-falco', 'Falco', 'DylanFalco'],
    fullName: 'Dylan Falco',
    role: 'coach',
    teamId: 'g2',
    region: 'EU',
    nationality: 'Canada',
    signatureChampions: [],
    careerHighlights: [
      'Head coach of G2 Esports, retained for the 2026 LEC season',
      'LEC Versus 2026 and LEC Spring 2026 winning head coach',
      'Took G2 to the Worlds 2025 quarter-finals',
    ],
    referenceQueries: [
      'Dylan Falco G2 Esports head coach LEC 2026 photo',
      'Dylan Falco G2 coach portrait lolesports',
      'G2 Esports coaching staff 2026 media photo',
    ],
    active: true,
    tags: ['coach'],
  },
  {
    id: 'memento',
    handle: 'Memento',
    aliases: ['g2-memento', 'Jonas Elmarghichi'],
    fullName: 'Jonas Elmarghichi',
    role: 'coach',
    teamId: 'g2',
    region: 'EU',
    nationality: 'Sweden',
    signatureChampions: [],
    careerHighlights: [
      'Strategic/assistant coach for G2 Esports, retained for the 2026 LEC season',
      'Former LEC jungler before moving to the bench',
    ],
    referenceQueries: [
      'Memento G2 Esports coach LEC 2026 photo',
      'Jonas Elmarghichi Memento coach portrait',
      'G2 Esports coaching staff 2026 photo',
    ],
    active: true,
    tags: ['coach'],
  },
  {
    id: 'mikyx',
    handle: 'Mikyx',
    aliases: ['g2-mikyx', 'Mihael Mehle'],
    fullName: 'Mihael Mehle',
    role: 'support',
    teamId: 'g2',
    region: 'EU',
    nationality: 'Slovenia',
    signatureChampions: ['Rakan', 'Alistar', 'Nautilus', 'Bard', 'Pyke'],
    careerHighlights: [
      'Worlds 2019 runner-up and MSI 2019 champion with G2 Esports',
      'LEC 2023 Summer champion and 2023 & 2024 LEC Season Finals champion with G2',
      'Two spells at G2; parted ways with the org in November 2024',
    ],
    referenceQueries: [
      'Mikyx G2 Esports LEC press photo',
      'Mihael Mehle Mikyx G2 support portrait lolesports',
      'Mikyx G2 Esports LEC 2024 champion photo',
    ],
    active: false,
    tags: ['veteran', 'former'],
  },
  {
    id: 'jankos',
    handle: 'Jankos',
    aliases: ['g2-jankos', 'Marcin Jankowski', 'The First Blood King'],
    fullName: 'Marcin Jankowski',
    role: 'jungle',
    teamId: 'g2',
    region: 'EU',
    nationality: 'Poland',
    signatureChampions: ['Jarvan IV', 'Lee Sin', 'Sejuani', 'Xin Zhao', 'Elise'],
    careerHighlights: [
      'Worlds 2019 runner-up and MSI 2019 champion with G2 Esports',
      'Multiple-time LEC champion across five seasons with G2 (2018–2022)',
      'Nicknamed "The First Blood King"; one of the most recognisable faces in European League of Legends',
    ],
    referenceQueries: [
      'Jankos G2 Esports LEC press photo',
      'Marcin Jankowski Jankos G2 portrait lolesports',
      'Jankos G2 Esports jungler stage photo',
    ],
    active: false,
    tags: ['veteran', 'legend', 'former'],
  },
];
