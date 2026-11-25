// 엔진 단위를 승수로 (2026-11-25 Q65, src/league/winsScale.ts). 눈금은 reports/nominal-content.md 0절.
import { describe, expect, it } from 'vitest';
import { formWins, runsWinsText, winsText, withWins } from '../src/league/winsScale';
import { EVENTS } from '../src/league/events';

describe('승수 눈금', () => {
  it('구단 전체 +0.01을 시즌 내내 = 2.87승, 11점 = 1승', () => {
    expect(formWins(0.01, 365)).toBeCloseTo(2.87, 2);
    expect(formWins(0.01, 365, 'bat')).toBeCloseTo(1.51, 2);
    expect(runsWinsText(11)).toBe('약 +1.0승');
    expect(runsWinsText(-4)).toBe('약 −0.4승');
    expect(winsText(0.034)).toBe('약 +0.03승');
  });

  it('선택지 글의 경기력 %p를 승수로 바꾸고, 관중률 %p는 그대로 둔다', () => {
    expect(withWins('반반: 7일 동안 팀 경기력 +3.0 / −1.8')).toBe(`반반: 7일 동안 팀 경기력 ${winsText(formWins(0.03, 7))} / ${winsText(formWins(-0.018, 7))}`);
    expect(withWins('10일 동안 팀 경기력 +3.0·관중률 +10%p, 그 뒤 7일 동안 −1.0 (반동)'))
      .toBe(`10일 동안 팀 경기력 ${winsText(formWins(0.03, 10))}·관중률 +10%p, 그 뒤 7일 동안 ${winsText(formWins(-0.01, 7))} (반동)`);
    expect(withWins('14일 동안 투수 경기력 +3.2')).toBe(`14일 동안 투수 경기력 ${winsText(formWins(0.032, 14, 'pit'))}`);
    expect(withWins('3일 동안 그 선수 경기력 −2.0')).toBe(`3일 동안 그 선수 경기력 ${winsText(formWins(-0.02, 3, 'player'))}`);
    expect(withWins('30일 동안 관중률 −6%p')).toBe('30일 동안 관중률 −6%p');
  });

  it('모든 이벤트 선택지 글에서 "경기력 +3.0" 꼴의 엔진 단위가 남지 않는다', () => {
    // 선택지 글은 상황 값으로 만든다: 글을 만들 수 있는 것만 본다 (값이 없으면 던지는 글은 건너뜀)
    const ctx = new Proxy({}, { get: () => () => 0 }) as never;
    let seen = 0;
    for (const ev of EVENTS) {
      for (const ch of ev.choices) {
        let t: string;
        try { t = ch.note(ctx, {} as never); } catch { continue; }
        if (!t.includes('경기력')) continue;
        seen++;
        expect(withWins(t), `${ev.id}: ${t}`).not.toMatch(/경기력 [+−-]\d|동안 [+−-]\d+(\.\d+)?(?!\d*%)/);
      }
    }
    expect(seen).toBeGreaterThan(20);
  });
});
