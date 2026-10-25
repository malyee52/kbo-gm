// 브라우저 저장 정리 기준 (game/storage.ts): 시즌 저장 형식이 3(일정 개편) 미만이거나 세션 형식 2(잠재력 v2 이전)인 칸만 지운다. 일정 개편 기획안 6.1
import { describe, expect, it } from 'vitest';
import { isOutdatedSave } from '../src/game/storage';
import type { GameSave } from '../src/game/session';

const save = (seasonFormat: unknown, format = 3) => ({ app: 'kbo-gm', format, season: { format: seasonFormat } }) as unknown as GameSave;

describe('예전 형식 저장 정리', () => {
  it('시즌 형식 1·2(엔진 2·일정 개편 이전)와 형식을 알 수 없는 저장은 지울 대상', () => {
    expect(isOutdatedSave(save(1))).toBe(true);
    expect(isOutdatedSave(save(2))).toBe(true);
    expect(isOutdatedSave(save(undefined))).toBe(true);
    expect(isOutdatedSave({} as GameSave)).toBe(true);
  });

  it('시즌 형식 3 저장은 남긴다', () => {
    expect(isOutdatedSave(save(3))).toBe(false);
  });

  it('세션 형식 2(잠재력 v2 이전)는 시즌 형식이 3이어도 지울 대상 (16-4)', () => {
    expect(isOutdatedSave(save(3, 2))).toBe(true);
  });
});
