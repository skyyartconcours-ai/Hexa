/**
 * Karmine Corp — LEC. Roster as of the 2026 LEC season.
 *
 * ROSTERS CHANGE. Re-verify before a season, after any trade window, and any
 * time a render surprises you. See `../roster.ts` for the full provenance
 * block and the re-verification procedure.
 *
 * sourcedAt: 2026-08-13
 * sources:
 *  - https://www.sheepesports.com/en/all/articles/lol-karmine-corp-s-completed-2026-lec-roster/en
 *  - https://esportsinsider.com/2026/01/karmine-corp-unveils-lec-and-vct-2026-rosters
 *  - https://www.sheepesports.com/en/all/articles/sources-reapered-set-to-join-karmine-corp-as-head-coach-for-the-2026-season/en
 *  - https://esportsworldcup.com/en/press-releases/dplus-kia-win-lol-at-ewc26
 *  - https://egamersworld.com/lol/news/26642/karmine-corp-dominates-g2-esports-3-0-to-win-lec-w-t4AmXuKdL
 *  - https://liquipedia.net/leagueoflegends/Karmine_Corp
 */

import type { Player } from '@hexa/core';

export const KC_PLAYERS: Player[] = [
  {
    id: 'canna',
    handle: 'Canna',
    aliases: ['kc-canna', 't1-canna', 'Kim Chang-dong', 'Kim Changdong', '김창동'],
    fullName: 'Kim Chang-dong',
    nativeName: '김창동',
    role: 'top',
    teamId: 'kc',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Renekton', 'Jayce', 'Gnar', "K'Sante", 'Aatrox'],
    careerHighlights: [
      'LEC 2025 MVP',
      'LEC Winter 2025 champion with Karmine Corp',
      'Esports World Cup 2026 runner-up',
      'LCK 2020 Spring champion with T1; Worlds 2021 semi-finalist',
      'Also played for Nongshim RedForce and Dplus KIA before moving to Europe',
    ],
    referenceQueries: [
      'Canna Karmine Corp LEC 2026 press photo',
      'Kim Chang-dong Canna Karmine Corp portrait lolesports',
      'Canna Karmine Corp LEC 2025 MVP photo',
      'Canna Karmine Corp media day 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2024-05',
    tags: ['starter', 'faceofteam'],
  },
  {
    id: 'yike',
    handle: 'Yike',
    aliases: ['kc-yike', 'g2-yike', 'Martin Sundelin'],
    fullName: 'Martin Sundelin',
    role: 'jungle',
    teamId: 'kc',
    region: 'EU',
    nationality: 'Sweden',
    signatureChampions: ['Viego', 'Vi', 'Nidalee', 'Xin Zhao', 'Sejuani'],
    careerHighlights: [
      'LEC champion with G2 Esports in 2024',
      'LEC Winter 2025 champion with Karmine Corp',
      'Esports World Cup 2026 runner-up',
      'The vocal leader and shotcaller of the Karmine Corp roster',
    ],
    referenceQueries: [
      'Yike Karmine Corp LEC 2026 press photo',
      'Martin Sundelin Yike Karmine Corp portrait lolesports',
      'Yike Karmine Corp jungler LEC media kit 2026',
      'Yike G2 Esports 2024 LEC photo',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter'],
  },
  {
    id: 'kyeahoo',
    handle: 'kyeahoo',
    aliases: ['kc-kyeahoo', 'Kyeahoo', 'Kang Ye-hoo', 'Kang Yehoo', '강예후'],
    fullName: 'Kang Ye-hoo',
    nativeName: '강예후',
    role: 'mid',
    teamId: 'kc',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Azir', 'Ahri', 'Sylas', 'Orianna'],
    careerHighlights: [
      'Esports World Cup 2026 runner-up with Karmine Corp',
      'LCK Academy 2022 Summer champion with DRX Academy',
      'Almost four seasons inside the DRX organisation across LCK AS, LCK CL and the LCK before moving to the LEC',
    ],
    referenceQueries: [
      'kyeahoo Karmine Corp LEC 2026 press photo',
      'Kang Ye-hoo kyeahoo Karmine Corp portrait lolesports',
      'kyeahoo DRX LCK mid laner media kit photo',
      'kyeahoo Karmine Corp signing announcement 2026 photo',
    ],
    active: true,
    tags: ['starter', 'rookie'],
  },
  {
    id: 'caliste',
    handle: 'Caliste',
    aliases: ['kc-caliste', 'Caliste Henry-Hennebert'],
    fullName: 'Caliste Henry-Hennebert',
    role: 'bot',
    teamId: 'kc',
    region: 'EU',
    nationality: 'France',
    signatureChampions: ['Ezreal', 'Jinx', "Kai'Sa", 'Varus', 'Xayah'],
    careerHighlights: [
      'LEC Winter 2025 champion with Karmine Corp',
      'Esports World Cup 2026 runner-up',
      'The team’s mechanical prodigy and public face, promoted out of the French LFL scene',
    ],
    referenceQueries: [
      'Caliste Karmine Corp LEC 2026 press photo',
      'Caliste Henry-Hennebert Karmine Corp portrait lolesports',
      'Caliste Karmine Corp bot laner LEC media kit 2026',
      'Caliste Karmine Corp Esports World Cup 2026 photo',
    ],
    active: true,
    tags: ['starter', 'faceofteam'],
  },
  {
    id: 'busio',
    handle: 'Busio',
    aliases: ['kc-busio', 'Alan Cwalina'],
    fullName: 'Alan Cwalina',
    role: 'support',
    teamId: 'kc',
    region: 'NA',
    nationality: 'United States',
    signatureChampions: ['Rakan', 'Nautilus', 'Rell', 'Braum', 'Alistar'],
    careerHighlights: [
      'World Championship appearances in 2024 and 2025 with FlyQuest',
      'Esports World Cup 2026 runner-up with Karmine Corp',
      'First European season in 2026 after his career in North America',
    ],
    referenceQueries: [
      'Busio Karmine Corp LEC 2026 press photo',
      'Alan Cwalina Busio support portrait lolesports',
      'Busio FlyQuest Worlds 2025 photo',
      'Busio Karmine Corp signing announcement 2026 photo',
    ],
    active: true,
    tags: ['starter'],
  },
  {
    id: 'reapered',
    handle: 'Reapered',
    aliases: ['kc-reapered', 'Bok Han-gyu', 'Bok Hangyu', '복한규'],
    fullName: 'Bok Han-gyu',
    nativeName: '복한규',
    role: 'coach',
    teamId: 'kc',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: [],
    careerHighlights: [
      'Head coach of Karmine Corp from the 2026 LEC season',
      'Multiple-time LCS champion head coach with Cloud9; also coached 100 Thieves',
      'Former professional top laner in Korea and China',
    ],
    referenceQueries: [
      'Reapered Karmine Corp head coach LEC 2026 press photo',
      'Bok Han-gyu Reapered coach portrait lolesports',
      'Karmine Corp coaching staff 2026 photo',
    ],
    active: true,
    tags: ['coach'],
  },
  {
    id: 'zeph',
    handle: 'Zeph',
    aliases: ['kc-zeph', 'Quentin Viguie', 'Quentin Viguié'],
    fullName: 'Quentin Viguié',
    role: 'coach',
    teamId: 'kc',
    region: 'EU',
    nationality: 'France',
    signatureChampions: [],
    careerHighlights: [
      'Assistant coach of Karmine Corp from the 2026 LEC season, alongside head coach Reapered',
    ],
    referenceQueries: [
      'Zeph Karmine Corp assistant coach LEC 2026 photo',
      'Quentin Viguie Zeph coach portrait Karmine Corp',
      'Karmine Corp coaching staff 2026 media photo',
    ],
    active: true,
    tags: ['coach'],
  },
  {
    id: 'targamas',
    handle: 'Targamas',
    aliases: ['kc-targamas', 'Raphael Crabbe', 'Raphaël Crabbé'],
    fullName: 'Raphaël Crabbé',
    role: 'support',
    teamId: 'kc',
    region: 'EU',
    nationality: 'Belgium',
    signatureChampions: ['Rakan', 'Nautilus', 'Bard', 'Alistar'],
    careerHighlights: [
      'LEC Winter 2025 champion with Karmine Corp',
      'Karmine Corp’s starting support before being replaced by Busio for 2026',
    ],
    referenceQueries: [
      'Targamas Karmine Corp LEC 2025 press photo',
      'Raphael Crabbe Targamas support portrait lolesports',
      'Targamas Karmine Corp LEC media kit photo',
    ],
    active: false,
    tags: ['former'],
  },
  {
    id: 'vladi',
    handle: 'Vladi',
    aliases: ['kc-vladi', 'Vladimiros Kourtidis', 'Vladimíros Kourtídis'],
    fullName: 'Vladimiros Kourtidis',
    role: 'mid',
    teamId: 'kc',
    region: 'EU',
    nationality: 'Greece',
    signatureChampions: ['Ahri', 'Sylas', 'Orianna', 'Azir'],
    careerHighlights: [
      'LEC Winter 2025 champion with Karmine Corp — the second-youngest mid laner to win the LEC, behind only Caps',
      'Left Karmine Corp after the 2025 season and joined Fnatic for 2026',
    ],
    referenceQueries: [
      'Vladi Karmine Corp LEC 2025 press photo',
      'Vladimiros Kourtidis Vladi mid laner portrait lolesports',
      'Vladi Karmine Corp LEC Winter 2025 champion photo',
    ],
    active: false,
    tags: ['former'],
  },
];
