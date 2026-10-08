// 한 시즌 시뮬레이션: 일정 생성 → 매일 엔트리 점검 → 경기 → 기록·순위 집계.
// Season은 하루씩 진행할 수 있고, 진행 중 상태를 저장(toSave)했다가 같은 위치에서 이어갈 수 있다(restore).
// 저장 후 이어서 돌린 결과는 끊지 않고 돌린 결과와 같다 (테스트로 확인).

import type { Rates } from '../data/types';
import { emptyLeagueCounters, simulateGame, type GameContext, type LeagueCounters } from './game';
import type { EngineParams } from './params';
import { Rng } from './rng';
import { newPlayerStates, refreshActive, todaysLineup, todaysStarter, type PlayerStates, type TeamSeason } from './team';
import { emptyBatLine, emptyPitLine, emptyTeamRecord, type BatLine, type PitLine, type SimPlayer, type TeamRecord, type World } from './types';

export interface ScheduledGame {
  home: number;
  away: number;
}

/**
 * 일정 생성. 원형 대진(라운드 로빈)을 필요한 만큼 반복한다.
 * 반환값은 날짜별 경기 목록이며, 6일 경기 뒤 하루는 빈 날(휴식일)이다.
 */
export function generateSchedule(nTeams: number, gamesPerTeam: number, rng: Rng): ScheduledGame[][] {
  const ring: number[] = Array.from({ length: nTeams }, (_, i) => i);
  if (nTeams % 2 === 1) ring.push(-1); // 홀수 구단이면 하루씩 쉬는 팀이 생긴다
  const m = ring.length;
  const played = new Array<number>(nTeams).fill(0);
  const flip = Array.from({ length: nTeams }, () => new Array<boolean>(nTeams).fill(false));
  const days: ScheduledGame[][] = [];
  let gameDays = 0;
  let guard = 0;

  while (played.some((g) => g < gamesPerTeam) && guard++ < 10000) {
    // 한 바퀴(모든 팀이 서로 한 번씩) 분량의 라운드를 만들고 순서를 섞는다
    const rounds: [number, number][][] = [];
    for (let r = 0; r < m - 1; r++) {
      const pairs: [number, number][] = [];
      for (let i = 0; i < m / 2; i++) {
        const a = ring[i];
        const b = ring[m - 1 - i];
        if (a >= 0 && b >= 0) pairs.push([a, b]);
      }
      rounds.push(pairs);
      ring.splice(1, 0, ring.pop()!);
    }
    rng.shuffle(rounds);
    for (const pairs of rounds) {
      const day: ScheduledGame[] = [];
      for (const [a, b] of pairs) {
        if (played[a] >= gamesPerTeam || played[b] >= gamesPerTeam) continue;
        // 같은 상대와는 홈·원정을 번갈아
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const homeIsLo = !flip[lo][hi];
        flip[lo][hi] = homeIsLo;
        day.push(homeIsLo ? { home: lo, away: hi } : { home: hi, away: lo });
        played[a]++;
        played[b]++;
      }
      if (day.length === 0) continue;
      days.push(day);
      if (++gameDays % 6 === 0) days.push([]);
    }
  }
  return days;
}

export interface SeasonResult {
  seed: string;
  year: number;
  cal: Rates;
  bat: BatLine[];
  pit: PitLine[];
  teams: TeamRecord[];
  totals: LeagueCounters;
  /** 승률 순 팀 색인 */
  standings: number[];
}

export interface SeasonOptions {
  /** 환경 맞춤 계수를 직접 줄 때 (예비 시즌을 건너뜀) */
  cal?: Rates;
}

/** 치른 경기 한 건 */
export interface GameLog {
  day: number;
  home: number;
  away: number;
  homeRuns: number;
  awayRuns: number;
  innings: number;
  /** 승리·패전·세이브 투수 색인 */
  win: number | null;
  loss: number | null;
  save: number | null;
}

export interface BoxBatter {
  idx: number;
  ab: number;
  r: number;
  h: number;
  rbi: number;
  hr: number;
  bb: number;
  so: number;
}

export interface BoxPitcher {
  idx: number;
  outs: number;
  bf: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
}

export interface BoxSide {
  batters: BoxBatter[];
  pitchers: BoxPitcher[];
}

