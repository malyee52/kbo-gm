// 판타지 효과 (docs/fantasy-mode.md 3~5단계): AI가 제안하는 게임 수치 변화. 정해 둔 목록(화이트리스트)과 상한 안에서만.
// - 실존 선수에게는 중립 효과(경기력, 휴식)만. 잠재력은 가상 선수(real === false)만 (사용자 결정: 실존 선수 잠재력 = 실제 고점)
// - 상한은 출처마다: 대화(chat) < 사건(event) < 이야기 줄기의 절정(arc)
// - AI는 선수를 이름으로 말한다. 우리 구단 선수 이름으로 id를 찾고, 없거나 겹치면 그 효과를 버린다
// 적용(applyFantasyEffects)은 세션이 한다 (조작 기록에서 재현된다).

export type EffectScale = 'chat' | 'event' | 'arc';

export type FantasyEffect =
  | { type: 'trust'; delta: number }
  | { type: 'fans'; delta: number }
  /** 만 원. 양수면 들어오고 음수면 나간다 */
  | { type: 'cash'; amount: number }
  /** 관중률 (0.05 = 5%p), days일 */
  | { type: 'fill'; fill: number; days: number }
  /** 구단 경기력 (타석마다 유리한 정도, 홈 이점 0.013 정도) */
  | { type: 'teamForm'; side: 'bat' | 'pit' | 'all'; edge: number; days: number }
  | { type: 'playerForm'; player: string; edge: number; days: number }
  | { type: 'rest'; player: string; days: number }
  /** 가상 선수만 (런) */
  | { type: 'potential'; player: string; delta: number }
  /** 큰 변화 (arc만): 가상 유망주가 다음 개막에 입단. potential은 런, pos P·C·IF·OF */
  | { type: 'prospect'; name: string; pos: 'P' | 'C' | 'IF' | 'OF'; age: number; potential: number }
  /** 큰 변화 (arc만): 구단주가 바뀐다 (신뢰를 새로 시작) */
  | { type: 'ownerChange'; trust: number }
  /** 협상 (negotiate.ts만): 그 구단이 우리 트레이드 제안을 보는 호감 (런, AI 트레이드 평가 이득에 더한다) */
  | { type: 'tradeGoodwill'; team: number; runs: number; days: number }
  /** 협상 (negotiate.ts만): 그 선수의 FA·다년 계약 요구액 할인(+)·할증(−) 비율 (이번 오프시즌) */
  | { type: 'demandDiscount'; player: string; pct: number }
  /** 협상 (negotiate.ts만): 에이전트가 받아들인 계약 조건 (연봉 만 원, 기간). 이번 오프시즌 그 조건 제시는 반드시 수락 */
  | { type: 'agreedDeal'; player: string; salary: number; years: number };

export interface EffectLimits { trust: number; fans: number; cash: number; edge: number; days: number; fill: number; potential: number; rest: number; count: number }

export const LIMITS: Record<EffectScale, EffectLimits> = {
  chat: { trust: 3, fans: 3, cash: 20_000, edge: 0.01, days: 7, fill: 0.05, potential: 2, rest: 3, count: 2 },
  event: { trust: 6, fans: 6, cash: 100_000, edge: 0.02, days: 14, fill: 0.1, potential: 4, rest: 7, count: 3 },
  arc: { trust: 15, fans: 15, cash: 1_000_000, edge: 0.03, days: 30, fill: 0.2, potential: 8, rest: 10, count: 4 },
};

