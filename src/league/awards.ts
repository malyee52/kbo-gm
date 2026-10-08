// 시즌 시상 (2026-10-08 사용자 요청): MVP, 신인상, 골든글러브, 타이틀 홀더.
// 시뮬레이션 기록으로 정한다. 투표가 없으므로 기준은 종합 가치(WAR 근사)와 KBO 규정타석·규정이닝이다. 가중치는 임시값.
import { defenseAt } from '../engine/defense';
import type { Season } from '../engine/season';
import type { BatLine, PitLine, SimPlayer, World } from '../engine/types';
import { fip, leagueBase, wraa, type LeagueBase } from '../game/saber';
import type { DataStore } from '../data/loadNode';
import type { LeaguePlayer, LeagueState } from './types';

type RealStore = Pick<DataStore, 'season'>;

export interface AwardWinner {
  id: string;
  name: string;
  team: number;
  /** 화면 표시용 기록 한 줄 */
  line: string;
  /** 종합 가치 (WAR 근사) */
  war: number;
}

export interface TitleAward {
  key: string;
  label: string;
  /** 공동 수상이 있을 수 있다 */
  winners: AwardWinner[];
  value: string;
}

export interface SeasonAwards {
  year: number;
  mvp: AwardWinner | null;
  rookie: AwardWinner | null;
  goldenGlove: { pos: GgPos; winner: AwardWinner }[];
  titles: TitleAward[];
}

