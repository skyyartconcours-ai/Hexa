/**
 * KT Rolster — LCK. The most volatile roster in this dataset; it changed twice
 * during the 2026 season and the second change was missing from the data until
 * the 2026-08-13 audit.
 *
 * What actually happened in 2026, in order:
 *  1. KT signed Aiming as starting AD carry and Ghost + Pollu as a rotating
 *     support pair.
 *  2. Ghost lost the support job during Spring to Lee "Effort" Sang-ho, called
 *     up from KT Challengers, and was later moved back to AD carry on the
 *     Challengers roster.
 *  3. Aiming was pulled from the active roster on 29 July 2026 over an internal
 *     dispute and traded to Kiwoom DRX for Jiwoo on 30 July 2026.
 *
 * The starting five recorded here is therefore PerfecT / Cuzz / Bdd / Jiwoo /
 * Effort. The previous version of this file had Pollu starting at support and
 * did not contain Effort at all.
 *
 * ROSTERS CHANGE, AND THIS ONE CHANGES FASTEST. Per-field provenance and
 * confidence live in `../verification.ts`. See `../README.md` for how to
 * re-verify.
 *
 * sourcedAt: 2026-08-13
 * sources:
 *  - https://www.sheepesports.com/en/all/articles/jiwoo-joins-kt-rolster-as-aiming-heads-the-other-way-to-kiwoom-drx/en
 *  - https://www.invenglobal.com/articles/24302/aiming-leaves-kt-rolster-for-krx-following-internal-conflict-traded-for-jiwoo
 *  - https://insider-gaming.com/kt-rolster-krx-aiming-jiwoo-swap/
 *  - https://www.sheepesports.com/en/all/articles/lol-lck-ghost-and-pollu-join-kt-rolster-as-supports/en
 *  - https://www.sheepesports.com/en/all/articles/kt-challengers-ghost-returns-to-adc-ahead-of-lck-cl-rounds-3-4/en
 *  - https://rft.gg/news/kt-rolster-ghost-adc-lck-2026
 *  - https://bo3.gg/lol/players/effort
 *  - https://esportsinsider.com/2025/11/kt-rolster-geng-deokdam-peter-canyon-departures
 *  - https://dotesports.com/league-of-legends/news/kt-rolster-are-your-2018-lck-summer-split-champions
 */

import type { Player } from '@hexa/core';

