// 에디터 모드 보기 (docs/에디터_기획안.md E1, 2026-11-03 사용자 Q1~Q4).
// 숨긴 값(진짜 지금 능력·천장·갈래 천장·성장 성향 d·시기 τ·노쇠·슬럼프·혹사·컨디션·AI가 보는 천장·진짜 기여·진짜 전력·숨겨진 특수능력)을
// 꺼내는 곳은 이 파일 하나다. 에디터가 꺼져 있으면 모든 함수가 null을 돌려준다 (끄면 다시 숨김).
// 화면은 src/ui/editor/ 폴더만 이 파일을 부른다 (tests/editor.test.ts·hidden-values.test.ts가 검사).
// 보기만 하므로 상태를 바꾸지 않고 난수를 쓰지 않는다 (같은 판에서 몇 번 불러도 같은 값, 조회를 끼워도 진행 결과가 같다).
// 고치기 미리보기(editorPreview, E2)도 상태를 바꾸지 않는다. 실제 고침은 session.editPlayer → 조작 edit·edit-off.
import { agingScale, computeGrades, conditionOf, isStarterSkill, TRAIT_INFO, traitsOf, type DisplayGrades, type SimPlayer, type World } from '../engine';
import { currentRuns, teamStrength, type ValueContext } from '../ai/value';
import { aiPotential } from '../league/owner';
import { BAT_BRANCHES, BAT_GOOD, PIT_BRANCHES, PIT_GOOD, timingOf, ceilingFor, type BranchCeiling } from '../league/branches';
import { fanLevel } from '../league/stadium';
import { pickOwner, PICK_MAX_ROUND, PICK_YEARS_AHEAD } from '../league/picks';
import { expectedGrowthRuns, runsOf } from '../league/growth';
import { capAtCeiling } from '../league/potential';
import { clampRule, ruleOf, RULE_DEFS, type RuleKey } from '../league/rules';
import { condToday } from '../league/events';
import { asiaEligible, firstOpenDraft, gradeOfRuns, MIN_JOIN_AGE, NAME_MAX } from '../fantasy/free';
import type { LeaguePlayer, MilitaryState } from '../league/types';
import { dollarText, wonText } from '../league/salary';
import { EDIT_CREATE_POS, editWarnings, editYear, isPlayerOp, MILITARY_LABEL, type EditOp } from './editOps';
import type { GuessSet } from '../league/scout';
import type { GameSession } from './session';

/** 등급 한 칸: 진짜 등급과 (있으면) 우리 스카우트 추측 */
export interface EditorGrade {
  key: string;
  label: string;
  /** 진짜 등급 (20~80) */
  value: number;
  /** 갈래 천장 등급 (선수 하나 보기에서만) */
  ceil?: number;
}

/** 표 한 줄 (모든 선수, Q3) */
export interface EditorRow {
  id: string;
  name: string;
  /** 월드 색인 (선수 상세를 열 수 있으면). 오프시즌 새 후보 등 월드에 없으면 null */
  idx: number | null;
  /** 구단 색인 (-1 = 소속 없음) */
  team: number;
  /** 소속 글 (구단 이름 또는 무소속·시장·드래프트 후보·외국인 후보·해외) */
  place: string;
  isPitcher: boolean;
  /** 포지션 약자 (투수는 SP·RP, 야수는 C 1B …) */
  pos: string;
  age: number | null;
  ageEstimated: boolean;
  real: boolean;
  foreign: boolean;
  /** 진짜 한 시즌 기여 (런, 시즌 중 지금 시즌, 오프시즌 다음 시즌) */
  nowRuns: number;
  /** 진짜 지금 등급 (런 → 20~80) */
  now: number;
  /** 진짜 종합 천장 (런·등급) */
  potRuns: number;
  pot: number;
  /** AI 구단이 보는 천장 (난이도 오차 포함, owner.ts aiPotential) */
  aiPotRuns: number;
  aiPot: number;
  /** 숨은 성장 성향 d (−1~1, 없으면 0으로 보는 값) */
  drive: number;
  driveSet: boolean;
  /** 시기 τ (해, + = 또래보다 늦게 큼). 저장에 없으면 시드로 다시 뽑는 값 */
  timing: number;
  /** 우리 스카우트가 보는 기여 (런·등급)와 천장 보고 문구 */
  guessRuns: number;
  guess: number;
  scoutPhrase: string | null;
  /** 숨겨진 특수능력 수 (Q4: 에디터에서만 보기) */
  traitCount: number;
}

/** 선수 하나 보기 (선수 상세 '에디터' 탭·에디터 화면 상세) */
export interface EditorPlayerView extends EditorRow {
  /** 진짜 갈래 등급과 갈래 천장 등급 (타자 컨택·파워·선구·주력, 투수 구위·제구·피홈런 억제·체력) */
  grades: EditorGrade[];
  /** 우리 스카우트 추측 (화면의 추측 칸과 같은 값) */
  guessSet: GuessSet | null;
  /** 조기 노쇠 (해, 노화 판정 때 더 먹은 나이) */
  decline: number;
  /** 다음 시즌 슬럼프 (능력 이동, 음수) */
  slump: number;
  /** 혹사지수 (시즌 중 지금 값, 오프시즌은 다음 개막 값) */
  overuse: number;
  /** 선수 컨디션 (시즌 중만): 낱말·사유와 효과 값 (−1~1) */
  condition: { text: string; value: number } | null;
  /** 숨겨진 특수능력 이름·효과 */
  traits: { label: string; note: string }[];
  /** 갈래별 능력·갈래 천장 (E3 고치기): 능력 비율을 갈래 등급(리그 주전 분포, 50 = 평균)으로 */
  branches: EditorBranch[];
  /** 고치기 칸이 쓰는 지금 값 (E2) */
  edit: EditorEditBase;
}

/** 갈래 하나 (능력치 v2 16-4a 갈래: 타자 so·bb·s1·d2·t3·hr, 투수 so·bb·hr·hit) */
export interface EditorBranch {
  key: string;
  label: string;
  /** 지금 갈래 등급 (20~80, 좋은 쪽이 높음) */
  value: number;
  /** 갈래 천장 등급 */
  ceil: number;
  /** 능력 비율 (리그 평균 대비 배율) */
  ratio: number;
  ceilRatio: number;
}