export type GgPos = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH';
export const GG_LABEL: Record<GgPos, string> = { P: '투수', C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', OF: '외야수', DH: '지명타자' };
const GG_ORDER: GgPos[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];

/** 포지션 보정 (650타석당 런, 일반적인 세이버 값) */
const POS_ADJ: Record<string, number> = { C: 12.5, SS: 7.5, '2B': 2.5, '3B': 2.5, CF: 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5 };
const RUNS_PER_WIN = 10;
/** 대체 선수 수준: 타자 600타석당 20런, 투수는 이닝당 (임시값) */
const REPL_BAT_PER_PA = 20 / 600;
const REPL_PIT_PER_IP = 0.12;

const avg = (b: BatLine) => (b.ab > 0 ? b.h / b.ab : 0);
const obp = (b: BatLine) => { const d = b.ab + b.bb + b.hbp + b.sf; return d > 0 ? (b.h + b.bb + b.hbp) / d : 0; };
const slg = (b: BatLine) => (b.ab > 0 ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : 0);
const era = (p: PitLine) => (p.outs > 0 ? (p.er * 27) / p.outs : Infinity);
const ipText = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? ` ${outs % 3}/3` : ''}`;
const f3 = (x: number) => x.toFixed(3).replace(/^0/, '');

/** 그 선수의 주 수비 위치 (골든글러브 부문용). 내야(IF)는 수비가 가장 나은 자리로 */
function mainPos(p: SimPlayer): string {
  if (p.pos === 'IF') {
    const cands = ['1B', '2B', '3B', 'SS'];
    return cands.reduce((a, b) => (defenseAt(p, b) > defenseAt(p, a) ? b : a));
  }
  if (p.pos === 'OF') return 'CF';
  return p.pos ?? 'DH';
}

function batWar(p: SimPlayer, b: BatLine, lg: LeagueBase, teamGames: number): number {
  const pos = mainPos(p);
  const off = wraa(b, lg);
  const rep = REPL_BAT_PER_PA * b.pa;
  const adj = (POS_ADJ[pos] ?? 0) * (b.pa / 650);
  const def = pos === 'DH' ? 0 : defenseAt(p, pos) * Math.min(1, b.g / teamGames);
  return (off + rep + adj + def) / RUNS_PER_WIN;
}

function pitWar(p: PitLine, lg: LeagueBase, lgEra: number): number {
  if (p.outs === 0) return 0;
  const ip = p.outs / 3;
  // 평균자책과 FIP를 반씩 (투표 성향에 가깝게, 임시값)
  const ra = 0.5 * era(p) + 0.5 * fip(p, lg);
  return ((lgEra - ra) * ip / 9 + REPL_PIT_PER_IP * ip) / RUNS_PER_WIN;
}

function batLine(b: BatLine): string {
  return `타율 ${f3(avg(b))} · ${b.hr}홈런 · ${b.rbi}타점 · OPS ${f3(obp(b) + slg(b))}`;
}
function pitLine(p: PitLine): string {
  const base = `${ipText(p.outs)}이닝 · 평균자책 ${era(p).toFixed(2)} · ${p.so}탈삼진`;
  return p.gs > 0 ? `${p.w}승 ${p.l}패 · ${base}` : `${p.sv}세이브 · ${p.g}경기 · ${base}`;
}

/**
 * 시즌 시상. league는 이 시즌 기록이 history에 들어가기 전 상태여야 한다 (신인 자격 판정).
 */
export function seasonAwards(world: World, season: Season, league: LeagueState, store: RealStore): SeasonAwards {
  const year = world.year;
  const teamGames = Math.max(...season.teams.map((t) => t.g));
  const lg = leagueBase(season.bat, season.pit);
  let er = 0;
  let outs = 0;
  for (const p of season.pit) { er += p.er; outs += p.outs; }
  const lgEra = outs > 0 ? (er * 27) / outs : 4.5;
  const qualPa = Math.ceil(3.1 * teamGames);
  const qualOuts = 3 * teamGames;

  type Cand = { sp: SimPlayer; b: BatLine; p: PitLine; war: number; bat: boolean };
  const cands: Cand[] = [];
  for (const sp of world.players) {
    const b = season.bat[sp.idx];
    const p = season.pit[sp.idx];
    if (b.pa === 0 && p.bf === 0) continue;
    const bw = b.pa > 0 && !sp.isPitcher ? batWar(sp, b, lg, teamGames) : 0;
    const pw = pitWar(p, lg, lgEra);
    cands.push({ sp, b, p, war: sp.isPitcher ? pw : bw, bat: !sp.isPitcher });
  }
  const win = (c: Cand): AwardWinner => ({
    id: c.sp.id, name: c.sp.name, team: c.sp.teamIdx, war: Math.round(c.war * 100) / 100,
    line: c.bat ? batLine(c.b) : pitLine(c.p),
  });

  // ---- 타이틀 (KBO 공식 시상 부문)
  const titles: TitleAward[] = [];
  const title = (key: string, label: string, pool: Cand[], val: (c: Cand) => number, fmt: (x: number) => string, low = false) => {
    if (!pool.length) return;
    const best = pool.reduce((m, c) => (low ? Math.min(m, val(c)) : Math.max(m, val(c))), low ? Infinity : -Infinity);
    if (!Number.isFinite(best) || (!low && best <= 0)) return;
    const ws = pool.filter((c) => Math.abs(val(c) - best) < 1e-9);
    titles.push({ key, label, winners: ws.map(win), value: fmt(best) });
  };
  const bats = cands.filter((c) => c.bat);
  const qBats = bats.filter((c) => c.b.pa >= qualPa);
  const pits = cands.filter((c) => c.sp.isPitcher);
  const qPits = pits.filter((c) => c.p.outs >= qualOuts);
  title('avg', '타율', qBats, (c) => avg(c.b), f3);
  title('hr', '홈런', bats, (c) => c.b.hr, (x) => `${x}개`);
  title('rbi', '타점', bats, (c) => c.b.rbi, (x) => `${x}개`);
  title('r', '득점', bats, (c) => c.b.r, (x) => `${x}개`);
  title('h', '안타', bats, (c) => c.b.h, (x) => `${x}개`);
  title('sb', '도루', bats, (c) => c.b.sb, (x) => `${x}개`);
  title('obp', '출루율', qBats, (c) => obp(c.b), f3);
  title('slg', '장타율', qBats, (c) => slg(c.b), f3);
  title('w', '다승', pits, (c) => c.p.w, (x) => `${x}승`);
  title('era', '평균자책점', qPits, (c) => era(c.p), (x) => x.toFixed(2), true);
  title('so', '탈삼진', pits, (c) => c.p.so, (x) => `${x}개`);
  title('sv', '세이브', pits, (c) => c.p.sv, (x) => `${x}개`);
  // 승률: 10승 이상
  title('wpct', '승률', pits.filter((c) => c.p.w >= 10), (c) => c.p.w / (c.p.w + c.p.l), f3);

  // ---- MVP: 종합 가치 + 타이틀 하나당 0.3 (투표가 타이틀을 중시하는 경향, 임시값)
  const titleCount = new Map<string, number>();
  for (const t of titles) for (const w of t.winners) titleCount.set(w.id, (titleCount.get(w.id) ?? 0) + 1);
  const mvpScore = (c: Cand) => c.war + 0.3 * (titleCount.get(c.sp.id) ?? 0);
  const regular = cands.filter((c) => (c.bat ? c.b.pa >= qualPa : c.p.outs >= qualOuts || c.p.sv >= 20));
  const mvp = regular.length ? win(regular.reduce((a, b) => (mvpScore(b) > mvpScore(a) ? b : a))) : null;

  // ---- 신인상: KBO 규정 (입단 5년 이내, 이전 시즌까지 60타석·30이닝 이하), 외국인 제외
  const lp = new Map(league.players.map((p) => [p.id, p]));
  const rookieOk = (sp: SimPlayer) => {
    const p = lp.get(sp.id);
    if (!p || p.foreign) return false;
    return isRookie(p, year, realPrior(store, p.id, Math.min(year, league.startYear)));
  };
  const rookies = cands.filter((c) => rookieOk(c.sp) && (c.bat ? c.b.pa >= 100 : c.p.outs >= 90));
  const rookie = rookies.length ? win(rookies.reduce((a, b) => (b.war > a.war ? b : a))) : null;

  // ---- 골든글러브: 부문별 종합 가치 1위 (외야 3명). 수비수는 그 자리에서 팀 경기의 절반 이상, 지명타자는 규정타석의 2/3 이상, 투수는 규정이닝 또는 20세이브
  const goldenGlove: SeasonAwards['goldenGlove'] = [];
  for (const pos of GG_ORDER) {
    let pool: Cand[];
    if (pos === 'P') pool = pits.filter((c) => c.p.outs >= qualOuts || c.p.sv >= 20);
    else if (pos === 'DH') pool = bats.filter((c) => mainPos(c.sp) === 'DH' && c.b.pa >= qualPa * (2 / 3));
    else if (pos === 'OF') pool = bats.filter((c) => ['LF', 'CF', 'RF'].includes(mainPos(c.sp)) && c.b.g >= teamGames / 2);
    else pool = bats.filter((c) => mainPos(c.sp) === pos && c.b.g >= teamGames / 2);
    const sorted = [...pool].sort((a, b) => b.war - a.war);
    for (const c of sorted.slice(0, pos === 'OF' ? 3 : 1)) goldenGlove.push({ pos, winner: win(c) });
  }

  return { year, mvp, rookie, goldenGlove, titles };
}

type Prior = { year: number; pa: number; outs: number };

/** 게임 시작 전 실제 기록 (시작 연도 직전 10년만 본다: 그보다 앞서 뛰었으면 어차피 신인 자격 기간이 지났다) */
function realPrior(store: RealStore, id: string, before: number): Prior[] {
  const out: Prior[] = [];
  for (let y = Math.max(1982, before - 10); y < before; y++) {
    const sd = store.season(y);
    if (!sd) continue;
    const pa = sd.bat.filter((r) => r.id === id).reduce((s, r) => s + r.pa, 0);
    const outs = sd.pit.filter((r) => r.id === id).reduce((s, r) => s + r.outs, 0);
    if (pa > 0 || outs > 0) out.push({ year: y, pa, outs });
  }
  return out;
}

/** 신인 자격 (KBO 규정): 첫 1군 시즌부터 5년 이내이고, 이전 시즌까지 누적 60타석·30이닝 이하. real: 게임 시작 전 실제 기록 */
export function isRookie(p: LeaguePlayer, year: number, real: Prior[] = []): boolean {
  const prev: Prior[] = [
    ...real,
    ...p.history.filter((h) => h.year < year).map((h) => ({ year: h.year, pa: h.bat?.[1] ?? 0, outs: h.pit?.[5] ?? 0 })),
  ];
  const pa = prev.reduce((s, h) => s + h.pa, 0);
  const outs = prev.reduce((s, h) => s + h.outs, 0);
  const first = prev.filter((h) => h.pa > 0 || h.outs > 0).map((h) => h.year).sort((a, b) => a - b)[0];
  if (first !== undefined && year - first >= 5) return false;
  return pa <= 60 && outs <= 90;
}
