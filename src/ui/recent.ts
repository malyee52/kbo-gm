// 우리 선수의 최근 기록 한 줄 (우리 팀 박스스코어 최근 n경기). 기용 보드 후보 비교에 쓴다 (2026-10-22 UI 대개편 2차)
import type { GameSession } from '../game/session';
import { fixed2, ipText, rate3 } from '../game/stats';

/** 선수 색인 → 최근 n경기 기록 한 줄. 그 기간에 나오지 않은 선수는 없다 */
export function recentLines(session: GameSession, n = 10): Map<number, string> {
  const s = session.season;
  const me = session.teamIdx;
  const games = s.log.map((g, i) => ({ g, i })).filter(({ g }) => g.home === me || g.away === me).slice(-n);
  const bat = new Map<number, { g: number; ab: number; h: number; bb: number; hr: number }>();
  const pit = new Map<number, { g: number; outs: number; er: number }>();
  for (const { g, i } of games) {
    const box = s.boxes.get(i);
    if (!box) continue;
    const side = g.home === me ? box.home : box.away;
    for (const l of side.batters) {
      const b = bat.get(l.idx) ?? { g: 0, ab: 0, h: 0, bb: 0, hr: 0 };
      b.g++; b.ab += l.ab; b.h += l.h; b.bb += l.bb; b.hr += l.hr;
      bat.set(l.idx, b);
    }
    for (const l of side.pitchers) {
      const x = pit.get(l.idx) ?? { g: 0, outs: 0, er: 0 };
      x.g++; x.outs += l.outs; x.er += l.er;
      pit.set(l.idx, x);
    }
  }
  const out = new Map<number, string>();
  for (const [i, b] of bat) {
    const pa = b.ab + b.bb;
    out.set(i, `${b.g}경기 타율 ${rate3(b.ab ? b.h / b.ab : 0)} · 출루 ${rate3(pa ? (b.h + b.bb) / pa : 0)}${b.hr ? ` · ${b.hr}홈런` : ''}`);
  }
  for (const [i, x] of pit) out.set(i, `${x.g}경기 ${ipText(x.outs)}이닝 · 평균자책 ${x.outs ? fixed2((x.er * 27) / x.outs) : '-'}`);
  return out;
}
