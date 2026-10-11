// 역사 시나리오 목표와 결과 표시 (league/scenarios.ts)
import { scenarioById } from '../league/scenarios';
import { challengeById, challengeProgress } from '../league/challenges';
import { useGame } from './context';

export function ScenarioBanner() {
  return <><HistoryBanner /><ChallengeBanner /></>;
}

/** 도전 모드 목표와 진행 (league/challenges.ts) */
function ChallengeBanner() {
  const { session } = useGame();
  const c = session.league.challenge;
  const def = c ? challengeById(c.id) : undefined;
  if (!c || !def) return null;
  // 결산 뒤(오프시즌)에는 다음 시즌 기준으로 남은 시즌을 센다
  const year = session.phase === 'offseason' ? session.year + 1 : session.year;
  return (
    <p className={`note small scenario-note ${c.result === 'success' ? 'up' : ''}`}>
      도전 <strong>「{def.title}」</strong> · {def.intro}{' '}
      {c.result ? (c.result === 'success' ? <strong>성공! ({c.doneYear})</strong> : <strong>실패 ({c.doneYear}): {c.why}</strong>) : challengeProgress(c, year)}
    </p>
  );
}

function HistoryBanner() {
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
