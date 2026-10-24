// 진행 멈춤 설정 (진행 버튼 옆 ⚙, 2026-10-12 사용자 요청).
// 다음 경기·하루·일주일·한 달 버튼이 무엇에서 멈출지 고른다. "시즌 끝까지"는 이 설정과 상관없이 멈추지 않는다.
// 브라우저에 저장한다 (stops.ts loadStops·saveStops). 게임 저장 파일에는 들어가지 않는다.
import { useEffect, useRef, useState } from 'react';
import { clampInt, DEFAULT_STOPS, type StopRules } from '../game/stops';

export function StopSettings({ value, onChange }: { value: StopRules; onChange: (r: StopRules) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const set = (patch: Partial<StopRules>) => onChange({ ...value, ...patch });
  const check = (k: keyof StopRules, label: string, hint?: string, disabled = false) => (
    <label className={`check${disabled ? ' muted' : ''}`} title={hint}>
      <input type="checkbox" checked={!!value[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked })} /> {label}
    </label>
  );
  const count = (k: 'injuryDays' | 'losingN', lo: number, hi: number, label: string) => (
    <input type="number" className="num" min={lo} max={hi} value={value[k]} aria-label={label}
      onChange={(e) => set({ [k]: clampInt(Number(e.target.value), lo, hi) })} />
  );

  return (
    <div className="stop-settings" ref={ref}>
      <button type="button" className="ghost" aria-expanded={open} aria-haspopup="dialog" title="진행 버튼이 무엇에서 멈출지" onClick={() => setOpen((o) => !o)}>⚙ 멈춤</button>
      {open && (
        <div className="stop-pop" role="dialog" aria-label="멈춤 설정">
          <p className="muted small">다음 경기·하루·일주일·한 달 진행이 멈출 때. <strong>시즌 끝까지</strong>는 멈추지 않고 이벤트를 첫 번째 선택지로 자동 처리합니다.</p>
          <fieldset>
            <legend>이벤트</legend>
            <label className="check"><input type="radio" name="stop-ev" checked={value.event} onChange={() => set({ event: true })} /> 멈춰서 직접 고르기</label>
            <label className="check"><input type="radio" name="stop-ev" checked={!value.event} onChange={() => set({ event: false })} /> 자동 선택 (첫 번째 선택지)</label>
            {check('tradeOffer', '트레이드 제안은 그래도 멈춤', 'AI 구단의 트레이드 제안 이벤트', value.event)}
          </fieldset>
          <fieldset>
            <legend>선수단</legend>
            <label className="check">
              <input type="checkbox" checked={value.injury} onChange={(e) => set({ injury: e.target.checked })} /> 1군 선수 부상·이탈 {count('injuryDays', 1, 30, '며칠 이상')}일 이상
            </label>
            <p className="muted small">엔트리를 직접 관리할 때만 해당합니다.</p>
            <label className="check">
              <input type="checkbox" checked={value.losing} onChange={(e) => set({ losing: e.target.checked })} /> {count('losingN', 2, 20, '연패 수')}연패
            </label>
          </fieldset>
          <fieldset>
            <legend>날짜</legend>
            {check('deadline', '트레이드 마감일 (7월 31일)')}
            {check('devDay', '육성선수 등록 가능일 (5월 1일)', '육성선수가 있을 때만')}
          </fieldset>
          <fieldset>
            <legend>중계</legend>
            {check('cast', '다음 경기는 중계로 보기', '다음 경기·가을야구 한 경기 진행 뒤 우리 경기를 문자 중계로 보여 줍니다')}
            {check('crisis', '위기 때 멈추기', '자동 진행 중 우리 경기가 7회 이후 2점 차 안에서 득점권 주자를 맞으면 그 타석 앞에서 멈추고, 직접 지휘할지 묻습니다 (정규시즌)')}
          </fieldset>
          <div className="row-between">
            <button type="button" className="small-btn" onClick={() => onChange({ ...DEFAULT_STOPS })}>기본값</button>
            <button type="button" className="small-btn" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
