// 화면 연출 (2026-10-12 사용자 요청 "애니메이션"): 숫자 카운트업, 축하 연출(꽃가루·배너·알림).
// 움직임 줄이기 설정(prefers-reduced-motion)이면 숫자는 바로 바뀌고 꽃가루는 없다.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Achievement } from '../game/celebrate';

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 값이 바뀌면 이전 값에서 새 값까지 세어 올라간다(내려간다). 처음 그릴 때는 바로 보인다 */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString('ko-KR'), ms = 600 }: { value: number; format?: (v: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || reducedMotion()) { setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <span className="count">{format(shown)}</span>;
}

/** 직전에 그린 순서와 견준 순위 변화 (팀 → +면 올라감). 진행 버튼으로 다시 그릴 때만 바뀐다 */
export function useRankMoves(order: number[]): Map<number, number> {
  const prev = useRef<number[] | null>(null);
  const key = order.join(',');
  const moves = useMemo(() => {
    const m = new Map<number, number>();
    const p = prev.current;
    if (p && p.join(',') !== key) order.forEach((t, i) => { const j = p.indexOf(t); if (j >= 0 && j !== i) m.set(t, j - i); });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { prev.current = order; });
  return moves;
}

const CONFETTI = 70;
const COLORS = ['var(--team)', '#f2c14e', '#e4572e', '#4c9be8', '#2bb673', '#ffffff'];

/** 축하: 큰 일은 꽃가루와 가운데 배너, 작은 일(기록)은 아래쪽 알림. 몇 초 뒤 저절로 닫힌다 */
export function Celebration({ items, onDone }: { items: Achievement[]; onDone: () => void }) {
  const big = items.find((a) => a.big);
  const small = items.filter((a) => !a.big).slice(-4);
  const pieces = useMemo(() => Array.from({ length: big && !reducedMotion() ? CONFETTI : 0 }, (_, i) => ({
    left: (i * 37) % 100 + ((i * 13) % 7) / 7,
    delay: ((i * 53) % 100) / 100 * 0.9,
    dur: 2.2 + ((i * 29) % 10) / 10,
    color: COLORS[i % COLORS.length],
    rot: (i * 47) % 360,
    w: 6 + (i % 4) * 2,
  })), [big]);
  useEffect(() => {
    const id = window.setTimeout(onDone, big ? 4800 : 3600);
    return () => window.clearTimeout(id);
  }, [items, big, onDone]);
  if (!items.length) return null;
  return (
    <div className="celebrate" aria-live="polite">
      {pieces.map((p, i) => (
        <i key={i} className="confetti" style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.color, width: p.w, transform: `rotate(${p.rot}deg)` }} />
      ))}
      {big && (
        <button type="button" className="celebrate-banner" onClick={onDone}>
          <strong>{big.title}</strong>
          <span>{big.sub}</span>
          {items.filter((a) => a.big && a !== big).map((a) => <span key={a.key} className="small">{a.title} {a.sub}</span>)}
        </button>
      )}
      {small.length > 0 && (
        <div className="toasts">
          {small.map((a) => <button key={a.key} type="button" className="toast" onClick={onDone}><strong>{a.title}</strong> {a.sub}</button>)}
        </div>
      )}
    </div>
  );
}
