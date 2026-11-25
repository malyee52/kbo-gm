// 멈춤 없애기·저장 줄이기 (2026-11-25 사용자 결정 Q55).
// 1) Worker 길(game/heavy.ts runHeavyJob: 저장 → 불러오기 → 새 게임·결산·개막·개막 미리 보기 → 저장)의 결과가
//    본 스레드에서 끊김 없이 한 결과와 같고, 그 뒤로 이어 해도 같고, 조작 기록으로 재현된다 (tests/game.test.ts 성질).
// 2) 저장 나누기(game/saveSplit.ts)는 합치면 원래 저장과 글자까지 같다.
// 3) 브라우저 저장소(game/storage.ts, fake-indexeddb)는 나눠 쓰고 합쳐 읽으며, 바뀌지 않은 기록 칸은 다시 쓰지 않고, 예전(DB 버전 2) 칸을 그대로 읽는다.
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { runHeavyJob } from '../src/game/heavy';
import { joinSave, splitSave } from '../src/game/saveSplit';
import { GameSession, type GameSave, type GameSaveV2 } from '../src/game/session';
import { getSave, putSave, type SaveRecord } from '../src/game/storage';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const text = (x: unknown) => JSON.stringify(x);
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => {
  store = loadDataStore();
}, 120_000);

function toReady(g: GameSession): void {
  for (let k = 0; k < 5 && g.phase === 'offseason' && (g.offseason!.stage as string) !== 'ready'; k++) g.autoOffseason();
  expect(g.offseason!.stage).toBe('ready');
}

const rec = (slot: string, data: GameSave): SaveRecord => ({ slot, savedAt: '2026-11-25T00:00:00Z', year: data.year, teamName: 'KT', day: 0, summary: '', data });