/** 박스스코어. 타자는 타순, 투수는 등판 순 */
export interface BoxScore {
  /** 이닝별 득점. 치르지 않은 말 공격은 -1 */
  lineScore: { away: number[]; home: number[] };
  home: BoxSide;
  away: BoxSide;
}

const UNIT: Rates = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const BAT_KEYS = Object.keys(emptyBatLine()) as (keyof BatLine)[];
const PIT_KEYS = Object.keys(emptyPitLine()) as (keyof PitLine)[];

export function winPct(t: TeamRecord): number {
  return t.w + t.l > 0 ? t.w / (t.w + t.l) : 0;
}

/** 승률 순 팀 색인 (같으면 승수, 그다음 색인 순) */
export function rankTeams(teams: TeamRecord[]): number[] {
  return teams.map((_, i) => i).sort((x, y) => winPct(teams[y]) - winPct(teams[x]) || teams[y].w - teams[x].w || x - y);
}

interface FixedAbsence {
  p: number;
  team: number;
  until: number;
}

/** 진행 중 시즌의 저장 형태 (JSON으로 그대로 쓸 수 있다) */
export interface SeasonSave {
  format: 1;
  seed: string;
  year: number;
  /** 월드의 선수 구성 지문. 데이터가 바뀌면 선수 색인이 어긋나므로 불러오기를 막는다 */
  roster: string;
  cal: Rates;
  day: number;
  rngDays: number;
  rngGames: number;
  absentUntil: number[];
  fatigue: number[];
  fatigueDay: number[];
  lastStartDay: number[];
  /** 선수별 기록. 필드 순서는 emptyBatLine / emptyPitLine의 키 순서 */
  bat: number[][];
  pit: number[][];
  teams: TeamRecord[];
  totals: LeagueCounters;
  log: GameLog[];
  boxes: [number, BoxScore][];
  boxTeams: number[];
  manual: (number[] | null)[];
  fixedAbsence: [number, FixedAbsence[]][];
  /** 시즌 중 이적: [날짜, 선수 색인, 새 구단 색인]. 불러올 때 이 순서대로 다시 적용한다 */
  transfers?: [number, number, number][];
}

/** 월드의 선수 구성 지문 (FNV-1a) */
export function rosterFingerprint(world: World): string {
  let h = 2166136261 >>> 0;
  const s = `${world.year}|${world.players.map((p) => `${p.id}@${p.teamIdx}`).join(',')}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${world.players.length}-${(h >>> 0).toString(16)}`;
}

export interface SeasonInit {
  /** 박스스코어를 남길 팀 색인 (보통 플레이어 구단). 기본은 남기지 않음 */
  boxTeams?: number[];
}

export class Season {
  readonly world: World;
  readonly params: EngineParams;
  readonly seed: string;
  readonly cal: Rates;
  /** 날짜별 경기. 빈 배열은 휴식일 */
  readonly schedule: ScheduledGame[][];
  /** 다음에 치를 날짜 (일정 색인) */
  day = 0;
  readonly states: PlayerStates;
  readonly bat: BatLine[];
  readonly pit: PitLine[];
  readonly teams: TeamRecord[];
  readonly totals: LeagueCounters;
  readonly teamSeasons: TeamSeason[];
  readonly log: GameLog[] = [];
  /** 경기 로그 색인 → 박스스코어 */
  readonly boxes = new Map<number, BoxScore>();
  readonly boxTeams: Set<number>;
  private dayRng: Rng;
  private ctx: GameContext;
  private fixedAbsence = new Map<number, FixedAbsence[]>();
  /** 이적 전 월드의 선수 구성 지문 (저장 호환 확인용) */
  readonly baseRoster: string;
  readonly transfers: [number, number, number][] = [];

