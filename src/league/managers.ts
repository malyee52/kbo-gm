// 감독 (docs/roadmap.md B1, 2026-10-12 사용자: 실존 인물 이름만, 성향은 중립적으로, 명단은 KBO·위키백과 감독 목록으로).
//
// 자료: data-src/감독.csv → public/data/managers.json (tools/build_data.py build_managers).
//   연도별 구단 개막 감독과 시즌 중 바뀐 감독, 사람별 경력(맡은 시즌·구단·우승)과 운영 경향.
// 운영 경향은 성격 평가가 아니라 기록 사실이다: 그 감독이 시즌 내내 맡은 해의 팀 도루 시도·희생번트·구원 등판 수를
//   그 해 리그 평균과 견준 배율. 경기에서는 이 배율을 작전 빈도(도루·번트)와 선발 교체 시점에 조금 반영한다.
//   능력치(승리 기여) 같은 평가는 두지 않는다.
// 바뀌는 때:
//   - 자료가 있는 해: AI 구단은 그 해 실제 개막 감독으로 시작한다 (시즌 중 교체는 다루지 않는다).
//   - 자료가 끝난 뒤: AI 구단은 계약이 끝나면 성적에 따라 재계약하거나 바꾸고, 꼴찌를 두 시즌 넘게 하면 바꾼다.
//   - 우리 구단: 오프시즌에 해임(남은 연봉의 절반 위약금)하고 후보 가운데서 고른다. 비워 두면 개막 때 첫 후보로 채운다.
// 수치는 모두 임시값.

import type { DataStore, ManagerInfo } from '../data/types';
import type { LeagueState } from './types';
import { Rng } from '../engine/rng';

export interface Manager {
  name: string;
  /** 이 구단에서 맡은 첫 시즌 */
  since: number;
  /** 계약 마지막 시즌 */
  until: number;
  /** 연봉 (만 원) */
  salary: number;
  /** 시즌 중 경질 뒤 수석코치가 맡은 감독 대행 (그 시즌까지, 오프시즌에 정식 감독을 고른다) */
  interim?: boolean;
}

/** 감독 대행 (이름 자료가 없는 수석코치). 운영 경향은 보통 */
export const INTERIM_NAME = '감독 대행 (수석코치)';
export const INTERIM_SALARY = 10_000;

export interface ManagerChange {
  year: number;
  team: number;
  from: string | null;
  to: string;
  reason: string;
}

/** 경기에 쓰는 작전 배율 (엔진 TeamSeason.tactics) */
export interface Tactics {
  steal: number;
  bunt: number;
  /**
   * 투수 밀어붙이기 (엔진 2 10단계, 기획안 3.9.1): 선발 투구 수 기준(plan)과 기준 뒤 여유의 배율 (작을수록 일찍 바꾼다).
   * 투구 단위 자료가 있는 감독(2023~)은 팀 선발 평균 투구 수 ÷ 리그, 없으면 구원 등판 배율(relief)에서
   */
  hook: number;
  /** 불펜 연투 허용 (엔진 2 10단계): 연투·3연투 기준의 배율 (클수록 연투가 잦다). 팀 구원 연투 비율 ÷ 리그 (2023~), 자료 없으면 1 */
  pen: number;
  /**
   * 대타·대주자 빈도 (엔진 2 9단계, 기획안 3.9.1): 대타 기준 이득·대주자 주력 차를 이 값으로 나눈다 (클수록 자주).
   * 실존 감독은 자료가 없어 모두 1, 가상 감독만 이름으로 정한 0.7~1.3 (임시값)
   */
  sub: number;
}

export const NEUTRAL_TACTICS: Tactics = { steal: 1, bunt: 1, hook: 1, pen: 1, sub: 1 };

/**
 * 기록 배율을 경기 배율로 옮길 때의 비율: 팀 기록에는 선수 구성 몫도 섞여 있어 절반 남짓만 감독 몫으로 본다 (임시값).
 * push·pen (엔진 2 10단계)은 2023~2025 선발 100구 이상 비율·구원 연투에 맞춘 값 (임시값)
 */
