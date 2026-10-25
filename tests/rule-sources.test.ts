// 빈 자료 결정 1·2 (2026-10-23): 2026 외국인 개막 명단(나무위키 계약표)과 제도연표 위키 확인값 (data-src/제도연표_보정.csv)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataStore, type DataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type EngineParams } from '../src/engine';
import { createLeague, openingTeamMoves } from '../src/league/create';
import { MIN_SALARY, minSalary, minSalaryNominal, ruleStepIndex, salaryCap } from '../src/league/salary';

let store: DataStore;
const FAST: EngineParams = { ...DEFAULT_PARAMS, pilotSeasons: 1 };

beforeAll(() => {
  store = loadDataStore();
});

describe('2026 외국인 개막 명단 (나무위키 2026 KBO 리그 계약표)', () => {
  it('구단마다 일반 3명 + 아시아쿼터 1명, 확인값 39명 (삼성 오러클린만 매닝 대신 넣은 미확인)', () => {
    const teams = store.meta.foreignOpening!['2026'];
    expect(Object.keys(teams)).toHaveLength(10);
    for (const list of Object.values(teams)) {
      expect(list.filter((x) => !x.asia)).toHaveLength(3);
      expect(list.filter((x) => x.asia)).toHaveLength(1);
    }
    const all = Object.values(teams).flat();
    expect(all.filter((x) => !x.confirmed).map((x) => x.id)).toEqual(['56464']);
  });

  it('출전량 추정에서 바뀐 개막 선수: 데일·보쉴리·치리노스·화이트(SSG)·플렉센·타무라·쿄야마·와일스·브룩스는 개막, 시라카와·로건·카라스코 등은 시즌 중 교체', () => {
    const ids = new Set(Object.values(store.meta.foreignOpening!['2026']).flat().map((x) => x.id));
    for (const id of ['56632', '56036', '55146', '55855', '50234', '56218', '56548', '56334', '56322', '55239']) expect(ids.has(id)).toBe(true);
    for (const id of ['54843', '55912', '56103', '56801', '52043', '56212', '56503', '56305', '56950']) expect(ids.has(id)).toBe(false);
  });

  it('시즌 중 교체 선수도 아시아쿼터 여부를 가진다 (일본식 이름 5명, 추정): 시장에서 아시아쿼터 자리로 들어온다', () => {
    for (const id of ['54843', '56212', '56503', '56800', '56474']) expect(store.players.get(id)?.asia).toBe(true);
    expect(store.players.get('56103')?.asia).toBeFalsy();
  });

  it('NC 개막 데이비슨(기록 소속 키움)은 NC에서 시작하고, 시즌 중 교체 선수는 소속 없이 시장 후보', () => {
    expect(openingTeamMoves(store, 2026)).toEqual(new Map([['54944', 'NC']]));
    const { league } = createLeague(store, 2026, 's', FAST);
    const team = (name: string) => league.teams.findIndex((t) => t.name === name);
    const p = (id: string) => league.players.find((x) => x.id === id)!;
    expect(p('54944').team).toBe(team('NC'));
    expect(p('54944').tenure0?.franchise).toBe('NC');
    expect(p('56464').team).toBe(team('삼성'));
    expect(p('56950').team).toBe(-1);
    expect(p('56950').market).toBe(2026);
    expect(p('54843').asia).toBe(true);
    for (let t = 0; t < league.teams.length; t++) {
      const f = league.players.filter((x) => x.team === t && x.foreign);
      expect(f.filter((x) => !x.asia)).toHaveLength(3);
      expect(f.filter((x) => x.asia)).toHaveLength(1);
    }
  });
});

describe('제도연표 위키 확인값', () => {
  it('최저 연봉 연도표 (명목, 만 원): 2010 2,400 · 2015 2,700 · 2021 3,000 (원문 확인), 앞 시대는 위키 요약', () => {
    expect(minSalaryNominal(1982)).toBe(600);
    expect(minSalaryNominal(1987)).toBe(600);
    expect(minSalaryNominal(1988)).toBe(840);
    expect(minSalaryNominal(2000)).toBe(1500);
    expect(minSalaryNominal(2009)).toBe(2000);
    expect(minSalaryNominal(2010)).toBe(2400);
    expect(minSalaryNominal(2020)).toBe(2700);
    expect(minSalaryNominal(2021)).toBe(3000);
    expect(minSalaryNominal(2040)).toBe(3000);
    // 게임 규정은 그 해 값을 2026년 물가로 (명목 ÷ 물가 계수, 10만 원 단위)
    expect(MIN_SALARY).toBe(3000);
    expect([1982, 1990, 2000, 2010, 2015, 2020, 2026].map((y) => minSalary(y))).toEqual([7500, 6000, 5000, 4290, 3750, 2900, 3000]);
    // 2027년부터는 리그 규칙 변경의 계단식 인상 (2030·2034…, salary.ts ruleStepIndex)
    expect(minSalary(2027)).toBe(3000);
    expect(minSalary(2040)).toBe(Math.round((MIN_SALARY * ruleStepIndex(2040)) / 100) * 100);
  });

  it('샐러리캡: 2023·2024 114억 2,638만, 2025 137억 1,165만 (2024-08 20% 상향)', () => {
    expect(salaryCap(2022)).toBeNull();
    expect(salaryCap(2023)).toBe(1142638);
    expect(salaryCap(2024)).toBe(1142638);
    expect(salaryCap(2025)).toBe(1371165);
  });
});
