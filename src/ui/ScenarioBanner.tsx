// 역사 시나리오 목표와 결과 표시 (league/scenarios.ts)
import { scenarioById } from '../league/scenarios';
import { useGame } from './context';

export function ScenarioBanner() {
  const { session } = useGame();
  const s = session.league.scenario;
  const def = s ? scenarioById(s.id) : undefined;
  if (!s || !def) return null;
  if (!s.result) {
    return (
      <p className="note small scenario-note">
        역사 시나리오 <strong>「{def.title}」</strong> · 목표: {def.year} 한국시리즈 우승
      </p>
    );
  }
  return (
    <p className={`note small scenario-note ${s.result === 'success' ? 'up' : ''}`}>
      역사 시나리오 <strong>「{def.title}」</strong> {s.result === 'success' ? '성공! 역사를 바꿨습니다.' : '실패.'} <span className="muted">{def.real}</span>
    </p>
  );
}
