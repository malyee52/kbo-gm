// 선수 칭호 (칭호 기획안 docs/칭호_기획안.md, league/titles.ts): 효과 없는 명예 이름표.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { TRAIT_INFO } from '../src/engine/traits';
import { GameSession } from '../src/game/session';
import { createLeague } from '../src/league/create';
import {
  ensureTitles, judgeTitles, LEAD_NAME, LEGEND_RULES, legendCond, realTitles, startTitles, titleChips, titlesOf, type TitleRecord,
} from '../src/league/titles';

let store: DataStore;
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeAll(() => { store = loadDataStore(); }, 120_000);

const nameOf = (id: string) => store.players.get(id)?.name ?? id;
const keyed = (rs: TitleRecord[]) => rs.map((r) => `${r.id}/${r.key}/${r.year}`).sort();

describe('레전드 칭호 (기획안 7장)', () => {
  it('데이터 표: KBO 레전드 40인, 켠 칭호 37개, 정민태·김시진·이순철은 칭호 없음, 우즈는 흑곰', () => {
    const rows = store.legendTitles!;
    expect(rows).toHaveLength(40);
    expect(rows.filter((x) => x.nick)).toHaveLength(37);
    expect(rows.filter((x) => !x.nick).map((x) => x.name).sort()).toEqual(['김시진', '이순철', '정민태']);
    expect(rows.find((x) => x.rank === 40)).toMatchObject({ name: '우즈', nick: '흑곰' });
    for (const x of rows) expect(LEGEND_RULES[x.rank], `${x.rank} ${x.name}`).toBeDefined();
  });

  it('실제 기록 1982~2025 판정이 tools/title_dist.ts 표와 같다: 켠 37개 모두 주인이 채우고, 다른 선수는 표의 사람만', () => {
    const recs = realTitles(store, 2026);
    const got = Object.fromEntries(store.legendTitles!.filter((x) => x.nick).map((x) => [x.nick, recs
      .filter((r) => r.key === `L:${x.rank}`).sort((a, b) => a.year - b.year).map((r) => `${nameOf(r.id)} ${r.year}`)]));
    // reports/title-dist-real.md '레전드 칭호 조건: 처음 채운 선수' (시대에 묶인 5개는 '원래 또는 대안')
    expect(got).toEqual({
      국보: ['선동열 1989'], 무쇠팔: ['장명부 1983', '최동원 1984'], '바람의 아들': ['이종범 1994'], 국민타자: ['이승엽 2003'], 송골매: ['송진우 2006'],
      '타격의 달인': ['장효조 1992'], 양신: ['양준혁 2009'], 대성불패: ['구대성 2007'], 핵잠수함: ['이강철 1998'], '연습생 신화': ['장종훈 1992', '박병호 2014'],
      불사조: ['박철순 1982', '니퍼트 2016'], 헐크: ['이만수 1985'], '대전의 황태자': ['정민철 1997', '류현진 2011'], 김별명: ['김태균 2018'], 쿨가이: ['박용택 2018'],
      노송: ['김용수 1998'], '리틀 쿠바': ['박재홍 2000'], 적토마: ['이병규 2005', '손아섭 2023'], 창용불패: ['임창용 2015'], 왕방울: ['김기태 1997'],
      포도대장: ['박경완 2010', '강민호 2022'], '4할 타자': ['백인천 1982'], '원조 이도류': ['김성한 1982'], 싸움닭: ['선동열 1991', '조계현 2000'],
      야생마: ['송진우 1992', '이상훈 1997'], 해결사: ['한대화 1990'], 두목곰: ['김동주 2010'], 헤라클레스: ['심정수 2003'],
      '그라운드의 여우': ['김재박 1986', '이종범 1997'], 탱크: ['박정태 1999'], 니느님: ['니퍼트 2018'], 대도: ['전준호 2008'],
      '푸른 피의 에이스': ['배영수 2017'], 홍포: ['홍성흔 2015'], '악마의 2루수': ['정근우 2017'], '국민 유격수': ['박진만 2014'], 흑곰: ['우즈 1998', '로하스 2020'],
    });
    // 칭호를 켜지 않은 레전드 조건은 기록으로도 남기지 않는다
    for (const rank of [18, 20, 37]) expect(recs.some((r) => r.key === `L:${rank}`)).toBe(false);
  });

  it('대안 조건 문구는 "원래 (또는 대안)"', () => {
    expect(legendCond(2)).toBe('한 시즌 280이닝 + 탈삼진 220 (또는 같은 해 다승·탈삼진·이닝 1위 + 탈삼진 220)');
    expect(legendCond(1)).toBe('평균자책점 1위 5회');
  });
});

