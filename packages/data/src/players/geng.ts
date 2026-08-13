/**
 * Gen.G — LCK. Roster as of the 2026 LCK season.
 *
 * ROSTERS CHANGE. Re-verify before a season, after any trade window, and any
 * time a render surprises you. See `../roster.ts` for the full provenance
 * block and the re-verification procedure.
 *
 * sourcedAt: 2026-08-13
 * sources:
 *  - https://www.sheepesports.com/en/all/articles/lol-gen-g-s-completed-2026-lck-roster/en
 *  - https://www.invenglobal.com/articles/19909/canyon-re-signs-with-geng-commits-to-2026-worlds-championship-push
 *  - https://www.invenglobal.com/articles/19713/geng-wins-lck-2025-season-playoffs
 *  - https://www.invenglobal.com/articles/18832/geng-crowned-champions-of-msi-2024-lehends-named-mvp
 *  - https://www.invenglobal.com/articles/20354/lck-2026-media-day-geng-named-overwhelming-title-favourite-as-geng-picks-t1
 *  - https://liquipedia.net/leagueoflegends/Gen.G_Esports
 */

import type { Player } from '@hexa/core';

export const GENG_PLAYERS: Player[] = [
  {
    id: 'kiin',
    handle: 'Kiin',
    aliases: ['geng-kiin', 'Kim Gi-in', 'Kim Giin', '김기인'],
    fullName: 'Kim Gi-in',
    nativeName: '김기인',
    role: 'top',
    teamId: 'geng',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Gnar', "K'Sante", 'Jax', 'Rumble', 'Aatrox'],
    careerHighlights: [
      'MSI 2024 champion with Gen.G',
      'LCK 2025 Season champion',
      'LCK 2024 Spring and Summer champion',
      'Repeat LCK First All-Pro top laner after a long tenure carrying Afreeca/Kwangdong Freecs',
    ],
    referenceQueries: [
      'Kiin Gen.G LCK 2026 press photo',
      'Kim Gi-in Kiin Gen.G portrait lolesports',
      'Kiin Gen.G top laner LCK media kit 2026',
      'Kiin Gen.G MSI 2024 champion photo',
    ],
    active: true,
    joinedAt: '2023-11',
    tags: ['starter', 'msi-winner', 'veteran'],
  },
  {
    id: 'canyon',
    handle: 'Canyon',
    aliases: ['geng-canyon', 'Kim Geon-bu', 'Kim Geonbu', '김건부'],
    fullName: 'Kim Geon-bu',
    nativeName: '김건부',
    role: 'jungle',
    teamId: 'geng',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Nidalee', 'Graves', 'Kindred', 'Lillia', 'Viego', 'Karthus'],
    careerHighlights: [
      'World Champion 2020 with DAMWON Gaming — Worlds 2020 Finals MVP',
      'Worlds 2021 runner-up',
      'MSI 2024 champion with Gen.G',
      'LCK 2025 Season champion; multiple-time LCK champion with DAMWON and Gen.G',
      'Widely regarded as the best jungler of his generation',
    ],
    referenceQueries: [
      'Canyon Gen.G LCK 2026 press photo',
      'Kim Geon-bu Canyon Gen.G portrait lolesports',
      'Canyon Gen.G jungler LCK media kit 2026',
      'Canyon DAMWON Worlds 2020 finals MVP photo',
    ],
    active: true,
    joinedAt: '2023-11',
    tags: ['starter', 'worlds-winner', 'msi-winner', 'faceofteam'],
  },
  {
    id: 'chovy',
    handle: 'Chovy',
    aliases: ['geng-chovy', 'Jeong Ji-hoon', 'Jeong Jihoon', '정지훈'],
    fullName: 'Jeong Ji-hoon',
    nativeName: '정지훈',
    role: 'mid',
    teamId: 'geng',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Azir', 'Ahri', 'Corki', 'Sylas', 'Yone', 'Akali'],
    careerHighlights: [
      'MSI 2024 champion with Gen.G',
      'LCK 2025 Season champion',
      'Multiple-time LCK champion and LCK regular-season MVP',
      'Perennial LCK First All-Pro mid laner since his Griffin debut in 2019',
      'Played the 2021 season for Hanwha Life Esports before joining Gen.G',
    ],
    referenceQueries: [
      'Chovy Gen.G LCK 2026 press photo',
      'Jeong Ji-hoon Chovy Gen.G portrait lolesports',
      'Chovy Gen.G mid laner LCK media kit 2026',
      'Chovy Gen.G MSI 2024 champion celebration photo',
    ],
    active: true,
    joinedAt: '2021-11',
    tags: ['starter', 'msi-winner', 'faceofteam'],
  },
  {
    id: 'ruler',
    handle: 'Ruler',
    aliases: ['geng-ruler', 'Park Jae-hyuk', 'Park Jaehyuk', '박재혁'],
    fullName: 'Park Jae-hyuk',
    nativeName: '박재혁',
    role: 'bot',
    teamId: 'geng',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Aphelios', "Kai'Sa", 'Varus', 'Xayah', 'Jinx', 'Ezreal'],
    careerHighlights: [
      'World Champion 2017 with Samsung Galaxy — Worlds 2017 Finals MVP',
      'MSI 2023 champion with JD Gaming',
      'LCK 2025 Season champion — Finals MVP on his return to Gen.G',
      'Worlds 2022 semi-finalist with Gen.G; one of the most decorated bot laners in the sport',
    ],
    referenceQueries: [
      'Ruler Gen.G LCK 2026 press photo',
      'Park Jae-hyuk Ruler Gen.G portrait lolesports',
      'Ruler Gen.G LCK 2025 finals MVP photo',
      'Ruler Samsung Galaxy Worlds 2017 champion photo',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter', 'worlds-winner', 'msi-winner', 'veteran', 'faceofteam'],
  },
  {
    id: 'duro',
    handle: 'Duro',
    aliases: ['geng-duro', 'Joo Min-kyu', 'Ju Min-gyu', '주민규'],
    fullName: 'Joo Min-kyu',
    nativeName: '주민규',
    role: 'support',
    teamId: 'geng',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Rell', 'Alistar', 'Rakan', 'Nautilus', 'Braum'],
    careerHighlights: [
      'LCK 2025 Season champion in his first year on a main LCK roster',
      'Signed to Gen.G through 2027',
    ],
    referenceQueries: [
      'Duro Gen.G LCK 2026 press photo',
      'Joo Min-kyu Duro Gen.G portrait lolesports',
      'Duro Gen.G support LCK media kit 2026',
      'Duro Gen.G LCK 2025 champion photo',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter', 'rookie'],
  },
  {
    id: 'ryu',
    handle: 'Ryu',
    aliases: ['geng-ryu', 'Yoo Sang-wook', 'Yu Sang-uk', '유상욱'],
    fullName: 'Yoo Sang-wook',
    nativeName: '유상욱',
    role: 'coach',
    teamId: 'geng',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: [],
    careerHighlights: [
      'Head coach of Gen.G for the 2026 LCK season',
      'Previously head coach of BNK FEARX',
      'Long playing career as a mid laner in the LCK, LCS and LEC',
    ],
    referenceQueries: [
      'Ryu Gen.G head coach LCK 2026 press photo',
      'Yoo Sang-wook Ryu coach portrait lolesports',
      'Gen.G coaching staff 2026 media day photo',
    ],
    active: true,
    tags: ['coach'],
  },
  {
    id: 'lehends',
    handle: 'Lehends',
    aliases: ['geng-lehends', 'Son Si-woo', 'Son Siwoo', '손시우'],
    fullName: 'Son Si-woo',
    nativeName: '손시우',
    role: 'support',
    teamId: 'geng',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Blitzcrank', 'Maokai', 'Rakan', 'Bard', 'Pyke'],
    careerHighlights: [
      'MSI 2024 champion with Gen.G — MSI 2024 Finals MVP',
      'LCK 2024 Spring and Summer champion with Gen.G',
      'Famous for the widest support champion pool in the LCK',
    ],
    referenceQueries: [
      'Lehends Gen.G LCK press photo',
      'Son Si-woo Lehends Gen.G portrait lolesports',
      'Lehends Gen.G MSI 2024 finals MVP photo',
      'Lehends Gen.G support media kit photo',
    ],
    active: false,
    tags: ['msi-winner', 'former'],
  },
];
