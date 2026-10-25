// 시작 연도 1군 기록이 없어 빠지던 실제 선수 보충 (2026-10-11 사용자 요청).
//
// 시작 명단은 "그 해 1군 기록이 있는 선수"로 만든다. 그래서 그 해에 1군 기록이 없는 선수는 통째로 빠지고, 게임은 실제 다음 시즌 자료로
// 선수를 들여오지 않으므로 영영 돌아오지 않았다 (예: 2004~2012 시작의 김진성, 2023·2024 시작의 김건우, 2012 시작의 나성범).
// 여기서는 지명 자료로 "지명은 됐지만 시작 연도까지 1군 기록이 없는 선수"를 찾는다. 군 복무·공백 선수는 create.ts가 처리한다.
// 지명 구단이 퓨처스 구단이면(2012 시작의 NC) 그 구단 소속으로 들어간다: 실제로 NC는 2011년 2012 입단 드래프트에서 이 선수들을 지명해
// 2012년 퓨처스리그를 뛰었다 (create.ts의 addFuturesTeams, 2026-10-11 사용자 결정).

import type { DataStore, DraftRow, PlayerMaster } from '../data/types';
import { Rng } from '../engine';
import type { ValueContext } from '../ai/value';
import { growthRoom, skillForRuns, type CareerIndex } from './growth';
import { initialMilitary, SERVICE_UNIT_GENERIC } from './careers';
import { drafteeCenterOf, makeDraftee, matchDraftee, type LeagueView } from './offseason';
import { minSalary } from './salary';
import type { LeaguePlayer, LeagueState, Military } from './types';

type Store = Pick<DataStore, 'meta' | 'players' | 'season' | 'drafts' | 'military'>;

/** 시작 연도 몇 해 전 지명까지 볼지 (임시값: 입단 뒤 7년 넘게 1군 기록이 없다가 데뷔하는 선수는 드물다) */
export const LATE_DEBUT_YEARS = 7;

/**
 * 그 해(year) 쓰던 구단 이름을 지금 리그의 구단 색인으로: 계보(meta.franchises)로 찾고, 해체 구단은 후속 구단(meta.successors)으로.
 * 리그에 없는 구단(아직 창단 전)이면 -1.
 */
export function leagueTeamFor(league: LeagueState, store: Pick<DataStore, 'meta'>, name: string, year: number): number {
  const fr = store.meta.franchises;
  let key = Object.keys(fr).find((k) => fr[k].some((x) => x.name === name && x.from <= year && year <= x.to))
    ?? Object.keys(fr).find((k) => fr[k].some((x) => x.name === name));
  for (let guard = 0; key && guard < 5; guard++) {
    const t = league.teams.findIndex((x) => x.franchise === key);
    if (t >= 0) return t;
    key = store.meta.successors[key];
  }
  return league.teams.findIndex((x) => x.name === name);
}

export interface LateDraftee {
  d: DraftRow;
  /** 입단 연도 (지명 자료의 키) */
  entry: number;
  /** 그 해 지명 자료 안의 순서 (makeDraftee의 index) */
  index: number;
  m: PlayerMaster;
}

/**
 * 게임 시작 전에 지명됐지만 시작 연도까지 1군 기록이 없고, 시작 뒤에 데뷔하는 실제 선수.
 * 같은 사람이 시작 뒤 다시 지명되면(고졸 지명 뒤 대학 진학 등) 그 드래프트로 들어오므로 뺀다.
 * league에 이미 있는 선수도 뺀다 (matchDraftee).
 */
export function lateDebutDraftees(store: Store, league: LeagueState, startYear: number): LateDraftee[] {
  const out: LateDraftee[] = [];
  const seen = new Set<string>();
  for (let entry = startYear; entry >= startYear - LATE_DEBUT_YEARS; entry--) {
    const all = store.drafts?.[String(entry)] ?? [];
    all.forEach((d, index) => {
      if (d.games === 0 || d.kind === '원년 멤버' || d.kind === '육성선수') return;
      const m = matchDraftee(store, d, entry, league);
      if (!m || seen.has(m.id) || m.foreign) return;
      if (m.first <= startYear) return; // 시작 연도까지 1군 기록이 있다 (그 해 기록이면 이미 명단에, 그 전이면 공백 선수로 따로 본다)
      if (m.entryYear > startYear + 1) return; // 시작 뒤 다시 지명된다
      seen.add(m.id);
      out.push({ d, entry, index, m });
    });
  }
  return out;
}

/**
 * 늦게 데뷔하는 지명 선수를 만든다: 잠재력은 실제 커리어(드래프트와 같은 방식), 지금 능력은 지금 나이 기준으로 다시 잡는다.
 * year: 이 선수가 뛸 시즌 (시작 연도, 또는 창단 구단의 첫 시즌). 만든 선수는 makeDraftee가 league.players에 넣는다.
 */
export function makeLateDraftee(league: LeagueState, view: LeagueView, x: LateDraftee, team: number, year: number,
                                store: Store, career: () => CareerIndex, taken: Set<string>): LeaguePlayer {
  const rng = new Rng(`${league.seed}/late/${x.m.id}`);
  const p = makeDraftee(league, view, rng, taken, x.d, x.index, x.entry, store, career);
  const age = p.birthYear ? year - p.birthYear : 22;
  // 지금 능력은 뽑힌 천장이 아니라 천장 중심에서 낸다 (잠재력 v2 18.3 ③: 지금 능력이 천장을 흘리지 않게). 천장 위로는 두지 않는다
  const center = drafteeCenterOf(store, x.m, x.d, x.entry, p.isPitcher, p.pos, view, career);
  const runs = Math.min(p.potential, Math.max(-15, center - growthRoom(age) * rng.range(0.7, 1.3)));
  Object.assign(p, skillForRuns({ ...p }, runs, view.ctx as ValueContext, year));
  p.team = team;
  p.entryYear = x.entry;
  p.contract = { kind: 'reserve', salary: minSalary(year, league), until: year };
  p.military = servingAt(store, p.id, year) ?? initialMilitary({ id: p.id, foreign: false, real: true, birthYear: p.birthYear }, career(), year, store.military?.[p.id]);
  return p;
}

/**
 * 그 시즌(year)에 군 복무 중인가 (military.json의 복무 기록): 전역한 해가 그 시즌이나 다음 시즌이면 복무 중으로 본다
 * (복무 기간 약 2년, 입대 해는 자료에 없다). 복무 중이면 전역 다음 해에 복귀하는 상태를, 아니면 null.
 */
export function servingAt(store: Pick<DataStore, 'military'>, id: string, year: number): Military | null {
  const rec = store.military?.[id];
  const s = rec?.served;
  if (!s?.end || s.end < year || s.end > year + 1) return null;
  // unit '복무' = 위키 병역 칸의 현역·보충역 (배포 파일이 둘을 가르지 않는다) → 현역 규칙. 그 밖의 unit은 군 야구단
  return { state: 'serving', enlisted: year - 1, returnYear: s.end + 1, basis: rec?.src === 'wiki' ? 'wiki' : 'record', note: s.unit,
           ...(s.unit === SERVICE_UNIT_GENERIC ? { kind: 'active' as const } : {}) };
}
