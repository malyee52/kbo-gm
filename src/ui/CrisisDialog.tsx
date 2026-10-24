// 위기 끼어들기 창 (UI 2단계 U2-11, docs/UI개편_2단계_기획안.md 2.2.3, 엔진 2 18단계 B → A 끼어들기).
// 자동 진행 중 우리 경기가 위기·승부처(session isCrisis: 7회 이후, 2점 차 안, 득점권 주자)가 되면 그 타석 경계에서 진행이 멈추고 이 창이 뜬다.
// "직접 지휘" → 그 자리에서 수동 경기 화면(CommandView). "AI 감독에게 맡기기" → 끼어들지 않고 진행을 이어 간다 (위기 멈춤을 끈 진행과 결과가 같다).
// "이번 진행 동안 더 묻지 않기"는 이번 진행(하루·일주일·한 달·다음 경기)의 남은 날에 위기 멈춤을 끈다 (화면 편의, 재현에 영향 없음).
import { useEffect, useRef, useState } from 'react';
import type { CommandPreview } from '../game/session';
import { basesText } from './CommandView';
import { useGame } from './context';
import { teamVars } from './teams';

export function CrisisDialog({ crisis, onCommand, onDecline }: { crisis: CommandPreview; onCommand: () => void; onDecline: (quiet: boolean) => void }) {
  const { session } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const r = crisis.req!;
  const W = session.world;
  const teamName = (t: number) => session.teamInfo(t).name;
  const which = crisis.dh ? '더블헤더 2차전' : session.ourGamesToday().length > 1 ? '더블헤더 1차전' : '오늘 경기';
  return (
    <dialog ref={ref} className="player crisis-dialog" aria-label="위기 끼어들기" onCancel={(e) => e.preventDefault()} style={teamVars(session.team.franchise, session.team.name)}>
      <div className="dialog-body">
        <header><h2>우리 경기가 위기입니다</h2></header>
        <p className="crisis-line">
          {r.inn}회{r.top ? '초' : '말'} {r.outs}아웃 {basesText(r.bases)} · {teamName(crisis.away)} {r.away} : {r.home} {teamName(crisis.home)} · 타자 {W.players[r.batter]?.name ?? '?'}
        </p>
        <p className="muted small">{which} · 그 전까지는 AI 감독이 치렀습니다. 직접 지휘할까요?</p>
        <div className="actions">
          <button type="button" className="go" onClick={onCommand}>직접 지휘</button>
          <button type="button" className="ghost" onClick={() => onDecline(quiet)}>AI 감독에게 맡기기</button>
        </div>
        <label className="check small"><input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} /> 이번 진행 동안 더 묻지 않기</label>
        <p className="muted small">설정: 진행 설정 › 멈춤 › 위기 때 멈추기 (켬)</p>
      </div>
    </dialog>
  );
}
