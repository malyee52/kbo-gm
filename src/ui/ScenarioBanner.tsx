// 도전 모드 목표와 진행 표시 (league/challenges.ts, 기획안 도전은 league/campaigns.ts)
import { challengeById, challengeProgress } from '../league/challenges';
import { STAGE_STATUS } from '../league/campaigns';
import { useGame } from './context';

export function ScenarioBanner() {
  const { session } = useGame();
  const c = session.league.challenge;
  const def = c ? challengeById(c.id) : undefined;
  if (!c || !def) return null;
  // 결산 뒤(오프시즌)에는 다음 시즌 기준으로 남은 시즌을 센다
  const year = session.phase === 'offseason' ? session.year + 1 : session.year;
  const plan = def.plan;
  return (
    <div className={`note small scenario-note ${c.result === 'success' ? 'up' : ''}`}>
      도전 <strong>「{def.title}」</strong>{plan ? ` (${plan.no}, ${plan.year} 시작)` : ''} · {def.intro}{' '}
      {c.result ? (c.result === 'success' ? <strong>{c.complete ? '완전 클리어' : '성공'}! ({c.doneYear})</strong> : <strong>실패 ({c.doneYear}): {c.why}</strong>)
        : plan && plan.stages.length > 1 ? `남은 시즌 ${Math.max(0, c.until - year + 1)} (${c.until}년까지)` : challengeProgress(c, year)}
      {plan && plan.stages.length > 1 && (
        <ol className="plain-ol">
          {plan.stages.map((st, i) => (
            <li key={i}>{i === plan.stages.length - 1 ? '최종' : `${i + 1}단계`}: {st.label} — <span className={c.stages?.[i] === 1 ? 'up' : c.stages?.[i] === 2 ? 'down' : 'muted'}>{STAGE_STATUS[c.stages?.[i] ?? 0]}</span></li>
          ))}
        </ol>
      )}
    </div>
  );
}