/** 구단 진짜 전력 */
export interface EditorTeam {
  idx: number;
  name: string;
  /** 진짜 전력 (런, ai/value.ts teamStrength) */
  strength: number;
  rank: number;
  /** 플레이어가 보는 전력 전망 (시즌 중, 세 단계) */
  outlook: string | null;
  /** 지금 자금 (만 원, 시즌 중 수입·지출 포함) */
  cash: number;
  /** 팬 만족도 (0~100, 없으면 null) */
  fans: number | null;
  /** 구단주 신뢰 (우리 구단만) */
  trust: number | null;
}

/** 갈래 이름 (훈련 화면 이름을 따른다) */
export const BRANCH_LABEL: Record<'bat' | 'pit', Record<string, string>> = {
  bat: { so: '맞히기', bb: '선구', s1: '컨택', d2: '2루타', t3: '3루타·주력', hr: '파워' },
  pit: { so: '구위', bb: '제구', hr: '장타 억제', hit: '타구 억제' },
};

const BAT_LABEL: [string, string][] = [['contact', '컨택'], ['power', '파워'], ['eye', '선구'], ['speed', '주력']];
const PIT_LABEL: [string, string][] = [['stuff', '구위'], ['control', '제구'], ['hrSuppression', '피홈런 억제'], ['stamina', '체력']];

/** 성장 성향 d 낱말 (5단계) */
export function driveWord(d: number): string {
  return d <= -0.6 ? '매우 느림' : d <= -0.2 ? '느림' : d < 0.2 ? '보통' : d < 0.6 ? '빠름' : '매우 빠름';
}

/** 시기 τ 문장 */
export function timingText(t: number): string {
  if (Math.abs(t) < 0.25) return '또래와 비슷한 때 큼';
  return `또래보다 ${Math.abs(t).toFixed(1)}년 ${t > 0 ? '늦게' : '일찍'} 큼`;
}

/** 지금 보는 판: 시즌 중은 이 시즌 월드, 오프시즌은 다음 시즌 보기 */
interface Frame {
  year: number;
  ctx: ValueContext;
  sim: Map<string, SimPlayer>;
  world: World;
  grades: DisplayGrades;
  off: boolean;
}

function frameOf(s: GameSession): Frame {
  if (s.phase === 'season') {
    return { year: s.world.year, ctx: s.values, sim: new Map(s.world.players.map((p) => [p.id, p])), world: s.world, grades: s.currentGrades(), off: false };
  }
  const v = s.offView();
  return { year: s.world.year + 1, ctx: v.ctx, sim: v.sim, world: { ...(v.world ?? s.world), players: [...v.sim.values()] }, grades: s.offGrades(), off: true };
}

/** 갈래 등급 눈금: 기준 집단(타자 가중 300타석·투수 200타자 이상) 능력 비율의 로그 평균·표준편차 */
type BranchScale = Record<string, { mean: number; sd: number; good: 1 | -1 }>;

function branchScale(f: Frame, pitcher: boolean): BranchScale {
  const keys: readonly string[] = pitcher ? PIT_BRANCHES : BAT_BRANCHES;
  const good = (pitcher ? PIT_GOOD : BAT_GOOD) as Record<string, 1 | -1>;
  const all = f.world.players.filter((p) => (pitcher ? p.isPitcher && p.pit : !p.isPitcher && p.bat));
  const ref = all.filter((p) => (pitcher ? p.pit!.sample >= 200 : p.bat!.sample >= 300));
  const pool = ref.length >= 20 ? ref : all;
  const out: BranchScale = {};
  for (const k of keys) {
    const xs = pool.map((p) => Math.log(Math.max(1e-6, (pitcher ? p.pit : p.bat)![k as 'so'])));
    const n = xs.length || 1;
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
    out[k] = { mean, sd, good: good[k] };
  }
  return out;
}

const clampG = (x: number) => Math.max(20, Math.min(80, Math.round(x)));
const branchGrade = (sc: BranchScale, k: string, x: number) => clampG(50 + (10 * sc[k].good * (Math.log(Math.max(1e-6, x)) - sc[k].mean)) / sc[k].sd);
const branchRatio = (sc: BranchScale, k: string, g: number) => Math.round(Math.exp(sc[k].mean + (sc[k].good * (clampG(g) - 50) * sc[k].sd) / 10) * 1e6) / 1e6;

/** 주 능력 쪽 (투수 = pit, 타자 = bat) 갈래 비율 */
function mainBranches(lp: LeaguePlayer): Record<string, number> | null {
  const sk = lp.isPitcher ? lp.pit : lp.bat;
  if (!sk) return null;
  const keys: readonly string[] = lp.isPitcher ? PIT_BRANCHES : BAT_BRANCHES;
  return Object.fromEntries(keys.map((k) => [k, (sk as unknown as Record<string, number>)[k]]));
}

function branchesOf(s: GameSession, f: Frame, lp: LeaguePlayer): EditorBranch[] {
  const now = mainBranches(lp);
  if (!now) return [];
  const side = lp.isPitcher ? 'pit' : 'bat';
  const sc = branchScale(f, lp.isPitcher);
  const c = ceilingFor(lp, f.ctx, f.year, s.league.seed, s.params)[side] as Record<string, number> | undefined;
  return Object.keys(now).map((k) => {
    const cr = c?.[k] ?? now[k];
    return { key: k, label: BRANCH_LABEL[side][k], value: branchGrade(sc, k, now[k]), ceil: branchGrade(sc, k, cr), ratio: now[k], ceilRatio: cr };
  });
}

/** 팬 만족도 (그날까지, 오프시즌은 지난 시즌 끝까지): 구장 화면과 같은 값 */
function fansNow(s: GameSession, team: number): number | null {
  if (!s.league.fans?.[team]) return null;
  return Math.round(fanLevel(s.league, team, s.year, s.phase === 'season' ? s.currentDay : undefined) * 10) / 10;
}

const signedWon = (man: number, year: number) => (man < 0 ? `−${wonText(-man, year)}` : wonText(man, year));

