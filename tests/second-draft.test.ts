// 2차 드래프트·창단 특별 지명 (2026-10-12, offseason.ts ProtectDraft)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import * as Off from '../src/league/offseason';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
beforeAll(() => { store = loadDataStore(); }, 120_000);

function toSecond(year: number, seed: string): GameSession {
  const lg = store.season(year)!.teams.findIndex((t) => t.name === 'LG');
  const g = GameSession.create(store, { year, teamIdx: lg, seed }, FAST);
  g.advance(100000);
  g.beginOffseason();
  for (let guard = 0; g.offseason!.stage !== 'second' && g.offseason!.stage !== 'foreign' && guard < 20; guard++) {
    if (g.offseason!.stage === 'comp') g.autoComp();
    g.nextStage();
  }
  return g;
}

describe('2차 드래프트', () => {
  it('열리는 해: 2011~2019·2023년부터 홀수 해', () => {
    expect([2011, 2013, 2019, 2023, 2025, 2027].every(Off.isSecondDraftYear)).toBe(true);
    expect([2010, 2012, 2020, 2021, 2022, 2024, 2026].some(Off.isSecondDraftYear)).toBe(false);
  });

  it('2025: 보호 35명, 우리 명단을 고치고 지명 희망대로 데려온다. 자동 제외 대상은 지명되지 않고, 양도금이 장부에 남는다', () => {
    // 양도금은 미계약 FA를 원 소속이 아닌 구단이 지명할 때만 생긴다 (원 소속이 다시 데려가면 없음). 어느 시드에서 그런 지명이 나오는지는
    // 시즌 결과·FA 시장에 달려 엔진·일정이 바뀔 때마다 옮겨 다녔다 (sd-3 → sd-4 → 2026-10-23 일정 개편 7단계 뒤 sd-4는 둘 다 원 소속이 지명).
    // 그래서 시드 몇 개를 차례로 보고, 모든 시드에서 규칙을 확인하며 양도금 지명이 나온 시드에서 멈춘다
    let faFees = 0;
    for (const seed of ['sd-4', 'sd-1', 'sd-2']) {
      faFees += secondDraftChecks(seed);
      if (faFees > 0) break;
    }
    expect(faFees).toBeGreaterThan(0);
  }, 900_000);

  /** 2025 2차 드래프트 한 판을 확인하고 양도금 낸 미계약 FA 지명 수를 돌려준다 */
  function secondDraftChecks(seed: string): number {
    const g = toSecond(2025, seed);
    const off = g.offseason!;
    expect(off.stage).toBe('second');
    const d = off.second!;
    expect(d.limit).toBe(35);
    const me = g.teamIdx;
    // 보호 인원 넘기면 안 된다
    const pool = Off.protectDraftPool(g.league, off, d, me);
    expect(g.setDraftProtect('second', pool.slice(0, 36).map((p) => p.id)).ok).toBe(false);
    // 우리 보호 명단에서 한 명 빼면 그 선수는 다른 구단 후보가 된다
    const out = d.protect[String(me)][0];
    expect(g.setDraftProtect('second', d.protect[String(me)].slice(1)).ok).toBe(true);
    expect(Off.protectDraftCandidates(g.league, off, d, (me + 1) % 10).some((p) => p.id === out)).toBe(true);
    // 다른 구단 후보 가운데 하나를 지명 희망으로 (2026-10-21부터 후보 앞에 계약하지 못한 FA가 붙는다: 다른 구단 소속 선수를 고른다)
    const cands = Off.protectDraftCandidates(g.league, off, d, me);
    const want = cands.find((p) => p.team >= 0)!;
    expect(g.setDraftWish('second', [want.id]).ok).toBe(true);
    const ledger = g.league.ledger.length;
    // 미계약 FA의 원 소속 (지명되면 무적 표시가 지워진다)
    const origin = new Map(Off.unsignedFas(g.league, off).map((p) => [p.id, p.freeAgent?.from ?? -1]));
    g.nextStage();
    expect(off.stage).not.toBe('second');
    const picks = d.picks!;
    expect(picks.length).toBeGreaterThan(5);
    expect(g.leaguePlayer(want.id)!.team).toBe(me);
    expect(g.league.ledger.length).toBeGreaterThan(ledger);
    const fa = new Set(off.fa.entries.map((e) => e.id));
    const lost = new Map<number, number>();
    let faFees = 0;
    for (const k of picks) {
      const p = g.leaguePlayer(k.id!)!;
      expect(p.foreign).toBe(false);
      if (k.from! < 0) {
        // 계약하지 못한 FA: 최저 연봉, 무적 표시가 지워진다. 양도금은 그 라운드 값을 원 소속 구단에 (2026-10-21, 예전에는 양도금 없음)
        expect(p.freeAgent).toBeUndefined();
        const o = origin.get(p.id) ?? -1;
        expect(k.origin, `${seed} ${p.name}`).toBe(o >= 0 && o !== k.team ? o : undefined);
        if (k.origin !== undefined) {
          expect(k.origin).not.toBe(k.team);
          expect(g.league.ledger.some((e) => e.from === k.team && e.to === k.origin && e.amount === k.fee && e.note.includes(p.name))).toBe(true);
          faFees++;
        }
        continue;
      }
      expect(fa.has(p.id)).toBe(false);
      expect(p.entryYear).toBeLessThan(2023);
      expect(d.protect[String(k.from)]).not.toContain(p.id);
      lost.set(k.from!, (lost.get(k.from!) ?? 0) + 1);
    }
    for (const n of lost.values()) expect(n).toBeLessThanOrEqual(Off.SECOND_MAX_LOSS);
    return faFees;
  }

  it('2026 시즌 뒤에는 열리지 않는다 (짝수 해)', () => {
    const g = toSecond(2026, 'sd-2');
    expect(g.offseason!.second).toBeUndefined();
  }, 600_000);
});

