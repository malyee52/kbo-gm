// 리그 규칙 변경과 개막 "올해 달라지는 규칙" 알림 (docs/리그규칙변경_기획안.md 2장, 5.1 1-1·1-2).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, rosterFingerprint, type EngineParams } from '../src/engine';
import { createLeague } from '../src/league/create';
import { faServiceNeeded, foreignRule } from '../src/league/eras';
import { isMainLine, keyValueText, ruleNews, ruleSnapshot, type RuleNews } from '../src/league/ruleNews';
import { salaryCap } from '../src/league/salary';
import { GameSession } from '../src/game/session';

let store: DataStore;
const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('규칙 변경 데이터 (1-1)', () => {
  it('rule_changes.json이 있고 공인구 표는 연도 순이다', () => {
    const rc = store.ruleChanges!;
    expect(rc.items.length).toBeGreaterThan(50);
    expect(rc.ball.map((b) => b.year)).toEqual([...rc.ball.map((b) => b.year)].sort((a, b) => a - b));
    expect(rc.ball.find((b) => b.year === 2019)?.range).toEqual([0.4034, 0.4234]);
  });

  it('규칙 자료는 선수 월드 지문에 들어가지 않는다 (자료를 고쳐도 예전 저장을 쓴다)', () => {
    const noRules: DataStore = { ...store, ruleChanges: undefined };
    for (const year of [2025, 1982]) {
      const a = createLeague(store, year, 'fp', FAST).world;
      const b = createLeague(noRules, year, 'fp', FAST).world;
      expect(rosterFingerprint(b)).toBe(rosterFingerprint(a));
    }
  });
});

const snap = (y: number) => {
  const s = store.season(y);
  return ruleSnapshot(store.meta, y, undefined, s ? { teams: s.teams.length, games: s.games } : undefined);
};
const news = (y: number, start = false): RuleNews => ruleNews({ year: y, data: store.ruleChanges, now: snap(y), prev: start ? undefined : snap(y - 1), start, seasonDays: 165 });
const all = (n: RuleNews) => [...n.main, ...n.other];