  /** rng는 시즌의 뿌리 난수. 일정·결장·경기 난수를 여기서 갈라 쓴다 */
  constructor(world: World, params: EngineParams, rng: Rng, cal: Rates, init: SeasonInit = {}) {
    this.world = world;
    this.params = params;
    this.seed = rng.seed;
    this.cal = cal;
    this.baseRoster = rosterFingerprint(world);
    const n = world.players.length;
    this.states = newPlayerStates(n);
    this.bat = Array.from({ length: n }, emptyBatLine);
    this.pit = Array.from({ length: n }, emptyPitLine);
    this.teams = world.teams.map(emptyTeamRecord);
    this.totals = emptyLeagueCounters();
    this.boxTeams = new Set(init.boxTeams ?? []);
    this.teamSeasons = world.teams.map((team) => ({
      team, hitters: [], rotation: [], bullpen: [], closer: null, nextReturnDay: 0, dirty: true, manual: null, callUps: [],
    }));
    this.schedule = generateSchedule(world.teams.length, world.gamesPerTeam, rng.fork('schedule'));
    this.dayRng = rng.fork('days');
    this.ctx = {
      league: world.league, env: world.env, cal, params, maxInnings: world.rules.maxInnings, day: 0, rng: rng.fork('games'),
      states: this.states, bat: this.bat, pit: this.pit, totals: this.totals,
    };

    // 출전 가능 비율이 지정된 선수: 시즌 중 한 구간을 통째로 비운다
    for (const p of world.players) {
      if (p.availability === undefined || p.availability >= 0.97) continue;
      const miss = Math.round((1 - Math.max(0, p.availability)) * this.schedule.length);
      const start = this.dayRng.int(this.schedule.length - miss + 1);
      const list = this.fixedAbsence.get(start) ?? [];
      list.push({ p: p.idx, team: p.teamIdx, until: start + miss });
      this.fixedAbsence.set(start, list);
    }
  }

  /** 환경 맞춤부터 해서 새 시즌을 연다 (simulateSeason과 같은 시드 규칙) */
  static start(world: World, params: EngineParams, seed: string | number, opts: SeasonOptions & SeasonInit = {}): Season {
    const rng = new Rng(seed);
    const cal = opts.cal ?? (params.pilotSeasons > 0 ? calibrate(world, params, rng.fork('pilot')) : { ...UNIT });
    return new Season(world, params, rng, cal, opts);
  }

  get done(): boolean {
    return this.day >= this.schedule.length;
  }

  standings(): number[] {
    return rankTeams(this.teams);
  }

  /** 플레이어가 정한 1군 명단을 바꾼다. null이면 AI에게 맡긴다 */
  setManualEntry(teamIdx: number, idxs: Iterable<number> | null): void {
    const ts = this.teamSeasons[teamIdx];
    ts.manual = idxs ? new Set(idxs) : null;
    ts.dirty = true;
  }

  /**
   * 선수를 다른 구단으로 옮긴다 (트레이드). world의 구단 소속을 바꾸므로 이 월드를 다른 시즌과 함께 쓰지 않는다.
   * 시즌 기록은 선수에게 그대로 남는다. 새 구단이 직접 관리하는 구단이면 2군으로 들어간다.
   */
  transfer(playerIdx: number, toTeam: number): void {
    const p = this.world.players[playerIdx];
    const from = p.teamIdx;
    if (from === toTeam) return;
    if (!this.world.teams[toTeam]) throw new Error(`구단 색인이 잘못됐습니다: ${toTeam}`);
    const src = this.world.teams[from].org;
    src.splice(src.indexOf(p), 1);
    this.world.teams[toTeam].org.push(p);
    p.teamIdx = toTeam;
    this.teamSeasons[from].manual?.delete(playerIdx);
    this.teamSeasons[from].dirty = true;
    this.teamSeasons[toTeam].dirty = true;
    this.transfers.push([this.day, playerIdx, toTeam]);
  }

  /** 다음 경기일 기준으로 1군을 다시 짠다 (화면에 현재 1군을 보여줄 때). 난수를 쓰지 않으므로 결과에 영향이 없다 */
  refresh(teamIdx: number): TeamSeason {
    const ts = this.teamSeasons[teamIdx];
    refreshActive(ts, this.world, this.states, this.day);
    return ts;
  }

