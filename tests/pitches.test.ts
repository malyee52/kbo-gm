// 능력치 v2 16-1a·16-1b: 구종 자료 (pitches.json)와 가공 함수 (src/data/pitches.ts).
// 숫자는 docs/능력치v2_기획안.md 15.5 ④ 가의 예 표(폰세·안우진·고우석·원태인)와 15.5 ②의 예(직구·포크볼 주무기·슬라이더·커브)다.
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { invNorm, measuredArsenal, measuredGrade, rankShares, wikiArsenal } from '../src/data/pitches';
import type { WikiPitcher } from '../src/data/types';

const store = loadDataStore();
const data = store.pitches!;

function idOf(name: string): string {
  const c = [...store.players.values()].filter((p) => p.name === name && data.players[p.id]);
  expect(c, name).toHaveLength(1);
  return c[0].id;
}

/** 한 시즌 값으로 낸 등급 (합치기 없음, 기획안 예 표와 같은 조건) */
function grade(name: string, year: number, type: string) {
  const v = data.players[idOf(name)][String(year)][type];
  const f = data.fields;
  return measuredGrade(data.prior, type, [{ year, rv: v[f.indexOf('rv')]!, n: v[f.indexOf('n')]! }]);
}

describe('구종 자료 (pitches.json)', () => {
  it('불러오고, 선수 ID가 모두 선수 마스터의 투수다', () => {
    expect(data).toBeDefined();
    expect(data.from).toBe(2016);
    for (const id of Object.keys(data.players)) expect(store.players.get(id)?.kind).toMatch(/P/);
    for (const id of Object.keys(data.wiki.players)) expect(store.players.get(id)?.kind).toMatch(/P/);
  });

  it('투수·시즌별 사용률 합은 100 ± 1', () => {
    const iu = data.fields.indexOf('usage');
    for (const ys of Object.values(data.players))
      for (const pt of Object.values(ys)) {
        const u = Object.values(pt).map((v) => v[iu]).filter((x): x is number => x !== null);
        if (u.length) expect(Math.abs(u.reduce((a, x) => a + x, 0) - 100)).toBeLessThanOrEqual(1);
      }
  });

  it('구종 가치 등급 표: 기준 행 100 이상인 7구종은 자기 표, 스위퍼·싱커는 빌림, 너클볼은 없음', () => {
    expect(Object.keys(data.prior.rv.tables).sort()).toEqual(['슬라이더', '체인지업', '커브', '커터', '투심', '포심', '포크'].sort());
    expect(data.prior.rv.borrow).toEqual({ 스위퍼: '슬라이더', 싱커: '투심' });
    expect(data.prior.rv.tables['포심'].c.length).toBeGreaterThan(1300);
  });

  it('측정 표가 기획안 15.5와 같은 꼴: 구종 2개 72.1 · 27.9, 2016 포심 평균 약 140, 투심 −2.2', () => {
    expect(data.prior.share['2'].s).toEqual([72.1, 27.9]);
    expect(data.prior.fbSpeed['2016']).toBeCloseTo(140.3, 0);
    expect(data.prior.speedDiff['투심'][0]).toBeCloseTo(-2.2, 1);
  });
});

describe('실측 구종 등급 (15.5 ④ 가)', () => {
  it('invNorm: Φ⁻¹(0.5) = 0, Φ⁻¹(0.975) ≈ 1.96', () => {
    expect(invNorm(0.5)).toBeCloseTo(0, 9);
    expect(invNorm(0.975)).toBeCloseTo(1.959964, 5);
    expect(invNorm(0.01)).toBeCloseTo(-2.326348, 5);
  });

  it('폰세 2025: 포심 69 · 체인지업 67 · 슬라이더 66 · 커터 59 (w 0.49) · 커브 56 · 포크 53 (w 0.14) · 투심 41', () => {
    expect(grade('폰세', 2025, '포심')).toBe(69);
    expect(grade('폰세', 2025, '체인지업')).toBe(67);
    expect(grade('폰세', 2025, '슬라이더')).toBe(66);
    expect(grade('폰세', 2025, '커터')).toBe(59);
    expect(grade('폰세', 2025, '커브')).toBe(56);
    expect(grade('폰세', 2025, '포크')).toBe(53);
    expect(grade('폰세', 2025, '투심')).toBe(41);
  });

  it('안우진 2022 65 · 65 · 61 · 57, 고우석 2019 커브 22구는 표본 적음, 원태인 2019 커브만 50 위', () => {
    expect(['포심', '체인지업', '슬라이더', '커브'].map((t) => grade('안우진', 2022, t))).toEqual([65, 65, 61, 57]);
    expect(['포심', '슬라이더', '커브'].map((t) => grade('고우석', 2019, t))).toEqual([63, 63, 'small']);
    expect(['포심', '체인지업', '슬라이더', '커브'].map((t) => grade('원태인', 2019, t))).toEqual([48, 46, 42, 54]);
  });

  it('표 빌리기: 스위퍼는 슬라이더 표, 너클볼은 등급 없음', () => {
    const p = [{ year: 2025, rv: -1, n: 400 }];
    expect(measuredGrade(data.prior, '스위퍼', p)).toBe(measuredGrade(data.prior, '슬라이더', p));
    expect(measuredGrade(data.prior, '너클볼', p)).toBeNull();
  });

  it('measuredArsenal: 폰세 2026 시작은 2025 시즌, 사용률 순, 포크(42구)는 2024 자료가 없어 그대로 53', () => {
    const a = measuredArsenal(data, idOf('폰세'), 2026)!;
    expect(a[0].type).toBe('포심');
    expect(a.every((x) => x.year === 2025)).toBe(true);
    expect(a.find((x) => x.type === '포크')!.grade).toBe(53);
    expect(measuredArsenal(data, idOf('폰세'), 2016)).toBeNull();
  });
});

