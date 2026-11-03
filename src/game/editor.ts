// 에디터 모드 보기 (docs/에디터_기획안.md E1, 2026-11-03 사용자 Q1~Q4).
// 숨긴 값(진짜 지금 능력·천장·갈래 천장·성장 성향 d·시기 τ·노쇠·슬럼프·혹사·컨디션·AI가 보는 천장·진짜 기여·진짜 전력·숨겨진 특수능력)을
// 꺼내는 곳은 이 파일 하나다. 에디터가 꺼져 있으면 모든 함수가 null을 돌려준다 (끄면 다시 숨김).
// 화면은 src/ui/editor/ 폴더만 이 파일을 부른다 (tests/editor.test.ts·hidden-values.test.ts가 검사).
// 보기만 하므로 상태를 바꾸지 않고 난수를 쓰지 않는다 (같은 판에서 몇 번 불러도 같은 값, 조회를 끼워도 진행 결과가 같다).
import { computeGrades, conditionOf, isStarterSkill, TRAIT_INFO, traitsOf, type DisplayGrades, type SimPlayer, type World } from '../engine';
import { currentRuns, teamStrength, type ValueContext } from '../ai/value';
import { aiPotential } from '../league/owner';
import { timingOf, ceilingFor } from '../league/branches';
import { runsOf } from '../league/growth';
import { condToday } from '../league/events';
import { gradeOfRuns } from '../fantasy/free';
import type { LeaguePlayer, MilitaryState } from '../league/types';
import { dollarText, wonText } from '../league/salary';
import { editWarnings, editYear, MILITARY_LABEL, type EditOp } from './editOps';
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
  /** 고치기 칸이 쓰는 지금 값 (E2) */
  edit: EditorEditBase;
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
}

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
        // 능력은 천장 위로 자라지 않는다: 지금 능력을 천장보다 높이면 천장도 같이 올린다 (기획안 3.2)
        const potAfter = op.potential ?? potG;
        if (op.now !== undefined && op.now > potAfter) op.potential = op.now;
        if (op.now === undefined && op.potential === undefined) break;
        if (op.now !== undefined) lines.push(`${lp.name} 지금 능력 ${nowG} → ${op.now}${lp.slump ? ' (슬럼프는 없앰)' : ''}`);
        if (op.potential !== undefined) lines.push(`${lp.name} 천장 ${potG} → ${op.potential}${raw.potential === undefined || raw.potential < op.potential ? ' (지금 능력에 맞춰 올림)' : ''}`);
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
        lines.push(`${lp.name} 연봉 ${money(lp, c.salary)} → ${money(lp, salary)}, 계약 ${c.until} → ${until} 시즌까지`);
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
