// 환경 맞춤 디스크 캐시 (tools/calCache.ts): 캐시를 거쳐도 맞춤 값이 같아야 하고, 월드·조정값·시드가 다르면 다른 칸을 써야 한다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { calibrate, DEFAULT_PARAMS, Rng, setCalibrationCache, worldForYear, type World } from '../src/engine';
import { canonical, diskCalCache } from '../tools/calCache';

const P = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
let world: World;
let dir: string;

beforeAll(() => {
  // 6구단 80경기라 예비 시즌이 가볍다
  world = worldForYear(loadDataStore(), 1982, P);
  dir = mkdtempSync(join(tmpdir(), 'kbo-cal-'));
});

afterAll(() => {
  setCalibrationCache(undefined);
  rmSync(dir, { recursive: true, force: true });
});

describe('환경 맞춤 캐시', () => {
  it('맞춤은 월드를 바꾸지 않는다 (캐시가 예비 시즌을 건너뛰어도 되는 근거)', () => {
    setCalibrationCache(undefined);
    const before = canonical(world);
    calibrate(world, P, new Rng('cal-a'));
    expect(canonical(world)).toBe(before);
  });

  it('캐시 없이, 처음(놓침), 다시(적중) 모두 같은 값', () => {
    setCalibrationCache(undefined);
    const plain = calibrate(world, P, new Rng('cal-b'));
    const cache = diskCalCache(dir);
    setCalibrationCache(cache);
    const cold = calibrate(world, P, new Rng('cal-b'));
    const warm = calibrate(world, P, new Rng('cal-b'));
    expect(cache.stats).toEqual({ hits: 1, misses: 1, skipped: 0 });
    expect(cold).toEqual(plain);
    expect(warm).toEqual(plain);
    // 돌려준 값을 고쳐도 캐시에 남은 값은 그대로
    warm.hr = 0;
    expect(calibrate(world, P, new Rng('cal-b'))).toEqual(plain);
  });

  it('시드·조정값·월드가 하나라도 다르면 놓친다', () => {
    const cache = diskCalCache(dir);
    setCalibrationCache(cache);
    calibrate(world, P, new Rng('cal-b'));
    expect(cache.stats.hits).toBe(1);
    // 같은 월드를 글로 바꿔 보기만: 키가 달라지는지는 canonical로 본다 (맞춤을 또 돌리지 않으려고)
    const w2 = structuredClone(world);
    expect(canonical(w2)).toBe(canonical(world));
    w2.players[0].value += 1e-9;
    expect(canonical(w2)).not.toBe(canonical(world));
    expect(canonical({ ...P, pilotSeasons: 2 })).not.toBe(canonical(P));
    setCalibrationCache(undefined);
  });

  it('글쓰기는 undefined·빈 칸·NaN·-0·Map·형식 배열을 구별하고 함수는 거절한다', () => {
    expect(canonical({ a: undefined })).not.toBe(canonical({}));
    expect(canonical([, 1])).not.toBe(canonical([undefined, 1])); // eslint-disable-line no-sparse-arrays
    expect(canonical(NaN)).not.toBe(canonical(null));
    expect(canonical(-0)).not.toBe(canonical(0));
    expect(canonical(new Map([[1, 2]]))).not.toBe(canonical({ 1: 2 }));
    expect(canonical(new Float32Array([1]))).not.toBe(canonical(new Int32Array([1])));
    expect(() => canonical({ f: () => 1 })).toThrow();
  });
});