function placeOf(s: GameSession, lp: LeaguePlayer, sim: SimPlayer | undefined): { team: number; place: string } {
  const team = s.phase === 'season' && sim ? sim.teamIdx : lp.team;
  if (team >= 0) return { team, place: s.teamInfo(team).name };
  const off = s.offseason;
  if (off?.draft?.pool.includes(lp.id)) return { team, place: '드래프트 후보' };
  if (off?.foreign?.pool.includes(lp.id)) return { team, place: '외국인 후보' };
  if (lp.abroad) return { team, place: '해외' };
  if (lp.market !== undefined) return { team, place: '시장' };
  return { team, place: '무소속' };
}

function rowOf(s: GameSession, f: Frame, lp: LeaguePlayer): EditorRow {
  const sim = f.sim.get(lp.id);
  const { team, place } = placeOf(s, lp, sim);
  const nowRuns = sim ? currentRuns(sim, f.ctx) : runsOf(lp, f.ctx, f.year);
  const aiPotRuns = aiPotential(s.league, lp);
  const guessRuns = s.seenRuns(lp.id);
  const age = lp.birthYear ? f.year - lp.birthYear : null;
  const pos = lp.isPitcher ? (isStarterSkill(lp.pit) ? 'SP' : 'RP') : (lp.pos ?? '-');
  return {
    id: lp.id, name: lp.name, idx: s.phase === 'season' ? (sim?.idx ?? null) : (s.world.players.find((p) => p.id === lp.id)?.idx ?? null),
    team, place, isPitcher: lp.isPitcher, pos, age, ageEstimated: lp.birthYearEstimated === true, real: lp.real, foreign: lp.foreign,
    nowRuns, now: gradeOfRuns(nowRuns, f.year), potRuns: lp.potential, pot: gradeOfRuns(lp.potential, f.year),
    aiPotRuns, aiPot: gradeOfRuns(aiPotRuns, f.year),
    drive: lp.drive ?? 0, driveSet: lp.drive !== undefined, timing: lp.timing ?? timingOf(s.league.seed, lp.id, false, s.params),
    guessRuns, guess: gradeOfRuns(guessRuns, f.year), scoutPhrase: s.scoutPhrase(lp.id),
    traitCount: traitsOf(s.store.traits, lp.id)?.length ?? 0,
  };
}

/** 표에 넣을 선수: 리그의 모든 선수 (자유 모드 빈 자리는 뺀다) */
function editorPlayers(s: GameSession): LeaguePlayer[] {
  return s.league.players.filter((p) => p.reserve === undefined && (p.bat || p.pit));
}

/** 모든 선수의 표 줄. 에디터가 꺼져 있으면 null */
export function editorRows(s: GameSession): EditorRow[] | null {
  if (!s.editorOn) return null;
  const f = frameOf(s);
  return editorPlayers(s).map((lp) => rowOf(s, f, lp));
}

/** 선수 하나의 숨긴 값 전부. 에디터가 꺼져 있거나 선수가 없으면 null */
export function editorView(s: GameSession, id: string): EditorPlayerView | null {
  if (!s.editorOn) return null;
  const lp = s.leaguePlayer(id);
  if (!lp || (!lp.bat && !lp.pit)) return null;
  const f = frameOf(s);
  const row = rowOf(s, f, lp);
  const sim = f.sim.get(id);
  // 갈래 천장 등급: 갈래 천장 모양을 입힌 그림자 선수를 같은 눈금(표본 0이라 기준 집단 밖)으로 잰다
  let grades: EditorGrade[] = [];
  let ceilGrades: DisplayGrades | null = null;
  if (sim) {
    const c = ceilingFor(lp, f.ctx, f.year, s.league.seed, s.params);
    const ghostId = `${id}#editor-ceil`;
    const ghost: SimPlayer = {
      ...sim, id: ghostId,
      bat: sim.bat && c.bat ? { ...sim.bat, ...c.bat, sample: 0 } : sim.bat,
      pit: sim.pit && c.pit ? { ...sim.pit, ...c.pit, sample: 0 } : sim.pit,
    };
    ceilGrades = computeGrades({ ...f.world, players: [...f.world.players, ghost] });
    const pick = (g: DisplayGrades, key: string) => {
      const m = (lp.isPitcher ? g.pitchers.get(key === 'self' ? id : ghostId) : g.batters.get(key === 'self' ? id : ghostId)) as unknown as Record<string, number | null> | undefined;
      return m;
    };
    const trueG = pick(f.grades, 'self');
    const ceilG = pick(ceilGrades, 'ceil');
    if (trueG) {
      grades = (lp.isPitcher ? PIT_LABEL : BAT_LABEL).map(([key, label]) => {
        const v = key === 'stamina' ? (trueG.stamina ?? trueG.reliefStamina) : trueG[key];
        const cv = ceilG ? (key === 'stamina' ? (ceilG.stamina ?? ceilG.reliefStamina) : ceilG[key]) : null;
        // 체력·주력은 갈래 천장에 없다 (자라지 않는 값)
        const grows = key !== 'stamina' && key !== 'speed';
        return { key, label, value: v ?? 50, ...(grows && cv !== null && cv !== undefined ? { ceil: Math.max(cv, v ?? 50) } : {}) };
      });
    }
  }
  let condition: EditorPlayerView['condition'] = null;
  if (s.phase === 'season' && sim && sim.teamIdx >= 0) {
    const se = s.season;
    const day = Math.min(se.day, se.schedule.length - 1);
    const ev = condToday(s.league, s.world.year, day, s.world.players);
    condition = { text: s.conditionText(sim.idx), value: Math.round(conditionOf(se.conditionFlow(sim.idx, day), ev?.value[sim.idx] ?? 0) * 100) / 100 };
  }
  const overuse = s.phase === 'season' && sim ? (s.season.states.overuse?.[sim.idx] ?? 0) : (lp.overuse ?? 0);
  return {
    ...row,
    grades,
    guessSet: s.guessSet(id, f.grades),
    decline: lp.decline ?? 0,
    slump: lp.slump ?? 0,
    overuse: Math.round(overuse * 100) / 100,
    condition,
    traits: (traitsOf(s.store.traits, id) ?? []).map((t) => ({ label: TRAIT_INFO[t].label, note: TRAIT_INFO[t].note })),
    branches: branchesOf(s, f, lp),
    edit: editBase(s, lp, sim),
  };
}

