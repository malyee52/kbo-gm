// 퓨처스리그 (2군) 간단 모델 (docs/roadmap.md 2장 3단계, 2026-10-11 사용자 결정: 경기를 한 타석씩 돌리지 않고 능력으로 성적을 만든다).
//
// 2군 경기 수 = (구단이 치른 1군 경기 − 그 선수가 1군에 있던 경기 − 결장한 경기) × FUT_GAME_RATIO.
// 출전 몫은 그 구단 2군 안의 순위로 (주전급 2군 야수는 매 경기 4타석, 2군 선발은 로테이션 5명 ...).
// 결과는 능력(리그 평균 대비 비율)을 2군 수준의 평균 상대와 맞붙인 기대값에, 선수마다 시즌 운(시드)을 곱한다.
// 필요할 때 계산하므로(재정 seasonFlows처럼) 저장할 것이 없고, 며칠씩 나눠 진행해도 결과가 같다.
// 창단 뒤 1군 진입 전 퓨처스 구단은 시즌 월드에 없어 아직 성적을 만들지 않는다.

import { Rng, type Season, type SimPlayer, type World } from '../engine';

/** 1군 경기 수 대비 퓨처스리그 경기 수 (임시값: 1군 144경기, 퓨처스 약 115경기) */
export const FUT_GAME_RATIO = 0.8;

/**
 * 퓨처스리그 환경: 1군 리그 비율 대비 (임시값. 퓨처스리그는 타율 .270 안팎, 평균자책 4.8 안팎).
 * 2군 선수끼리 붙으므로 능력은 "2군 선수 평균 대비"로 다시 잰다 (모두 1군 평균보다 약해 그대로 쓰면 리그 전체가 낮게 나온다)
 */
const FUT_ENV = { so: 0.98, bb: 1.08, hbp: 1.1, hr: 0.8, s1: 1.05, d2: 1.0, t3: 1.2 };
/** 경기당 한 팀 타석 (득점·실점을 같은 양으로 맞출 때) */
const PA_PER_GAME = 38;

/** 2군 안 순위별 출전: 야수 경기당 타석, 투수 */
const HIT_PA = [4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 3.8, 2.0, 1.8, 1.5, 1.2, 1.0];
const HIT_PA_REST = 0.4;
const ROT = 5;
const RELIEF_APPS = 0.4;
const RELIEVERS = 8;
const PIT_REST_APPS = 0.08;

export interface FuturesBat { g: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; so: number }
export interface FuturesPit { g: number; gs: number; outs: number; bf: number; h: number; hr: number; bb: number; so: number; r: number; er: number }
export interface FuturesLine { idx: number; teamIdx: number; bat?: FuturesBat; pit?: FuturesPit }
export interface FuturesTeam { team: number; g: number; w: number; l: number; rs: number; ra: number }

/** 지금까지 그 선수가 결장한 날 수 (시즌 시작 결장 + 결장 기록) */
function absentDays(season: Season, p: SimPlayer, today: number): number {
  let d = Math.min(today, Math.max(0, p.startAbsent ?? 0));
  for (const a of season.absences) {
    if (a.idx !== p.idx) continue;
    d += Math.max(0, Math.min(a.until, today) - Math.max(a.day, p.startAbsent ?? 0));
  }
  return Math.min(today, d);
}

/** BaseRuns: 사건 수로 득점 추정 */
function baseRuns(h: number, d: number, t: number, hr: number, bb: number, ab: number): number {
  const tb = h + d + 2 * t + 3 * hr;
  const A = h + bb - hr;
  const B = (1.4 * tb - 0.6 * h - 3 * hr + 0.1 * bb) * 1.02;
  const C = ab - h;
  return B + C > 0 ? (A * B) / (B + C) + hr : hr;
}