/** AI에게 알려 주는 효과 목록 (JSON 형식 설명) */
export function effectMenu(scale: EffectScale): string {
  const L = LIMITS[scale];
  const lines = [
    `- {"type":"trust","delta":정수} 구단주 신뢰 (±${L.trust})`,
    `- {"type":"fans","delta":정수} 팬 만족도 (±${L.fans})`,
    `- {"type":"cash","amount":정수} 구단 자금, 단위 만 원 (±${L.cash.toLocaleString('ko-KR')}, 1억 = 10000)`,
    `- {"type":"fill","fill":소수,"days":정수} 관중률 (±${L.fill}, ${L.days}일까지)`,
    `- {"type":"teamForm","side":"bat|pit|all","edge":소수,"days":정수} 선수단 경기력 (±${L.edge}, ${L.days}일까지)`,
    `- {"type":"playerForm","player":"선수 이름","edge":소수,"days":정수} 우리 선수 한 명 경기력 (±${L.edge})`,
    `- {"type":"rest","player":"선수 이름","days":정수} 우리 선수 휴식 (${L.rest}일까지)`,
    `- {"type":"potential","player":"가상 선수 이름","delta":정수} (가상) 선수만 잠재력 (±${L.potential})`,
  ];
  if (scale === 'arc') {
    lines.push('- {"type":"prospect","name":"지어낸 한국 이름","pos":"P|C|IF|OF","age":17~22,"potential":20~45} 가상 유망주가 다음 개막에 입단 (이야기의 절정에서만)');
    lines.push('- {"type":"ownerChange","trust":40~70} 구단주가 바뀌고 신뢰를 새로 시작 (이야기의 절정에서만)');
  }
  return `한 번에 최대 ${L.count}개. 효과는 상황과 이야기에 맞을 때만, 없으면 빈 목록.\n${lines.join('\n')}`;
}

export interface EffectPlayer { id: string; name: string; real: boolean }

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() && Number.isFinite(Number(x)) ? Number(x) : null);
const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));

/** AI가 낸 효과를 검사하고 상한으로 자른다. 쓸 수 없는 효과는 버리고 이유를 남긴다 */
export function sanitizeEffects(raw: unknown, scale: EffectScale, roster: EffectPlayer[]): { effects: FantasyEffect[]; dropped: string[] } {
  const L = LIMITS[scale];
  const out: FantasyEffect[] = [];
  const dropped: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  const byName = (name: unknown): EffectPlayer | null => {
    if (typeof name !== 'string') return null;
    const hits = roster.filter((p) => p.name === name.trim());
    return hits.length === 1 ? hits[0] : null;
  };
  for (const r of list) {
    if (out.length >= L.count) { dropped.push('효과가 너무 많음'); break; }
    const e = (r ?? {}) as Record<string, unknown>;
    const t = e.type;
    if (t === 'trust' || t === 'fans') {
      const d = num(e.delta);
      if (d === null || d === 0) { dropped.push(`${t}: 값 없음`); continue; }
      out.push({ type: t, delta: Math.round(clamp(d, L[t])) });
    } else if (t === 'cash') {
      const a = num(e.amount);
      if (a === null || a === 0) { dropped.push('cash: 값 없음'); continue; }
      out.push({ type: 'cash', amount: Math.round(clamp(a, L.cash)) });
    } else if (t === 'fill') {
      const f = num(e.fill);
      const d = num(e.days);
      if (f === null || f === 0) { dropped.push('fill: 값 없음'); continue; }
      out.push({ type: 'fill', fill: Math.round(clamp(f, L.fill) * 1000) / 1000, days: Math.max(1, Math.min(L.days, Math.round(d ?? 7))) });
    } else if (t === 'teamForm') {
      const edge = num(e.edge);
      if (edge === null || edge === 0) { dropped.push('teamForm: 값 없음'); continue; }
      const side = e.side === 'bat' || e.side === 'pit' ? e.side : 'all';
      out.push({ type: 'teamForm', side, edge: Math.round(clamp(edge, L.edge) * 10000) / 10000, days: Math.max(1, Math.min(L.days, Math.round(num(e.days) ?? 7))) });
    } else if (t === 'playerForm' || t === 'rest' || t === 'potential') {
      const p = byName(e.player);
      if (!p) { dropped.push(`${t}: 우리 선수 "${String(e.player)}"를 찾지 못함`); continue; }
      if (t === 'playerForm') {
        const edge = num(e.edge);
        if (edge === null || edge === 0) { dropped.push('playerForm: 값 없음'); continue; }
        out.push({ type: 'playerForm', player: p.id, edge: Math.round(clamp(edge, L.edge) * 10000) / 10000, days: Math.max(1, Math.min(L.days, Math.round(num(e.days) ?? 7))) });
      } else if (t === 'rest') {
        out.push({ type: 'rest', player: p.id, days: Math.max(1, Math.min(L.rest, Math.round(num(e.days) ?? 3))) });
      } else {
        if (p.real) { dropped.push(`potential: ${p.name}은 실존 선수 (잠재력은 실제 고점)`); continue; }
        const d = num(e.delta);
        if (d === null || d === 0) { dropped.push('potential: 값 없음'); continue; }
        out.push({ type: 'potential', player: p.id, delta: Math.round(clamp(d, L.potential)) });
      }
    } else if (t === 'prospect' || t === 'ownerChange') {
      if (scale !== 'arc') { dropped.push(`${t}: 이야기의 절정에서만`); continue; }
      if (t === 'prospect') {
        const name = typeof e.name === 'string' ? e.name.trim() : '';
        if (!/^[가-힣]{2,4}$/.test(name) || roster.some((p) => p.name === name)) { dropped.push('prospect: 이름이 알맞지 않음'); continue; }
        const pos = e.pos === 'P' || e.pos === 'C' || e.pos === 'IF' || e.pos === 'OF' ? e.pos : 'IF';
        out.push({ type: 'prospect', name, pos, age: Math.max(17, Math.min(22, Math.round(num(e.age) ?? 19))), potential: Math.max(20, Math.min(45, Math.round(num(e.potential) ?? 30))) });
      } else {
        out.push({ type: 'ownerChange', trust: Math.max(40, Math.min(70, Math.round(num(e.trust) ?? 55))) });
      }
    } else {
      dropped.push(`알 수 없는 효과 ${String(t)}`);
    }
  }
  return { effects: out, dropped };
}

