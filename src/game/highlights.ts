// 중계 문구와 경기 하이라이트 (2026-10-12 사용자 요청 "애니메이션": 경기 중계 화면, 경기 결과 하이라이트).
// 엔진이 남긴 중계 기록(engine/game.ts Play)을 글로 옮긴다. 실존 선수는 기록 사실만 쓴다 (평가·수식어 없음).
import type { Play, PlayKind } from '../engine';

export type NameOf = (idx: number) => string;

const KIND_TEXT: Record<PlayKind, string> = {
  SO: '삼진', BB: '볼넷', HBP: '몸에 맞는 공', HR: '홈런', '3B': '3루타', '2B': '2루타', '1B': '안타', E: '실책으로 출루',
  GDP: '병살타', GO: '땅볼 아웃', FO: '뜬공 아웃', SF: '희생플라이', SAC: '희생번트', SB: '도루 성공', CS: '도루 실패', WP: '폭투로 주자 진루', PC: '투수 교체',
  IBB: '고의4구', BF: '번트 실패', PH: '대타', PR: '대주자',
};

export const isHit = (k: PlayKind) => k === '1B' || k === '2B' || k === '3B' || k === 'HR';

/** 홈런 종류: 솔로·2점·3점·만루 */
export function homerLabel(runs: number): string {
  return runs >= 4 ? '만루 홈런' : runs === 1 ? '솔로 홈런' : `${runs}점 홈런`;
}

/** 한 줄 중계 문구 */
export function playText(p: Play, name: NameOf): string {
  if (p.kind === 'PC') return `투수 교체: ${name(p.pit)}`;
  if (p.kind === 'WP') return `폭투·포일${p.runs ? `, ${p.runs}점` : ''}`;
  if (p.kind === 'PH' || p.kind === 'PR') return `${KIND_TEXT[p.kind]}: ${name(p.bat)}`;
  const who = name(p.bat);
  if (p.kind === 'HR') return `${who} ${homerLabel(p.runs)}!`;
  const tail = p.runs > 0 ? ` (${p.runs}점)` : '';
  // 실책: 누가 했나 (2026-10-13 수비수별 실책)
  if (p.kind === 'E' && p.fielder !== undefined && p.fielder >= 0) return `${who} ${name(p.fielder)}의 실책으로 출루${tail}`;
  return `${who} ${KIND_TEXT[p.kind]}${tail}`;
}

export const inningLabel = (p: Pick<Play, 'inn' | 'top'>) => `${p.inn}회${p.top ? '초' : '말'}`;

/** 플레이 직전 점수 (공격 팀 기준이 아니라 원정·홈) */
export function scoreBefore(p: Play): { away: number; home: number } {
  return p.top ? { away: p.away - p.runs, home: p.home } : { away: p.away, home: p.home - p.runs };
}

export interface Moment {
  play: Play;
  text: string;
  /** 'walkoff' 끝내기, 'lead' 역전·앞서가는 점수, 'tie' 동점, 'homer' 홈런 */
  tag: 'walkoff' | 'lead' | 'tie' | 'homer';
}

/**
 * 경기 하이라이트: 끝내기, 역전(동점에서 앞서가는 점수 포함), 동점, 홈런 순으로 고른다.
 * team: 우리 구단이 홈이면 'home', 원정이면 'away' (우리 쪽 장면을 먼저)
 */
export function highlights(plays: Play[], name: NameOf, team: 'home' | 'away', max = 3): Moment[] {
  const out: Moment[] = [];
  const last = plays[plays.length - 1];
  for (const p of plays) {
    if (p.runs <= 0) continue;
    const b = scoreBefore(p);
    const att = p.top ? 'away' : 'home';
    const def = att === 'away' ? 'home' : 'away';
    const before = b[att] - b[def];
    const after = p[att] - p[def];
    const text = `${inningLabel(p)} ${playText(p, name)} ${p.away}:${p.home}`;
    if (p === last && !p.top && p.inn >= 9 && p.home > p.away) out.push({ play: p, text: `끝내기! ${text}`, tag: 'walkoff' });
    else if (before <= 0 && after > 0) out.push({ play: p, text: `${before < 0 ? '역전' : '리드'} ${text}`, tag: 'lead' });
    else if (before < 0 && after === 0) out.push({ play: p, text: `동점 ${text}`, tag: 'tie' });
    else if (p.kind === 'HR') out.push({ play: p, text, tag: 'homer' });
  }
  const order = { walkoff: 0, lead: 1, tie: 2, homer: 3 };
  const mine = (m: Moment) => ((m.play.top ? 'away' : 'home') === team ? 0 : 1);
  return out
    .map((m, i) => ({ m, i }))
    .sort((a, b) => order[a.m.tag] - order[b.m.tag] || mine(a.m) - mine(b.m) || b.m.play.inn - a.m.play.inn || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.m);
}

/** 중계 기록으로 이닝별 점수를 만든다 (진행 중인 장면까지) */
export function lineScoreUpTo(plays: Play[], upto: number): { away: number[]; home: number[] } {
  const away: number[] = [];
  const home: number[] = [];
  for (let i = 0; i < Math.min(upto, plays.length); i++) {
    const p = plays[i];
    const arr = p.top ? away : home;
    while (arr.length < p.inn) arr.push(0);
    arr[p.inn - 1] += p.runs;
  }
  return { away, home };
}