/**
 * 지금까지(정규시즌 경과 날짜까지)의 퓨처스리그 성적: 선수별 줄과 구단 순위.
 * registered: 구단별 지금 1군 명단 (2군 안 순위를 정할 때 뺀다)
 */
export function futuresSeason(world: World, season: Season, seed: string, registered: (team: number) => Set<number>): { lines: Map<number, FuturesLine>; teams: FuturesTeam[] } {
  const lg = world.league;
  const today = Math.min(season.day, season.schedule.length);
  const rng = (p: SimPlayer) => new Rng(`${seed}/futures/${world.year}/${p.id}`);

  // 1) 출전량: 야수 타석, 투수 상대 타자 (구단 2군 안의 순위로)
  const batPA = new Map<number, { p: SimPlayer; pa: number; g: number }>();
  const pitBF = new Map<number, { p: SimPlayer; bf: number; apps: number; st: boolean }>();
  const futGames = new Map<number, number>();
  for (const team of world.teams) {
    const tg = season.teams[team.idx].g;
    futGames.set(team.idx, Math.round(tg * FUT_GAME_RATIO));
    const reg = registered(team.idx);
    const perDay = today > 0 ? tg / today : 0;
    const games = (p: SimPlayer) => Math.max(0, tg - season.activeDays[p.idx] - absentDays(season, p, today) * perDay) * FUT_GAME_RATIO;
    const hitters = team.org.filter((p) => !p.isPitcher && p.bat && !reg.has(p.idx)).sort((a, b) => b.value - a.value || a.idx - b.idx);
    hitters.forEach((p, i) => {
      const n = games(p);
      const paPer = HIT_PA[i] ?? HIT_PA_REST;
      const pa = Math.round(n * paPer);
      if (pa >= 1) batPA.set(p.idx, { p, pa, g: Math.round(n * Math.min(1, paPer / 4)) });
    });
    const pitchers = team.org.filter((p) => p.isPitcher && p.pit && !reg.has(p.idx));
    const starters = pitchers.filter((p) => p.pit!.startShare >= 0.5).sort((a, b) => a.value - b.value || a.idx - b.idx).slice(0, ROT);
    const relievers = pitchers.filter((p) => !starters.includes(p)).sort((a, b) => a.value - b.value || a.idx - b.idx);
    for (const p of pitchers) {
      const n = games(p);
      const st = starters.includes(p);
      const ri = relievers.indexOf(p);
      const apps = st ? n / ROT : n * (ri >= 0 && ri < RELIEVERS ? RELIEF_APPS : PIT_REST_APPS);
      const bf = Math.round(apps * (st ? Math.min(26, p.pit!.stamina * 0.95) : Math.max(3, p.pit!.reliefStint)));
      if (bf >= 1) pitBF.set(p.idx, { p, bf, apps, st });
    }
  }

  // 2) 2군 선수 평균 능력 (출전량 가중)
  const KB = ['so', 'bb', 'hbp', 'hr', 's1', 'd2', 't3'] as const;
  const mb: Record<string, number> = {};
  const wb = [...batPA.values()].reduce((x, v) => x + v.pa, 0) || 1;
  for (const k of KB) mb[k] = [...batPA.values()].reduce((x, v) => x + v.p.bat![k] * v.pa, 0) / wb || 1;
  const KP = ['so', 'bb', 'hbp', 'hr', 'hit'] as const;
  const mp: Record<string, number> = {};
  const wp = [...pitBF.values()].reduce((x, v) => x + v.bf, 0) || 1;
  for (const k of KP) mp[k] = [...pitBF.values()].reduce((x, v) => x + v.p.pit![k] * v.bf, 0) / wp || 1;

  // 3) 결과
  const lines = new Map<number, FuturesLine>();
  const rs = new Map<number, { runs: number; pa: number }>();
  const ra = new Map<number, { runs: number; bf: number }>();
  for (const { p, pa, g } of batPA.values()) {
    const luck = Math.exp((rng(p).next() - 0.5) * 0.3); // 시즌 운 ±15% 안팎
    const rate = (k: (typeof KB)[number]) => lg[k] * FUT_ENV[k] * (p.bat![k] / mb[k]);
    const so = Math.round(pa * rate('so') / luck);
    const bb = Math.round(pa * rate('bb') * luck);
    const hbp = Math.round(pa * rate('hbp'));
    const hr = Math.round(pa * rate('hr') * luck);
    const d = Math.round(pa * rate('d2') * luck);
    const t = Math.round(pa * rate('t3'));
    const s1 = Math.round(pa * rate('s1') * luck);
    const h = s1 + d + t + hr;
    const ab = Math.max(h, pa - bb - hbp);
    lines.set(p.idx, { idx: p.idx, teamIdx: p.teamIdx, bat: { g, pa, ab, h, d, t, hr, bb: bb + hbp, so: Math.min(so, ab - h) } });
    const r = rs.get(p.teamIdx) ?? { runs: 0, pa: 0 };
    r.runs += baseRuns(h, d, t, hr, bb + hbp, ab);
    r.pa += pa;
    rs.set(p.teamIdx, r);
  }
  for (const { p, bf, apps, st } of pitBF.values()) {
    const ps = p.pit!;
    const luck = Math.exp((rng(p).next() - 0.5) * 0.3);
    const rel = (k: (typeof KP)[number]) => ps[k] / mp[k];
    const so = Math.round(bf * lg.so * FUT_ENV.so * rel('so') * luck);
    const bb = Math.round(bf * (lg.bb * FUT_ENV.bb * rel('bb') + lg.hbp * FUT_ENV.hbp * rel('hbp')) / luck);
    const hr = Math.round(bf * lg.hr * FUT_ENV.hr * rel('hr') / luck);
    const hitRate = (lg.s1 * FUT_ENV.s1 + lg.d2 * FUT_ENV.d2 + lg.t3 * FUT_ENV.t3) * rel('hit') / luck;
    const h = Math.round(bf * hitRate) + hr;
    const d = Math.round(bf * lg.d2 * FUT_ENV.d2 * rel('hit') / luck);
    const ab = Math.max(h, bf - bb);
    const outs = Math.max(0, bf - h - bb);
    const runs = baseRuns(h, d, 0, hr, bb, ab);
    const rr = Math.round(runs);
    lines.set(p.idx, { idx: p.idx, teamIdx: p.teamIdx, pit: { g: Math.round(apps), gs: st ? Math.round(apps) : 0, outs, bf, h, hr, bb, so, r: rr, er: Math.round(rr * 0.92) } });
    const x = ra.get(p.teamIdx) ?? { runs: 0, bf: 0 };
    x.runs += runs;
    x.bf += bf;
    ra.set(p.teamIdx, x);
  }

  // 4) 순위: 득점·실점을 타석당으로 바꿔 같은 양(경기 수 × PA_PER_GAME)으로 맞추고 피타고리안 승률
  const teams: FuturesTeam[] = world.teams.map((team) => {
    const futG = futGames.get(team.idx) ?? 0;
    const vol = futG * PA_PER_GAME;
    const r = rs.get(team.idx);
    const a = ra.get(team.idx);
    const runsFor = r && r.pa ? (r.runs / r.pa) * vol : 0;
    const runsAg = a && a.bf ? (a.runs / a.bf) * vol : 0;
    const pct = runsFor + runsAg > 0 ? runsFor ** 1.83 / (runsFor ** 1.83 + runsAg ** 1.83) : 0.5;
    const w = Math.round(futG * pct);
    return { team: team.idx, g: futG, w, l: futG - w, rs: Math.round(runsFor), ra: Math.round(runsAg) };
  });
  return { lines, teams: teams.sort((a, b) => b.w / Math.max(1, b.g) - a.w / Math.max(1, a.g) || a.team - b.team) };
}