/** 효과를 화면 글로 */
export function effectText(e: FantasyEffect, nameOf: (id: string) => string): string {
  const sign = (x: number) => (x > 0 ? `+${x}` : `${x}`);
  switch (e.type) {
    case 'trust': return `구단주 신뢰 ${sign(e.delta)}`;
    case 'fans': return `팬 만족도 ${sign(e.delta)}`;
    case 'cash': return `자금 ${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount / 10000).toFixed(1)}억 원`;
    case 'fill': return `관중률 ${sign(Math.round(e.fill * 100))}%p (${e.days}일)`;
    case 'teamForm': return `${e.side === 'bat' ? '타자진' : e.side === 'pit' ? '투수진' : '선수단'} 경기력 ${sign(Math.round(e.edge * 1000) / 10)} (${e.days}일)`;
    case 'playerForm': return `${nameOf(e.player)} 경기력 ${sign(Math.round(e.edge * 1000) / 10)} (${e.days}일)`;
    case 'rest': return `${nameOf(e.player)} ${e.days}일 휴식`;
    // 잠재(천장)는 숫자로 보이지 않는다 (능력치 v2 17.6): 방향만 말로
    case 'potential': return `${nameOf(e.player)} 성장 여지가 ${e.delta > 0 ? '넓어진다' : e.delta < 0 ? '좁아진다' : '그대로'}`;
    case 'prospect': return `유망주 ${e.name} (${e.pos === 'P' ? '투수' : e.pos === 'C' ? 'C' : e.pos === 'IF' ? 'IF' : 'OF'}, ${e.age}세) 다음 개막에 입단`;
    case 'ownerChange': return `구단주 교체 (신뢰 ${e.trust}에서 새로 시작)`;
    case 'tradeGoodwill': return `상대 구단 호감 ${sign(e.runs)}런 (${e.days}일, 트레이드 평가에 더함)`;
    case 'demandDiscount': return `${nameOf(e.player)} 요구액 ${e.pct >= 0 ? `${Math.round(e.pct * 100)}% 할인` : `${Math.round(-e.pct * 100)}% 인상`}`;
    case 'agreedDeal': return `${nameOf(e.player)} 합의 조건: 연봉 ${(e.salary / 10000).toFixed(1)}억 원·${e.years}년 (이 조건 제시는 반드시 수락)`;
  }
}
