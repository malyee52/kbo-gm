// 배포 병역 자료(military.json)에 보충역 구분을 남기지 않는다 (2026-10-24 사용자 M9 Q5 ①).
// 위키 병역 칸의 현역·보충역은 unit '복무' 하나로 내보내고, 게임은 그것을 현역 규칙으로 본다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MilitaryRecord } from '../src/data/types';
import { SERVICE_UNIT_GENERIC, serviceName } from '../src/league/careers';
import { servingAt } from '../src/league/missing';

const file = JSON.parse(readFileSync('public/data/military.json', 'utf-8')) as { players: Record<string, MilitaryRecord & { served?: { kind?: string } }> };

describe('배포 병역 자료', () => {
  it('선수 칸에 보충역·복무 형태(kind)가 없다', () => {
    const recs = Object.values(file.players);
    expect(recs.some((r) => r.served?.unit === SERVICE_UNIT_GENERIC)).toBe(true);
    for (const r of recs) {
      expect(r.served?.kind).toBeUndefined();
      expect(r.served?.unit).not.toBe('보충역');
      expect(r.served?.unit).not.toBe('현역');
    }
  });

  it("시작 때 복무 중인 '복무'는 현역 규칙, 군 야구단은 그대로", () => {
    const store = { military: { a: { src: 'wiki', served: { unit: SERVICE_UNIT_GENERIC, end: 2020 } }, b: { served: { unit: '상무', end: 2020 } } } } as const;
    const a = servingAt(store as never, 'a', 2019)!;
    expect(a).toMatchObject({ state: 'serving', kind: 'active', returnYear: 2021 });
    expect(serviceName(a)).toBe('군 복무');
    const b = servingAt(store as never, 'b', 2019)!;
    expect(b.kind).toBeUndefined();
    expect(serviceName(b)).toBe('상무');
  });
});