/** 구단별 진짜 전력과 순위. 에디터가 꺼져 있으면 null */
export function editorTeams(s: GameSession): EditorTeam[] | null {
  if (!s.editorOn) return null;
  const off = s.phase !== 'season';
  const v = off ? s.offView() : null;
  const orgs = off ? v!.orgs : s.world.teams.map((t) => t.org);
  const ctx = off ? v!.ctx : s.values;
  const str = orgs.map((org) => teamStrength(org, ctx, 0));
  const outlook = off ? null : s.strengthOutlook();
  return str.map((x, i) => ({
    idx: i, name: s.teamInfo(i).name, strength: Math.round(x * 10) / 10,
    rank: 1 + str.filter((w, j) => w > x || (w === x && j < i)).length,
    outlook: outlook?.[i] ?? null,
    cash: s.cashNow(i), fans: fansNow(s, i), trust: i === s.teamIdx ? (s.league.owner?.trust ?? null) : null,
  }));
}

/** 고치기 칸이 쓰는 지금 값 (숨긴 값이 아닌 것: 생년·계약·병역·부상) */
export interface EditorEditBase {
  /** 고침이 쓰는 기준 시즌 (시즌 중 = 이 시즌, 오프시즌 = 다음 시즌) */
  year: number;
  birthYear: number | null;
  /** 연봉 (만 원, 외국인은 달러). 계약이 없으면 null */
  salary: number | null;
  until: number | null;
  military: MilitaryState | null;
  /** 병역을 고칠 수 있나 (국내 선수, 복무 중이 아님) */
  militaryEditable: boolean;
  militaryText: string | null;
  /** 지금 부상 (낫게 하기 대상). 이탈 이벤트·병역 결장은 아님 */
  injury: { text: string; days: number } | null;
}

const MILITARY_TEXT: Record<MilitaryState, string> = { pending: '미필', serving: '복무 중', homeOnly: '방위병 복무 중', done: '마침', exempt: '면제' };

function editBase(s: GameSession, lp: LeaguePlayer, sim: SimPlayer | undefined): EditorEditBase {
  const st = lp.military?.state ?? null;
  return {
    year: editYear(s), birthYear: lp.birthYear, salary: lp.contract ? lp.contract.salary : null, until: lp.contract ? lp.contract.until : null,
    military: st, militaryEditable: !lp.foreign && st !== 'serving' && st !== 'homeOnly', militaryText: st ? MILITARY_TEXT[st] : null,
    injury: s.injuryNow(lp.id, sim),
  };
}

/** 고치기 미리보기: 다듬은 조작·대상 이름·"전 → 후" 문장·규정 경고 (Q5). 에디터가 꺼져 있으면 null */
export interface EditorPreview {
  ops: EditOp[];
  names: string[];
  lines: string[];
  warnings: string[];
  /** 고칠 수 없는 까닭 (있으면 저장하지 않는다) */
  error?: string;
}

