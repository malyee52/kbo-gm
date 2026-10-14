// 자유 모드 여러 시즌: 시즌 중·오프시즌마다 게임 마스터 조작(이동·생성·능력·규정·지명권·입단 예약)을 섞어도
// 리그가 무너지지 않고, 저장·불러오기와 처음부터 재현한 결과가 같다.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { resolveOps } from '../src/fantasy/free';
import { ruleOf } from '../src/league/rules';
import { isServing } from '../src/league/careers';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
beforeAll(() => { store = loadDataStore(); }, 120_000);

/** 리그가 멀쩡한지: id 중복 없음, 숫자가 유한함, 빈 예비 자리 없음(결산 뒤), 구단 정원·최소 인원 */
function checkLeague(g: GameSession, label: string, roster = true) {
  const ids = g.league.players.map((p) => p.id);
  expect(new Set(ids).size, `${label}: id 중복`).toBe(ids.length);
  for (const p of g.league.players) {
    const nums: unknown[] = [p.potential, p.contract.salary];
    const walk = (o: object | null | undefined) => { for (const v of Object.values(o ?? {})) if (v && typeof v === 'object') walk(v); else nums.push(v); };
    walk(p.bat); walk(p.pit);
    expect(nums.every((v) => typeof v !== 'number' || Number.isFinite(v)), `${label}: ${p.name} 능력·계약`).toBe(true);
  }
  expect(g.league.players.some((p) => p.reserve !== undefined), `${label}: 예비 자리`).toBe(false);
  if (!roster) return;
  // 정원은 시즌 중 규정을 줄여도 오프시즌 방출 단계에서 맞춘다
  const limit = ruleOf(g.league, 'orgLimit');
  g.league.teams.forEach((t, i) => {
    const org = g.league.players.filter((p) => p.team === i);
    // 정원은 복무 중·육성선수를 뺀 정식 선수 (offseason.ts orgSize)
    expect(org.filter((p) => !isServing(p) && !p.dev).length, `${label}: ${t.name} 정원`).toBeLessThanOrEqual(limit);
    expect(org.filter((p) => p.isPitcher).length, `${label}: ${t.name} 투수`).toBeGreaterThanOrEqual(18);
    expect(org.filter((p) => !p.isPitcher && p.pos === 'C').length, `${label}: ${t.name} 포수`).toBeGreaterThanOrEqual(2);
  });
}

function runOffseason(g: GameSession, onStage: (stage: string) => void) {
  for (let guard = 0; g.offseason!.stage !== 'ready' && guard < 40; guard++) {
    const st = g.offseason!.stage;
    onStage(st);
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  expect(g.offseason!.stage).toBe('ready');
}

describe('자유 모드 여러 시즌', () => {
  it('3시즌 동안 조작을 섞어도 리그가 멀쩡하고, 저장·재현이 같다', () => {
    const lg = store.season(2026)!.teams.findIndex((t) => t.name === 'LG');
    const g = GameSession.create(store, { year: 2026, teamIdx: lg, seed: 'free-long', fantasy: { free: true } }, FAST);
    const apply = (title: string, raw: unknown[]) => {
      const { ops, dropped } = resolveOps(g, raw, store);
      expect(dropped, title).toEqual([]);
      g.addFantasy({ kind: 'action', title, text: 'x', ops });
    };
    const created: string[] = [];
    // 이름이 5자 이상이면 외국인으로 본다 (free.ts looksForeignName): 국내 선수는 세 글자로
    const NAMES = ['한가람', '두나래', '세찬솔'], FUTURE = ['예준서', '예도윤', '예시우'], OFF = ['오하준', '오지호', '오은우'];
    for (let s = 0; s < 3; s++) {
      const year = g.world.year;
      g.advance(12);
      // 시즌 중: 다른 구단 에이스 데려오기, 가상 유망주 만들기, 능력 바꾸기, 규정, 지명권, 입단 예약
      const rival = g.league.teams.findIndex((t, i) => i !== g.teamIdx && t.name === (s % 2 ? '삼성' : 'KIA'));
      const ace = g.world.teams[rival].org.filter((p) => p.isPitcher && !p.foreign).sort((a, b) => b.value - a.value)[0];
      const name = NAMES[s];
      created.push(name);
      apply(`${year} 시즌 중`, [
        { op: 'move', player: `${ace.name}@${g.league.teams[rival].name}`, to: 'LG' },
        { op: 'create', name, team: 'LG', pos: s === 1 ? 'C' : 'SS', age: 20, now: 45, potential: 72 },
        { op: 'rule', key: 'foreignRegular', value: 3 + s },
        { op: 'rule', key: 'orgLimit', value: 70 - s * 4 },
        { op: 'pick', draft: year + 2, round: 1, from: g.league.teams[rival].name, to: 'LG' },
        { op: 'future', name: FUTURE[s], team: 'LG', pos: 'P', role: 'SP', birthYear: year - 18, joinYear: year + 1, now: 50, potential: 70 },
        { op: 'teamCash', team: g.league.teams[rival].name, amount: 30 },
      ]);
      // 이름은 그때 리그에서 찾으므로, 방금 만든 선수는 다음 판정에서 고친다
      apply(`${year} 능력`, [{ op: 'ability', player: name, potential: 76 }]);
      g.advance(30);
      // 시즌 중 저장 → 불러오기 → 같이 진행
      const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
      h.advance(10); g.advance(10);
      expect(roundTrip(h.toSave()), `${year} 시즌 중 저장`).toEqual(roundTrip(g.toSave()));

      g.advance(100000);
      g.beginOffseason();
      checkLeague(g, `${year} 결산`, false);
      for (const n of created) expect(g.league.players.some((p) => p.name === n), `${n} 남음`).toBe(true);
      runOffseason(g, (st) => {
        // 오프시즌 단계마다 하나씩 조작 (FA·드래프트 사이에도 끼어든다)
        if (st === 'fa') apply(`${year} 오프시즌`, [{ op: 'create', name: OFF[s], team: 'LG', pos: 'OF', age: 27, now: 58, potential: 60 }]);
        if (st === 'draft') {
          const kia = g.league.teams.findIndex((t) => t.name === 'KIA');
          const v = g.league.players.find((p) => p.team === kia && !p.foreign && p.isPitcher)!;
          apply(`${year} 드래프트`, [{ op: 'move', player: `${v.name}@KIA`, to: 'LG' }]);
        }
      });
      checkLeague(g, `${year} 오프시즌 끝`);
      // 오프시즌 끝 저장 → 불러오기
      const o = GameSession.load(store, roundTrip(g.toSave()), FAST);
      expect(roundTrip(o.toSave()), `${year} 오프시즌 저장`).toEqual(roundTrip(g.toSave()));
      g.openNextSeason();
      expect(g.world.year).toBe(year + 1);
      // 예약한 선수는 다음 개막에 실제로 들어온다
      expect(g.league.players.some((p) => p.name === FUTURE[s] && p.team === g.teamIdx), `${FUTURE[s]} 입단`).toBe(true);
      expect(ruleOf(g.league, 'foreignRegular')).toBe(3 + s);
    }
    g.advance(20);
    const info = g.reproInfo();
    const r = GameSession.replay(store, info.opts, info.actions, info.at, FAST);
    expect(roundTrip(r.toSave()), '처음부터 재현').toEqual(roundTrip(g.toSave()));
  }, 1_800_000);
});
