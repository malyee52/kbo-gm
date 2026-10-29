// 숨긴 값 (능력치 v2 17.6·17.7, 16-7): 종합·천장(잠재)·성장 성향 d·시기 τ·갈래 천장·추측 어긋남 z는 화면·알림·LLM 글 어디에도 나오지 않는다.
// 화면은 진짜 등급을 직접 그리지 않고 parts.tsx의 useSeen(→ session.guessSet·guessGrade)만 거친다. traits.test.ts의 숨김 검사와 같은 꼴.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { computeGrades, DEFAULT_PARAMS } from '../src/engine';
import { currentRuns } from '../src/ai/value';
import { GameSession } from '../src/game/session';
import { guessMid, guessSetText } from '../src/league/scout';
import { strengthTier } from '../src/game/rank';
import { EVENTS } from '../src/league/events';
import { prospects } from '../src/league/events-extra';
import * as Off from '../src/league/offseason';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

/**
 * 화면 코드에서 빠지는 파일: 엔진 시험 화면(?lab, 개발용), 자유 모드 입력·미리보기(사용자가 넣은 능력·잠재 숫자, Q6 ①: 입력·미리보기는 그대로)
 */
const UI_EXEMPT = ['EngineLab.tsx', 'FantasyFree.tsx', 'GmPreview.tsx'];