export function editorPreview(s: GameSession, input: EditOp[]): EditorPreview | null {
  if (!s.editorOn) return null;
  const f = frameOf(s);
  const year = f.year;
  const ops: EditOp[] = [];
  const lines: string[] = [];
  const names: string[] = [];
  const fail = (error: string): EditorPreview => ({ ops: [], names, lines, warnings: [], error });
  const money = (lp: LeaguePlayer, v: number) => (lp.foreign ? dollarText(v) : wonText(v, year));
  for (const raw of input) {
    if (!isPlayerOp(raw)) {
      const r = teamPreview(s, raw, year);
      if (typeof r === 'string') return fail(r);
      if (!r) continue;
      if (!names.includes(r.name)) names.push(r.name);
      lines.push(r.line);
      ops.push(r.op);
      continue;
    }
    const lp = s.leaguePlayer(raw.player);
    if (!lp || (!lp.bat && !lp.pit)) return fail('고칠 선수를 찾을 수 없습니다.');
    if (!names.includes(lp.name)) names.push(lp.name);
    const sim = f.sim.get(lp.id);
    switch (raw.op) {
      case 'ability': {
        const nowG = gradeOfRuns(sim ? currentRuns(sim, f.ctx) : runsOf(lp, f.ctx, year), year);
        const potG = gradeOfRuns(lp.potential, year);
        const clampG = (x: number) => Math.max(20, Math.min(80, Math.round(x)));
        const op: Extract<EditOp, { op: 'ability' }> = { op: 'ability', player: lp.id };
        if (raw.now !== undefined) op.now = clampG(raw.now);
        if (raw.potential !== undefined) op.potential = clampG(raw.potential);
        // 능력은 천장 위로 자라지 않는다: 지금 능력을 천장보다 높이면 천장도 같이 올리고, 천장은 지금 능력 아래로 내리지 않는다 (기획안 3.2)
        const nowAfter = op.now ?? nowG;
        if ((op.potential ?? potG) < nowAfter) op.potential = nowAfter;
        if (op.potential === potG && raw.potential !== undefined && raw.now === undefined) return fail(`천장은 지금 능력(${nowG})보다 낮출 수 없습니다.`);
        if (op.now === undefined && op.potential === undefined) break;
        if (op.now !== undefined) lines.push(`${lp.name} 지금 능력 ${nowG} → ${op.now}${lp.slump ? ' (슬럼프는 없앰)' : ''}`);
        if (op.potential !== undefined) lines.push(`${lp.name} 천장 ${potG} → ${op.potential}${raw.potential === undefined || raw.potential < op.potential ? ' (지금 능력보다 낮을 수 없어 맞춤)' : ''}`);
        ops.push(op);
        break;
      }
      case 'birth': {
        const b = Math.round(raw.birthYear);
        if (!Number.isFinite(b) || b > year - 10 || b < year - 70) return fail(`생년은 ${year - 70}~${year - 10}년 사이로 넣습니다.`);
        const was = lp.birthYear;
        lines.push(`${lp.name} 생년 ${was ?? '모름'} → ${b} (나이 ${was ? `${lp.birthYearEstimated ? '약 ' : ''}${year - was}세` : '모름'} → ${year - b}세)`);
        ops.push({ op: 'birth', player: lp.id, birthYear: b });
        break;
      }
      case 'move': {
        if (raw.to !== -1 && !s.league.teams[raw.to]) return fail('없는 구단입니다.');
        const from = s.phase === 'season' && sim ? sim.teamIdx : lp.team;
        if (from === raw.to) break;
        if (s.phase === 'season' && !sim) return fail('이번 시즌 선수단에 없는 선수라 시즌 중에는 옮길 수 없습니다 (오프시즌에).');
        const nameOf = (t: number) => (t >= 0 ? s.teamInfo(t).name : '소속 없음');
        lines.push(`${lp.name} 소속 ${nameOf(from)} → ${nameOf(raw.to)}`);
        ops.push({ op: 'move', player: lp.id, to: raw.to });
        break;
      }
      case 'contract': {
        const salary = Math.max(0, Math.round(raw.salary));
        const years = Math.round(raw.years);
        if (!Number.isFinite(salary) || !Number.isFinite(years) || years < 1 || years > 15) return fail(`계약 끝 시즌은 ${year}~${year + 14}년 사이로 넣습니다.`);
        const c = lp.contract;
        const until = year + years - 1;
        const pay = salary === c.salary ? `연봉 ${money(lp, salary)} 그대로` : `연봉 ${money(lp, c.salary)} → ${money(lp, salary)}`;
        lines.push(`${lp.name} ${pay}, 계약 ${c.until === until ? `${until} 시즌까지 그대로` : `${c.until} → ${until} 시즌까지`}`);
        ops.push({ op: 'contract', player: lp.id, salary, years });
        break;
      }
      case 'military': {
        const st = lp.military?.state;
        if (lp.foreign) return fail('외국인 선수는 병역이 없습니다.');
        if (st === 'serving' || st === 'homeOnly') return fail('복무 중인 선수의 병역은 고칠 수 없습니다.');
        if (!(raw.state in MILITARY_LABEL)) return fail('없는 병역 상태입니다.');
        if (st === raw.state) break;
        lines.push(`${lp.name} 병역 ${st ? MILITARY_TEXT[st] : '모름'} → ${MILITARY_LABEL[raw.state]}`);
        ops.push({ op: 'military', player: lp.id, state: raw.state });
        break;
      }
      case 'branch': {
        const r = branchPreview(s, f, lp, raw);
        if (typeof r === 'string') return fail(r);
        if (!r) break;
        lines.push(...r.lines);
        ops.push(r.op);
        break;
      }
      case 'grow': {
        const op: Extract<EditOp, { op: 'grow' }> = { op: 'grow', player: lp.id };
        const d0 = lp.drive ?? 0;
        const t0 = lp.timing ?? timingOf(s.league.seed, lp.id, false, s.params);
        const span = s.params.growth2.tauSpan;
        if (raw.drive !== undefined && Number.isFinite(raw.drive)) {
          const d = Math.round(Math.max(-1, Math.min(1, raw.drive)) * 100) / 100;
          if (d !== d0 || lp.drive === undefined) {
            op.drive = d;
            lines.push(`${lp.name} 성장 성향 ${driveWord(d0)} ${sgn(d0, 2)} → ${driveWord(d)} ${sgn(d, 2)}${raw.drive !== d ? ' (−1~1로 맞춤)' : ''}`);
          }
        }
        if (raw.timing !== undefined && Number.isFinite(raw.timing)) {
          const t = Math.round(Math.max(-span, Math.min(span, raw.timing)) * 100) / 100;
          if (t !== t0 || lp.timing === undefined) {
            op.timing = t;
            lines.push(`${lp.name} 성장 시기 τ ${sgn(t0, 2)} → ${sgn(t, 2)}년 (${timingText(t)})${raw.timing !== t ? ` (±${span}년으로 맞춤)` : ''}`);
          }
        }
        if (op.drive === undefined && op.timing === undefined) break;
        ops.push(op);
        break;
      }
      case 'heal': {
        const inj = s.injuryNow(lp.id, sim);
        if (!inj) return fail(`${lp.name}은(는) 부상 중이 아닙니다.`);
        lines.push(`${lp.name} 부상 (${inj.text}, ${inj.days}일 남음) → 나음`);
        ops.push({ op: 'heal', player: lp.id });
        break;
      }
    }
  }
  if (!ops.length) return { ops, names, lines, warnings: [], error: '바뀌는 값이 없습니다.' };
  return { ops, names, lines, warnings: editWarnings(s, ops) };
}

