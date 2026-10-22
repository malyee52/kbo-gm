// 일정 규칙 표 (schedule.json, data-src/일정규칙.csv) 읽기. 일정 개편 기획안 8장 1단계
import { describe, expect, it } from 'vitest';
import { loadDataStore } from '../src/data/loadNode';
import { addDays, daysBetween, scheduleRule, weekdayOf } from '../src/data/schedule';

const store = loadDataStore();
const data = store.schedule!;

describe('일정 규칙 표', () => {
  it('데이터 창구가 schedule.json을 읽는다', () => {
    expect(data).toBeDefined();
    expect(Object.keys(data.years).length).toBe(store.meta.years.length);
  });

  it('자료가 있는 모든 해: 팀당 경기와 구단 수가 시즌 자료와 같다', () => {
    for (const y of store.meta.years) {
      const r = scheduleRule(data, y)!;
      const sd = store.season(y)!;
      expect(r.projected, `${y}`).toBe(false);
      expect(r.teams, `${y}`).toBe(sd.teams.length);
      if (!store.meta.inProgress?.includes(y)) {
        for (const t of sd.teams) expect(t.g, `${y} ${t.name}`).toBe(r.games);
      }
    }
  });

  it('1999: 양대 리그 같은 리그 20·다른 리그 18, 2연전기는 올스타 뒤', () => {
    const r = scheduleRule(data, 1999)!;
    expect([r.teams, r.games, r.vs, r.vsOther, r.frame]).toEqual([8, 132, 20, 18, 'S33-99']);
    expect(r.twoGameFrom).toBe('allStar');
    expect(r.opening).toBe('1999-04-03');
  });

  it('2026: 개막 3/28(토), 올스타 7/11, 휴식 7/10~7/15, 아시안게임은 더블헤더만 금지', () => {
    const r = scheduleRule(data, 2026)!;
    expect(r.opening).toBe('2026-03-28');
    expect(weekdayOf(r.opening)).toBe(6);
    expect(r.allStar).toBe('2026-07-11');
    expect(r.breaks).toEqual([{ from: '2026-07-10', to: '2026-07-15', reason: '올스타' }]);
    expect(r.dhBan).toContainEqual({ from: '2026-09-19', to: '2026-10-04' });
    expect([r.frame, r.unscheduled, r.postpone]).toEqual(['S33F', 9, 'R5']);
  });

  it('2020은 5/5(화) 개막·올스타 없음, 2021은 올림픽 중단', () => {
    const r = scheduleRule(data, 2020)!;
    expect(r.opening).toBe('2020-05-05');
    expect(weekdayOf(r.opening)).toBe(2);
    expect(r.allStar).toBeNull();
    const r21 = scheduleRule(data, 2021)!;
    expect(r21.allStar).toBeNull();
    expect(r21.breaks).toEqual([{ from: '2021-07-13', to: '2021-08-09', reason: '코로나·올림픽' }]);
  });

  it('1988은 가을야구 10/8 시작, 다른 해는 시작일이 없다', () => {
    expect(scheduleRule(data, 1988)!.postseasonStart).toBe('1988-10-08');
    expect(scheduleRule(data, 1989)!.postseasonStart).toBeUndefined();
  });

  it('2027~: 3월 넷째 토요일 개막, 7월 둘째 토요일 올스타, 휴식 금~수 (2026 모양)', () => {
    for (let y = 2027; y <= 2060; y++) {
      const r = scheduleRule(data, y)!;
      expect(r.projected).toBe(true);
      expect(r.teams).toBeUndefined();
      expect(weekdayOf(r.opening)).toBe(6);
      const od = Number(r.opening.slice(8));
      expect(r.opening.slice(5, 7)).toBe('03');
      expect(od >= 22 && od <= 28, r.opening).toBe(true);
      expect(weekdayOf(r.allStar!)).toBe(6);
      const ad = Number(r.allStar!.slice(8));
      expect(ad >= 8 && ad <= 14, r.allStar!).toBe(true);
      const b = r.breaks.find((x) => x.reason === '올스타')!;
      expect(weekdayOf(b.from)).toBe(5);
      expect(daysBetween(b.from, b.to)).toBe(5);
      expect([r.games, r.vs, r.frame, r.unscheduled]).toEqual([144, 16, 'S33F', 9]);
    }
    expect(scheduleRule(data, 2030)!.opening).toBe('2030-03-23');
    expect(scheduleRule(data, 2030)!.allStar).toBe('2030-07-13');
  });

  it('자료보다 이른 해는 규칙이 없다', () => {
    expect(scheduleRule(data, 1981)).toBeUndefined();
  });

  it('쉬는 기간은 모두 개막 뒤, 올스타 날은 쉬는 기간 안', () => {
    for (let y = 1982; y <= 2030; y++) {
      const r = scheduleRule(data, y)!;
      for (const b of r.breaks) {
        expect(daysBetween(r.opening, b.from) > 0, `${y} ${b.from}`).toBe(true);
        expect(b.from <= b.to).toBe(true);
      }
      if (r.allStar) expect(r.breaks.some((b) => b.from <= r.allStar! && r.allStar! <= b.to), `${y}`).toBe(true);
    }
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });
});