export const TACTIC_SHARE = { steal: 0.6, bunt: 0.8, hook: 0.6, push: 1, pen: 1 };
/** 가상 감독 성향 폭 (이름 해시, 임시값): 대타·대주자 빈도, 투수 밀어붙이기, 불펜 연투 허용 */
export const VIRTUAL_RANGE = { sub: [0.7, 1.3], hook: [0.94, 1.06], pen: [0.85, 1.15] } as const;
/** 연봉: 기본 2억 + 감독 시즌마다 4천만, 우승마다 5천만, 최대 7억 (만 원, 임시값) */
export const MANAGER_SALARY = { base: 20_000, perSeason: 4_000, perTitle: 5_000, max: 70_000 };
/** 계약 기간 (시즌, 임시값). 실제 KBO 감독 계약은 대개 2~3년 */
export const MANAGER_YEARS = 3;
export const MANAGER_RENEW_YEARS = 2;
/** 해임 위약금: 남은 연봉 가운데 이 비율 (임시값) */
export const MANAGER_BUYOUT = 0.5;
/** 후보: 마지막으로 감독을 맡은 해가 이만큼 안쪽인 사람 */
export const CANDIDATE_RECENT = 12;
/** 후보 화면에 보이는 수 */
export const CANDIDATE_MAX = 12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const infoOf = (store: Pick<DataStore, 'managers'>, name: string): ManagerInfo | undefined => store.managers?.people[name];

/**
 * 기록 배율 → 경기 배율. year: 그 시즌 (있으면 그 해 개막 감독으로 맡은 팀의 투구 단위 값 byYear를 먼저 쓴다).
 * 자료 없는 이름(가상 감독)은 대타·대주자 빈도·투수 밀어붙이기·불펜 연투 허용을 이름으로 정한다
 */
