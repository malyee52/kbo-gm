// 진행 버튼(다음 경기·하루·일주일·한 달)이 무엇에서 멈출지 (2026-10-12 사용자 요청).
// "시즌 끝까지"는 아무 데서도 멈추지 않는다 (NO_STOPS). 멈춤은 게임 결과를 바꾸지 않는 화면 설정이라
// 리그 상태·조작 기록에 넣지 않는다. 자동으로 고른 이벤트는 첫 번째 선택지로 처리되고, 재현해도 같은 자리에서 자동 처리된다.

export interface StopRules {
  /** 이벤트가 생기면 멈춰서 직접 고른다 (끄면 첫 번째 선택지로 자동) */
  event: boolean;
  /** 이벤트를 자동으로 고르더라도 트레이드 제안(trade-offer)은 멈춘다 */
  tradeOffer: boolean;
  /** 직접 관리하는 1군 선수가 injuryDays일 이상 빠지면 멈춘다 */
  injury: boolean;
  injuryDays: number;
  /** 우리 팀이 losingN연패에 이르면 멈춘다 */
  losing: boolean;
  losingN: number;
  /** 트레이드 마감일(그날 경기 전까지 트레이드 가능)에 멈춘다 */
  deadline: boolean;
  /** 육성선수 정식 등록이 되는 첫날(5월 1일)에 멈춘다 (육성선수가 있을 때) */
  devDay: boolean;
  /** "다음 경기"·가을야구 한 경기 진행 뒤 우리 경기를 중계 화면으로 보여 준다 (GameCast) */
  cast: boolean;
  /** 자동 진행 중 우리 경기의 위기·승부처(7회 이후 2점 차 안, 득점권 주자)에서 멈춰 직접 지휘한다 */
  crisis: boolean;
}

/** 기본값: 예전 동작 그대로 (이벤트·1군 선수 3일 이상 이탈에서 멈춤) */
export const DEFAULT_STOPS: StopRules = {
  event: true, tradeOffer: true, injury: true, injuryDays: 3, losing: false, losingN: 5, deadline: false, devDay: false, cast: true, crisis: false,
};

/** 아무 데서도 멈추지 않는다 (시즌 끝까지, 테스트·장기 진행) */
export const NO_STOPS: StopRules = {
  event: false, tradeOffer: false, injury: false, injuryDays: 3, losing: false, losingN: 5, deadline: false, devDay: false, cast: false, crisis: false,
};

export type AttentionKind = 'injury' | 'losing' | 'deadline' | 'dev' | 'crisis';

/** 진행을 멈춘 까닭 (화면이 요약 창 맨 위에 보여 준다) */
export interface Attention {
  kind: AttentionKind;
  text: string;
}

/** 일부만 정한 규칙을 채운다 (빠진 칸은 멈추지 않음) */
export function stopRules(r: Partial<StopRules> | null | undefined): StopRules {
  return { ...NO_STOPS, ...(r ?? {}) };
}

/** 이 이벤트에서 멈추나. 트레이드 제안은 실제 제안이 있을 때만 (제안이 없으면 vars.none) */
export function stopsOnEvent(r: StopRules, ev: { id: string; vars?: Record<string, unknown> }): boolean {
  return r.event || (r.tradeOffer && ev.id === 'trade-offer' && !ev.vars?.none);
}

const KEY = 'kbo-gm.stops';

/** 브라우저에 저장한 멈춤 설정 (없거나 못 읽으면 기본값) */
export function loadStops(): StopRules {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_STOPS };
    const v = JSON.parse(raw) as Partial<StopRules>;
    const out = { ...DEFAULT_STOPS };
    for (const k of Object.keys(out) as (keyof StopRules)[]) {
      if (typeof v[k] === typeof out[k]) (out as Record<string, unknown>)[k] = v[k];
    }
    out.injuryDays = clampInt(out.injuryDays, 1, 30);
    out.losingN = clampInt(out.losingN, 2, 20);
    return out;
  } catch {
    return { ...DEFAULT_STOPS };
  }
}

export function saveStops(r: StopRules): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // 저장이 막힌 브라우저: 이번 접속 동안만 쓴다
  }
}

export function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));
}