/** 화면이 읽으면 안 되는 것: 진짜 천장·숨은 성장 값·추측 어긋남·진짜 기여·진짜 전력·AI 판단값 */
const FORBIDDEN: [string, RegExp][] = [
  ['잠재(천장)', /\.potential\b/],
  ['옛 스카우트 평가', /scoutPotential/],
  ['성장 성향 d', /\.drive\b/],
  ['시기 τ', /\.timing\b/],
  ['갈래 천장', /(?<!Math)\.ceil\b/],
  ['추측 어긋남 z', /scoutZ\(/],
  ['AI 판단 잠재', /aiPotential\(/],
  ['진짜 기여', /currentRuns\(|nextRuns\(/],
  ['진짜 전력', /teamStrength\(/],
  ['시즌 폼', /seasonForm/],
];

describe('화면 코드는 숨긴 값을 읽지 않는다 (소스 검사)', () => {
  const files = filesUnder('src/ui').filter((f) => !UI_EXEMPT.some((x) => f.endsWith(x)));

  it('src/ui에 진짜 천장·d·τ·갈래 천장·z·진짜 기여·전력이 없다', () => {
    expect(files.length).toBeGreaterThan(40);
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const [what, re] of FORBIDDEN) if (re.test(text)) bad.push(`${f}: ${what}`);
    }
    expect(bad).toEqual([]);
  });

  it('진짜 화면 등급(computeGrades)은 parts.tsx의 useSeen 한 곳에서만 꺼낸다', () => {
    const bad = files.filter((f) => !f.endsWith('parts.tsx') && /\.(batters|pitchers)\.get\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('옛 잠재 표시(PotCell·usePotentialOf·potentialView)는 없다', () => {
    const all = filesUnder('src');
    const bad = all.filter((f) => /PotCell|usePotentialOf|potentialView|potentialSortValue|SCOUT_NOISE/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('LLM에 넘기는 선수 글은 진짜 능력·잠재 대신 스카우트 추측을 쓴다', () => {
    const free = readFileSync('src/fantasy/free.ts', 'utf8');
    const roster = free.slice(free.indexOf('function rosterTable'), free.indexOf('export function teamOfNow'));
    expect(roster).toContain('guessSetText');
    expect(roster).not.toMatch(/\.potential\b|currentRuns\(|gradeOfRuns\(/);
    const neg = readFileSync('src/ui/screens/FantasyNegotiate.tsx', 'utf8');
    expect(neg).toContain('guessSetText');
    expect(neg).not.toMatch(/sit\.rank/);
  });

  it('플레이어 구단 쪽 정렬(이벤트 유망주·자동 방출)은 진짜 잠재로 줄 세우지 않는다', () => {
    // 이벤트 유망주: 한 곳(events-extra.ts prospects)에서 우리 스카우트 가치로만
    for (const f of ['src/league/events.ts', 'src/league/events-extra.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/\.sort\([^\n]*\.potential/);
    }
    const ex = readFileSync('src/league/events-extra.ts', 'utf8');
    const body = ex.slice(ex.indexOf('export function prospects'), ex.indexOf('const losing'));
    expect(body).toContain('c.seenValue(');
    expect(body).not.toMatch(/\.potential/);
    // 정원 정리: 플레이어 구단의 기본 방출 가치는 우리 스카우트 가치, 자동 방출·화면 계획은 기본 가치를 그대로 쓴다
    const off = readFileSync('src/league/offseason.ts', 'utf8');
    expect(off).toMatch(/team === off\.userTeam \? \(p\) => userReleaseValue/);
    const auto = off.slice(off.indexOf('export function autoReleaseUser'), off.indexOf('export function userOrgSize'));
    expect(auto).not.toMatch(/releaseValue/);
  });

  it('이벤트·판타지 효과 문구에 잠재 숫자가 없다', () => {
    for (const f of ['src/league/events.ts', 'src/league/events-extra.ts', 'src/fantasy/effects.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/잠재력? *[+−-]\d|잠재력? \$\{sign/);
    }
  });
});

describe('한 시즌 짧게 돌린 화면 값', () => {
  let store: DataStore;
  let g: GameSession;
  beforeAll(() => {
    store = loadDataStore();
    g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'hidden' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    g.advance(25);
  }, 120_000);

  it('알림·소식에 잠재·종합 숫자와 전력 순위 숫자가 없다', () => {
    const texts = g.news.map((n) => n.text);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t) => /잠재력? *[0-9+−]|종합 *\d|전력 예상 *\d|전력 \d+위/.test(t))).toEqual([]);
    expect(texts.some((t) => /구단주 전망 (상위권|중위권|하위권)/.test(t))).toBe(true);
  });

  it('추측 셋: 다른 구단 주전은 범위로 보이고 진짜와 어긋난다, 우리 선수에게만 관계 배율', () => {
    const grades = computeGrades(g.world);
    const theirs = g.world.teams[3].org.filter((p) => !p.isPitcher && (p.bat?.sample ?? 0) > 600);
    expect(theirs.length).toBeGreaterThan(3);
    for (const p of theirs) {
      const s = g.guessSet(p.id, grades)!;
      expect(s.items.map((x) => x.key)).toEqual(['contact', 'power', 'eye']);
      expect(guessSetText(s)).toMatch(/^컨택 \d+(~\d+)? · 파워 /);
    }
    // 진짜 등급과 가운데값의 차이: 다른 구단 주전(σ 6) 평균 절대 오차가 우리 오래된 주전보다 크다
    const err = (ps: typeof theirs) => {
      let sum = 0;
      let n = 0;
      for (const p of ps) {
        const b = grades.batters.get(p.id)!;
        const s = g.guessSet(p.id, grades)!;
        sum += Math.abs(guessMid(s.items[0].view) - b.contact);
        n++;
      }
      return sum / n;
    };
    expect(err(theirs)).toBeGreaterThan(1);
    // 우리 선수는 관계 배율(우리 구단에서 보낸 시즌 수)이 붙고, 다른 구단 선수는 붙지 않는다
    const ours = g.world.teams[0].org.find((p) => !p.isPitcher && (p.bat?.sample ?? 0) > 600)!;
    expect(g.seenOf(ours.id).seasonsWithUs).not.toBeNull();
    expect(g.seenOf(theirs[0].id).seasonsWithUs).toBeNull();
    // 우리 조직 선수(2군·신인 포함)의 지금 능력은 범위 없이 진짜 등급 그대로 (2026-10-29 사용자)
    let mineChecked = 0;
    for (const p of g.world.teams[0].org) {
      const s = g.guessSet(p.id, grades);
      if (!s) continue;
      const tg = (p.isPitcher ? grades.pitchers.get(p.id) : grades.batters.get(p.id)) as unknown as Record<string, number | null>;
      for (const it of s.items) {
        expect(it.view.kind).toBe('one');
        const t = it.key === 'stamina' ? (tg.stamina ?? tg.reliefStamina) : tg[it.key];
        expect(guessMid(it.view)).toBe(Math.round(t ?? 50));
      }
      expect(guessSetText(s)).not.toContain('~');
      expect(g.seenRuns(p.id)).toBeCloseTo(currentRuns(p, g.values), 9);
      mineChecked++;
    }
    expect(mineChecked).toBeGreaterThan(20);
  });

  it('이벤트가 고르는 우리 유망주는 우리 스카우트 가치 순이다', () => {
    const c = g.eventContext();
    const list = prospects(c);
    expect(list.length).toBeGreaterThan(2);
    const v = list.map((p) => g.seenValue(p.id));
    for (let i = 1; i < v.length; i++) expect(v[i - 1]).toBeGreaterThanOrEqual(v[i]);
    const mentor = EVENTS.find((e) => e.id === 'veteran-mentor')!;
    expect(mentor.vars!(c, null as never)).toMatchObject({ a: list[0].id, b: list[1].id });
  });

  it('정원 정리 순서: 우리 구단은 스카우트 가치, AI 구단은 8시즌 가치(aiPotential 길)', () => {
    const view = Off.leagueView(g.league, store, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
    const off = { year: g.year, userTeam: g.teamIdx } as Off.OffseasonState;
    const fresh = (p: { entryYear: number }) => p.entryYear >= off.year + 2 - Off.ROOKIE_GRACE;
    const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1] <= x);
    const mine = Off.releaseSplit(g.league, off, view, g.teamIdx).order.filter((p) => !fresh(p));
    expect(mine.length).toBeGreaterThan(5);
    expect(ascending(mine.map((p) => Off.userReleaseValue(g.league, off, view, p)))).toBe(true);
    // 진짜 8시즌 가치 순과는 다르다 (같으면 순서 열이 숨은 값을 줄 세워 보여 준다)
    expect(ascending(mine.map((p) => Off.releaseValue(view, p)))).toBe(false);
    const theirs = Off.releaseSplit(g.league, off, view, 3).order.filter((p) => !fresh(p));
    expect(ascending(theirs.map((p) => Off.releaseValue(view, p)))).toBe(true);
  });

  it('전력 전망은 구단마다 세 단계 하나이고, 위·아래 30%씩', () => {
    const o = g.strengthOutlook();
    expect(o.length).toBe(g.world.teams.length);
    expect(o.filter((x) => x === '상위권').length).toBe(3);
    expect(o.filter((x) => x === '하위권').length).toBe(3);
    expect(strengthTier(1, 4)).toBe('상위권');
    expect(strengthTier(4, 4)).toBe('하위권');
    expect(strengthTier(2, 4)).toBe('중위권');
  });
});
