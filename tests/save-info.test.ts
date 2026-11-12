// 저장 요약 store (2026-11-11 편의 P1, game/storage.ts): 요약 레코드, 자동 저장 정리(최근 AUTO_KEEP개), DB 버전 1 → 2 올리기.
// IndexedDB는 fake-indexeddb로 흉내 낸다. 시험마다 새 IDBFactory를 써서 서로 섞이지 않게 한다.
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SEASON_SAVE_FORMAT } from '../src/engine';
import type { GameSave } from '../src/game/session';
import {
  AUTO_KEEP, AUTO_SLOT, autoSlotOf, deleteSave, getSave, getSaveInfo, infoOf, listSaveInfos,
  pruneAutoSaves, purgeOutdatedSaves, putSave, renameSave, type SaveRecord,
} from '../src/game/storage';

const data = (o: { phase?: string; news?: unknown[]; seasonFormat?: number; editor?: object } = {}) => ({
  app: 'kbo-gm', format: 3, phase: o.phase ?? 'season',
  season: { format: o.seasonFormat ?? SEASON_SAVE_FORMAT },
  news: o.news ?? [],
  league: o.editor ? { editor: o.editor } : {},
}) as unknown as GameSave;

const rec = (slot: string, savedAt: string, d: GameSave = data(), extra: Partial<SaveRecord> = {}): SaveRecord => ({
  slot, savedAt, year: 2026, teamName: 'LG', day: 10, summary: '1위', data: d, ...extra,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('저장 요약 레코드', () => {
  it('요약은 data를 빼고 오프시즌·시즌 종료·에디터·예전 형식을 담는다', () => {
    const plain = infoOf(rec('a', '2026-11-01T00:00:00Z'));
    expect('data' in plain).toBe(false);
    expect(plain).toMatchObject({ slot: 'a', year: 2026, teamName: 'LG', day: 10, summary: '1위', editor: null, offseason: false, done: false, outdated: false });

    const off = infoOf(rec('b', 'x', data({ phase: 'offseason' })));
    expect(off.offseason).toBe(true);
    expect(off.done).toBe(true);

    const done = infoOf(rec('c', 'x', data({ news: [{ year: 2026, kind: 'season', text: '정규시즌 종료: LG 1위' }] })));
    expect(done.done).toBe(true);
    // 지난 시즌의 종료 소식은 세지 않는다
    const lastYear = infoOf(rec('d', 'x', data({ news: [{ year: 2025, kind: 'season', text: '정규시즌 종료: LG 1위' }] })));
    expect(lastYear.done).toBe(false);

    expect(infoOf(rec('e', 'x', data({ editor: { firstEdit: 3 } }))).editor).toBe('고침');
    expect(infoOf(rec('f', 'x', data({ editor: {} }))).editor).toBe('보기');
    expect(infoOf(rec('g', 'x', data({ seasonFormat: 2 }))).outdated).toBe(true);
  });

  it('putSave는 데이터와 요약을 함께 쓰고, 이름 바꾸기·지우기도 요약에 닿는다', async () => {
    const r = rec('slot1', '2026-11-01T00:00:00Z');
    await putSave(r);
    expect((await getSave('slot1'))?.data).toEqual(r.data);
    expect(await getSaveInfo('slot1')).toEqual(infoOf(r));

    await renameSave('slot1', '  내 저장  ');
    expect((await getSaveInfo('slot1'))?.label).toBe('내 저장');
    expect((await getSave('slot1'))?.label).toBe('내 저장');

    await deleteSave('slot1');
    expect(await getSave('slot1')).toBeUndefined();
    expect(await getSaveInfo('slot1')).toBeUndefined();
  });

  it('목록은 최근 저장 순이고 예전 형식 칸만 지운다', async () => {
    await putSave(rec('old', '2026-11-01T00:00:00Z', data({ seasonFormat: 2 })));
    await putSave(rec('new', '2026-11-03T00:00:00Z'));
    await putSave(rec('mid', '2026-11-02T00:00:00Z'));
    expect((await listSaveInfos()).map((s) => s.slot)).toEqual(['new', 'mid', 'old']);
    expect(await purgeOutdatedSaves()).toBe(1);
    expect((await listSaveInfos()).map((s) => s.slot)).toEqual(['new', 'mid']);
    expect(await getSave('old')).toBeUndefined();
  });
});

describe('자동 저장 정리', () => {
  it(`이 게임 칸과 예전 'auto' 칸·수동 칸은 남기고, 다른 게임 자동 저장은 최근 ${AUTO_KEEP - 1}개만`, async () => {
    const mine = autoSlotOf(2026, 'me');
    await putSave(rec(AUTO_SLOT, '2026-01-01T00:00:00Z'));
    await putSave(rec('manual', '2026-01-02T00:00:00Z'));
    for (let i = 0; i < 5; i++) await putSave(rec(autoSlotOf(2026, `g${i}`), `2026-02-0${i + 1}T00:00:00Z`));
    await putSave(rec(mine, '2026-03-01T00:00:00Z'));

    const gone = await pruneAutoSaves(mine);
    expect(gone.sort()).toEqual(['g0', 'g1', 'g2'].map((s) => autoSlotOf(2026, s)).sort());
    const left = (await listSaveInfos()).map((s) => s.slot).sort();
    expect(left).toEqual([AUTO_SLOT, 'manual', mine, autoSlotOf(2026, 'g3'), autoSlotOf(2026, 'g4')].sort());
    // 지운 칸은 데이터도 없다
    expect(await getSave(autoSlotOf(2026, 'g0'))).toBeUndefined();
    // 자동 저장 칸 수 = 이 게임 + 다른 게임 AUTO_KEEP − 1개 (예전 'auto' 칸 빼고)
    expect(left.filter((s) => s.startsWith('auto:')).length).toBe(AUTO_KEEP);
  });
});

describe('DB 버전 1 → 2', () => {
  it('예전 DB(요약 store 없음)를 열면 있던 칸의 요약이 채워지고 그대로 불러와진다', async () => {
    const recs = [
      rec(autoSlotOf(2026, 'a'), '2026-11-01T00:00:00Z'),
      rec('manual', '2026-11-02T00:00:00Z', data({ phase: 'offseason' }), { label: '수동' }),
    ];
    // 버전 1 DB를 예전 코드처럼 만든다: 'saves' store 하나
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('kbo-gm', 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore('saves', { keyPath: 'slot' });
        for (const r of recs) s.put(r);
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });

    const infos = await listSaveInfos();
    expect(infos.map((s) => s.slot)).toEqual(['manual', autoSlotOf(2026, 'a')]);
    expect(infos[0]).toEqual(infoOf(recs[1]));
    expect(infos[0].label).toBe('수동');
    expect(infos[0].offseason).toBe(true);
    expect((await getSave('manual'))?.data).toEqual(recs[1].data);
    expect((await getSave(autoSlotOf(2026, 'a')))?.data).toEqual(recs[0].data);
  });
});
