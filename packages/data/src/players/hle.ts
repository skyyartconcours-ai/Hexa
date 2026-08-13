/**
 * Hanwha Life Esports — LCK. Roster as of the 2026 LCK season.
 *
 * ROSTERS CHANGE, AND SOME OF THIS IS ONLY "REPORTED". Per-field provenance and
 * confidence live in `../verification.ts`. See `../README.md` for how to
 * re-verify.
 *
 * Audited 2026-08-13. Corrections made in that pass:
 *  - Homme did **not** head-coach Hanwha Life to the LCK 2024 Summer title.
 *    Choi "DanDy" In-gyu did; Homme joined HLE for the 2026 season. Deleted.
 *  - Kanavi: "five-time LPL champion" cut to the four titles that can be named;
 *    an unsourced "two-time LPL Jungler of the Year" line deleted.
 *  - Peanut did not stop playing in September 2025 — he announced his
 *    enlistment then and played on through Worlds 2025.
 *  - Zeus gained the Worlds 2023 Finals MVP, which the dataset had credited to
 *    Faker.
 *
 * sourcedAt: 2026-08-13
 * sources:
 *  - https://www.sheepesports.com/en/all/articles/lol-lck-gumayusi-joins-hanwha-life-esports/en
 *  - https://egamersworld.com/lol/news/30721/gumayusi-officially-becomes-the-new-adc-of-hanwha--CRku_kA7n
 *  - https://esportsinsider.com/2025/11/hanwha-life-esports-zeus-zeka-2026
 *  - https://www.sheepesports.com/en/all/articles/lol-homme-joins-hle-as-head-coach-for-the-2026-lck-season-mowgli-renews/en
 *  - https://www.koreaherald.com/article/10806145
 *  - https://dotesports.com/league-of-legends/news/hanwha-life-esports-win-msi-2026
 *  - https://egamersworld.com/lol/news/30913/viper-joins-bilibili-gaming-for-the-2026-season-aVKkclhr3
 *  - https://esports-news.co.uk/2025/10/28/peanut-jungler-retires-from-lol-esports-after-hle-worlds-exit/
 */

import type { Player } from '@hexa/core';

