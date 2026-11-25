// 세이브·15승 엔진 카드 (2026-11-25 사용자 Q44): 마무리 피로 여유(mgr.closerExtra)·마무리 고정(mgr.closerKeep)·선발 보너스(starterDeal.bonus).
// 마무리 고정은 이번 시즌 세이브(순환 주기 시작 전 경기 기록)로 고르고, 화면 조회·저장 뒤 이어 돌리기를 끼워도 결과가 같아야 한다
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, Season, worldForYear, type EngineParams, type SimPlayer } from '../src/engine';
import { CHURN_DAYS, newPlayerStates, refreshActive, type TeamSeason } from '../src/engine/team';

const store = loadDataStore();
const UNIT = { s1: 1, d2: 1, t3: 1, hr: 1, bb: 1, hbp: 1, so: 1 };
const NO_PILOT: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 0 };

describe('조정값 (임시값)', () => {
  it('마무리 피로 여유 45구, 마무리 부진 강등 2배, 마무리 고정 문턱 3세이브, 선발 보너스 0.10', () => {
    expect(DEFAULT_PARAMS.mgr.closerExtra).toBe(45);
    expect(DEFAULT_PARAMS.churnSlump?.closerRatio).toBe(2);
    expect(DEFAULT_PARAMS.mgr.closerKeep).toBe(3);
    expect(DEFAULT_PARAMS.mgr.starterDeal.bonus).toBe(0.1);
  });
});

describe('마무리 고정 (team.ts refreshActive keep)', () => {
  const world = worldForYear(store, 2025, NO_PILOT);
  const team = world.teams[0];
  const fresh = (): TeamSeason => ({ team, hitters: [], rotation: [], bullpen: [], closer: null, nextReturnDay: 0, dirty: true });
  const st = newPlayerStates(world.players.length);
  const base = fresh();
  refreshActive(base, world, st, 0);
  // 지난 시즌 세이브로 고른 마무리가 아닌 불펜 투수 하나
  const other = base.bullpen.find((p) => p !== base.closer)!;

  it('이번 시즌 세이브가 문턱 이상이면 가장 많은 투수가 마무리', () => {
    const sv = new Int16Array(world.players.length);
    sv[other.idx] = 8;
    if (base.closer) sv[base.closer.idx] = 5;
    const ts = fresh();
    refreshActive(ts, world, st, 0, 0, 0, null, 0, 0, { sv, min: 3 });
    expect(ts.closer?.idx).toBe(other.idx);
  });

  it('문턱보다 적으면 예전 규칙(지난 시즌 세이브)대로', () => {
    const sv = new Int16Array(world.players.length);
    sv[other.idx] = 2;
    const ts = fresh();
    refreshActive(ts, world, st, 0, 0, 0, null, 0, 0, { sv, min: 3 });
    expect(ts.closer?.idx).toBe(base.closer?.idx);
  });

  it('세이브가 가장 많은 투수가 빠지면 다음으로 많은 투수, 돌아오면 다시 그 투수', () => {
    const sv = new Int16Array(world.players.length);
    sv[other.idx] = 10;
    const second = base.bullpen.find((p) => p !== base.closer && p !== other)!;
    sv[second.idx] = 4;
    const hurt = newPlayerStates(world.players.length);
    hurt.absentUntil[other.idx] = 20;
    const ts = fresh();
    refreshActive(ts, world, hurt, 0, 0, 0, null, 0, 0, { sv, min: 3 });
    expect(ts.closer?.idx).toBe(second.idx);
    // 돌아오는 날(또는 그 전 순환 주기 끝)에 다시 짠다
    expect(ts.nextReturnDay).toBeLessThanOrEqual(20);
    refreshActive(ts, world, hurt, 20, 0, 0, null, 0, 0, { sv, min: 3 });
    expect(ts.closer?.idx).toBe(other.idx);
  });

  it('고정 규칙을 쓰는 동안은 순환 주기가 바뀌는 날 다시 짠다 (직접 정한 1군도)', () => {
    const sv = new Int16Array(world.players.length);
    const ts: TeamSeason = { ...fresh(), manual: new Set(base.hitters.concat(base.rotation, base.bullpen).map((p: SimPlayer) => p.idx)) };
    refreshActive(ts, world, st, 3, 0, 0, null, 0, 0, { sv, min: 3 });
    expect(ts.nextReturnDay).toBeLessThanOrEqual(CHURN_DAYS);
  });
});

describe('마무리 고정이 든 시즌 (season.ts closerSavesOn)', () => {
  // 문턱 1: 마무리가 자주 바뀌어 조회·저장 순서가 새면 잘 드러난다
  const P: EngineParams = { ...NO_PILOT, mgr: { ...NO_PILOT.mgr, closerKeep: 1 } };
  const run = (days: number, every?: (s: Season) => void) => {
    const s = Season.start(worldForYear(store, 2025, P), P, 'closer-keep', { cal: UNIT });
    for (let d = 0; d < days && !s.done; d++) {
      every?.(s);
      s.simulateDay();
    }
    return s;
  };

  it('날마다 화면 조회(refresh)를 끼워도, 순환 주기 가운데서 저장·불러와도 끊김 없이 돌린 결과와 같다', () => {
    const full = run(120);
    const peek = run(120, (s) => { for (let t = 0; t < s.teamSeasons.length; t++) s.refresh(t); });
    expect(JSON.stringify(peek.toSave())).toBe(JSON.stringify(full.toSave()));
    // 63일째는 순환 주기(10일) 가운데: 주기 시작 뒤 경기의 세이브는 그 주기 마무리 고르기에 세지 않아야 한다
    const half = run(63);
    const back = Season.restore(worldForYear(store, 2025, P), P, JSON.parse(JSON.stringify(half.toSave())));
    for (let d = 63; d < 120; d++) back.simulateDay();
    expect(JSON.stringify(back.toSave())).toBe(JSON.stringify(full.toSave()));
  });

  it('마무리는 이번 시즌 세이브를 쌓은 투수로 굳는다: 120일 뒤 구단마다 마무리가 팀 세이브 1위이거나 빠져 있다', () => {
    const s = run(120);
    for (const ts of s.teamSeasons) {
      const top = ts.team.org.reduce((a, b) => ((s.pit[b.idx]?.sv ?? 0) > (s.pit[a.idx]?.sv ?? 0) ? b : a));
      const topSv = s.pit[top.idx]?.sv ?? 0;
      if (topSv < 3) continue;
      const out = !ts.bullpen.includes(top);
      // 주기 시작 전까지로 세므로 막 앞지른 투수는 다음 주기부터: 1위와 2개 이내면 통과
      const closerSv = ts.closer ? s.pit[ts.closer.idx]?.sv ?? 0 : 0;
      expect(out || closerSv >= topSv - 2, ts.team.name).toBe(true);
    }
  });
});
