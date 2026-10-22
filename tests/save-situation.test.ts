// 세이브 상황 (기록 규정 ①②, 2026-10-22 사용자 결정): 세이브·홀드·블론 세이브가 같은 판정을 쓴다
import { describe, expect, it } from 'vitest';
import { isSaveSituation } from '../src/engine/state';

describe('세이브 상황', () => {
  it('1~3점 리드는 주자와 관계없이 세이브 상황', () => {
    for (const lead of [1, 2, 3]) expect(isSaveSituation(lead, 0)).toBe(true);
  });

  it('4점 이상 리드는 동점 주자가 누상·타석·대기 타석에 있을 때만 (리드 ≤ 주자 + 2)', () => {
    expect(isSaveSituation(4, 1)).toBe(false);
    expect(isSaveSituation(4, 2)).toBe(true); // 주자 2명 + 타자 + 대기 타자가 동점 주자
    expect(isSaveSituation(5, 3)).toBe(true);
    expect(isSaveSituation(6, 3)).toBe(false);
  });

  it('동점·지는 경기는 세이브 상황이 아니다', () => {
    expect(isSaveSituation(0, 3)).toBe(false);
    expect(isSaveSituation(-2, 3)).toBe(false);
  });
});
