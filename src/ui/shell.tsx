// 화면 틀이 본문 화면에 내려 주는 것 (2026-10-22 UI 대개편 1차): 진행 버튼 동작, 정보 깊이(요약/상세), 결정함.
// context.tsx(GameUi)는 게임 상태, 여기는 틀의 조작이다.
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Decision } from './decisions';

/** 정보 깊이: 난이도와 별개인 표시 옵션. 이 브라우저에 기억한다 */
export type Density = 'brief' | 'full';
const DENSITY_KEY = 'kbo-gm.density';

export function loadDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'full' ? 'full' : 'brief';
  } catch {
    return 'brief';
  }
}

export function saveDensity(d: Density): void {
  try { localStorage.setItem(DENSITY_KEY, d); } catch { /* 기억하지 못해도 화면은 그대로 */ }
}

export interface ShellUi {
  /** 진행 중 문구 (진행 중이 아니면 null) */
  busy: string | null;
  /** 진행 버튼을 누를 수 없는가 (진행 중·이벤트 대기·시즌 끝) */
  advanceDisabled: boolean;
  /** 다음 경기 (가을야구 중이면 가을야구 한 경기) */
  advanceNext(): void;
  /** 진행 설정 열기 (하루·일주일·한 달·시즌 끝까지·멈춤 설정) */
  openProgress(): void;
  density: Density;
  setDensity(d: Density): void;
  decisions: Decision[];
  /** "확인"으로 알림을 내려 둔다 (그 상태 서명이 바뀔 때까지, Decision.ack) */
  ack(key: string, sig: string): void;
}

const Ctx = createContext<ShellUi | null>(null);

export function ShellProvider({ value, children }: { value: ShellUi; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): ShellUi {
  const v = useContext(Ctx);
  if (!v) throw new Error('ShellProvider 밖에서 useShell을 불렀습니다');
  return v;
}

/** 요약/상세 전환 단추 */
export function DensityToggle() {
  const { density, setDensity } = useShell();
  return (
    <div className="seg small density" role="group" aria-label="정보 깊이">
      <button type="button" aria-pressed={density === 'brief'} className={density === 'brief' ? 'on' : ''} onClick={() => setDensity('brief')}>요약</button>
      <button type="button" aria-pressed={density === 'full'} className={density === 'full' ? 'on' : ''} onClick={() => setDensity('full')}>상세</button>
    </div>
  );
}

/**
 * 가로로 넘치는 단계 표시(.steps, 휴대폰)를 지금 단계(aria-current="step")가 가운데 오게 옆으로 민다 (2026-10-22 UI 대개편 2차).
 * 쪽 전체를 세로로 움직이지 않게 scrollIntoView 대신 목록의 scrollLeft만 바꾼다
 */
export function useCurrentStep<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const ol = ref.current;
    const li = ol?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!ol || !li || ol.scrollWidth <= ol.clientWidth) return;
    const a = ol.getBoundingClientRect();
    const b = li.getBoundingClientRect();
    ol.scrollLeft += b.left - a.left - (a.width - b.width) / 2;
  }, [key]);
  return ref;
}
