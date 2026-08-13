/**
 * Dplus KIA (formerly DAMWON Gaming / DWG KIA) — LCK. Roster as of the 2026
 * LCK season.
 *
 * ROSTERS CHANGE. Re-verify before a season, after any trade window, and any
 * time a render surprises you. See `../roster.ts` for the full provenance
 * block and the re-verification procedure.
 *
 * sourcedAt: 2026-08-13
 * sources:
 *  - https://www.sheepesports.com/en/all/articles/lol-dplus-kia-s-completed-2026-lck-roster/en
 *  - https://www.sheepesports.com/us/lol/articles/lol-cvmax-promoted-dplus-kia-head-coach-for-2026/en
 *  - https://esportsworldcup.com/en/press-releases/dplus-kia-win-lol-at-ewc26
 *  - https://www.koreajoongangdaily.com/sports/dplus-kia-wins-esports-world-cup-league-of-legends-title/12780581
 *  - https://esports-news.co.uk/2025/11/24/dplus-kia-sign-former-t1-bot-laner/
 *  - https://liquipedia.net/leagueoflegends/Dplus
 */

import type { Player } from '@hexa/core';

export const DPLUS_PLAYERS: Player[] = [
  {
    id: 'siwoo',
    handle: 'Siwoo',
    aliases: ['dplus-siwoo', 'dk-siwoo', 'Jeon Si-woo', 'Jeon Siwoo', '전시우'],
    fullName: 'Jeon Si-woo',
    nativeName: '전시우',
    role: 'top',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Jax', 'Aatrox', 'Gnar', 'Renekton', "K'Sante"],
    careerHighlights: [
      'Esports World Cup 2026 champion with Dplus KIA',
      'Second consecutive season as Dplus KIA’s starting top laner',
    ],
    referenceQueries: [
      'Siwoo Dplus KIA LCK 2026 press photo',
      'Jeon Si-woo Siwoo Dplus KIA portrait lolesports',
      'Siwoo Dplus KIA Esports World Cup 2026 champion photo',
      'Siwoo Dplus KIA media day 2026 jersey portrait',
    ],
    active: true,
    joinedAt: '2024-11',
    tags: ['starter'],
  },
  {
    id: 'lucid',
    handle: 'Lucid',
    aliases: ['dplus-lucid', 'dk-lucid', 'Choi Yong-hyeok', 'Choi Yonghyeok', '최용혁'],
    fullName: 'Choi Yong-hyeok',
    nativeName: '최용혁',
    role: 'jungle',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Vi', 'Xin Zhao', 'Sejuani', 'Wukong', 'Maokai', 'Lee Sin'],
    careerHighlights: [
      'Esports World Cup 2026 champion with Dplus KIA',
      'Third season as Dplus KIA’s starting jungler; re-signed through 2027',
    ],
    referenceQueries: [
      'Lucid Dplus KIA LCK 2026 press photo',
      'Choi Yong-hyeok Lucid Dplus KIA portrait lolesports',
      'Lucid Dplus KIA Esports World Cup 2026 champion photo',
      'Lucid Dplus KIA jungler media kit 2026',
    ],
    active: true,
    joinedAt: '2023-11',
    tags: ['starter'],
  },
  {
    id: 'showmaker',
    handle: 'ShowMaker',
    aliases: ['dplus-showmaker', 'dk-showmaker', 'Showmaker', 'Heo Su', '허수'],
    fullName: 'Heo Su',
    nativeName: '허수',
    role: 'mid',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Sylas', 'LeBlanc', 'Twisted Fate', 'Zoe', 'Azir', 'Akali'],
    careerHighlights: [
      'World Champion 2020 with DAMWON Gaming',
      'Worlds 2021 runner-up; MSI 2021 runner-up',
      'Esports World Cup 2026 champion with Dplus KIA',
      'Multiple-time LCK champion and the franchise face of the DAMWON/Dplus organisation since 2019',
    ],
    referenceQueries: [
      'ShowMaker Dplus KIA LCK 2026 press photo',
      'Heo Su ShowMaker Dplus KIA portrait lolesports',
      'ShowMaker DAMWON Gaming Worlds 2020 champion photo',
      'ShowMaker Dplus KIA Esports World Cup 2026 trophy photo',
      'ShowMaker Dplus KIA media day 2026 jersey portrait',
    ],
    active: true,
    tags: ['starter', 'worlds-winner', 'veteran', 'faceofteam'],
  },
  {
    id: 'smash',
    handle: 'Smash',
    aliases: ['dplus-smash', 'dk-smash', 'Shin Geum-jae', 'Shin Geumjae', '신금재'],
    fullName: 'Shin Geum-jae',
    nativeName: '신금재',
    role: 'bot',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Jinx', "Kai'Sa", 'Ezreal', 'Varus', 'Ashe'],
    careerHighlights: [
      'Esports World Cup 2026 champion with Dplus KIA',
      'Five years inside the T1 organisation before joining Dplus KIA as a starter for 2026',
    ],
    referenceQueries: [
      'Smash Dplus KIA LCK 2026 press photo',
      'Shin Geum-jae Smash Dplus KIA portrait lolesports',
      'Smash Dplus KIA Esports World Cup 2026 champion photo',
      'Smash Dplus KIA bot laner signing announcement photo',
    ],
    active: true,
    joinedAt: '2025-11',
    tags: ['starter'],
  },
  {
    id: 'career',
    handle: 'Career',
    aliases: ['dplus-career', 'dk-career', 'Oh Hyeong-seok', 'Oh Hyeongseok', '오형석'],
    fullName: 'Oh Hyeong-seok',
    nativeName: '오형석',
    role: 'support',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Nautilus', 'Rell', 'Alistar', 'Rakan', 'Braum'],
    careerHighlights: [
      'Esports World Cup 2026 champion with Dplus KIA',
      'LCK Challengers League champion in 2025 with BNK FEARX Youth',
      'Made his LCK debut with Dplus KIA in 2026, replacing BeryL',
    ],
    referenceQueries: [
      'Career Dplus KIA LCK 2026 press photo',
      'Oh Hyeong-seok Career Dplus KIA support portrait lolesports',
      'Career Dplus KIA Esports World Cup 2026 champion photo',
      'Career Dplus KIA rookie support media kit 2026',
    ],
    active: true,
    joinedAt: '2025-11',
    tags: ['starter', 'rookie'],
  },
  {
    id: 'cvmax',
    handle: 'cvMax',
    aliases: ['dplus-cvmax', 'CvMax', 'Kim Dae-ho', 'Kim Daeho', '김대호'],
    fullName: 'Kim Dae-ho',
    nativeName: '김대호',
    role: 'coach',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: [],
    careerHighlights: [
      'Head coach of Dplus KIA for 2026, promoted from within the staff',
      'Esports World Cup 2026 winning head coach',
      'Previously head coach of Griffin and DRX; known for unorthodox drafting',
    ],
    referenceQueries: [
      'cvMax Dplus KIA head coach LCK 2026 press photo',
      'Kim Dae-ho cvMax coach portrait lolesports',
      'Dplus KIA coaching staff Esports World Cup 2026 photo',
    ],
    active: true,
    tags: ['coach'],
  },
  {
    id: 'beryl',
    handle: 'BeryL',
    aliases: ['dplus-beryl', 'Beryl', 'Cho Geon-hee', 'Cho Geonhee', '조건희'],
    fullName: 'Cho Geon-hee',
    nativeName: '조건희',
    role: 'support',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Leona', 'Bard', 'Pantheon', 'Rakan', 'Nautilus'],
    careerHighlights: [
      'World Champion 2020 with DAMWON Gaming',
      'Worlds 2021 runner-up; MSI 2021 runner-up',
      'Multiple-time LCK champion; returned to the DAMWON/Dplus organisation twice',
      'Left Dplus KIA ahead of the 2026 season',
    ],
    referenceQueries: [
      'BeryL Dplus KIA LCK 2025 press photo',
      'Cho Geon-hee BeryL portrait lolesports',
      'BeryL DAMWON Gaming Worlds 2020 champion photo',
      'BeryL Dplus KIA support media kit photo',
    ],
    active: false,
    tags: ['worlds-winner', 'veteran', 'former'],
  },
  {
    id: 'kellin',
    handle: 'Kellin',
    aliases: ['dplus-kellin', 'Kim Hyeong-gyu', 'Kim Hyeonggyu', '김형규'],
    fullName: 'Kim Hyeong-gyu',
    nativeName: '김형규',
    role: 'support',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: ['Nautilus', 'Rakan', 'Rell', 'Renata Glasc'],
    careerHighlights: [
      'Dplus KIA’s starting support in 2024, including their Worlds 2024 run',
      'Long LCK career including Sandbox Gaming and BNK FEARX',
    ],
    referenceQueries: [
      'Kellin Dplus KIA LCK 2024 press photo',
      'Kim Hyeong-gyu Kellin support portrait lolesports',
      'Kellin Dplus KIA Worlds 2024 photo',
    ],
    active: false,
    tags: ['former'],
  },
  {
    id: 'bengi',
    handle: 'Bengi',
    aliases: ['dplus-bengi', 'Bae Seong-woong', 'Bae Seongwoong', '배성웅'],
    fullName: 'Bae Seong-woong',
    nativeName: '배성웅',
    role: 'coach',
    teamId: 'dplus',
    region: 'KR',
    nationality: 'South Korea',
    signatureChampions: [],
    careerHighlights: [
      'World Champion 2013, 2015 and 2016 as SK Telecom T1’s jungler',
      'Head coach of T1 from 2022, then head coach of Dplus KIA for the 2025 season',
      'Parted ways with Dplus KIA in November 2025',
    ],
    referenceQueries: [
      'Bengi Dplus KIA head coach 2025 press photo',
      'Bae Seong-woong Bengi coach portrait lolesports',
      'Bengi SKT T1 Worlds champion jungler photo',
    ],
    active: false,
    tags: ['coach', 'worlds-winner', 'legend', 'former'],
  },
];