  /** 하루를 진행한다. 끝난 시즌이면 아무것도 하지 않는다 */
  simulateDay(): void {
    if (this.done) return;
    const { world, params, states, ctx, dayRng } = this;
    const day = this.day;
    const games = this.schedule[day];
    const season = this.teamSeasons;
    const [minAbs, maxAbs] = params.absenceDays;
    ctx.day = day;

    for (const a of this.fixedAbsence.get(day) ?? []) {
      states.absentUntil[a.p] = a.until;
      season[a.team].dirty = true;
    }
    // 결장 발생 (부상 모델 도입 전 임시 처리)
    if (games.length) {
      for (const ts of season) {
        for (const p of ts.team.org) {
          if (p.availability !== undefined) continue;
          if (states.absentUntil[p.idx] <= day && dayRng.chance(params.absenceChance)) {
            states.absentUntil[p.idx] = day + minAbs + dayRng.int(maxAbs - minAbs + 1);
            ts.dirty = true;
          }
        }
      }
    }
    for (const ts of season) if (ts.dirty || day >= ts.nextReturnDay) refreshActive(ts, world, states, day);

    for (const g of games) {
      const h = season[g.home];
      const a = season[g.away];
      const homeLineup = todaysLineup(h, world.league, params, dayRng);
      const awayLineup = todaysLineup(a, world.league, params, dayRng);
      const wantBox = this.boxTeams.has(g.home) || this.boxTeams.has(g.away);
      const pitBefore = wantBox ? this.snapshotPitchers([h, a]) : null;
      const batBefore = wantBox ? [...homeLineup, ...awayLineup].map((p) => ({ ...this.bat[p.idx] })) : null;
      const res = simulateGame(h, a, homeLineup, awayLineup, todaysStarter(h, states, day, params), todaysStarter(a, states, day, params), ctx);
      const ht = this.teams[g.home];
      const at = this.teams[g.away];
      ht.g++; at.g++;
      ht.rs += res.homeRuns; ht.ra += res.awayRuns;
      at.rs += res.awayRuns; at.ra += res.homeRuns;
      if (res.homeRuns > res.awayRuns) { ht.w++; at.l++; ht.homeW++; }
      else if (res.homeRuns < res.awayRuns) { at.w++; ht.l++; ht.homeL++; }
      else { ht.t++; at.t++; ht.homeT++; }
      this.log.push({
        day, home: g.home, away: g.away, homeRuns: res.homeRuns, awayRuns: res.awayRuns, innings: res.innings,
        win: res.win, loss: res.loss, save: res.save,
      });
      if (pitBefore && batBefore) {
        const boxBat = (lineup: SimPlayer[], offset: number): BoxBatter[] => lineup.map((p, i) => {
          const now = this.bat[p.idx];
          const was = batBefore[offset + i];
          return {
            idx: p.idx, ab: now.ab - was.ab, r: now.r - was.r, h: now.h - was.h, rbi: now.rbi - was.rbi, hr: now.hr - was.hr,
            bb: now.bb - was.bb, so: now.so - was.so,
          };
        });
        const boxPit = (staff: number[]): BoxPitcher[] => staff.map((idx) => {
          const now = this.pit[idx];
          const was = pitBefore.get(idx)!;
          return {
            idx, outs: now.outs - was.outs, bf: now.bf - was.bf, h: now.h - was.h, r: now.r - was.r, er: now.er - was.er,
            bb: now.bb - was.bb, so: now.so - was.so, hr: now.hr - was.hr,
          };
        });
        this.boxes.set(this.log.length - 1, {
          lineScore: res.lineScore,
          home: { batters: boxBat(homeLineup, 0), pitchers: boxPit(res.homeStaff) },
          away: { batters: boxBat(awayLineup, 9), pitchers: boxPit(res.awayStaff) },
        });
      }
    }
    this.day++;
  }

  private snapshotPitchers(sides: TeamSeason[]): Map<number, PitLine> {
    const m = new Map<number, PitLine>();
    for (const ts of sides) for (const p of ts.team.org) if (p.isPitcher) m.set(p.idx, { ...this.pit[p.idx] });
    return m;
  }

  runToEnd(): void {
    while (!this.done) this.simulateDay();
  }

  result(): SeasonResult {
    return {
      seed: this.seed, year: this.world.year, cal: this.cal, bat: this.bat, pit: this.pit, teams: this.teams, totals: this.totals,
      standings: this.standings(),
    };
  }

  toSave(): SeasonSave {
    const st = this.states;
    return {
      format: 1,
      seed: this.seed,
      year: this.world.year,
      roster: this.baseRoster,
      cal: { ...this.cal },
      day: this.day,
      rngDays: this.dayRng.state(),
      rngGames: this.ctx.rng.state(),
      absentUntil: Array.from(st.absentUntil),
      fatigue: Array.from(st.fatigue),
      fatigueDay: Array.from(st.fatigueDay),
      lastStartDay: Array.from(st.lastStartDay),
      bat: this.bat.map((b) => BAT_KEYS.map((k) => b[k])),
      pit: this.pit.map((p) => PIT_KEYS.map((k) => p[k])),
      teams: this.teams.map((t) => ({ ...t })),
      totals: { ...this.totals },
      log: this.log.map((g) => ({ ...g })),
      boxes: [...this.boxes.entries()],
      boxTeams: [...this.boxTeams],
      manual: this.teamSeasons.map((ts) => (ts.manual ? [...ts.manual] : null)),
      fixedAbsence: [...this.fixedAbsence.entries()],
      transfers: this.transfers.map((t) => [...t] as [number, number, number]),
    };
  }

