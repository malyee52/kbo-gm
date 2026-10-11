// 세부 난이도 고르기 (league/difficulty.ts). 시작 화면의 "사용자 설정"과 저장·설정 화면에서 쓴다.
import { SETTING_DEFS, type DifficultySettings } from '../league/difficulty';

export function DifficultyEditor({ value, onChange, disabled }: { value: DifficultySettings; onChange: (s: DifficultySettings) => void; disabled?: boolean }) {
  return (
    <div className="difficulty-grid">
      {SETTING_DEFS.map((d) => {
        // 지금 값이 목록에 없으면(예전 값) 가장 가까운 것을 보여 준다
        // 예전 저장에 없는 항목(지명권 트레이드)은 첫 선택지(기본값)로 본다
        const v = value[d.key] ?? d.options[0].v;
        const cur = d.options.reduce((best, o) => (Math.abs(o.v - v) < Math.abs(best.v - v) ? o : best), d.options[0]);
        return (
          <label key={d.key} title={d.note}>
            <span className="small"><strong>{d.label}</strong></span>
            <select value={cur.v} disabled={disabled} onChange={(e) => onChange({ ...value, [d.key]: Number(e.target.value) })}>
              {d.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            <span className="muted small">{d.note}</span>
          </label>
        );
      })}
    </div>
  );
}
