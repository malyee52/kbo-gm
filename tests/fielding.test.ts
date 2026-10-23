// 능력치 v2 16-3a: 수비 판정 함수 (src/engine/fielding.ts). 기획안 14.7 첫 카드 시험 + 15.8 퓨처스 이닝 하나.
// 숫자는 docs/능력치v2_기획안.md 12.1·12.2·13.2·14.1·14.2·15.3의 측정값이다.
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { emergencyCatcher, familiarity, fieldYears, mainPosition, playable, reputationWeight, type FieldYear } from '../src/engine/fielding';
import type { FieldPos } from '../src/engine/defense';

const store = loadDataStore();

function idOf(name: string, birthYear?: number): string {
  const c = [...store.players.values()].filter((p) => p.name === name && (birthYear === undefined || p.birthYear === birthYear));
  expect(c, `${name} ${birthYear ?? ''}`).toHaveLength(1);
  return c[0].id;
}

function judge(id: string, start: number) {
  const years = fieldYears(store, id, start);
  const main = mainPosition(years, start);
  return { years, main, playable: playable(years, start, main), emergency: emergencyCatcher(years, start, main), u: (p: FieldPos) => familiarity(years, start, p, main) };
}

describe('수비 자료 (defense.json)', () => {
  it('불러오고, 선수 ID가 모두 선수 마스터에 있다', () => {
    const d = store.defense!;
    expect(d).toBeDefined();
    expect(d.from).toBe(2001);
    for (const id of Object.keys(d.players)) expect(store.players.has(id)).toBe(true);
    for (const id of Object.keys(d.rep)) expect(store.players.has(id)).toBe(true);
  });
});

describe('주 포지션 (12.2)', () => {
  it('강백호 2026: 화면 DH, 수비 본 자리 1B (포수 202이닝·선발 23으로 포수 규칙 탈락, 3시즌 447이닝이라 커리어 최다 1B)', () => {
    const j = judge(idOf('강백호'), 2026);
    expect(j.main.screen).toBe('DH');
    expect(j.main.field).toBe('1B');
    expect(j.main.basis).toBe('career');
    expect(j.main.noDefShare).toBeCloseTo(0.76, 1);
  });

  it('강백호 2024: 화면도 1B (수비 없는 몫 0.32)', () => {
    const j = judge(idOf('강백호'), 2024);
    expect(j.main.screen).toBe('1B');
    expect(j.main.field).toBe('1B');
  });

  it('김건희 2026: 포수 규칙 통과 → C', () => {
    const j = judge(idOf('김건희', 2004), 2026);
    expect(j.main.screen).toBe('C');
    expect(j.main.basis).toBe('catcher');
    expect(j.playable).toContain('C');
  });

  it('2026 시작 포수 기준 통과 (직전 3시즌 포수 500이닝 또는 선발 60) 23명', () => {
    const n = Object.keys(store.defense!.players).filter((id) => judge(id, 2026).main.basis === 'catcher').length;
    expect(n).toBe(23);
  });
});