describe('시작 때 칭호 (결정 7: 시작 해 전 실제 기록)', () => {
  it('2026년 시작: 류현진 대전의 황태자·손아섭 적토마·강민호 포도대장, 최정은 홈런 줄기 가장 높은 칸 사백 홈런', () => {
    const { league } = createLeague(store, 2026, 'titles-2026', FAST);
    const look = { startYear: 2026, lastYear: 2025, legends: store.legendTitles };
    const legend = (id: string) => titlesOf(league.titles, id, look).filter((v) => v.tier === 'L').map((v) => v.name);
    expect(legend('76715')).toEqual(['대전의 황태자']);
    expect(legend('77532')).toEqual(['적토마']);
    expect(legend('74540')).toEqual(['포도대장']);
    const choi = titlesOf(league.titles, '75847', look);
    expect(choi.map((v) => v.name)).toEqual(expect.arrayContaining(['백 홈런', '이백 홈런', '삼백 홈런', '사백 홈런']));
    const chips = titleChips(choi);
    expect(chips.filter((v) => v.stem === 'c:hr').map((v) => v.name)).toEqual(['사백 홈런']);
    expect(choi.every((v) => v.real)).toBe(true);
    // 시작 해 기록은 미리 쓰지 않는다
    expect(league.titles!.every((r) => r.year < 2026)).toBe(true);
    // 리그 선수만 담는다
    const ids = new Set(league.players.map((p) => p.id));
    expect(league.titles!.every((r) => ids.has(r.id))).toBe(true);
  });

  it('2025년 시작: 로하스 흑곰(2020), 박병호 연습생 신화(2014), 2024년 타이틀은 "현 ○○왕"', () => {
    const { league } = createLeague(store, 2025, 'titles-2025', FAST);
    const look = { startYear: 2025, lastYear: 2024, legends: store.legendTitles };
    const rojas = titlesOf(league.titles, '67025', look).find((v) => v.tier === 'L');
    expect(rojas).toMatchObject({ name: '흑곰', years: [2020], owner: '우즈', real: true });
    expect(titlesOf(league.titles, '75125', look).find((v) => v.tier === 'L')?.name).toBe('연습생 신화');
    const cur = league.titles!.filter((r) => r.year === 2024 && r.key.startsWith('lead:'));
    expect(cur.length).toBeGreaterThan(10);
    const v = titlesOf(league.titles, cur[0].id, look).find((x) => x.key === cur[0].key)!;
    expect(v.current).toBe(true);
    expect(v.name.startsWith('현 ')).toBe(true);
  });

  it('타이틀 칭호는 횟수로 남는다: 류현진 탈삼진왕 ×5는 ★★★ (5회), 이력 해 목록', () => {
    const { league } = createLeague(store, 2026, 'titles-2026', FAST);
    const v = titlesOf(league.titles, '76715', { startYear: 2026, lastYear: 2025 }).find((x) => x.key === 'lead:so')!;
    expect(v.name).toBe(`${LEAD_NAME.so} ×${v.years.length}`);
    expect(v.tier).toBe(v.years.length >= 5 ? 3 : v.years.length >= 3 ? 2 : 1);
    expect(v.current).toBe(false);
  });

  it('예전 저장(칭호 칸 없음)은 불러올 때 시작 칭호를 같게 채운다', () => {
    const { league } = createLeague(store, 2026, 'titles-2026', FAST);
    const want = keyed(league.titles!);
    delete league.titles;
    ensureTitles(league, store, 2025);
    expect(keyed(league.titles!)).toEqual(want);
  });
});