const sgn = (x: number, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

/**
 * 갈래 고치기 미리보기 (E3): 갈래 등급 → 능력 비율. 규칙 (기획안 E3 "갈래 고침 뒤 천장 규칙"):
 * - 갈래 천장은 지금 갈래보다 나쁠 수 없다: 지금 갈래를 천장 위로 올리면 그 갈래 천장도 같이 올리고, 천장만 지금 아래로 내리면 오류.
 * - 종합 천장은 갈래 천장 모양의 종합 런이 바뀐 만큼 옮기고, 지금 종합보다 낮지 않게 맞춘다.
 * 결과(비율·갈래 천장 전체·종합 천장)를 조작에 담아 적용은 값을 그대로 넣는다 (난수·환경 맞춤 없음)
 */
function branchPreview(s: GameSession, f: Frame, lp: LeaguePlayer, raw: Extract<EditOp, { op: 'branch' }>):
  { op: EditOp; lines: string[] } | string | null {
  const now0 = mainBranches(lp);
  if (!now0) return '이 선수는 갈래 능력이 없습니다.';
  const side = lp.isPitcher ? 'pit' : 'bat';
  const label = BRANCH_LABEL[side];
  const sc = branchScale(f, lp.isPitcher);
  const year = f.year;
  const ceil0 = ceilingFor(lp, f.ctx, year, s.league.seed, s.params);
  const c0 = { ...((ceil0[side] as Record<string, number> | undefined) ?? now0) };
  const nowR: Record<string, number> = {};
  const ceilR: Record<string, number> = { ...c0 };
  const lines: string[] = [];
  // 화면은 등급(nowGrade·ceilGrade)으로, 이미 푼 조작(now·ceil, 미리보기 결과를 다시 넘긴 것)은 비율 그대로 받는다
  const rawCeil = raw.ceil?.[side] as Record<string, number> | undefined;
  for (const k of Object.keys(now0)) {
    const ng = raw.nowGrade?.[k];
    if (ng !== undefined && Number.isFinite(ng)) { if (clampG(ng) !== branchGrade(sc, k, now0[k])) nowR[k] = branchRatio(sc, k, ng); }
    else if (raw.now?.[k] !== undefined && raw.now[k] > 0 && raw.now[k] !== now0[k]) nowR[k] = raw.now[k];
    const cg = raw.ceilGrade?.[k];
    if (cg !== undefined && Number.isFinite(cg)) { if (clampG(cg) !== branchGrade(sc, k, c0[k])) ceilR[k] = branchRatio(sc, k, cg); }
    else if (rawCeil?.[k] !== undefined && rawCeil[k] > 0) ceilR[k] = rawCeil[k];
  }
  const lifted = new Set<string>();
  for (const k of Object.keys(now0)) {
    const nk = nowR[k] ?? now0[k];
    // 반올림(1e-6) 차이는 같은 값으로 본다
    if (sc[k].good * (Math.log(ceilR[k]) - Math.log(nk)) >= -1e-6) continue;
    // 천장만 지금 아래로 내렸다 → 오류. 지금을 천장 위로 올렸다(또는 원래 위였다) → 갈래 천장을 지금으로
    if (nowR[k] === undefined && ceilR[k] !== c0[k]) return `${label[k]} 갈래 천장은 지금(${branchGrade(sc, k, nk)})보다 낮출 수 없습니다.`;
    ceilR[k] = nk;
    if (nowR[k] !== undefined) lifted.add(k);
  }
  const same = (a: number, b: number) => Math.abs(Math.log(a) - Math.log(b)) < 1e-6;
  for (const k of Object.keys(now0)) if (same(ceilR[k], c0[k])) ceilR[k] = c0[k];
  const ceilChanged = Object.keys(now0).some((k) => ceilR[k] !== c0[k]);
  if (!Object.keys(nowR).length && !ceilChanged) return null;
  const withSide = (base: LeaguePlayer, v: Record<string, number>) => ({ ...base, [side]: { ...(base[side] as object), ...v } }) as LeaguePlayer;
  const after = withSide(lp, nowR);
  const nowRuns = runsOf(after, f.ctx, year);
  const shift = runsOf(withSide(after, ceilR), f.ctx, year) - runsOf(withSide(lp, c0), f.ctx, year);
  const potential = Math.round(Math.max(lp.potential + shift, nowRuns) * 1000) / 1000;
  const ceil: BranchCeiling = { ...ceil0, pa: potential, [side]: ceilR };
  for (const k of Object.keys(nowR)) lines.push(`${lp.name} ${label[k]} ${branchGrade(sc, k, now0[k])} → ${branchGrade(sc, k, nowR[k])}${lp.slump ? ' (슬럼프는 없앰)' : ''}`);
  for (const k of Object.keys(now0)) {
    if (ceilR[k] === c0[k]) continue;
    lines.push(`${lp.name} ${label[k]} 천장 ${branchGrade(sc, k, c0[k])} → ${branchGrade(sc, k, ceilR[k])}${lifted.has(k) ? ' (지금보다 낮을 수 없어 맞춤)' : ''}`);
  }
  const p0 = gradeOfRuns(lp.potential, year);
  const p1 = gradeOfRuns(potential, year);
  lines.push(`${lp.name} 종합 천장 ${p0} → ${p1} (${sgn(lp.potential)} → ${sgn(potential)}런)`);
  return { op: { op: 'branch', player: lp.id, ...(Object.keys(nowR).length ? { now: nowR } : {}), ceil, potential }, lines };
}

/** 구단 고치기 미리보기 (E3): 자금·팬·신뢰·지명권. 바뀌는 값이 없으면 null, 안 되면 까닭 */
function teamPreview(s: GameSession, raw: Exclude<EditOp, { player: string }>, year: number): { op: EditOp; name: string; line: string } | string | null {
  const L = s.league;
  const teamName = (t: number) => s.teamInfo(t).name;
  switch (raw.op) {
    case 'cash': {
      if (!L.teams[raw.team]) return '없는 구단입니다.';
      const amount = Math.round(raw.amount);
      if (!Number.isFinite(amount) || !amount) return null;
      const before = s.cashNow(raw.team);
      return { op: { op: 'cash', team: raw.team, amount }, name: teamName(raw.team),
        line: `${teamName(raw.team)} 자금 ${signedWon(before, year)} → ${signedWon(before + amount, year)}` };
    }
    case 'fans': {
      const before = fansNow(s, raw.team);
      if (before === null) return '팬 만족도가 없는 구단입니다.';
      const after = Math.round(Math.max(0, Math.min(100, before + raw.delta)) * 10) / 10;
      const delta = Math.round((after - before) * 10) / 10;
      if (!delta) return null;
      return { op: { op: 'fans', team: raw.team, delta }, name: teamName(raw.team), line: `${teamName(raw.team)} 팬 만족도 ${before} → ${after}` };
    }
    case 'trust': {
      const before = L.owner?.trust ?? 50;
      const v = Math.round(Math.max(0, Math.min(100, raw.value)));
      if (!Number.isFinite(v) || v === before) return null;
      return { op: { op: 'trust', value: v }, name: teamName(s.teamIdx), line: `${teamName(s.teamIdx)} 구단주 신뢰 ${before} → ${v}` };
    }
    case 'create': return createPreview(s, raw, year);
    case 'rule': {
      const def = RULE_DEFS.find((d) => d.key === raw.key);
      if (!def) return '없는 규정입니다.';
      const nullable = raw.key === 'foreignRegular' || raw.key === 'foreignAsia';
      if (raw.value === null && !nullable) return `${def.label}은(는) 숫자로 넣습니다.`;
      if (raw.value !== null && !Number.isFinite(raw.value)) return `${def.label}은(는) 숫자로 넣습니다.`;
      const v = raw.value === null ? null : clampRule(raw.key, raw.value);
      const before = ruleOf(L, raw.key);
      if (before === v) return null;
      const fit = raw.value !== null && v !== raw.value ? ` (${def.min}~${def.max} 범위로 맞춤)` : '';
      return { op: { op: 'rule', key: raw.key, value: v }, name: '리그 규정',
        line: `규정 ${def.label} ${ruleText(raw.key, before)} → ${ruleText(raw.key, v)}${fit}` };
    }
    case 'pick': {
      const pv = editorPicks(s);
      if (!pv) return null;
      if (!pv.drafts.includes(raw.draft)) return `고칠 수 있는 지명권은 ${pv.drafts.join('·')} 드래프트입니다.`;
      if (raw.round < 1 || raw.round > pv.rounds) return `라운드는 1~${pv.rounds}입니다.`;
      if (!pv.teams.includes(raw.from) || !pv.teams.includes(raw.to)) return '없는 구단입니다.';
      const before = pickOwner(L, raw);
      if (before === raw.to) return null;
      return { op: { op: 'pick', draft: raw.draft, round: raw.round, from: raw.from, to: raw.to }, name: teamName(raw.from),
        line: `${raw.draft} 드래프트 ${raw.round}라운드 (${teamName(raw.from)} 원래) 주인 ${teamName(before)} → ${teamName(raw.to)}` };
    }
  }
  return null;
}

/** 지명권 고치기 범위와 지금 주인 (E3 구단 탭). 에디터가 꺼져 있으면 null */
export function editorPicks(s: GameSession): { drafts: number[]; rounds: number; teams: number[]; moved: { draft: number; round: number; from: number; owner: number }[] } | null {
  if (!s.editorOn) return null;
  const L = s.league;
  const teams = L.teams.map((_, i) => i).filter((i) => s.phase !== 'season' || !!s.world.teams[i]);
  const first = firstOpenDraft(s);
  const drafts: number[] = [];
  for (let d = first; d <= first - 1 + PICK_YEARS_AHEAD; d++) drafts.push(d);
  const moved = (L.pickOwners ?? []).filter((x) => drafts.includes(x.draft)).map((x) => ({ draft: x.draft, round: x.round, from: x.from, owner: x.owner }))
    .sort((a, b) => a.draft - b.draft || a.round - b.round || a.from - b.from);
  return { drafts, rounds: PICK_MAX_ROUND, teams, moved };
}

/** 표 일괄 고침 종류 (E3, 기획안 6.2): 천장 ±n, 지금 능력 = n, 부상 낫게, 성장 성향 = d */
export type BulkKind = 'pot' | 'now' | 'heal' | 'drive';

/**
 * 체크한 선수들에게 같은 고침을 내는 조작 묶음 (조작 하나로 기록). 바뀌지 않는 선수는 뺀다
 * (천장이 이미 끝·지금 능력과 같음, 부상 아님 등). 에디터가 꺼져 있으면 빈 묶음
 */
export function editorBulkOps(s: GameSession, ids: string[], kind: BulkKind, value: number): EditOp[] {
  if (!s.editorOn || !Number.isFinite(value)) return [];
  const f = frameOf(s);
  const out: EditOp[] = [];
  for (const id of ids) {
    const lp = s.leaguePlayer(id);
    if (!lp || (!lp.bat && !lp.pit)) continue;
    const r = rowOf(s, f, lp);
    if (kind === 'pot') {
      const pot = Math.max(r.now, clampG(r.pot + value));
      if (pot !== r.pot) out.push({ op: 'ability', player: id, potential: pot });
    } else if (kind === 'now') {
      if (clampG(value) !== r.now) out.push({ op: 'ability', player: id, now: clampG(value) });
    } else if (kind === 'heal') {
      if (s.injuryNow(id, f.sim.get(id))) out.push({ op: 'heal', player: id });
    } else {
      const d = Math.round(Math.max(-1, Math.min(1, value)) * 100) / 100;
      if (d !== r.drive || !r.driveSet) out.push({ op: 'grow', player: id, drive: d });
    }
  }
  return out;
}

/** 에디터 grow 조작 적용 (숨은 성장 성향 d·시기 τ를 쓰는 곳은 이 파일 하나, session.applyEdits가 부른다) */
export function applyGrow(lp: LeaguePlayer, op: Extract<EditOp, { op: 'grow' }>): void {
  if (op.drive !== undefined) lp.drive = op.drive;
  if (op.timing !== undefined) lp.timing = op.timing;
}

/** 규정 값 글 (실제 규정 = null, 월일·달러·배율) */
export function ruleText(key: RuleKey, v: number | null): string {
  if (v === null) return '실제 규정';
  const def = RULE_DEFS.find((d) => d.key === key)!;
  if (key === 'tradeDeadline' || key === 'marketDeadline') return `${Math.floor(v / 100)}월 ${v % 100}일`;
  if (key === 'foreignPosting') return v ? '켬' : '끔';
  if (def.unit === '달러') return dollarText(v);
  return `${v}${def.unit}`;
}

/** 규정 표 한 줄 (E4 규정 탭) */
export interface EditorRuleRow {
  key: RuleKey;
  label: string;
  /** 지금 값 (null = 실제 규정) */
  value: number | null;
  /** 바꾼 규정인가 (league.rules에 있음) */
  changed: boolean;
  min: number;
  max: number;
  unit: string;
  /** '실제 규정'(null)으로 돌릴 수 있나 (외국인 보유 한도·아시아쿼터) */
  nullable: boolean;
}

/** 리그 규정 표 (E4 규정 탭): 지금 값·범위. 에디터가 꺼져 있으면 null */
export function editorRules(s: GameSession): EditorRuleRow[] | null {
  if (!s.editorOn) return null;
  return RULE_DEFS.map((d) => ({
    key: d.key, label: d.label, value: ruleOf(s.league, d.key), changed: s.league.rules?.[d.key] !== undefined, min: d.min, max: d.max, unit: d.unit,
    nullable: d.key === 'foreignRegular' || d.key === 'foreignAsia',
  }));
}

/**
 * 선수 만들기 미리보기 (E4, 오프시즌만): 자유 모드 create처럼 이름(NAME_MAX자)·국적으로 아시아쿼터 대상·병역(28세 이상이면 마침)을 정한다.
 * 늘 가상 선수. 값은 범위 안으로 맞추고 맞춘 것을 문장에 적는다
 */
function createPreview(s: GameSession, raw: Extract<EditOp, { op: 'create' }>, year: number): { op: EditOp; name: string; line: string } | string {
  if (s.phase === 'season') return '선수 만들기는 오프시즌에만 됩니다 (시즌 중에는 선수단 빈 자리가 없습니다).';
  const name = (raw.name ?? '').trim();
  if (!name) return '이름을 넣습니다.';
  if (name.length > NAME_MAX) return `이름은 ${NAME_MAX}자까지입니다.`;
  if (!s.league.teams[raw.team]) return '없는 구단입니다.';
  if (!EDIT_CREATE_POS.includes(raw.pos)) return '없는 포지션입니다.';
  if (![raw.age, raw.now, raw.potential].every(Number.isFinite)) return '나이·능력·천장은 숫자로 넣습니다.';
  const fits: string[] = [];
  const age = Math.max(MIN_JOIN_AGE, Math.min(50, Math.round(raw.age)));
  if (age !== raw.age) fits.push(`나이 ${MIN_JOIN_AGE}~50세로 맞춤`);
  const now = clampG(raw.now);
  let pot = clampG(raw.potential);
  if (now !== raw.now || pot !== raw.potential) fits.push('등급 20~80으로 맞춤');
  if (pot < now) { pot = now; fits.push('천장은 지금 능력보다 낮을 수 없어 맞춤'); }
  const foreign = raw.foreign === true;
  const nation = foreign ? (raw.nation ?? '').trim() : '';
  const asia = foreign && asiaEligible(nation || undefined, name);
  const military = foreign ? undefined : raw.military ?? (age >= 28 ? 'done' : 'pending');
  const role = raw.pos === 'P' ? (raw.role ?? 'SP') : undefined;
  const op: Extract<EditOp, { op: 'create' }> = { op: 'create', name, team: raw.team, pos: raw.pos, ...(role ? { role } : {}), age, now, potential: pot,
    ...(foreign ? { foreign: true } : {}), ...(nation ? { nation } : {}), ...(asia ? { asia: true } : {}), ...(military ? { military } : {}) };
  let pay = foreign ? '외국인 기본 계약' : '신인 계약 (최저 연봉, 3시즌)';
  if (raw.salary !== undefined || raw.years !== undefined) {
    const salary = Math.max(0, Math.round(raw.salary ?? 0));
    const yrs = Math.round(raw.years ?? 1);
    if (!Number.isFinite(salary) || !Number.isFinite(yrs) || yrs < 1 || yrs > 15) return '계약 기간은 1~15시즌입니다.';
    op.salary = salary;
    op.years = yrs;
    pay = `연봉 ${foreign ? dollarText(salary) : wonText(salary, year)}, ${year + yrs - 1} 시즌까지`;
  }
  const posText = raw.pos === 'P' ? (role === 'RP' ? '구원 투수' : '선발 투수') : raw.pos;
  const who = foreign ? `외국인${nation ? ` ${nation}` : ''}${asia ? ', 아시아쿼터 대상 (자리가 비면 아시아쿼터)' : ''}` : `국내, 병역 ${MILITARY_LABEL[military!]}`;
  return { op, name, line: `새 가상 선수 ${name}: ${s.teamInfo(raw.team).name} ${posText}, ${year}년 ${age}세, 지금 ${now} · 천장 ${pot} (${who}), ${pay}${fits.length ? ` (${fits.join(', ')})` : ''}` };
}

/** 성장 곡선 한 점 (그 시즌 기대 능력) */
export interface EditorCurvePoint {
  year: number;
  age: number;
  runs: number;
  grade: number;
}

/** 성장 곡선 미리보기 (E4): 그 선수의 진짜 성장 판정 식을 난수 없이 기대값으로 몇 해 앞까지 */
export interface EditorCurve {
  /** 가정한 1군 출전 기회 (0~1) */
  share: number;
  potRuns: number;
  pot: number;
  /** 첫 점 = 지금 보는 시즌 (슬럼프 뺀 바탕 능력), 그 뒤 해마다 결산 성장 뒤 */
  points: EditorCurvePoint[];
}

/** 성장 곡선이 내다보는 해 수 */
export const CURVE_YEARS = 6;

/**
 * 성장 곡선 미리보기: 결산 성장 판정(league/growth.ts growthRuns)과 같은 식에서 운을 빼고 터지는 해를 확률만큼 섞은 기대값(expectedGrowthRuns),
 * 천장에서 자름(capAtCeiling). 숨은 성향 d·시기 τ·조기 노쇠·노화 특수능력을 쓴다. 코치·육성 투자·퓨처스 활약·부상·훈련·은퇴·입대는 넣지 않는다.
 * 등급은 지금 보는 시즌 눈금. 상태를 바꾸지 않는다. 에디터가 꺼져 있거나 나이를 모르면 null
 */
export function editorGrowthCurve(s: GameSession, id: string, share = 1, years = CURVE_YEARS): EditorCurve | null {
  if (!s.editorOn) return null;
  const lp = s.leaguePlayer(id);
  if (!lp || (!lp.bat && !lp.pit) || !lp.birthYear) return null;
  const f = frameOf(s);
  const aging = agingScale(traitsOf(s.store.traits, lp.id), s.params.traits);
  const timing = lp.timing ?? timingOf(s.league.seed, lp.id, false, s.params);
  let runs = runsOf(lp, f.ctx, f.year);
  const pts: EditorCurvePoint[] = [{ year: f.year, age: f.year - lp.birthYear, runs, grade: gradeOfRuns(runs, f.year) }];
  for (let k = 1; k <= years; k++) {
    const y = f.year + k;
    const age = y - lp.birthYear + (lp.decline ?? 0);
    const next = expectedGrowthRuns(age, runs, lp.potential, share, lp.isPitcher, aging, lp.drive, s.params.potential, timing, s.params.growth2);
    runs = capAtCeiling(next, runs, lp.potential);
    pts.push({ year: y, age: y - lp.birthYear, runs, grade: gradeOfRuns(runs, f.year) });
  }
  return { share, potRuns: lp.potential, pot: gradeOfRuns(lp.potential, f.year), points: pts };
}
