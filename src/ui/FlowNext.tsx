// 시즌 마무리 흐름의 '다음' 버튼 (2026-10-12 사용자: 가을야구 → 시즌 결산 → 시상식 → 성장 → 오프시즌으로 자연스럽게).
// 각 화면 맨 위에 지금 단계와 다음으로 가는 버튼 하나를 둔다.
import { useGame } from './context';

const STEPS = ['가을야구', '시즌 결산', '시상식', '선수 성장', '오프시즌'] as const;
export type FlowStep = (typeof STEPS)[number];

export function FlowNext({ step, label, onNext, note }: { step: FlowStep; label: string; onNext: () => void; note?: string }) {
  const at = STEPS.indexOf(step);
  return (
    <section className="flow-next" aria-label="시즌 마무리 단계">
      <ol>
        {STEPS.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>{s}</li>)}
      </ol>
      {note && <span className="small muted">{note}</span>}
      <button type="button" onClick={onNext}>{label} →</button>
    </section>
  );
}

/**
 * 결산을 시작한다: 오프시즌을 열고(구단주 평가·시상·성장 판정) 시상식으로. 해고되면 영입 제의를 고를 구단 화면으로.
 * 결산은 Web Worker에서 돈다 (Q55, ui.heavy). 멈추면 시즌 결산 화면 그대로
 */
export function useSettle(): () => void {
  const { session, go, changed, autosave, heavy } = useGame();
  return () => void (async () => {
    if (session.phase !== 'season') return;
    const r = await heavy('시즌 결산 중입니다 (구단주 평가·시상·성장 판정)', 'begin-off');
    if (!r.ok) {
      if (!r.cancelled) console.error(`결산하지 못했습니다: ${r.message}`);
      return;
    }
    changed();
    void autosave();
    go(session.league.owner?.offers?.length ? 'club' : 'awards');
  })();
}
