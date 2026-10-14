// 구장 명명권 (2026-10-14 사용자 선택): 오프시즌에 가상 기업들의 제안을 받아 구장 이름을 팔고, 계약 기간 동안 해마다 개막 때 수입.
// - 제안은 리그 시드·연도·구단으로 정해진다 (가상 기업 이름, 실존 기업 아님). 팬 만족도·시설이 좋을수록 비싸다.
// - 계약은 중간에 깰 수 없다. AI 구단도 명명권이 비면 절반쯤 판다.
// 수치는 모두 임시값 (docs/temp-values.md).
import { Rng } from '../engine';
import type { LeagueState } from './types';

const PRE = ['한빛', '누리', '새솔', '가람', '다온', '미르', '온새', '해찬', '별누리', '라온', '하늬', '비채'];
const SUF = ['전자', '생명', '카드', '에너지', '건설', '통신', '증권', '푸드', '모빌리티', '제약', '항공', '물산'];
/** 한 해 기준 금액(만 원), 기간별 배율 (임시값) */
export const NAMING_BASE = 150_000;
export const NAMING_YEARS: Record<number, number> = { 3: 1, 5: 0.95, 10: 0.85 };
export const AI_NAMING_CHANCE = 0.5;

export interface Naming { sponsor: string; from: number; until: number; yearly: number }
export interface NamingOffer { id: string; sponsor: string; years: number; yearly: number }

/** 그 시즌에 걸린 명명권 */
export function namingAt(league: Pick<LeagueState, 'stadiums'>, team: number, year: number): Naming | undefined {
  const n = league.stadiums?.[team]?.naming;
  return n && n.from <= year && year <= n.until ? n : undefined;
}

/** 화면에 보일 구장 이름 */
export function stadiumName(league: Pick<LeagueState, 'stadiums'>, team: number, year: number): string | undefined {
  const s = league.stadiums?.[team];
  const n = namingAt(league, team, year);
  return n ? `${n.sponsor} 파크` : s?.name;
}

/** offYear 오프시즌의 제안 3개 (다음 시즌부터). 다음 시즌에도 계약이 남아 있으면 없다 */
export function namingOffers(league: Pick<LeagueState, 'seed' | 'stadiums' | 'fans'>, team: number, offYear: number): NamingOffer[] {
  const s = league.stadiums?.[team];
  if (!s || (s.naming && s.naming.until > offYear)) return [];
  const rng = new Rng(`${league.seed}/naming/${offYear}/${team}`);
  const fans = league.fans?.[team]?.level ?? 50;
  const worth = NAMING_BASE * (0.6 + fans / 100) * (0.8 + s.quality / 250);
  const used = new Set<string>();
  return [3, 5, 10].map((years, i) => {
    let sponsor = '';
    do sponsor = PRE[rng.int(PRE.length)] + SUF[rng.int(SUF.length)]; while (used.has(sponsor));
    used.add(sponsor);
    return { id: `naming-${offYear}-${team}-${i}`, sponsor, years, yearly: Math.round((worth * NAMING_YEARS[years] * (0.9 + rng.next() * 0.2)) / 1000) * 1000 };
  });
}

export function signNaming(league: LeagueState, team: number, offYear: number, id: string): { ok: boolean; message: string } {
  const o = namingOffers(league, team, offYear).find((x) => x.id === id);
  if (!o) return { ok: false, message: '받을 수 없는 제안입니다.' };
  league.stadiums![team].naming = { sponsor: o.sponsor, from: offYear + 1, until: offYear + o.years, yearly: o.yearly };
  return { ok: true, message: `명명권 계약: ${o.sponsor} 파크 (${offYear + 1}~${offYear + o.years} 시즌, 해마다 ${(o.yearly / 10000).toFixed(1)}억 원).` };
}

/** 개막 때 (league.year = 새 시즌): AI 구단 명명권 판매, 모든 구단 명명권 수입을 장부에. 우리 구단 소식 문장 */
export function openNaming(league: LeagueState, userTeam: number): string[] {
  const year = league.year;
  const news: string[] = [];
  for (let t = 0; t < (league.stadiums?.length ?? 0); t++) {
    if (t !== userTeam && !namingAt(league, t, year) && new Rng(`${league.seed}/naming-ai/${year}/${t}`).chance(AI_NAMING_CHANCE)) {
      const offers = namingOffers(league, t, year - 1);
      if (offers.length) signNaming(league, t, year - 1, offers[1].id);
    }
    const n = namingAt(league, t, year);
    if (!n) continue;
    league.ledger.push({ year, from: -1, to: t, amount: n.yearly, note: `${league.teams[t].name} 구장 명명권 (${n.sponsor})`, kind: 'sponsor' });
    if (t === userTeam) news.push(`구장 명명권 수입 ${(n.yearly / 10000).toFixed(1)}억 원 (${n.sponsor}, ${n.until} 시즌까지)`);
  }
  return news;
}