  /** 저장한 위치에서 시즌을 다시 연다. world는 저장할 때와 같은 데이터·연도로 만든 것이어야 한다 */
  static restore(world: World, params: EngineParams, save: SeasonSave): Season {
    if (save.format !== 1) throw new Error(`알 수 없는 저장 형식입니다 (${String(save.format)})`);
    if (save.year !== world.year) throw new Error(`저장한 연도(${save.year})와 월드 연도(${world.year})가 다릅니다`);
    if (save.roster !== rosterFingerprint(world)) {
      throw new Error('게임 데이터가 저장할 때와 달라 이 저장을 이어갈 수 없습니다 (선수 구성이 바뀜)');
    }
    const root = new Rng(save.seed);
    const s = new Season(world, params, root, save.cal, { boxTeams: save.boxTeams });
    for (const [d, idx, to] of save.transfers ?? []) {
      s.day = d;
      s.transfer(idx, to);
    }
    s.day = save.day;
    s.dayRng = Rng.fromState(root.fork('days').seed, save.rngDays);
    s.ctx.rng = Rng.fromState(root.fork('games').seed, save.rngGames);
    s.states.absentUntil.set(save.absentUntil);
    s.states.fatigue.set(save.fatigue);
    s.states.fatigueDay.set(save.fatigueDay);
    s.states.lastStartDay.set(save.lastStartDay);
    save.bat.forEach((row, i) => BAT_KEYS.forEach((k, j) => { s.bat[i][k] = row[j]; }));
    save.pit.forEach((row, i) => PIT_KEYS.forEach((k, j) => { s.pit[i][k] = row[j]; }));
    save.teams.forEach((t, i) => Object.assign(s.teams[i], t));
    Object.assign(s.totals, save.totals);
    s.log.push(...save.log.map((g) => ({ ...g })));
    for (const [k, v] of save.boxes) s.boxes.set(k, v);
    save.manual.forEach((m, i) => { s.teamSeasons[i].manual = m ? new Set(m) : null; });
    s.fixedAbsence = new Map(save.fixedAbsence);
    return s;
  }
}

/**
 * 환경 맞춤: 예비 시즌을 돌려 리그 전체 비율이 목표(그 해의 리그 평균)에 오도록 사건별 계수를 구한다.
 * 능력치는 리그 평균 대비 값이라, 누가 얼마나 뛰느냐에 따라 리그 합계가 목표에서 조금씩 벗어나기 때문이다.
 */
export function calibrate(world: World, params: EngineParams, rng: Rng): Rates {
  const cal = { ...UNIT };
  const keys = Object.keys(cal) as (keyof Rates)[];
  for (let round = 0; round < 2; round++) {
    const sum = emptyLeagueCounters();
    for (let i = 0; i < params.pilotSeasons; i++) {
      const pilot = new Season(world, params, rng.fork(`r${round}s${i}`), cal);
      pilot.runToEnd();
      const t = pilot.totals;
      for (const k of Object.keys(sum) as (keyof LeagueCounters)[]) sum[k] += t[k];
    }
    if (sum.pa === 0) break;
    const got: Rates = {
      s1: (sum.h - sum.d - sum.t - sum.hr) / sum.pa, d2: sum.d / sum.pa, t3: sum.t / sum.pa, hr: sum.hr / sum.pa,
      bb: sum.bb / sum.pa, hbp: sum.hbp / sum.pa, so: sum.so / sum.pa,
    };
    for (const k of keys) if (got[k] > 0) cal[k] *= world.league[k] / got[k];
  }
  return cal;
}

export function simulateSeason(world: World, params: EngineParams, seed: string | number, opts: SeasonOptions = {}): SeasonResult {
  const s = Season.start(world, params, seed, opts);
  s.runToEnd();
  return s.result();
}
