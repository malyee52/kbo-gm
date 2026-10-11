// 도전형 시나리오: 시즌 도전 30개(난이도 하·중·상)와 장기 캠페인 10개 (2026-10-12 사용자 기획안
// "KBO_도전형_시나리오_기획안.md"). 실제 구단의 그 시즌 개막에서 시작한다. 목표·기한·예산 조건은 게임용 설정이고,
// '실제 시즌 배경'은 기획안의 참고 문구다.
//
// 목표는 단계(stage)로 적는다. 마지막 단계가 최종 클리어 조건이고, 앞 단계는 "완전 클리어" 조건이다 (기획안 5.4):
//   - 최종 조건 달성 = 클리어. 모든 단계를 기한 안에 = 완전 클리어. 중간 단계 실패는 도전을 끝내지 않는다.
//   - 최종 조건을 더는 채울 수 없으면 실패. 어느 쪽이든 자유 플레이로 이어 간다.
// 자체 육성 주전 (기획안 5.2): 시작 때 우리 구단의 만 23세 이하 선수이거나 그 뒤 우리가 지명한 선수 가운데
//   그 시즌 300타석, 80이닝, 구원 40경기 가운데 하나를 넘긴 선수.

/** 한 시즌의 우리 구단 결과 (결산 때 남긴다) */
export interface SeasonMark {
  year: number;
  /** 정규시즌 순위 (1부터) */
  rank: number;
  teams: number;
  pct: number;
  ps: boolean;
  ks: boolean;
  champ: boolean;
  /** 자체 육성 주전 수 */
  home: number;
}

export type Metric =
  | { k: 'champ' } | { k: 'ks' } | { k: 'ps' } | { k: 'notLast' }
  | { k: 'rank'; n: number } | { k: 'pct'; v: number } | { k: 'home'; n: number };

export type Cond =
  /** 그 해에 */
  | { t: 'in'; year: number; m: Metric }
  /** 시작부터 그 해까지 한 번이라도 */
  | { t: 'by'; year: number; m: Metric }
  /** 기간 중 n번 이상 */
  | { t: 'count'; from: number; to: number; m: Metric; n: number }
  /** 기간 내내 */
  | { t: 'all'; from: number; to: number; m: Metric }
  /** 기간 중 한 시즌에 모두 */
  | { t: 'same'; from: number; to: number; ms: Metric[] };

export interface Stage {
  label: string;
  conds: Cond[];
}

export type Tier = '하' | '중' | '상' | '장기';

export interface PlanChallenge {
  id: string;
  tier: Tier;
  no: string;
  year: number;
  /** 계보 (meta.franchises 키) */
  franchise: string;
  title: string;
  background: string;
  fun: string;
  stages: Stage[];
  /** 우리 구단 연봉 상한: 게임 안 리그 평균 연봉(캡 계산 기준)의 비율 (넥센 캠페인 0.85) */
  budget?: number;
}

export const STAGE_STATUS = ['진행', '달성', '실패'] as const;
export type StageStatus = 0 | 1 | 2;

const champ: Metric = { k: 'champ' };
const ks: Metric = { k: 'ks' };
const ps: Metric = { k: 'ps' };
const rank = (n: number): Metric => ({ k: 'rank', n });
const pct = (v: number): Metric => ({ k: 'pct', v });
const home = (n: number): Metric => ({ k: 'home', n });

function metricText(m: Metric): string {
  switch (m.k) {
    case 'champ': return '한국시리즈 우승';
    case 'ks': return '한국시리즈 진출';
    case 'ps': return '포스트시즌 진출';
    case 'notLast': return '최하위 탈출';
    case 'rank': return `정규시즌 ${m.n}위 이내`;
    case 'pct': return `승률 ${m.v.toFixed(3).replace(/^0/, '')} 이상`;
    case 'home': return `자체 육성 주전 ${m.n}명`;
  }
}