export const KT_PLAYERS: Player[] = [
  {
    id: 'perfect',
    handle: 'PerfecT',
    aliases: ['kt-perfect', 'Perfect', 'Lee Seung-min', 'Lee Seungmin', '이승민'],
    fullName: 'Lee Seung-min',
    nativeName: '이승민',
    role: 'top',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Jayce', 'Rumble', 'Gwen', "K'Sante", 'Aatrox'],
    careerHighlights: [
      'Worlds 2025 runner-up with KT Rolster',
      'KT Rolster’s starting top laner since 2024, re-signed for 2026',
    ],
    referenceQueries: [
      'PerfecT KT Rolster LCK 2026 press photo',
      'Lee Seung-min PerfecT KT portrait lolesports',
      'PerfecT KT Rolster Worlds 2025 finals stage photo',
      'PerfecT KT Rolster media day 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2023-11',
    tags: ['starter'],
  },
  {
    id: 'cuzz',
    handle: 'Cuzz',
    aliases: ['kt-cuzz', 'Mun U-chan', 'Moon Woo-chan', 'Mun Uchan', '문우찬'],
    fullName: 'Mun U-chan',
    nativeName: '문우찬',
    role: 'jungle',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Xin Zhao', 'Vi', 'Sejuani', 'Maokai', 'Wukong'],
    careerHighlights: [
      'Worlds 2025 runner-up with KT Rolster',
      'LCK veteran jungler; returned to KT for 2025 on a deal through 2027',
    ],
    referenceQueries: [
      'Cuzz KT Rolster LCK 2026 press photo',
      'Mun U-chan Cuzz KT portrait lolesports',
      'Cuzz KT Rolster Worlds 2025 stage photo jungler',
      'Cuzz KT Rolster media kit 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter', 'veteran'],
  },
  {
    id: 'bdd',
    handle: 'Bdd',
    aliases: ['kt-bdd', 'BDD', 'Gwak Bo-seong', 'Gwak Boseong', '곽보성'],
    fullName: 'Gwak Bo-seong',
    nativeName: '곽보성',
    role: 'mid',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Azir', 'Orianna', 'Corki', 'Taliyah', 'Syndra'],
    careerHighlights: [
      'Worlds 2025 runner-up with KT Rolster',
      'LCK 2017 Summer champion with Longzhu Gaming',
      'LCK 2017 Summer regular-season MVP',
      // DELETED 2026-08-13: an unsourced Worlds 2017 placement and an unsourced
      // All-Pro claim.
      'A fixture of the LCK since 2017',
    ],
    referenceQueries: [
      'Bdd KT Rolster LCK 2026 press photo',
      'Gwak Bo-seong Bdd KT portrait lolesports',
      'Bdd KT Rolster Worlds 2025 finals photo',
      'Bdd KT Rolster media day 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2022-11',
    tags: ['starter', 'veteran', 'faceofteam'],
  },
  {
    id: 'jiwoo',
    handle: 'Jiwoo',
    aliases: ['kt-jiwoo', 'Ruin', 'Jung Ji-woo', 'Jeong Ji-u', '정지우'],
    fullName: 'Jung Ji-woo',
    nativeName: '정지우',
    role: 'bot',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Ezreal', 'Jinx', "Kai'Sa", 'Ashe', 'Varus'],
    careerHighlights: [
      'LCK Challengers League 2022 Summer champion with Nongshim',
      'LCK starter with Nongshim RedForce and Kiwoom DRX before the July 2026 trade to KT Rolster',
      'Competed under the handle "Ruin" earlier in his career',
    ],
    referenceQueries: [
      'Jiwoo KT Rolster LCK 2026 press photo',
      'Jung Ji-woo Jiwoo bot laner portrait lolesports',
      'Jiwoo DRX LCK 2026 media kit photo',
      'Jiwoo KT Rolster trade announcement photo 2026',
    ],
    active: true,
    joinedAt: '2026-07-30',
    tags: ['starter'],
  },
  {
    id: 'pollu',
    handle: 'Pollu',
    aliases: ['kt-pollu', 'Oh Dong-gyu', 'Oh Donggyu', '오동규'],
    fullName: 'Oh Dong-gyu',
    nativeName: '오동규',
    role: 'support',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Rakan', 'Nautilus', 'Leona', 'Braum', 'Rell'],
    careerHighlights: [
      // CORRECTED 2026-08-13: was "Two LCK seasons with OKSavingsBank BRION
      // (2024–2025)". Sources give one LCK season, 2025, after a career inside
      // the BRO organisation.
      'Spent his whole career to date inside OKSavingsBank BRION; LCK debut season in 2025',
      'KeSPA Cup 2024 winner with BRION',
      'Signed to KT Rolster for 2026 as part of a two-support rotation with Ghost',
      // NOTE: neither half of that rotation held the job. Effort took the
      // starting support role during Spring 2026.
    ],
    referenceQueries: [
      'Pollu KT Rolster LCK 2026 press photo',
      'Oh Dong-gyu Pollu KT support portrait lolesports',
      'Pollu KT Rolster media day 2026 jersey photo',
      'Pollu BRION LCK 2025 press photo',
    ],
    active: true,
    joinedAt: '2025-11',
    // CORRECTED 2026-08-13: the 'starter' tag was removed. Pollu was signed as
    // half of a rotation, and Effort took the starting job during Spring 2026.
    tags: ['rookie'],
  },
  {
    // ADDED 2026-08-13. KT's actual starting support was missing from this
    // dataset entirely, which left a superseded Pollu/Ghost rotation on record.
    id: 'effort',
    handle: 'Effort',
    aliases: ['kt-effort', 'Lee Sang-ho', 'Lee Sangho', '이상호'],
    fullName: 'Lee Sang-ho',
    nativeName: '이상호',
    role: 'support',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Nautilus', 'Rakan', 'Rell', 'Alistar'],
    careerHighlights: [
      'Called up from KT Challengers during the 2026 season and took over the starting support role from Ghost',
      // Deliberately short. Nothing earlier in his career could be sourced in
      // the 2026-08-13 audit, and an absent honour beats an invented one.
    ],
    referenceQueries: [
      'Effort KT Rolster LCK 2026 press photo',
      'Lee Sang-ho Effort KT support portrait lolesports',
      'Effort KT Rolster support media kit 2026',
    ],
    active: true,
    joinedAt: '2026-04',
    tags: ['starter'],
  },
  {
    id: 'ghost',
    handle: 'Ghost',
    aliases: ['kt-ghost', 'Jang Yong-jun', 'Jang Yongjun', '장용준'],
    fullName: 'Jang Yong-jun',
    nativeName: '장용준',
    // CORRECTED 2026-08-13: was `role: 'support'`. He joined KT as a role-swapped
    // support for 2026, lost the job during Spring and was moved back to AD
    // carry on the KT Challengers roster. `role` records where he plays now.
    role: 'bot',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Ashe', 'Senna', 'Aphelios', 'Jhin', 'Ezreal'],
    careerHighlights: [
      'World Champion 2020 with DAMWON Gaming',
      'Worlds 2021 runner-up; MSI 2021 runner-up',
      'LCK 2020 Summer, 2021 Spring and 2021 Summer champion',
      'Joined KT Rolster for 2026, returning to Korea after three years abroad and role-swapping from bot lane to support',
      'Moved to the KT Challengers roster and back to AD carry during the 2026 season',
    ],
    referenceQueries: [
      'Ghost KT Rolster LCK 2026 press photo',
      'Jang Yong-jun Ghost KT portrait lolesports',
      'Ghost DAMWON Gaming Worlds 2020 champion photo',
      'Ghost KT Challengers 2026 bot laner photo',
    ],
    active: true,
    joinedAt: '2025-11',
    // CORRECTED 2026-08-13: 'substitute' removed — he is not on the main roster.
    tags: ['worlds-winner', 'veteran', 'academy'],
  },
  {
    id: 'score',
    handle: 'Score',
    aliases: ['kt-score', 'Go Dong-bin', 'Ko Dong-bin', '고동빈'],
    fullName: 'Go Dong-bin',
    nativeName: '고동빈',
    role: 'coach',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: [],
    careerHighlights: [
      // CORRECTED 2026-08-13: a "signed through 2026" contract length was
      // removed — coverage in the audit reports an extension to 2029, so the
      // original figure is at best stale.
      'Head coach of KT Rolster; led KT to the Worlds 2025 final',
      'LCK 2018 Summer champion as KT Rolster’s jungler, and the split MVP',
      'One of the longest-serving players in KT Rolster history before moving to the bench',
    ],
    referenceQueries: [
      'Score KT Rolster head coach LCK 2026 press photo',
      'Go Dong-bin Score coach portrait lolesports',
      'KT Rolster coaching staff Worlds 2025 photo',
    ],
    active: true,
    tags: ['coach'],
  },
  {
    id: 'aiming',
    handle: 'Aiming',
    aliases: ['kt-aiming', 'Kim Ha-ram', 'Kim Haram', '김하람'],
    fullName: 'Kim Ha-ram',
    nativeName: '김하람',
    role: 'bot',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Jinx', "Kai'Sa", 'Varus', 'Xayah', 'Ezreal'],
    careerHighlights: [
      // CORRECTED 2026-08-13: the 2018 org was Afreeca Freecs (renamed Kwangdong
      // Freecs later), and an "LCK 2018 Spring runner-up" line was deleted — the
      // placing is the team's and his part in it could not be sourced.
      'LCK debut in 2018 with Afreeca Freecs, now Kwangdong Freecs',
      'Two seasons with Dplus KIA (2024–2025) before returning to KT Rolster',
      'Signed by KT Rolster for 2026, pulled from the active roster on 29 July 2026 after an internal dispute and traded to Kiwoom DRX the following day',
    ],
    referenceQueries: [
      'Aiming KT Rolster LCK 2026 press photo',
      'Kim Ha-ram Aiming portrait lolesports',
      'Aiming Dplus KIA LCK 2025 media kit photo',
      'Aiming Kiwoom DRX 2026 announcement photo',
    ],
    active: false,
    tags: ['former', 'veteran'],
  },
  {
    id: 'deokdam',
    handle: 'deokdam',
    aliases: ['kt-deokdam', 'Deokdam', 'Seo Dae-gil', 'Seo Daegil', '서대길'],
    fullName: 'Seo Dae-gil',
    nativeName: '서대길',
    role: 'bot',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Caitlyn', "Kai'Sa", 'Ziggs', 'Varus', 'Ezreal'],
    careerHighlights: [
      'Worlds 2025 runner-up with KT Rolster',
      'KT Rolster’s starting bot laner in 2025 after a spell in the LPL with FunPlus Phoenix',
      'Left KT Rolster for DN Freecs, since rebranded DN SOOPers, ahead of the 2026 season',
    ],
    referenceQueries: [
      'deokdam KT Rolster Worlds 2025 press photo',
      'Seo Dae-gil deokdam portrait lolesports',
      'deokdam KT Rolster LCK 2025 media kit photo',
      'deokdam DN Freecs 2026 announcement photo',
    ],
    active: false,
    tags: ['former'],
  },
  {
    id: 'peter',
    handle: 'Peter',
    aliases: ['kt-peter', 'Jeong Yoon-su', 'Jung Yoon-su', '정윤수'],
    fullName: 'Jeong Yoon-su',
    nativeName: '정윤수',
    role: 'support',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Rakan', 'Nautilus', 'Alistar', 'Rell'],
    careerHighlights: [
      'Worlds 2025 runner-up with KT Rolster',
      'Left KT Rolster for DN Freecs, since rebranded DN SOOPers, ahead of the 2026 season, staying paired with deokdam',
    ],
    referenceQueries: [
      'Peter KT Rolster Worlds 2025 press photo',
      'Jeong Yoon-su Peter KT support portrait lolesports',
      'Peter KT Rolster LCK 2025 media kit photo',
    ],
    active: false,
    tags: ['former'],
  },
  {
    id: 'deft',
    handle: 'Deft',
    aliases: ['kt-deft', 'Kim Hyuk-kyu', 'Kim Hyukkyu', '김혁규'],
    fullName: 'Kim Hyuk-kyu',
    nativeName: '김혁규',
    role: 'bot',
    teamId: 'kt',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Ezreal', 'Caitlyn', 'Aphelios', 'Varus', 'Jinx'],
    careerHighlights: [
      'World Champion 2022 with DRX — the lowest seed ever to win the title',
      // DELETED 2026-08-13: an unsourced "highest career kill totals" claim.
      // Dplus KIA was missing from the team list; he joined them in Nov 2022.
      'A decade-long career across Samsung, EDward Gaming, KT Rolster, DRX and Dplus KIA',
      'Enlisted for mandatory military service in 2025, bidding farewell on stream',
    ],
    referenceQueries: [
      'Deft KT Rolster LCK press photo',
      'Kim Hyuk-kyu Deft portrait lolesports',
      'Deft DRX Worlds 2022 champion celebration photo',
      'Deft KT Rolster media kit photo',
    ],
    active: false,
    tags: ['worlds-winner', 'veteran', 'legend', 'former'],
  },
];