describe('숨김 값과 실존 선수 규칙', () => {
  it('칭호 모듈은 능력·잠재·특수능력 모듈을 가져오지 않는다', () => {
    const src = readFileSync('src/league/titles.ts', 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const bad of ['ratings', 'potential', 'traits', 'branches', 'scout', 'growth', 'value']) {
      expect(imports.some((x) => x.split('/').pop() === bad), bad).toBe(false);
    }
  });

  it('기록이 같으면 능력·잠재·숨은 성향을 바꿔도 칭호가 같다', () => {
    const { league } = createLeague(store, 2026, 'titles-2026', FAST);
    const want = keyed(league.titles!);
    for (const p of league.players) {
      p.potential = 0;
      p.drive = 9;
      p.timing = 0;
    }
    startTitles(league, store);
    expect(keyed(league.titles!)).toEqual(want);
  });

  it('칭호 이름이 숨은 특수능력 이름과 겹치지 않는다', () => {
    const traitNames = new Set(Object.values(TRAIT_INFO).map((t) => t.label));
    const { league } = createLeague(store, 2026, 'titles-2026', FAST);
    const names = league.players.flatMap((p) => titlesOf(league.titles, p.id, { startYear: 2026, lastYear: 2025, legends: store.legendTitles }).map((v) => v.name));
    for (const L of store.legendTitles!) if (L.nick) names.push(L.nick);
    for (const n of names) expect(traitNames.has(n.replace(/ ×\d+$/, '')), n).toBe(false);
  });

  it('조건 문구는 기록 문턱만 쓴다 (사건·사유 낱말 없음)', () => {
    const conds = Object.keys(LEGEND_RULES).map((r) => legendCond(Number(r)));
    const { league } = createLeague(store, 2026, 'titles-2026', FAST);
    for (const p of league.players) conds.push(...titlesOf(league.titles, p.id, { startYear: 2026, lastYear: 2025 }).map((v) => v.cond));
    for (const c of conds) expect(c, c).not.toMatch(/음주|도박|폭행|논란|징계|사고|체포|스캔들|연승|경기 연속|한국시리즈 [0-9]승/);
  });
});

describe('결산 판정 (게임 안 시즌)', () => {
  let a: GameSession;
  beforeAll(() => {
    a = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'titles-season' }, FAST);
    a.advance(100000);
    a.beginOffseason();
  }, 600_000);

  it('그 해 시상 타이틀 홀더가 모두 그 해 타이틀 칭호를 얻는다 ("현 ○○왕")', () => {
    const aw = a.league.awards!.find((x) => x.year === 2026)!;
    for (const t of aw.titles) for (const w of t.winners) {
      expect(a.league.titles!.some((r) => r.id === w.id && r.key === `lead:${t.key}` && r.year === 2026), `${t.label} ${w.name}`).toBe(true);
      const v = a.titlesOf(w.id).find((x) => x.key === `lead:${t.key}`)!;
      expect(v.current).toBe(true);
    }
    if (aw.mvp) expect(a.league.titles!.some((r) => r.id === aw.mvp!.id && r.key === 'mvp' && r.year === 2026)).toBe(true);
  });

  it('우승 구단 1군 선수에게 우승 기록이 붙는다 (가을야구 뒤 다시 판정)', () => {
    const champ = a.league.yearbook!.find((y) => y.year === 2026)!.champion!;
    const holders = a.league.titles!.filter((r) => r.key === 'champ' && r.year === 2026);
    expect(holders.length).toBeGreaterThan(15);
    for (const r of holders) expect(a.league.players.find((p) => p.id === r.id)!.history.find((h) => h.year === 2026)!.team).toBe(champ);
  });

  it('같은 해를 다시 판정해도 결과가 같다 (결정적)', () => {
    const want = keyed(a.league.titles!);
    judgeTitles(a.league, store, 2026);
    expect(keyed(a.league.titles!)).toEqual(want);
  });

  it('저장·불러오기 왕복에 칭호가 그대로 남고, 같은 시드로 다시 돌리면 같은 칭호다', () => {
    const c = GameSession.load(store, roundTrip(a.toSave()), FAST);
    expect(keyed(c.league.titles!)).toEqual(keyed(a.league.titles!));
    const b = GameSession.create(store, { year: 2026, teamIdx: 2, seed: 'titles-season' }, FAST);
    b.advance(100000);
    b.beginOffseason();
    expect(keyed(b.league.titles!)).toEqual(keyed(a.league.titles!));
    expect(b.news.filter((n) => n.text.startsWith('칭호:'))).toEqual(a.news.filter((n) => n.text.startsWith('칭호:')));
  });

  it('칭호 소식은 기록 사실만, 기사는 ★★★·레전드만', () => {
    const news = a.news.filter((n) => n.text.startsWith('칭호:'));
    expect(news.length).toBeGreaterThan(0);
    for (const n of news) expect(n.text).toMatch(/^칭호: \S+ .+ '.+' (★{1,3}|레전드) \(2026 · .+\)$/);
    for (const art of (a.league.articles ?? []).filter((x) => x.kind === 'honor')) expect(art.title).toMatch(/칭호 '/);
  });
});