export function condText(c: Cond): string {
  switch (c.t) {
    case 'in': return `${c.year}년 ${metricText(c.m)}`;
    case 'by': return `${c.year}년까지 ${metricText(c.m)}`;
    case 'count': return `${c.from}~${c.to}년 중 ${metricText(c.m).replace(' 진출', '')} ${c.n}회`;
    case 'all': return `${c.from}~${c.to}년 모두 ${metricText(c.m)}`;
    case 'same': return `${c.from}~${c.to}년 중 한 시즌에 ${c.ms.map(metricText).join(' + ')}`;
  }
}

// ---- 정의

type Short = [no: string, year: number, franchise: string, title: string, background: string, fun: string, ...stages: Stage[]];
const one = (label: string, ...conds: Cond[]): Stage => ({ label, conds });
const seasonGoal = (year: number, m: Metric) => one(`${year}년 ${metricText(m)}`, { t: 'in', year, m });
const byGoal = (year: number, m: Metric) => one(`${year}년까지 ${metricText(m)}`, { t: 'by', year, m });

const LOW: Short[] = [
  ['01', 2017, 'KIA', '호랑이 군단의 진격', '87승, 팀 타율 .302', '강타선을 활용하고 투수진 소모 관리', seasonGoal(2017, rank(3))],
  ['02', 2014, '삼성', '완성된 왕조의 지휘봉', '4년 연속 통합우승 완성', '선수단 컨디션과 역할 배분', seasonGoal(2014, ks)],
  ['03', 2023, 'LG', '우승 전력의 사용 설명서', '정규시즌 86승, 한국시리즈 우승', '충분한 전력을 안정적인 승수로 연결', seasonGoal(2023, rank(3))],
  ['04', 2016, '두산', '93승 군단을 맡다', '정규시즌 93승', '강한 선발진을 바탕으로 시즌 운영', seasonGoal(2016, rank(2))],
  ['05', 2008, 'SSG', '빈틈없는 야구', '83승 43패, 팀 평균자책점 3.22', '투수 교체와 수비 중심 경기 운영', seasonGoal(2008, ks)],
  ['06', 2021, 'KT', '정상에 설 준비', '창단 첫 통합우승', '안정적인 전력으로 장기 레이스 관리', seasonGoal(2021, ps)],
  ['07', 2020, 'NC', '공룡 타선의 힘', '83승, 팀 타율 .291', '타순과 주전 휴식 조정', seasonGoal(2020, rank(3))],
  ['08', 2011, '롯데', '거인의 방망이', '72승, 팀 타율 .288', '타선으로 투수진 부담 보완', seasonGoal(2011, ps)],
  ['09', 2006, '한화', '독수리의 황금 기회', '67승, 한국시리즈 준우승', '경쟁력 있는 투수진으로 승수 관리', seasonGoal(2006, ps)],
  ['10', 2015, '히어로즈', '목동의 마지막 불꽃', '78승, 팀 타율 .298', '공격력 중심의 경기 운영', seasonGoal(2015, ps)],
];
const MID: Short[] = [
  ['11', 2009, 'KIA', '명가의 부활', '1997년 이후 12년 만의 한국시리즈 우승', '우승 기회를 포착하고 단기전 전력 완성', seasonGoal(2009, champ)],
  ['12', 2002, '삼성', '마지막 한을 풀어라', '첫 한국시리즈 우승', '정규시즌 전력을 최종 우승으로 연결', seasonGoal(2002, champ)],
  ['13', 2013, 'LG', '다시 열린 가을', '2002년 이후 포스트시즌 복귀', '침체기를 끝낼 기용과 전력 보강', seasonGoal(2013, rank(2))],
  ['14', 2001, '두산', '미라클 베어스', '65승 63패 5무에서 한국시리즈 우승', '압도적이지 않은 전력으로 가을 대진 돌파', seasonGoal(2001, champ)],
  ['15', 2007, 'SSG', '왕조의 시작', '구단 첫 한국시리즈 우승', '역할 정립과 투수 운용 체계 완성', seasonGoal(2007, champ)],
  ['16', 2020, 'KT', '막내에게도 가을은 온다', '81승, 첫 포스트시즌 진출', '성장한 전력을 상위권 성적으로 연결', seasonGoal(2020, rank(3))],
  ['17', 2014, 'NC', '2년 차의 반란', '1군 진입 두 번째 시즌에 PS 진출', '얇은 선수층을 관리하며 경쟁', seasonGoal(2014, ps)],
  ['18', 2008, '롯데', '가을에도 야구하자', '8년 만의 포스트시즌 복귀', '기존 선수 조합으로 잠재력 실현', seasonGoal(2008, ps)],
  ['19', 2018, '한화', '11년의 기다림', '정규시즌 3위로 가을야구 복귀', '접전 승리와 불펜 체력 관리', seasonGoal(2018, rank(3))],
  ['20', 2014, '히어로즈', '영웅들의 첫 결승', '창단 첫 한국시리즈 진출', '강타선을 유지하며 투수진 보완', seasonGoal(2014, ks)],
];
const HIGH: Short[] = [
  ['21', 2007, 'KIA', '꼴찌 호랑이의 반격', '51승 74패 1무, 최하위', '즉시전력 보강과 유망주 육성 병행', byGoal(2008, ps), byGoal(2009, champ)],
  ['22', 2017, '삼성', '왕조의 잿더미에서', '55승 84패 5무, 9위', '취약한 투수진의 재건 순서 결정', byGoal(2019, ps)],
  ['23', 2006, 'LG', '암흑기를 끊어라', '47승 75패 4무, 최하위', '주축 유지와 선수단 교체 사이의 결단', byGoal(2008, ps)],
  ['24', 2022, '두산', '왕조 이후의 베어스', '60승 82패 2무, 9위', '경쟁력 회복과 세대교체 병행', byGoal(2024, ks)],
  ['25', 2000, 'SSG', '신생 비룡의 생존기', '창단 첫해 44승 86패 3무', '선수층 확충과 중심 선수 확보', byGoal(2002, ps)],
  ['26', 2015, 'KT', '제로에서 가을까지', '1군 첫해 52승 91패 1무', '실제보다 빠르게 신생팀 경쟁력 구축', byGoal(2017, ps)],
  ['27', 2018, 'NC', '추락한 공룡을 깨워라', '58승 85패 1무, 최하위', '회복 가능한 전력 선별과 필요한 부분 보강', byGoal(2019, ps), byGoal(2020, champ)],
  ['28', 2002, '롯데', '35승의 폐허', '35승 97패 1무, 승률 .265', '투타 전반의 약점을 단계적으로 해결', one('2003년 승률 .400 이상', { t: 'in', year: 2003, m: pct(0.4) }), byGoal(2005, ps)],
  ['29', 2020, '한화', '독수리 재건 계획', '46승 95패 3무, 시즌 중 18연패', '단기 성적과 유망주 경험 사이의 선택', byGoal(2022, ps)],
  ['30', 2011, '히어로즈', '꼴찌에서 영웅으로', '51승 80패 2무, 최하위', '성장할 선수 발굴과 핵심 전력 정착', byGoal(2013, ps), byGoal(2014, champ)],
];

