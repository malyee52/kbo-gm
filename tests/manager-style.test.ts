// 감독 작전 스타일 문구 (league/managerStyle.ts, 2026-11-12 사용자 그릴 Q39): 효과 크기는 그대로, 화면에 낱말로만 보인다
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { NEUTRAL_TACTICS, tacticsOf } from '../src/league/managers';
import { managerStyle } from '../src/league/managerStyle';

describe('감독 작전 스타일', () => {
  it('리그 평균(배율 1)이면 정석 운영 하나', () => {
    expect(managerStyle(NEUTRAL_TACTICS).map((t) => t.label)).toEqual(['정석 운영']);
  });

  it('문턱을 넘은 배율만 낱말이 되고 센 것부터 많아야 셋', () => {
    const t = { ...NEUTRAL_TACTICS, steal: 1.3, bunt: 0.85, hook: 0.97, pen: 1.02, ibb: 0.3 };
    const tags = managerStyle(t);
    expect(tags.length).toBe(3);
    expect(tags.map((x) => x.label)).toContain('적극 도루');
    expect(tags.map((x) => x.label)).toContain('정면 승부');
    expect(tags.map((x) => x.label)).not.toContain('불펜 연투 마다 않음'); // 1.02는 문턱 안
    for (let i = 1; i < tags.length; i++) expect(tags[i - 1].strength).toBeGreaterThanOrEqual(tags[i].strength);
    expect(managerStyle({ ...NEUTRAL_TACTICS, hook: 0.95 }).map((x) => x.label)).toEqual(['불펜 조기 투입']);
    expect(managerStyle({ ...NEUTRAL_TACTICS, bunt: 1.15 }).map((x) => x.label)).toEqual(['번트 선호']);
  });

  it('숫자를 드러내지 않는다 (문구·설명에 숫자 없음)', () => {
    const t = { ...NEUTRAL_TACTICS, steal: 1.4, bunt: 1.4, hook: 0.85, pen: 0.7, sub: 1.3, ibb: 2, cond: 1.5 };
    for (const x of managerStyle(t, 99)) {
      // '고의4구'는 용어라 빼고 본다
      expect(x.label.replace('고의4구', '')).not.toMatch(/\d/);
      expect(x.note.replace('고의4구', '')).not.toMatch(/\d/);
    }
  });

  it('실존 감독 명단: 모두 문구가 나오고 여러 스타일이 고루 보인다', () => {
    const store = loadDataStore();
    const names = Object.keys(store.managers?.people ?? {});
    expect(names.length).toBeGreaterThan(20);
    const seen = new Set<string>();
    for (const n of names) {
      const tags = managerStyle(tacticsOf(store.managers!.people[n], n, 2026));
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) seen.add(t.label);
    }
    // 한두 낱말에 몰리지 않는다 (문턱이 너무 높거나 낮지 않은지)
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