export function tacticsOf(info: ManagerInfo | undefined, name?: string, year?: number): Tactics {
  if (!info) return name ? { ...NEUTRAL_TACTICS, sub: virtualSub(name), hook: virtualTactic(name, 'hook'), pen: virtualTactic(name, 'pen') } : NEUTRAL_TACTICS;
  const by = year !== undefined ? info.byYear?.[String(year)] : undefined;
  const push = by?.push ?? info.push;
  const pen = by?.pen ?? info.pen;
  return {
    sub: 1,
    steal: clamp(1 + (info.steal - 1) * TACTIC_SHARE.steal, 0.7, 1.4),
    bunt: clamp(1 + (info.bunt - 1) * TACTIC_SHARE.bunt, 0.7, 1.4),
    hook: push !== undefined ? round3(clamp(1 + (push - 1) * TACTIC_SHARE.push, 0.85, 1.15)) : clamp(1 - (info.relief - 1) * TACTIC_SHARE.hook, 0.9, 1.1),
    pen: pen !== undefined ? round3(clamp(1 + (pen - 1) * TACTIC_SHARE.pen, 0.7, 1.4)) : 1,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** 가상 감독의 대타·대주자 빈도: 이름으로 정한 0.7~1.3 (같은 이름은 늘 같다, 임시값) */
export function virtualSub(name: string): number {
  return Math.round((0.7 + 0.6 * new Rng(`manager-sub/${name}`).next()) * 100) / 100;
}

/** 가상 감독의 투수 밀어붙이기·불펜 연투 허용: 이름으로 정한 VIRTUAL_RANGE 안 값 (같은 이름은 늘 같다, 임시값) */
export function virtualTactic(name: string, key: 'hook' | 'pen'): number {
  const [lo, hi] = VIRTUAL_RANGE[key];
  return Math.round((lo + (hi - lo) * new Rng(`manager-${key}/${name}`).next()) * 100) / 100;
}

/** 배율을 말로 (화면). 기록 비교일 뿐 좋고 나쁨이 아니다 */
export function tendencyLabel(v: number): string {
  return v >= 1.1 ? '많음' : v <= 0.9 ? '적음' : '보통';
}

export function managerSalary(info: ManagerInfo | undefined): number {
  if (!info) return MANAGER_SALARY.base;
  return Math.min(MANAGER_SALARY.max, MANAGER_SALARY.base + MANAGER_SALARY.perSeason * info.seasons + MANAGER_SALARY.perTitle * info.titles);
}

/** 경력 한 줄 (기록 사실만) */
export function careerLine(info: ManagerInfo | undefined): string {
  if (!info) return '경력 자료 없음';
  const parts = [info.seasons ? `감독 ${info.seasons}시즌` : '', info.acting ? `대행 ${info.acting}번` : '', info.titles ? `우승 ${info.titles}번` : ''].filter(Boolean);
  return `${parts.join(' · ') || '감독 경력 없음'} (${info.first === info.last ? info.first : `${info.first}~${info.last}`}, ${info.teams.join('·')})`;
}

/**
 * 그 해 그 계보의 실제 개막 감독. 창단 구단이 퓨처스 시절이라 자료가 없으면 1군 첫해 감독 (NC 2012 퓨처스 → 2013 김경문).
 * 자료가 끝난 해 뒤로는 없음
 */
export function realOpening(store: Pick<DataStore, 'managers' | 'meta'>, franchise: string, year: number): string | null {
  const s = store.managers?.seasons;
  if (!s) return null;
  const pick = (y: number) => s[String(y)]?.[franchise]?.find((m) => !m.mid)?.name ?? null;
  const now = pick(year);
  if (now) return now;
  const span = store.meta.franchises[franchise];
  if (span?.length && year < span[0].from && year >= span[0].from - 2) return pick(span[0].from);
  return null;
}

/** 자료가 있는 마지막 해 */
export function lastDataYear(store: Pick<DataStore, 'managers'>): number {
  return Math.max(0, ...Object.keys(store.managers?.seasons ?? {}).map(Number));
}

function makeManager(store: Pick<DataStore, 'managers'>, name: string, year: number, years = MANAGER_YEARS): Manager {
  return { name, since: year, until: year + years - 1, salary: managerSalary(infoOf(store, name)) };
}

const employed = (league: LeagueState) => new Set((league.managers ?? []).filter(Boolean).map((m) => m!.name));

/**
 * 고용할 수 있는 후보 (이름 순서가 정해져 있어 결정적이다): 그 해까지 감독(대행 포함)을 맡은 적이 있고,
 * 최근(CANDIDATE_RECENT년 안)까지 맡았던 사람 가운데 지금 다른 구단에 없는 사람. 경력이 긴 순.
 * 자료가 끝난 뒤로는 자료 마지막 해를 기준으로 본다 (실존 인물만 쓰므로 새 사람이 생기지 않는다)
 */
export function candidates(league: LeagueState, store: Pick<DataStore, 'managers'>, year: number): string[] {
  const people = store.managers?.people ?? {};
  const busy = employed(league);
  const base = Math.min(year, lastDataYear(store) || year);
  return Object.entries(people)
    .filter(([name, i]) => !busy.has(name) && i.first <= year && i.last >= base - CANDIDATE_RECENT)
    .sort(([an, a], [bn, b]) => b.seasons - a.seasons || b.titles - a.titles || b.last - a.last || an.localeCompare(bn))
    .map(([name]) => name);
}

/** 구장·재정처럼 예전 저장이나 새 게임에 감독을 채운다 (그 해 실제 개막 감독, 없으면 후보 첫째) */
export function ensureManagers(league: LeagueState, store: Pick<DataStore, 'managers' | 'meta'>): void {
  if (!store.managers) return;
  league.managers ??= [];
  for (let t = 0; t < league.teams.length; t++) {
    if (league.managers[t]) continue;
    const real = realOpening(store, league.teams[t].franchise, league.year);
    const name = real && !employed(league).has(real) ? real : candidates(league, store, league.year)[0];
    if (!name) continue;
    // 실제 감독은 그 구단에서 맡기 시작한 해를 자료에서 찾는다
    let since = league.year;
    while (real === name && realOpening(store, league.teams[t].franchise, since - 1) === name) since--;
    // 계약은 맡기 시작한 해부터 MANAGER_YEARS년 단위로 이어진 것으로 본다 (실제 계약 기간 자료가 없다)
    const left = MANAGER_YEARS - ((league.year - since) % MANAGER_YEARS);
    league.managers[t] = { ...makeManager(store, name, league.year, left), since };
  }
}

export const managerOf = (league: Pick<LeagueState, 'managers'>, team: number): Manager | null => league.managers?.[team] ?? null;

/** 그 구단 감독 연봉 (한 해) */
export const managerPayroll = (league: Pick<LeagueState, 'managers'>, team: number): number => managerOf(league, team)?.salary ?? 0;

function record(league: LeagueState, c: ManagerChange): void {
  (league.managerLog ??= []).push(c);
  if (league.managerLog.length > 200) league.managerLog.splice(0, league.managerLog.length - 200);
}

/** 우리 구단 감독 해임 (오프시즌). 위약금은 다음 시즌 장부 */
export function fireManager(league: LeagueState, team: number, offYear: number): { ok: boolean; message: string } {
  const cur = managerOf(league, team);
  if (!cur) return { ok: false, message: '감독 자리가 이미 비어 있습니다.' };
  const buyout = Math.round(cur.salary * Math.max(0, cur.until - offYear) * MANAGER_BUYOUT);
  if (buyout > 0) league.ledger.push({ year: offYear + 1, from: team, to: -1, amount: buyout, note: `${cur.name} 감독 계약 해지 위약금`, kind: 'coach' });
  league.managers![team] = null;
  record(league, { year: offYear, team, from: cur.name, to: '', reason: '해임' });
  return { ok: true, message: `${cur.name} 감독을 해임했습니다.${buyout > 0 ? ` 위약금 ${(buyout / 10000).toFixed(1)}억 원.` : ''} 개막 전에 새 감독을 고르세요.` };
}

/** 우리 구단 감독 고용 (오프시즌, 다음 시즌부터). 자리가 차 있으면 먼저 해임해야 한다 (감독 대행은 빈자리로 본다) */
export function hireManager(league: LeagueState, store: Pick<DataStore, 'managers'>, team: number, offYear: number, name: string): { ok: boolean; message: string } {
  if (managerOf(league, team) && !managerOf(league, team)!.interim) return { ok: false, message: '먼저 지금 감독을 해임해야 합니다.' };
  if (!candidates(league, store, offYear + 1).includes(name)) return { ok: false, message: '고용할 수 없는 후보입니다.' };
  league.managers![team] = makeManager(store, name, offYear + 1);
  record(league, { year: offYear + 1, team, from: null, to: name, reason: '선임' });
  return { ok: true, message: `${name} 감독 선임: ${offYear + 1}~${offYear + MANAGER_YEARS} 시즌, 연봉 ${(league.managers![team]!.salary / 10000).toFixed(1)}억 원.` };
}

/** 오프시즌 감독 교체를 한 번에: 해임(위약금) 뒤 선임. 선임할 수 없으면 아무것도 바꾸지 않는다 */
export function replaceManager(league: LeagueState, store: Pick<DataStore, 'managers'>, team: number, offYear: number, name: string): { ok: boolean; message: string } {
  if (!candidates(league, store, offYear + 1).includes(name)) return { ok: false, message: '고용할 수 없는 후보입니다.' };
  const cur = managerOf(league, team);
  const fired = cur && !cur.interim ? fireManager(league, team, offYear) : null;
  if (cur?.interim) league.managers![team] = null;
  const hired = hireManager(league, store, team, offYear, name);
  return { ok: hired.ok, message: `${fired ? `${fired.message.replace(' 개막 전에 새 감독을 고르세요.', '')} ` : ''}${hired.message}` };
}

/**
 * 시즌 중 감독 교체 (우리 구단, year = 지금 시즌). name이 있으면 그 후보를 바로 정식 감독으로(이번 시즌부터 MANAGER_YEARS년),
 * null이면 수석코치가 시즌 끝까지 감독 대행. 전임 감독 위약금 = 연봉 × (남은 시즌 + 이번 시즌 절반) × MANAGER_BUYOUT, 이번 시즌 장부
 */
export function changeManagerInSeason(league: LeagueState, store: Pick<DataStore, 'managers'>, team: number, year: number, name: string | null): { ok: boolean; message: string } {
  const cur = managerOf(league, team);
  if (name === null && cur?.interim) return { ok: false, message: '이미 감독 대행 체제입니다.' };
  if (name !== null && !candidates(league, store, year).includes(name)) return { ok: false, message: '데려올 수 없는 후보입니다.' };
  let note = '';
  if (cur && !cur.interim) {
    const buyout = Math.round(cur.salary * (Math.max(0, cur.until - year) + 0.5) * MANAGER_BUYOUT);
    if (buyout > 0) league.ledger.push({ year, from: team, to: -1, amount: buyout, note: `${cur.name} 감독 시즌 중 경질 위약금`, kind: 'coach' });
    record(league, { year, team, from: cur.name, to: '', reason: '시즌 중 경질' });
    note = `${cur.name} 감독 경질${buyout > 0 ? ` (위약금 ${(buyout / 10000).toFixed(1)}억 원)` : ''}. `;
  }
  league.managers ??= [];
  if (name === null) {
    league.managers[team] = { name: INTERIM_NAME, since: year, until: year, salary: INTERIM_SALARY, interim: true };
    record(league, { year, team, from: null, to: INTERIM_NAME, reason: '감독 대행' });
    return { ok: true, message: `${note}수석코치가 시즌 끝까지 감독 대행을 맡습니다. 정식 감독은 오프시즌에 고르세요.` };
  }
  league.managers[team] = makeManager(store, name, year);
  record(league, { year, team, from: null, to: name, reason: '시즌 중 선임' });
  return { ok: true, message: `${note}${name} 감독 선임: ${year}~${year + MANAGER_YEARS - 1} 시즌, 연봉 ${(league.managers[team]!.salary / 10000).toFixed(1)}억 원.` };
}

/**
 * 개막 때 감독 정리 (session 'open', closeOffseason 뒤 league.year = 새 시즌). 바뀐 일을 문장으로 돌려준다.
 * - 우리 구단: 계약이 끝났으면 같은 조건으로 재계약, 비어 있으면 첫 후보로 채운다.
 * - AI 구단: 자료가 있는 해는 실제 개막 감독. 아니면 계약 만료·성적으로 재계약하거나 바꾼다.
 * standings: 지난 시즌 순위 (구단 색인, 1위부터). postseasonTeams: 지난 시즌 가을야구 팀 수.
 * postseason: 양대 리그 해(1999·2000)만, 지난 시즌 실제 가을야구 진출 구단. 주면 "가을야구"는 이것으로, 꼴찌·상위 절반은 통합 순위 그대로 (일정 개편 기획안 10.6)
 */
export function openManagers(league: LeagueState, store: Pick<DataStore, 'managers' | 'meta'>, userTeam: number, standings: number[], postseasonTeams: number,
                             postseason?: readonly number[]): string[] {
  if (!store.managers) return [];
  const year = league.year;
  league.managers ??= [];
  const out: string[] = [];
  const set = (t: number, name: string, reason: string) => {
    const prev = league.managers![t];
    league.managers![t] = makeManager(store, name, year);
    record(league, { year, team: t, from: prev?.name ?? null, to: name, reason });
    out.push(`${league.teams[t].name} ${name} 감독 ${reason === '선임' ? '선임' : reason}`);
  };
  // 1) 우리 구단
  if (userTeam >= 0) {
    const m = league.managers[userTeam];
    // 감독 대행은 시즌이 끝나면 물러난다 (오프시즌에 고르지 않았으면 아래 3)에서 첫 후보)
    if (m?.interim) {
      league.managers[userTeam] = null;
      record(league, { year, team: userTeam, from: m.name, to: '', reason: '대행 종료' });
    } else if (m && m.until < year) {
      m.until = year + MANAGER_RENEW_YEARS - 1;
      out.push(`${league.teams[userTeam].name} ${m.name} 감독과 ${MANAGER_RENEW_YEARS}년 재계약`);
    }
  }
  // 2) AI 구단: 실제 자료 먼저 (이름이 다른 구단과 겹치지 않게 차례로)
  const rank = (t: number) => standings.indexOf(t);
  for (let t = 0; t < league.teams.length; t++) {
    if (t === userTeam) continue;
    const real = realOpening(store, league.teams[t].franchise, year);
    const cur = league.managers[t];
    if (real) {
      if (cur?.name === real) {
        if (cur.until < year) cur.until = year + MANAGER_RENEW_YEARS - 1;
        continue;
      }
      if (!employed(league).has(real)) { set(t, real, '선임'); continue; }
    }
    if (!cur) continue;
    const r = rank(t);
    const last = r >= 0 && r === standings.length - 1;
    const good = postseason ? postseason.includes(t) : r >= 0 && r < postseasonTeams;
    // 실제 감독이 우리 구단에 있어 데려올 수 없으면 지금 감독을 그대로 둔다
    if (real !== null) continue;
    let why = '';
    if (cur.until < year) {
      if (good || (r >= 0 && r < standings.length / 2)) { cur.until = year + MANAGER_RENEW_YEARS - 1; continue; }
      why = '계약 만료';
    } else if (last && cur.since <= year - 2) why = '성적 부진';
    if (!why) continue;
    league.managers[t] = null;
    record(league, { year, team: t, from: cur.name, to: '', reason: why });
    out.push(`${league.teams[t].name} ${cur.name} 감독 퇴진 (${why})`);
  }
  // 3) 빈자리 채우기 (구단 색인 순서, 후보 순서)
  for (let t = 0; t < league.teams.length; t++) {
    if (league.managers[t]) continue;
    // 막 내보낸 감독을 같은 구단이 다시 데려오지 않는다
    const gone = new Set((league.managerLog ?? []).filter((c) => c.team === t && c.year >= year - 1 && !c.to && c.from).map((c) => c.from!));
    const name = candidates(league, store, year).find((n) => !gone.has(n));
    if (name) set(t, name, '선임');
  }
  return out;
}
