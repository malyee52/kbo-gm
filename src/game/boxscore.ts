// 박스스코어로 만드는 경기 결과 정보 (2026-10-23 UI 2단계 U2-3, 기획안 2.2.1·2.2.4).
// 경기 결과 창(라인스코어 R·H·E·B, 승·패·세 투수 이닝·투구 수, 오늘의 선수)과 기용 보드·다음 경기 카드의 지난 등판에 쓴다.
// 박스스코어는 우리 구단 경기에만 있다 (Season.boxTeams). 화면 계산만 하고 게임 상태를 바꾸지 않는다.
import type { BoxBatter, BoxPitcher, BoxScore, BoxSide, GameLog, Season } from '../engine';
import { shortDate } from './calendar';
import { ipText } from './stats';

/** 라인스코어 오른쪽 합계: 안타·실책·볼넷. 실책은 2026-10-23 전 박스스코어·가을야구에 없어 null */
export function sideTotals(side: BoxSide): { h: number; e: number | null; b: number } {
  return {
    h: side.batters.reduce((a, b) => a + b.h, 0),
    e: side.e ?? null,
    b: side.batters.reduce((a, b) => a + b.bb, 0),
  };
}

/** 승·패·세 투수 한 줄: "6이닝 98구 2실점". 투구 수가 0이면(세지 않은 경기) 뺀다 */
export function pitchSummary(p: Pick<BoxPitcher, 'outs' | 'np' | 'r'>): string {
  return [`${ipText(p.outs)}이닝`, p.np > 0 ? `${p.np}구` : null, `${p.r}실점`].filter(Boolean).join(' ');
}

/** 투수 결과 표시: 승·패·세·홀·블 (한 투수에 여러 개면 이어 쓴다, 예: 블승) */
export function pitchDecision(p: BoxPitcher, log: Pick<GameLog, 'win' | 'loss' | 'save'>): string {
  return [
    p.bsv ? '블' : '', p.idx === log.win ? '승' : '', p.idx === log.loss ? '패' : '', p.idx === log.save ? '세' : '', p.hld ? '홀' : '',
  ].join('');
}

/** 두 팀이 이 경기까지 시즌에서 몇 번째 만났나 ("9차전") */
export function meetingNumber(log: GameLog[], i: number): number {
  const g = log[i];
  let n = 0;
  for (let k = 0; k <= i; k++) {
    const x = log[k];
    if ((x.home === g.home && x.away === g.away) || (x.home === g.away && x.away === g.home)) n++;
  }
  return n;
}

// ---- 오늘의 선수 (기획안 2.2.1 "경기 기여가 가장 큰 선수, 계산식은 개발 카드에서 임시값")
// 타자: 루타 + 볼넷 + 득점 + 타점 + 도루 − 0.3 × 범타. 투수: 1.5 × 이닝 + 0.5 × 삼진 − 2 × 자책 − 0.5 × (피안타 + 볼넷), 승·세 +2.
// 이긴 팀에서 고르고 (무승부면 두 팀 모두), 같으면 먼저 나온 선수. 임시값.
export const POG_WEIGHT = { miss: 0.3, ip: 1.5, so: 0.5, er: 2, baserunner: 0.5, decision: 2 };

export interface PlayerOfGame { idx: number; team: number; pitcher: boolean; score: number; line: string }

function batScore(b: BoxBatter): number {
  const tb = b.h + (b.d ?? 0) + 2 * (b.t ?? 0) + 3 * b.hr;
  return tb + b.bb + b.r + b.rbi + (b.sb ?? 0) - POG_WEIGHT.miss * (b.ab - b.h);
}

function pitScore(p: BoxPitcher, log: Pick<GameLog, 'win' | 'save'>): number {
  const w = POG_WEIGHT;
  return w.ip * (p.outs / 3) + w.so * p.so - w.er * p.er - w.baserunner * (p.h + p.bb) + (p.idx === log.win || p.idx === log.save ? w.decision : 0);
}

/** 타자 한 줄: "4타수 3안타 1홈런 2타점" */
export function batSummary(b: BoxBatter): string {
  return [`${b.ab}타수 ${b.h}안타`, b.hr ? `${b.hr}홈런` : null, b.rbi ? `${b.rbi}타점` : null, b.bb ? `${b.bb}볼넷` : null, b.sb ? `${b.sb}도루` : null]
    .filter(Boolean).join(' ');
}

export function playerOfGame(log: Pick<GameLog, 'home' | 'away' | 'homeRuns' | 'awayRuns' | 'win' | 'save'>, box: BoxScore): PlayerOfGame | null {
  const sides: [BoxSide, number][] = log.homeRuns > log.awayRuns ? [[box.home, log.home]]
    : log.homeRuns < log.awayRuns ? [[box.away, log.away]] : [[box.away, log.away], [box.home, log.home]];
  let best: PlayerOfGame | null = null;
  const seen = new Set<number>();
  for (const [side, team] of sides) {
    for (const b of side.batters) {
      if (seen.has(b.idx)) continue;
      seen.add(b.idx);
      const sc = batScore(b);
      if (!best || sc > best.score) best = { idx: b.idx, team, pitcher: false, score: sc, line: batSummary(b) };
    }
    for (const p of side.pitchers) {
      const sc = pitScore(p, log);
      if (!best || sc > best.score) best = { idx: p.idx, team, pitcher: true, score: sc, line: `${pitchSummary(p)} ${p.so}삼진` };
    }
  }
  return best;
}

// ---- 지난 등판 (기용 보드 투수 칸·후보 창, 다음 경기 카드)

export interface Outing {
  /** 마지막 등판 일정 색인 */
  day: number;
  np: number;
  outs: number;
  start: boolean;
  /** 마지막 등판 뒤 쉰 날 수 (today 전날까지). 어제 던졌으면 0 */
  rest: number;
  /** 마지막 등판까지 날짜가 이어진 등판 수 (어제·그제 던졌으면 2). 1이면 연투 아님 */
  streak: number;
}

/** 한 구단 투수들의 지난 등판 (그 구단 박스스코어로). today는 다음에 치를 날 (Season.day) */
export function lastOutings(season: Pick<Season, 'log' | 'boxes'>, team: number, today: number): Map<number, Outing> {
  const days = new Map<number, { day: number; np: number; outs: number; start: boolean }[]>();
  season.log.forEach((g, i) => {
    if (g.home !== team && g.away !== team) return;
    const box = season.boxes.get(i);
    if (!box) return;
    const side = g.home === team ? box.home : box.away;
    side.pitchers.forEach((p, k) => {
      const list = days.get(p.idx) ?? [];
      list.push({ day: g.day, np: p.np, outs: p.outs, start: k === 0 });
      days.set(p.idx, list);
    });
  });
  const out = new Map<number, Outing>();
  for (const [idx, list] of days) {
    const last = list[list.length - 1];
    let streak = 1;
    for (let k = list.length - 2; k >= 0 && list[k].day === list[k + 1].day - 1; k--) streak++;
    out.set(idx, { ...last, rest: Math.max(0, today - last.day - 1), streak });
  }
  return out;
}

/** "6/08 104구 · 휴식 4일" (+ 어제까지 이어 던졌으면 "· 2연투"). 투구 수를 세지 않은 경기는 이닝으로 */
export function outingText(o: Outing, year: number): string {
  const amount = o.np > 0 ? `${o.np}구` : `${ipText(o.outs)}이닝`;
  return `${shortDate(year, o.day)} ${amount} · 휴식 ${o.rest}일${o.rest === 0 && o.streak >= 2 ? ` · ${o.streak}연투` : ''}`;
}