describe('위키 구종 목록과 사용률 짐작 (15.5 ①②, 15.6 1.0)', () => {
  const plan = { share: { '4': { n: 948, s: [54.4, 28.3, 12.7, 5.0] }, '5': { n: 859, s: [51.4, 27.7, 14.1, 6.7, 2.2] } } };

  it('기획안 예: 직구 · 슬라이더 · 포크볼(주무기) · 커브 → 직구 50 · 포크볼 30 · 슬라이더 15 · 커브 5', () => {
    const w: WikiPitcher = { p: [['포심', 0, 0, null, null], ['슬라이더', 1, 0, null, null], ['포크', 2, 1, null, null], ['커브', 3, 0, null, null]], top: 150 };
    const lines = wikiArsenal(w, ['직구', '슬라이더', '포크볼', '커브'], plan, 2005);
    expect(lines.map((l) => [l.name, l.share])).toEqual([['직구', 50], ['포크볼', 30], ['슬라이더', 15], ['커브', 5]]);
  });

  it('싱커는 투심으로 계산하고 투심과 한 줄로 합친다 (데스파이네: 포심·투심·커터·체인지업·커브·싱커 → 5줄)', () => {
    const id = '50040';
    expect(store.players.get(id)!.name).toBe('데스파이네');
    const lines = wikiArsenal(data.wiki.players[id], data.wiki.names, data.prior, 2020);
    expect(lines).toHaveLength(5);
    expect(lines.find((l) => l.type === '투심')!.name).toBe('투심·싱커');
    expect(lines.some((l) => l.type === '싱커')).toBe(false);
  });

  it('주무기 표시 3개는 없는 것으로, 빠른 공이 없으면 "빠른 공 (위키에 없음)"을 맨 앞에 (이주엽)', () => {
    const id = '50262';
    expect(store.players.get(id)!.name).toBe('이주엽');
    const lines = wikiArsenal(data.wiki.players[id], data.wiki.names, data.prior, 2022);
    expect(lines[0]).toMatchObject({ name: '빠른 공 (위키에 없음)', type: '포심', added: true });
    expect(lines.every((l) => !l.main)).toBe(true);
    expect(lines.map((l) => l.type)).toEqual(['포심', '슬라이더', '커브', '체인지업']);
  });

  it('시기가 적힌 구종은 그 시기에만 (스탁: 투심 ~2019, 커터 2020~)', () => {
    const id = '52234';
    const at = (y: number) => wikiArsenal(data.wiki.players[id], data.wiki.names, data.prior, y).map((l) => l.type);
    expect(at(2019)).toContain('투심');
    expect(at(2019)).not.toContain('커터');
    expect(at(2022)).toContain('커터');
    expect(at(2022)).not.toContain('투심');
  });

  it('너클볼·기타는 맨 뒤 가끔, 구종 하나면 주로', () => {
    const w: WikiPitcher = { p: [['포심', 0, 0, null, null], ['너클볼', 1, 0, null, null]], top: null };
    expect(wikiArsenal(w, ['직구', '너클볼'], plan, 2000).map((l) => l.share)).toEqual(['mostly', 'rare']);
  });

  it('구종 6개: 5개 표에 6위 1%를 두고 비례로 줄임, 5% 밑은 가끔, 합 100이 되게 1위', () => {
    const s = rankShares(plan, 6);
    expect(s[4]).toBe('rare');
    expect(s[5]).toBe('rare');
    expect((s.filter((x) => typeof x === 'number') as number[]).reduce((a, x) => a + x, 0)).toBe(100);
  });
});