const fin = (label: string, ...conds: Cond[]) => one(label, ...conds);
const LONG: Short[] = [
  ['L01', 2007, 'KIA', '다시, 타이거즈의 시대', '2007~2014, 8시즌', '하위권에서 우승 전력을 만들고 새로운 전성기로 연결',
    byGoal(2009, ps), byGoal(2011, champ),
    fin('2014년까지 누적 우승 2회, 마지막 3시즌 모두 PS 진출', { t: 'count', from: 2007, to: 2014, m: champ, n: 2 }, { t: 'all', from: 2012, to: 2014, m: ps })],
  ['L02', 2014, '삼성', '왕조의 유통기한', '2014~2023, 10시즌', '당장 우승하면서 주축 노쇠화 이후까지 준비',
    one('2014~2016년 중 우승 2회', { t: 'count', from: 2014, to: 2016, m: champ, n: 2 }),
    one('2017~2020년 중 PS 진출 3회', { t: 'count', from: 2017, to: 2020, m: ps, n: 3 }),
    fin('2021~2023년 중 우승 1회 + 2023년 자체 육성 주전 3명', { t: 'count', from: 2021, to: 2023, m: champ, n: 1 }, { t: 'in', year: 2023, m: home(3) })],
  ['L03', 2006, 'LG', '잠실의 긴 겨울', '2006~2015, 10시즌', '보강과 육성의 방향을 정해 지속적인 가을야구 팀 구축',
    byGoal(2008, pct(0.5)), byGoal(2011, ps),
    fin('2015년까지 우승 1회, 마지막 5시즌 중 PS 진출 3회', { t: 'count', from: 2006, to: 2015, m: champ, n: 1 }, { t: 'count', from: 2011, to: 2015, m: ps, n: 3 })],
  ['L04', 2022, '두산', '다음 세대의 베어스', '2022~2029, 8시즌', '경쟁력 회복과 자체 육성 선수로의 주전 교체',
    byGoal(2024, ps), byGoal(2026, ks),
    fin('2029년까지 우승 1회 + 우승 시즌 자체 육성 주전 4명', { t: 'same', from: 2022, to: 2029, ms: [champ, home(4)] })],
  ['L05', 2000, 'SSG', '비룡의 건국', '2000~2009, 10시즌', '신생팀 선수층 확보부터 우승 이후 경쟁력 유지까지',
    byGoal(2002, pct(0.45)), byGoal(2005, ks),
    fin('2009년까지 누적 우승 2회, 마지막 3시즌 모두 PS 진출', { t: 'count', from: 2000, to: 2009, m: champ, n: 2 }, { t: 'all', from: 2007, to: 2009, m: ps })],
  ['L06', 2015, 'KT', '열 번째 구단의 첫 왕조', '2015~2024, 10시즌', '신생팀의 첫 우승 이후 두 번째 우승에 도전',
    byGoal(2017, { k: 'notLast' }), byGoal(2020, ps),
    fin('2024년까지 누적 우승 2회 + 2024년 자체 육성 주전 4명', { t: 'count', from: 2015, to: 2024, m: champ, n: 2 }, { t: 'in', year: 2024, m: home(4) })],
  ['L07', 2018, 'NC', '공룡의 두 번째 진화', '2018~2024, 7시즌', '빠른 회복과 우승 이후 자체 육성 구조 확립',
    byGoal(2019, ps), byGoal(2021, champ),
    fin('2022~2024년 중 PS 진출 2회 + 2024년 자체 육성 주전 3명', { t: 'count', from: 2022, to: 2024, m: ps, n: 2 }, { t: 'in', year: 2024, m: home(3) })],
  ['L08', 2002, '롯데', '사직에 우승기를', '2002~2011, 10시즌', '긴 재건을 버티고 여러 해에 걸쳐 선수층 확보',
    byGoal(2004, pct(0.45)), byGoal(2007, ps),
    fin('2011년까지 우승 1회, 마지막 3시즌 모두 PS 진출', { t: 'count', from: 2002, to: 2011, m: champ, n: 1 }, { t: 'all', from: 2009, to: 2011, m: ps })],
  ['L09', 2020, '한화', '독수리의 성장 곡선', '2020~2029, 10시즌', '육성으로 기반을 만들고 적절한 시점에 우승 도전으로 전환',
    byGoal(2022, pct(0.45)), byGoal(2025, ps),
    fin('2029년까지 우승 1회(우승 시즌 자체 육성 주전 4명), 마지막 3시즌 PS 진출 2회',
      { t: 'same', from: 2020, to: 2029, ms: [champ, home(4)] }, { t: 'count', from: 2027, to: 2029, m: ps, n: 2 })],
  ['L10', 2011, '히어로즈', '영웅은 계속 태어난다', '2011~2018, 8시즌', '제한된 예산에서 주축이 떠나도 대체 선수가 올라오는 구조',
    byGoal(2013, ps), byGoal(2015, ks),
    fin('2018년까지 우승 1회(우승 시즌 자체 육성 주전 4명), 전체 기간 PS 진출 4회',
      { t: 'same', from: 2011, to: 2018, ms: [champ, home(4)] }, { t: 'count', from: 2011, to: 2018, m: ps, n: 4 })],
];