describe('Worker 길 = 본 스레드 (Q55)', () => {
  // 두 시즌짜리 판 하나로 새 게임·결산·개막·미리 보기와 저장 나누기를 함께 본다
  let opts: { year: number; teamIdx: number; seed: string };
  let direct: GameSession;
  let save2027: GameSave;

  it('새 게임·결산·개막·개막 미리 보기·이어 하기·재현이 같다', () => {
    const kt = store.season(2026)!.teams.findIndex((t) => t.name === 'KT');
    opts = { year: 2026, teamIdx: kt, seed: 'heavy-save' };
    direct = GameSession.create(store, opts, FAST);

    // 새 게임
    const c = runHeavyJob(store, { kind: 'create', opts }, FAST);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(text(c.save)).toBe(text(direct.toSave()));
    const viaWorker = GameSession.load(store, roundTrip(c.save), FAST);
    direct.advance(100000);
    viaWorker.advance(100000);
    expect(text(viaWorker.toSave())).toBe(text(direct.toSave()));

    // 결산: Worker 결과를 들인(adopt) 세션 = 본 스레드에서 결산한 세션
    const before = roundTrip(direct.toSave());
    direct.beginOffseason();
    const b = runHeavyJob(store, { kind: 'begin-off', save: roundTrip(before) }, FAST);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(text(b.save)).toBe(text(direct.toSave()));
    viaWorker.adopt(roundTrip(b.save));
    expect(viaWorker.phase).toBe('offseason');
    expect(text(viaWorker.toSave())).toBe(text(direct.toSave()));

    // 개막 미리 보기와 개막
    toReady(direct);
    toReady(viaWorker);
    const ready = roundTrip(direct.toSave());
    const p = runHeavyJob(store, { kind: 'preview', save: roundTrip(ready) }, FAST);
    expect(p.ok).toBe(true);
    const pv = direct.previewOpening()!;
    if (p.ok) expect(text(GameSession.load(store, roundTrip(p.save), FAST).toSave())).toBe(text(pv.toSave()));
    expect(direct.openNextSeason().ok).toBe(true);
    const o = runHeavyJob(store, { kind: 'open', save: ready }, FAST);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    viaWorker.adopt(roundTrip(o.save));
    expect(viaWorker.year).toBe(2027);
    expect(text(viaWorker.toSave())).toBe(text(direct.toSave()));
    // 개막 미리 보기 = 실제 개막
    expect(pv.world.players.map((x) => x.id)).toEqual(direct.world.players.map((x) => x.id));

    // 이어 하기와 재현
    direct.advance(20);
    viaWorker.advance(20);
    expect(text(viaWorker.toSave())).toBe(text(direct.toSave()));
    const re = GameSession.replay(store, opts, viaWorker.actions, { year: 2027, day: viaWorker.day }, FAST);
    expect(text(re.toSave().season)).toBe(text(direct.toSave().season));
    save2027 = roundTrip(direct.toSave());
  }, 600_000);

  it('저장 나누기: 지난 시즌 몫을 떼고, 합치면 글자까지 같다', () => {
    const { main: m0, details } = splitSave(save2027);
    const main = m0 as GameSaveV2;
    // 2026 시즌 몫 (그보다 앞 해는 시작 전 실제 칭호·시상처럼 시작 때 들어온 기록)
    expect(details.map((d) => d.year)).toContain(2026);
    expect(details.every((d) => d.year < 2027)).toBe(true);
    expect(text(main).length).toBeLessThan(text(save2027).length);
    const d = details.find((x) => x.year === 2026)!;
    expect(Object.keys(d.arrays)).toEqual(expect.arrayContaining(['news', 'actions']));
    expect(Object.keys(d.history.league ?? {}).length).toBeGreaterThan(300);
    // 본 칸에는 2027 몫만
    expect(main.news.every((n) => (n.year ?? 2026) >= 2027)).toBe(true);
    expect(main.league.players.every((p) => (p.history ?? []).every((h) => h.year >= 2027))).toBe(true);
    expect(text(joinSave(main, roundTrip(details)))).toBe(text(save2027));
    // 넣은 저장은 그대로
    expect(save2027.news.some((n) => n.year === 2026)).toBe(true);
    // 합친 저장을 불러온 세션 = 원래 저장을 불러온 세션
    const a = GameSession.load(store, roundTrip(save2027), FAST);
    const b = GameSession.load(store, joinSave(roundTrip(main), roundTrip(details)), FAST);
    a.advance(5);
    b.advance(5);
    expect(text(b.toSave())).toBe(text(a.toSave()));
  }, 300_000);

  it('브라우저 저장소: 나눠 쓰고 합쳐 읽고, 바뀌지 않은 기록 칸은 다시 쓰지 않는다', async () => {
    globalThis.indexedDB = new IDBFactory();
    // 기록 칸 store(save-detail)에 들어가는 쓰기를 센다
    const puts: unknown[] = [];
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'save-detail') puts.push(args[1]);
      return orig.apply(this, args);
    };
    const years = splitSave(save2027).details.length;
    try {
      await putSave(rec('s', save2027));
      expect(puts.length).toBe(years);
      expect(text((await getSave('s'))!.data)).toBe(text(save2027));
      // 시즌을 조금 더 해도 지난 시즌 기록 칸은 그대로라 다시 쓰지 않는다
      const g = GameSession.load(store, roundTrip(save2027), FAST);
      g.advance(3);
      const later = roundTrip(g.toSave());
      await putSave(rec('s', later));
      expect(puts.length).toBe(years);
      expect(text((await getSave('s'))!.data)).toBe(text(later));
      // 지난 시즌 몫이 바뀌면 그 칸만 다시 쓰고, 옛 칸은 지운다
      const edited = roundTrip(later);
      edited.news.unshift({ year: 2026, day: -1, kind: 'season', text: '시험용 소식' });
      await putSave(rec('s', edited));
      expect(puts.length).toBe(years + 1);
      expect(text((await getSave('s'))!.data)).toBe(text(edited));
      // 지난 시즌 몫이 없는 저장 (첫 시즌): 기록 칸을 모두 지운다
      const first = roundTrip(save2027);
      first.year = 2026;
      await putSave(rec('s', first));
      expect(text((await getSave('s'))!.data)).toBe(text(first));
    } finally {
      IDBObjectStore.prototype.put = orig;
    }
  }, 120_000);

  it('예전(DB 버전 2) 칸은 나누지 않은 채 그대로 읽고, 다음 저장 때 나눈다', async () => {
    globalThis.indexedDB = new IDBFactory();
    // 버전 2의 모습: saves·save-info만, data가 저장 전체
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('kbo-gm', 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('saves', { keyPath: 'slot' });
        req.result.createObjectStore('save-info', { keyPath: 'slot' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction(['saves'], 'readwrite');
        t.objectStore('saves').put(rec('old', save2027));
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
    const r = await getSave('old');
    expect(text(r!.data)).toBe(text(save2027));
    await putSave(r!);
    expect(text((await getSave('old'))!.data)).toBe(text(save2027));
  }, 120_000);
});

describe('저장 나누기 규칙 (작은 예)', () => {
  const mk = (news: { year?: number; text: string }[], history: { year: number }[][]) => ({
    app: 'kbo-gm', format: 3, year: 2030, phase: 'season', teamIdx: 0, teamName: 'A', seed: 's',
    season: {}, news, actions: [],
    league: { players: history.map((h, i) => ({ id: `p${i}`, history: h })), ledger: [{ year: 2028, amount: 1 }, { year: 2030, amount: 2 }] },
  }) as unknown as GameSave;

  it('앞부분에서 연도가 줄지 않는 동안만 떼고, 순서가 섞인 뒤는 본 칸에 남긴다', () => {
    const save = mk(
      [{ year: 2028, text: 'a' }, { year: 2029, text: 'b' }, { year: 2028, text: 'c' }, { year: 2030, text: 'd' }, { text: 'e' }],
      [[{ year: 2028 }, { year: 2029 }, { year: 2030 }], [{ year: 2030 }], [{ year: 2029 }, { year: 2028 }]],
    );
    const { main: m0, details } = splitSave(save);
    const main = m0 as GameSaveV2;
    expect(details.map((d) => d.year)).toEqual([2028, 2029]);
    expect(main.news.map((n) => n.text)).toEqual(['c', 'd', 'e']);
    expect(main.league.players.map((p) => p.history.length)).toEqual([1, 1, 1]);
    expect(text(joinSave(main, details))).toBe(text(save));
  });

  it('같은 id가 둘이면 그 묶음 선수 기록은 떼지 않는다', () => {
    const save = mk([], [[{ year: 2028 }], [{ year: 2028 }]]);
    ((save as GameSaveV2).league.players[1] as { id: string }).id = 'p0';
    const { main: m0, details } = splitSave(save);
    const main = m0 as GameSaveV2;
    expect(main.league.players.map((p) => p.history.length)).toEqual([1, 1]);
    expect(details.every((d) => !d.history.league)).toBe(true);
    expect(text(joinSave(main, details))).toBe(text(save));
  });

  it('형식 1 저장과 연도 없는 저장은 나누지 않는다', () => {
    const v1 = { ...mk([{ year: 2028, text: 'a' }], []), format: 1 } as unknown as GameSave;
    expect(splitSave(v1).details).toEqual([]);
    const noYear = { ...mk([{ year: 2028, text: 'a' }], []), year: undefined } as unknown as GameSave;
    expect(splitSave(noYear).details).toEqual([]);
  });
});