export const HLE_PLAYERS: Player[] = [
  {
    id: 'zeus',
    handle: 'Zeus',
    aliases: ['hle-zeus', 't1-zeus', 'Choi Woo-je', 'Choi Wooje', '최우제'],
    fullName: 'Choi Woo-je',
    nativeName: '최우제',
    role: 'top',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Jayce', 'Gnar', 'Aatrox', "K'Sante", 'Rumble', 'Camille'],
    careerHighlights: [
      'World Champion 2023, 2024 (T1)',
      // ADDED 2026-08-13: the dataset had credited this award to Faker.
      'Worlds 2023 Finals MVP',
      'MSI 2026 champion with Hanwha Life Esports — Finals MVP',
      'Worlds 2022 runner-up with T1',
      // DELETED 2026-08-13: an unsourced All-Pro claim. "LCK champion" kept.
      'LCK champion',
    ],
    referenceQueries: [
      'Zeus Hanwha Life Esports LCK 2026 press photo',
      'Choi Woo-je Zeus HLE portrait lolesports',
      'Zeus HLE MSI 2026 finals MVP photo',
      'Zeus Hanwha Life media day 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter', 'worlds-winner', 'msi-winner', 'faceofteam'],
  },
  {
    id: 'kanavi',
    handle: 'Kanavi',
    aliases: ['hle-kanavi', 'Seo Jin-hyeok', 'Seo Jinhyeok', '서진혁'],
    fullName: 'Seo Jin-hyeok',
    nativeName: '서진혁',
    role: 'jungle',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Nidalee', 'Graves', 'Xin Zhao', 'Lee Sin', 'Jarvan IV', 'Vi'],
    careerHighlights: [
      'MSI 2023 champion with JD Gaming',
      'MSI 2026 champion with Hanwha Life Esports',
      // CORRECTED 2026-08-13: was "five-time LPL champion". Four titles can be
      // named; an unsourced "two-time LPL Jungler of the Year" line was deleted.
      'Four-time LPL champion with JD Gaming (2020 Spring, 2022 Summer, 2023 Spring, 2023 Summer)',
      'Asian Games gold medallist with South Korea (Hangzhou 2022, held in 2023)',
      'Spent 2019–2024 with JD Gaming and 2025 with Top Esports before his first LCK season',
    ],
    referenceQueries: [
      'Kanavi Hanwha Life Esports LCK 2026 press photo',
      'Seo Jin-hyeok Kanavi portrait lolesports',
      'Kanavi HLE MSI 2026 champion photo jungler',
      'Kanavi Hanwha Life signing announcement 2026 photo',
    ],
    active: true,
    joinedAt: '2025-11',
    tags: ['starter', 'msi-winner', 'veteran'],
  },
  {
    id: 'zeka',
    handle: 'Zeka',
    aliases: ['hle-zeka', 'Kim Geon-woo', 'Kim Geonwoo', '김건우'],
    fullName: 'Kim Geon-woo',
    nativeName: '김건우',
    role: 'mid',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Akali', 'Sylas', 'Azir', 'Ahri', 'Yone'],
    careerHighlights: [
      'World Champion 2022 with DRX — Worlds 2022 Finals MVP',
      'MSI 2026 champion with Hanwha Life Esports',
      'LCK 2024 Summer champion with Hanwha Life Esports',
      // DELETED 2026-08-13: editorial narrative, not a title or placement.
    ],
    referenceQueries: [
      'Zeka Hanwha Life Esports LCK 2026 press photo',
      'Kim Geon-woo Zeka HLE portrait lolesports',
      'Zeka DRX Worlds 2022 finals MVP photo',
      'Zeka Hanwha Life MSI 2026 champion photo',
    ],
    active: true,
    joinedAt: '2022-11',
    tags: ['starter', 'worlds-winner', 'msi-winner', 'faceofteam'],
  },
  {
    id: 'gumayusi',
    handle: 'Gumayusi',
    aliases: ['hle-gumayusi', 't1-gumayusi', 'Guma', 'Lee Min-hyeong', 'Lee Minhyeong', '이민형'],
    fullName: 'Lee Min-hyeong',
    nativeName: '이민형',
    role: 'bot',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Jinx', "Kai'Sa", 'Aphelios', 'Lucian', 'Ezreal', 'Varus'],
    careerHighlights: [
      'World Champion 2023, 2024, 2025 (T1) — three titles',
      'Worlds 2025 Finals MVP',
      'MSI 2026 champion with Hanwha Life Esports',
      'Worlds 2022 runner-up with T1; multiple-time LCK champion',
      'Left T1 after the 2025 three-peat to lead Hanwha Life’s bot lane',
    ],
    referenceQueries: [
      'Gumayusi Hanwha Life Esports LCK 2026 press photo',
      'Lee Min-hyeong Gumayusi portrait lolesports',
      'Gumayusi Worlds 2025 finals MVP celebration photo',
      'Gumayusi HLE signing announcement 2026 bot laner photo',
      'Gumayusi Hanwha Life MSI 2026 champion photo',
    ],
    active: true,
    joinedAt: '2025-11',
    tags: ['starter', 'worlds-winner', 'msi-winner', 'faceofteam'],
  },
  {
    id: 'delight',
    handle: 'Delight',
    // DISPUTED romanisation: Liquipedia/Esports Charts read 유환중 as
    // "Yu Hwan-jung"; Leaguepedia/ggscore/Esports Earnings read it
    // "Yoo Hwan-joong". Both are kept as aliases. See ../verification.ts.
    aliases: ['hle-delight', 'Yu Hwan-jung', 'Yoo Hwan-joong', 'Yu Hwanjung', 'Yoo Hwanjoong', '유환중'],
    fullName: 'Yu Hwan-jung',
    nativeName: '유환중',
    role: 'support',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Rakan', 'Nautilus', 'Rell', 'Alistar', 'Renata Glasc'],
    careerHighlights: [
      'MSI 2026 champion with Hanwha Life Esports',
      'LCK 2024 Summer champion with Hanwha Life Esports',
      // DELETED 2026-08-13: the academy/debut path could not be sourced.
    ],
    referenceQueries: [
      'Delight Hanwha Life Esports LCK 2026 press photo',
      'Yu Hwan-jung Delight HLE portrait lolesports',
      'Delight Hanwha Life MSI 2026 champion support photo',
      'Delight HLE media day 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2023-11',
    tags: ['starter', 'msi-winner'],
  },
  {
    id: 'homme',
    handle: 'Homme',
    aliases: ['hle-homme', 'Yoon Sung-young', 'Yun Seong-yeong', '윤성영'],
    fullName: 'Yoon Sung-young',
    nativeName: '윤성영',
    role: 'coach',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: [],
    careerHighlights: [
      'Joined Hanwha Life Esports as head coach for the 2026 LCK season',
      'Head coach of Hanwha Life Esports through the MSI 2026 title run',
      // DELETED 2026-08-13: "Head coach for the LCK 2024 Summer championship
      // side" was FALSE. That title was won under Choi "DanDy" In-gyu; Homme was
      // at JD Gaming and then Top Esports, and only joined HLE for 2026.
      'Head coach of JD Gaming from 2018 to 2023, winning four LPL titles and MSI 2023',
      'Head coach of Top Esports from December 2024',
      'Played top lane for MVP White/MVP Ozone before moving to the bench in 2014',
    ],
    referenceQueries: [
      'Homme Hanwha Life head coach LCK 2026 press photo',
      'Yoon Sung-young Homme coach portrait lolesports',
      'Hanwha Life Esports coaching staff MSI 2026 photo',
    ],
    active: true,
    tags: ['coach', 'msi-winner'],
  },
  {
    id: 'viper',
    handle: 'Viper',
    aliases: ['hle-viper', 'Park Do-hyeon', 'Park Dohyeon', '박도현'],
    fullName: 'Park Do-hyeon',
    nativeName: '박도현',
    role: 'bot',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Aphelios', "Kai'Sa", 'Varus', 'Xayah', 'Zeri'],
    careerHighlights: [
      'World Champion 2021 with Edward Gaming',
      'LCK 2024 Summer champion with Hanwha Life Esports',
      'Three seasons as Hanwha Life’s bot laner (2023–2025) before returning to the LPL with Bilibili Gaming for 2026',
    ],
    referenceQueries: [
      'Viper Hanwha Life Esports LCK 2025 press photo',
      'Park Do-hyeon Viper portrait lolesports',
      'Viper HLE bot laner LCK media kit photo',
      'Viper EDG Worlds 2021 champion photo',
    ],
    active: false,
    tags: ['worlds-winner', 'former'],
  },
  {
    id: 'peanut',
    handle: 'Peanut',
    aliases: ['hle-peanut', 'Han Wang-ho', 'Han Wangho', '한왕호'],
    fullName: 'Han Wang-ho',
    nativeName: '한왕호',
    role: 'jungle',
    teamId: 'hle',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Sejuani', 'Maokai', 'Wukong', 'Lee Sin', 'Vi'],
    careerHighlights: [
      'MSI 2017 champion with SK Telecom T1; Worlds 2017 runner-up',
      'LCK 2024 Summer champion with Hanwha Life Esports',
      'Multiple-time LCK champion across SKT, Gen.G and Hanwha Life',
      // CORRECTED 2026-08-13: he did NOT stop playing in September 2025.
      'Announced in September 2025 that he would enlist for mandatory military service',
      'Played his final competitive match at Worlds 2025, in Hanwha Life’s quarter-final exit to Gen.G',
    ],
    referenceQueries: [
      'Peanut Hanwha Life Esports LCK 2025 press photo',
      'Han Wang-ho Peanut portrait lolesports',
      'Peanut HLE jungler LCK media kit photo',
      'Peanut Hanwha Life LCK 2024 Summer champion photo',
    ],
    active: false,
    tags: ['veteran', 'former'],
  },
];