describe('알림 계산 (1-2)', () => {
  it('2019: 공인구 기준 하향과 개막 전 3월 18일 검사만 개막 목록에, 5월 24일 검사는 그 날짜 소식, 10월 29일은 결산 소식', () => {
    const n = news(2019);
    const ball = n.main[0];
    expect(ball.cat).toBe('ball');
    expect(ball.title).toBe('공인구 반발계수 기준 하향');
    expect(ball.before).toBe('0.4134~0.4374');
    expect(ball.after).toContain('0.4034~0.4234');
    expect(ball.detail!.join(' ')).toContain('0.4247');
    expect(ball.detail!.join(' ')).toContain('3월 18일');
    expect(JSON.stringify([n.main, n.other])).not.toContain('0.4189');
    expect(n.dated.map((d) => d.text).join(' ')).toContain('0.4189');
    expect(n.dated.every((d) => d.day > 0 && d.day < 165)).toBe(true);
    expect(n.closing.join(' ')).toContain('0.4105');
    expect(n.headline).toContain('공인구 반발계수 기준 하향');
  });

  it('2026: 아시아쿼터·엔트리는 게임 값으로, 단순화 문구가 붙는다', () => {
    const n = news(2026);
    const foreign = n.main.find((l) => l.key === 'foreignLimit')!;
    expect(foreign.before).toBe('3명');
    expect(foreign.after).toBe('4명 (아시아쿼터 1명 포함)');
    const roster = n.main.find((l) => l.key === 'rosterSize')!;
    expect([roster.before, roster.after]).toEqual(['28명', '29명']);
    expect(roster.simplified).toContain('등록 인원 모두 출장');
    expect(n.main.find((l) => l.key === 'salaryCap')).toBeTruthy();
  });

  it('1982 시작: 출범 규칙 요약 (게임 값), 공인구 공표 없음', () => {
    const n = news(1982, true);
    expect(n.start).toBe(true);
    expect(n.summary[0]).toBe(`6구단, 팀당 80경기 (게임은 단일 시즌으로 진행)`);
    expect(n.summary.join(' ')).toContain('외국인 선수 없음');
    expect(n.summary.join(' ')).toContain('FA 없음');
    expect(n.summary.join(' ')).toContain('샐러리캡 없음');
    expect(n.main[0].detail!.join(' ')).toContain('공표 없음');
    // 연장: 게임 값(12회)과 실제 값(15회)을 함께
    const inn = n.main.find((l) => l.key === 'maxInnings')!;
    expect(inn.after).toBe(`게임 ${keyValueText('maxInnings', snap(1982))}`);
    expect(inn.real).toBe('15회');
  });

  it('2027 (미래 규칙 변화 없음): 캡 값과 하한만', () => {
    const n = news(2027);
    expect(n.main.every((l) => l.cat === 'cap')).toBe(true);
    expect(n.main.find((l) => l.key === 'salaryCap')?.after).toBe(keyValueText('salaryCap', snap(2027)));
    expect(n.other).toEqual([]);
  });

  it('키 항목의 전·후는 게임 규칙 값과 같다', () => {
    for (let y = 1983; y <= 2030; y++) {
      const now = snap(y);
      const prev = snap(y - 1);
      for (const l of all(news(y)).filter((x) => x.key && x.before)) {
        expect(l.before).toBe(keyValueText(l.key!, prev));
        expect(l.after).toBe(keyValueText(l.key!, now));
      }
    }
    // 게임 값을 직접: 1998 외국인 2명, 2023 캡 도입, 2022 시즌 뒤 FA 고졸 8·대졸 7
    expect(foreignRule(store.meta, 1998).total).toBe(2);
    expect(news(1998).main.find((l) => l.key === 'foreignLimit')?.after).toBe('2명');
    expect(news(2023).main.find((l) => l.key === 'salaryCap')?.after).toBe(keyValueText('salaryCap', { ...snap(2023), salaryCap: salaryCap(2023) }));
    expect(news(2022).main.find((l) => l.key === 'faService')?.after).toBe(`고졸 ${faServiceNeeded(2022, false)}·대졸 ${faServiceNeeded(2022, true)}시즌`);
  });

  it('FA 연한 알림이 게임 값과 같다: 2001 시즌 10 → 9시즌, 2011 시즌 고졸 9·대졸 8 (1-4)', () => {
    const a = news(2001).main.find((l) => l.key === 'faService')!;
    expect([a.before, a.after]).toEqual(['1군 10시즌', '1군 9시즌']);
    const b = news(2011).main.find((l) => l.key === 'faService')!;
    expect([b.before, b.after]).toEqual(['1군 9시즌', '고졸 9·대졸 8시즌']);
  });

  it('표시만 항목은 모두 "그 밖의 변경"에, 위 칸에는 공인구·리그 운영·경기 반영만', () => {
    for (let y = 1982; y <= 2027; y++) {
      const n = news(y, y === 1982);
      expect(n.other.every((l) => !isMainLine(l))).toBe(true);
      expect(n.main.every((l) => isMainLine(l))).toBe(true);
    }
    const shows = store.ruleChanges!.items.filter((it) => (it.effect === 'show' || it.effect === 'show-env') && !it.date);
    for (const it of shows) expect(news(it.year, it.year === 1982).other.some((l) => l.title === it.title)).toBe(true);
  });

  it('같은 입력 → 같은 출력, 난수를 쓰지 않는다', () => {
    const r = Math.random;
    let called = 0;
    Math.random = () => { called++; return r(); };
    try {
      for (const y of [1982, 2001, 2019, 2024, 2026, 2027]) expect(news(y, y === 1982)).toEqual(news(y, y === 1982));
    } finally {
      Math.random = r;
    }
    expect(called).toBe(0);
  });

  it('자료가 없어도 게임 값 변화는 알린다', () => {
    const n = ruleNews({ year: 2026, now: snap(2026), prev: snap(2025) });
    expect(n.main.find((l) => l.key === 'foreignLimit')?.status).toBe('confirmed');
    expect(n.other).toEqual([]);
  });
});

describe('게임 진행 속 규칙 소식 (1-3)', () => {
  const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const ruleNewsOf = (g: GameSession) => g.news.filter((n) => n.text.startsWith('[공인구]') || n.text.startsWith('[규칙]') || n.text.includes('달라지는 규칙'));

  it('2019 시작: 개막 소식 한 줄, 5월 24일 검사는 그날 소식으로. 저장 뒤 이어 돌려도 같다', () => {
    const g = GameSession.create(store, { year: 2019, teamIdx: 0, seed: 'rule-news' }, FAST);
    const day = g.ruleNewsFor().dated.find((d) => d.text.includes('0.4189'))!.day;
    expect(g.news.some((n) => n.day === 0 && n.text.includes('2019 시즌 리그 규칙'))).toBe(true);
    g.advance(day - 5);
    expect(g.news.some((n) => n.text.includes('0.4189'))).toBe(false);
    const h = GameSession.load(store, roundTrip(g.toSave()), FAST);
    g.advance(10);
    h.advance(10);
    const hit = g.news.find((n) => n.text.includes('0.4189'))!;
    expect(hit.day).toBe(day);
    expect(ruleNewsOf(h)).toEqual(ruleNewsOf(g));
    // 화면 조회를 끼워도 같다
    h.ruleNewsFor(2020);
    h.ruleNewsFor();
    g.advance(3);
    h.advance(3);
    expect(ruleNewsOf(h)).toEqual(ruleNewsOf(g));
  });
});
