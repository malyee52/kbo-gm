// 2026-11-12 사용자 결정: 기본 모드는 경영 > 구단주 칸을 빼고 구단 현황에 신뢰도 추이·예산 회의 기록을 둔다. 판타지 모드는 칸 그대로.
// 올스타전 화면도 메뉴에서 빠졌다 (소식·기사로만).
import { describe, expect, it } from 'vitest';
import type { GameSession } from '../src/game/session';
import { userMeetings, type MeetingRecord } from '../src/league/meeting';
import { hidden, MENU } from '../src/ui/menu';

const rec = (year: number): MeetingRecord => ({ year, ask: 'none', result: 'none', goalShift: 0, trust: 1, reason: '' });

describe('구단주 칸 합치기', () => {
  it('구단주 칸은 판타지 모드에서만 보이고, 올스타 칸은 없다', () => {
    const owner = MENU.find((m) => m.key === 'owner')!;
    expect(hidden({ fantasy: false } as unknown as GameSession, owner)).toBe(true);
    expect(hidden({ fantasy: true } as unknown as GameSession, owner)).toBe(false);
    expect(MENU.some((m) => m.tabs.some((t) => (t.screen as string) === 'allstar'))).toBe(false);
  });

  it('예산 회의 기록은 지금 구단을 맡은 시즌 것만, 최근부터', () => {
    // 2026·2027은 구단 0, 2028은 구단 3(해고 뒤 부임), 2029는 아직 평가 전(지금 구단 3)
    const history = [{ year: 2026, team: 0 }, { year: 2027, team: 0 }, { year: 2028, team: 3 }];
    // 구단 3의 장부: 2027은 부임 전 AI 회의, 2028·2029는 플레이어
    expect(userMeetings(history, [rec(2027), rec(2028), rec(2029)], 3).map((m) => m.year)).toEqual([2029, 2028]);
    expect(userMeetings(history, [rec(2026), rec(2027)], 0).map((m) => m.year)).toEqual([2027, 2026]);
    // 첫 시즌 (평가 전): 회의 기록은 지금 구단 것
    expect(userMeetings([], [rec(2027)], 5).map((m) => m.year)).toEqual([2027]);
    expect(userMeetings([], undefined, 5)).toEqual([]);
  });
});
