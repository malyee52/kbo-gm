// 시작 불펜 서열 (2026-10-22, docs/하드힛_현실감_기획안.md 2.1): 개막에는 지난 시즌 실제 쓰임 순, 시즌이 지나며 능력 순
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { bullpenOrder, DEFAULT_PARAMS, penTrustOf, type SimPlayer } from '../src/engine';
import { GameSession } from '../src/game/session';

const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const fake = (name: string, value: number, penTrust?: number) => ({ name, value, ...(penTrust ? { penTrust } : {}) }) as unknown as SimPlayer;

describe('불펜 서열', () => {
  it('신뢰도: gmLI가 있으면 그 값, 없으면 1 + (세이브+홀드)/구원 등판, 구원 10번 미만은 0', () => {
    expect(penTrustOf(50, 30, 0, 1.9)).toBe(1.9);
    expect(penTrustOf(50, 0, 25, null)).toBeCloseTo(1.5);
    expect(penTrustOf(9, 5, 3, 2.0)).toBe(0);
  });

  it('개막에는 쓰임 순, blendDays가 지나면 능력 순, 그 사이는 섞인다', () => {
    // value는 작을수록 좋다: 능력 순 A B C D, 쓰임 순 D C (A B는 쓰임 모름)
    const pen = [fake('A', 1), fake('B', 2), fake('C', 3, 1.4), fake('D', 4, 1.8)];
    const names = (day: number) => bullpenOrder(pen, day, 100).map((p) => p.name).join('');
    expect(names(0)).toBe('DCAB');
    expect(names(100)).toBe('ABCD');
    expect(names(500)).toBe('ABCD');
    // day 50: 키 = 0.5 × 쓰임 순위 + 0.5 × 능력 순위 → A 1, C 1.5, D 1.5 (같으면 능력 순), B 2
    expect(names(50)).toBe('ACDB');
    // 쓰임 정보가 하나도 없으면 능력 순 그대로
    expect(bullpenOrder([fake('B', 2), fake('A', 1)], 0, 100).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('2025 시작: 실제로 쓰인 구원 투수에게 신뢰도가 붙고, 저장·불러오기 뒤에도 같다', () => {
    const store = loadDataStore();
    const g = GameSession.create(store, { year: 2025, teamIdx: 0, seed: 'pen-order' }, FAST);
    const trusted = g.world.players.filter((p) => p.isPitcher && p.penTrust);
    expect(trusted.length).toBeGreaterThan(100);
    // 2025 하드힛 gmLI가 들어 있다 (마무리급은 1.5 이상)
    expect(trusted.some((p) => p.penTrust! >= 1.5)).toBe(true);
    const b = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())), FAST);
    for (const p of trusted) expect(b.world.players[p.idx].penTrust).toBe(p.penTrust);
  });
});