const build = (tier: Tier, list: Short[]): PlanChallenge[] => list.map(([no, year, franchise, title, background, fun, ...stages]) => ({
  id: `plan-${no.toLowerCase()}`, tier, no, year, franchise, title, background, fun, stages,
  ...(no === 'L10' ? { budget: 0.85 } : {}),
}));

export const PLAN_CHALLENGES: PlanChallenge[] = [...build('하', LOW), ...build('중', MID), ...build('상', HIGH), ...build('장기', LONG)];

export const planById = (id: string) => PLAN_CHALLENGES.find((c) => c.id === id);

/** 마지막으로 판정이 필요한 해 */
export function lastYear(c: Pick<PlanChallenge, 'year' | 'stages'>): number {
  let y = c.year;
  for (const s of c.stages) {
    for (const k of s.conds) y = Math.max(y, 'year' in k ? k.year : k.to);
  }
  return y;
}

// ---- 판정

function hit(m: Metric, s: SeasonMark): boolean {
  switch (m.k) {
    case 'champ': return s.champ;
    case 'ks': return s.ks;
    case 'ps': return s.ps;
    case 'notLast': return s.rank < s.teams;
    case 'rank': return s.rank <= m.n;
    case 'pct': return s.pct >= m.v - 1e-9;
    case 'home': return s.home >= m.n;
  }
}

