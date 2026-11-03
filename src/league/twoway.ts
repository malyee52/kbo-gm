// 투타 겸업 (2026-10-13 사용자 요청 "오타니나 하현승 등의 이도류 선수 처리를 위한 개편", 결정: 구단이 역할 선택 + 오타니식,
// "오타니 등만 특별 취급할 수는 없다. 모든 선수가 해당 능력치를 가지게 하되 실제 능력치로 성장할 수 있는 것은 특정 몇몇만").
//
// - 모든 선수는 본업 반대쪽 능력(투수의 타격, 타자의 투구)을 갖는다 (alt.runs·alt.potential, 런 단위). 대부분은 20~26등급으로 낮고
//   잠재력도 거의 같아 자라지 않는다. 겸업 재능(twoWayTalent)이 있는 선수만 잠재력이 높다: 실제 지명 자료에 투타겸업으로 표기된 선수
//   (하현승·강백호·김건희 등), 가상 신인의 아주 드문 몇 명(1%).
// - 구단이 이도류로 쓰면(twoWay) 반대쪽 능력의 실제 능력치(alt.bat·alt.pit)를 만들어 둔다. 엔진은 그 선수를 본업 자리와 함께
//   반대쪽 자리 후보에도 넣는다 (engine/team.ts refreshActive): 투수는 지명타자로, 타자는 선발 투수 후보로. 기록·피로·부상은 한 선수로 이어진다.
//   투수 겸업은 등판한 날도 타석에 서고, 등판 다음 날은 타석에서 쉰다 (오타니식).
import { leagueQuality, Rng, type BatSkill, type PitSkill } from '../engine';
import type { ValueContext } from '../ai/value';
import { skillForRuns } from './growth';
import type { LeaguePlayer, LeagueState } from './types';

/** 반대쪽 능력: 지금·잠재력 (런, 현재 능력 currentRuns와 같은 단위). 이도류로 쓸 때만 실제 능력치(bat·pit)를 둔다 */
export interface AltAbility {
  runs: number;
  potential: number;
  bat?: BatSkill;
  pit?: PitSkill;
}

/** 등급(20~80) ↔ 런 (ui/grades.ts runsGrade의 거꾸로) */
export function runsForGradeAt(grade: number, year: number): number {
  return ((Math.max(20, Math.min(80, grade)) - 40) / (5 * leagueQuality(year)) + 0.49) / 0.108;
}
export function gradeAt(runs: number, year: number): number {
  return Math.max(20, Math.min(80, Math.round(40 + 5 * (-0.49 + 0.108 * runs) * leagueQuality(year))));
}

/** 투수의 타격 바탕 (리그 평균 비율, 느림, 수비는 지명타자만) */
const BAT_BASE: BatSkill = {
  so: 1, bb: 1, hbp: 1, hr: 1, s1: 1, d2: 1, t3: 1, sbAtt: 0.02, sbPct: 0.6, speed: 0.35, sample: 0,
  def: { C: -60, '1B': -15, '2B': -30, '3B': -25, SS: -35, LF: -18, CF: -28, RF: -20 },
};
/** 타자의 투구 바탕 (리그 평균 비율, 선발 체력은 낮게) */
const PIT_BASE: PitSkill = { so: 1, bb: 1, hbp: 1, hr: 1, hit: 1, stamina: 20, reliefStint: 4.5, startShare: 0.9, sample: 0 };

/** 겸업 재능이 있는 가상 신인 비율 */
export const VIRTUAL_TWO_WAY_SHARE = 0.01;

/** 반대쪽 능력 만들기 (선수 id로 고정된 운). talent면 잠재력이 높다 */
export function makeAlt(league: Pick<LeagueState, 'seed'>, p: Pick<LeaguePlayer, 'id'>, year: number, talent: boolean): AltAbility {
  const rng = new Rng(`${league.seed}/alt/${p.id}`);
  const now = talent ? rng.range(32, 42) : rng.range(20, 26);
  const pot = talent ? rng.range(52, 68) : now + rng.range(0, 3);
  return { runs: runsForGradeAt(now, year), potential: runsForGradeAt(pot, year) };
}

/** 반대쪽 능력이 없는 선수에게 만든다 (새 게임·새 선수·예전 저장) */
export function ensureAlts(league: LeagueState, year: number): void {
  for (const p of league.players) if (!p.alt) p.alt = makeAlt(league, p, year, !!p.twoWayTalent);
}

/** 이도류로 쓸 때의 실제 능력치 (반대쪽 런에 맞춘 바탕 능력) */
export function altSkillFor(p: LeaguePlayer, ctx: ValueContext, year: number): Pick<AltAbility, 'bat' | 'pit'> {
  const runs = p.alt?.runs ?? runsForGradeAt(22, year);
  const holder = { ...p, isPitcher: !p.isPitcher, pos: p.isPitcher ? 'DH' : null, bat: p.isPitcher ? BAT_BASE : null, pit: p.isPitcher ? null : PIT_BASE };
  const s = skillForRuns(holder, runs, ctx, year);
  return p.isPitcher ? { bat: s.bat! } : { pit: s.pit! };
}

/**
 * 반대쪽 능력 (없으면 개막 때 ensureAlts가 줄 값과 같은 값을 만들어 보여 준다, 상태는 바꾸지 않는다).
 * 오프시즌에 새로 계약한 외국인·지명 신인은 개막 전까지 alt가 없어 선수 창에 이도류 칸이 없었다 (2026-10-29 사용자 "외국인들 이도류 못하는 버그")
 */
export function altOf(league: Pick<LeagueState, 'seed'>, p: LeaguePlayer, year: number): AltAbility {
  return p.alt ?? makeAlt(league, p, year, !!p.twoWayTalent);
}

/** 이도류 켜기·끄기 (켜면 실제 능력치를 만든다). league를 주면 반대쪽 능력이 없는 선수에게 ensureAlts와 같은 값을 준다 */
export function setTwoWay(p: LeaguePlayer, on: boolean, ctx: ValueContext, year: number, league?: Pick<LeagueState, 'seed'>): void {
  if (!on) {
    delete p.twoWay;
    if (p.alt) { delete p.alt.bat; delete p.alt.pit; }
    return;
  }
  p.alt ??= league ? makeAlt(league, p, year, !!p.twoWayTalent) : { runs: runsForGradeAt(22, year), potential: runsForGradeAt(22, year) };
  p.twoWay = true;
  Object.assign(p.alt, altSkillFor(p, ctx, year));
}

/** AI 구단이 이도류로 쓸 만한가: 반대쪽 능력 45등급 이상 (리그 주전 평균에 가까움) */
export const AI_TWO_WAY_GRADE = 45;