describe('계약하지 못한 FA (2026-10-21 사용자 결정)', () => {
  it('리그를 떠나지 않고 2차 드래프트 후보·육성선수 후보가 된다. 남은 선수는 다음 시즌 중 자유계약, 그 시즌도 못 찾으면 은퇴', () => {
    const g = toSecond(2025, 'sd-1');
    const off = g.offseason!;
    const left = off.fa.entries.filter((e) => e.status === 'left' && !e.returnee).map((e) => g.leaguePlayer(e.id)!);
    if (!left.length) return; // 이 시드에 미계약 FA가 없으면 넘어간다
    for (const p of left) {
      expect(p.team).toBe(-1);
      expect(p.freeAgent?.since).toBe(2025);
    }
    const ids = new Set(Off.unsignedFas(g.league, off).map((p) => p.id));
    expect(Off.protectDraftCandidates(g.league, off, off.second!, g.teamIdx).filter((p) => ids.has(p.id)).length).toBe(ids.size);
    // 2차 드래프트 지명 희망을 비워 두고 정원 정리 단계까지
    g.setDraftWish('second', []);
    for (let guard = 0; off.stage !== 'release' && guard < 20; guard++) { if (off.stage === 'draft') g.autoDraft(); g.nextStage(); }
    expect(off.stage).toBe('release');
    const pool = new Set(Off.devPool(g.league, off).map((p) => p.id));
    for (const p of Off.unsignedFas(g.league, off)) expect(pool.has(p.id)).toBe(true);
    const still = Off.unsignedFas(g.league, off)[0];
    if (still) {
      // 나이와 상관없이 우리 육성선수로 데려올 수 있다
      expect(g.signDev(still.id).ok).toBe(true);
      expect(g.leaguePlayer(still.id)).toMatchObject({ team: g.teamIdx, dev: true });
      expect(g.leaguePlayer(still.id)!.freeAgent).toBeUndefined();
    }
    // 끝까지 남은 선수: 다음 시즌 중 자유계약 선수 (시즌 월드에 소속 없이), 그 시즌도 계약하지 못하면 은퇴 기록
    for (let guard = 0; off.stage !== 'ready' && guard < 20; guard++) { if (off.stage === 'release') g.autoRelease(); g.nextStage(); }
    const rest = Off.unsignedFas(g.league, off).map((p) => p.id);
    expect(g.openNextSeason().ok).toBe(true);
    for (const id of rest) expect(g.world.players.find((p) => p.id === id)?.teamIdx).toBe(-1);
    if (!rest.length) return;
    g.advance(100000);
    g.beginOffseason();
    for (const id of rest) {
      const p = g.league.players.find((x) => x.id === id);
      if (p && p.team >= 0) continue; // 시즌 중 누가 데려갔다
      expect(g.league.retired!.some((r) => r.id === id && r.year === 2026)).toBe(true);
    }
  }, 600_000);
});

describe('창단 특별 지명', () => {
  it('2012 시즌 뒤 NC 1군 진입: 우리 보호 명단 밖에서만 1명, 기존 구단마다 1명', () => {
    const g = toSecond(2012, 'sd-exp');
    const off = g.offseason!;
    expect(off.stage).toBe('second');
    const d = off.expansion!;
    expect(d.limit).toBe(20);
    const me = g.teamIdx;
    const prot = d.protect[String(me)];
    g.nextStage();
    const nc = d.team!;
    const picks = d.picks!;
    expect(picks.length).toBe(8);
    for (const k of picks) expect(g.leaguePlayer(k.id!)!.team).toBe(nc);
    const mine = picks.find((k) => k.from === me)!;
    expect(prot).not.toContain(mine.id);
    expect(g.league.players.filter((p) => p.team === nc).length).toBeGreaterThanOrEqual(Off.EXPANSION_MIN);
  }, 600_000);
});