/** 조건 하나: 1 달성, 2 실패, 0 아직. year = 방금 판정한 시즌 */
export function condStatus(c: Cond, marks: SeasonMark[], year: number): StageStatus {
  const at = (y: number) => marks.find((s) => s.year === y);
  switch (c.t) {
    case 'in': {
      if (year < c.year) return 0;
      const s = at(c.year);
      return s && hit(c.m, s) ? 1 : 2;
    }
    case 'by':
      if (marks.some((s) => s.year <= c.year && hit(c.m, s))) return 1;
      return year >= c.year ? 2 : 0;
    case 'count': {
      const n = marks.filter((s) => s.year >= c.from && s.year <= c.to && hit(c.m, s)).length;
      if (n >= c.n) return 1;
      const left = Math.max(0, c.to - Math.max(year, c.from - 1));
      return n + left < c.n ? 2 : 0;
    }
    case 'all': {
      if (marks.some((s) => s.year >= c.from && s.year <= c.to && !hit(c.m, s))) return 2;
      return year >= c.to ? 1 : 0;
    }
    case 'same':
      if (marks.some((s) => s.year >= c.from && s.year <= c.to && c.ms.every((m) => hit(m, s)))) return 1;
      return year >= c.to ? 2 : 0;
  }
}

export function stageStatus(st: Stage, marks: SeasonMark[], year: number): StageStatus {
  const xs = st.conds.map((c) => condStatus(c, marks, year));
  if (xs.includes(2)) return 2;
  return xs.every((x) => x === 1) ? 1 : 0;
}

/** 자체 육성 주전의 출전 기준 (기획안 5.2): 300타석, 80이닝(240아웃), 구원 40경기 */
export const HOMEGROWN = { pa: 300, outs: 240, relief: 40, age: 23 };