describe('익숙함·수비 가능·비상 포수 (13.1·13.2·14.1·14.2)', () => {
  it('강백호 2026: 1B 가능, LF 불가 (마지막 2018 → 최근성), C는 가능이 아니고 비상 포수 (C 204.7이닝 ÷ 900)', () => {
    const j = judge(idOf('강백호'), 2026);
    expect(j.playable).toContain('1B');
    expect(j.playable).not.toContain('LF');
    expect(j.playable).not.toContain('C');
    expect(j.u('C')).toBeCloseTo(0.23, 2);
    expect(j.emergency).toBe(true);
  });

  it('강백호 2025·2027 시작도 비상 포수, 2028 시작은 C 불가 (직전 3시즌 C 32.7이닝 < 150)', () => {
    const kb = idOf('강백호');
    expect(judge(kb, 2025).emergency).toBe(true);
    expect(judge(kb, 2027).emergency).toBe(true);
    const j = judge(kb, 2028);
    expect(j.playable).not.toContain('C');
    expect(j.emergency).toBe(false);
  });

  it('김도영 2026: SS 가능 (2022~2023 192이닝, 3B → SS 100이닝에 다 참), 2B 불가 (유사 포지션은 본 자리에서만)', () => {
    const j = judge(idOf('김도영', 2003), 2026);
    expect(j.main.field).toBe('3B');
    expect(j.playable).toContain('SS');
    expect(j.playable).not.toContain('2B');
  });

  it('해 보지 않은 자리는 익숙함 0', () => {
    const j = judge(idOf('김건희', 2004), 2026);
    for (const p of ['2B', 'SS', 'LF', 'CF', 'RF'] as FieldPos[]) expect(j.u(p)).toBe(0);
  });

  it('2026 시작 비상 포수는 2명 (강백호, 김재성)', () => {
    const ids = new Set(store.season(2026)!.bat.map((b) => b.id));
    const names = [...ids].filter((id) => judge(id, 2026).emergency).map((id) => store.players.get(id)!.name).sort();
    expect(names).toEqual(['강백호', '김재성']);
  });

  it('퓨처스 이닝 (15.8): 누적 C 205 + 퓨처스 700 → W_F 1이면 정규 포수, 0.7이면 u 0.77 비상 포수', () => {
    // 1군 C 205이닝은 판정 창(직전 3시즌) 밖, 퓨처스 C 700이닝은 게임 첫 해(2026). 본 자리는 1B
    const years: FieldYear[] = [
      { year: 2022, inn: { C: 205, '1B': 600 }, gs: { C: 20, '1B': 70 }, pa: 500, noDefPa: 0 },
      { year: 2025, inn: { '1B': 900 }, gs: { '1B': 105 }, pa: 500, noDefPa: 0 },
      { year: 2026, fut: { C: 700 }, pa: 0, noDefPa: 0 },
    ];
    const m1 = mainPosition(years, 2027, { futWeight: 1 });
    expect(familiarity(years, 2027, 'C', m1, { futWeight: 1 })).toBe(1);
    expect(playable(years, 2027, m1, { futWeight: 1 })).toContain('C');
    const m07 = mainPosition(years, 2027, { futWeight: 0.7 });
    expect(m07.field).toBe('1B');
    expect(familiarity(years, 2027, 'C', m07, { futWeight: 0.7 })).toBeCloseTo(0.77, 2);
    expect(emergencyCatcher(years, 2027, m07, { futWeight: 0.7 })).toBe(true);
  });
});

describe('평판 무게 (12.4 ①)', () => {
  it('오지환 2012 시작: 시기 없는 SS 매우 좋음은 SS 누적 1,383이닝 ÷ 2,300 = 0.60, 유사 포지션 2B도 같은 무게', () => {
    const id = idOf('오지환');
    const years = fieldYears(store, id, 2012);
    const rep = store.defense!.rep[id].find((r) => r[0] === 'SS')!;
    const w = reputationWeight(rep, years, 2012);
    expect(w.SS).toBeCloseTo(0.6, 2);
    expect(w['2B']).toBeCloseTo(0.6, 2);
  });

  it('앞날 평판은 시작 등급에 쓰지 않는다, 지명타자 몫이 큰 시기의 좋음 이상은 버린다', () => {
    const kgh = idOf('김건희', 2004);
    const rep = store.defense!.rep[kgh].find((r) => r[0] === 'C')!; // C 좋음 2024~2025
    expect(reputationWeight(rep, fieldYears(store, kgh, 2024), 2024)).toEqual({});
    expect(reputationWeight(rep, fieldYears(store, kgh, 2026), 2026).C).toBe(1);
    const chw = idOf('최형우');
    const lf = store.defense!.rep[chw].find((r) => r[0] === 'LF')!; // LF 매우 좋음 2020~2025, 그 시기 DH 90%
    expect(reputationWeight(lf, fieldYears(store, chw, 2026), 2026)).toEqual({});
  });
});
