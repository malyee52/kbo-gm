// 저장·설정: 저장 칸, 파일 내보내기·가져오기, 버그 보고용 재현 정보.
import { useEffect, useState } from 'react';
import { AUTO_SLOT, deleteSave, listSaves, type SaveRecord } from '../../game/storage';
import { useGame } from '../context';
import { exportSession, saveSession, whenText } from '../saving';

const SLOTS = ['저장 1', '저장 2', '저장 3'];

export function SaveScreen({ onQuit }: { onQuit: () => void }) {
  const { session } = useGame();
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () => listSaves().then(setSaves, (e: Error) => setMsg({ text: e.message, error: true }));
  useEffect(() => { void refresh(); }, []);

  const saveTo = async (slot: string) => {
    try {
      await saveSession(session, slot);
      setMsg({ text: `${slot}에 저장했습니다.` });
      await refresh();
    } catch (e) {
      setMsg({ text: `저장하지 못했습니다: ${(e as Error).message}`, error: true });
    }
  };

  const bySlot = new Map(saves.map((s) => [s.slot, s]));
  const repro = {
    year: session.world.year,
    team: session.team.name,
    teamIdx: session.teamIdx,
    seed: session.season.seed,
    day: session.day,
    actions: session.actions,
  };

  const copyRepro = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(repro));
      setCopied(true);
    } catch {
      setMsg({ text: '클립보드에 복사하지 못했습니다. 아래 내용을 직접 복사하세요.', error: true });
    }
  };

  return (
    <div className="stack">
      <h1>저장·설정</h1>
      {msg && <p className={msg.error ? 'error' : 'note'} role="status">{msg.text}</p>}

      <section className="panel">
        <h2>브라우저에 저장</h2>
        <p className="muted small">진행 버튼을 누를 때마다 "자동 저장" 칸에 덮어씁니다. 브라우저 데이터를 지우면 저장도 사라지므로 중요한 게임은 파일로 내보내 두세요.</p>
        <div className="scroll">
          <table>
            <thead><tr><th className="l">칸</th><th className="l">구단</th><th className="l">진행</th><th className="l">성적</th><th className="l">저장 시각</th><th /></tr></thead>
            <tbody>
              {[AUTO_SLOT, ...SLOTS].map((slot) => {
                const s = bySlot.get(slot);
                return (
                  <tr key={slot}>
                    <td className="l">{slot === AUTO_SLOT ? '자동 저장' : slot}</td>
                    {s ? (
                      <>
                        <td className="l">{s.year} {s.teamName}</td>
                        <td className="l">{whenText(s, s.data.news.some((n) => n.text.startsWith('정규시즌 종료')))}</td>
                        <td className="l">{s.summary}</td>
                        <td className="l muted">{new Date(s.savedAt).toLocaleString('ko-KR')}</td>
                      </>
                    ) : <td className="l muted" colSpan={4}>비어 있음</td>}
                    <td className="r-actions">
                      {slot !== AUTO_SLOT && <button type="button" onClick={() => void saveTo(slot)}>{s ? '덮어쓰기' : '저장'}</button>}
                      {s && slot !== AUTO_SLOT && (
                        <button type="button" className="ghost danger" onClick={() => void deleteSave(slot).then(refresh)}>지우기</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">저장한 게임을 불러오려면 시작 화면으로 나가세요.</p>
        <div className="actions">
          <button type="button" className="ghost" onClick={onQuit}>시작 화면으로</button>
        </div>
      </section>

      <section className="panel">
        <h2>파일로 내보내기</h2>
        <p className="muted small">지금 상태를 JSON 파일로 내려받습니다. 시작 화면의 "파일에서 불러오기"로 다시 열 수 있습니다.</p>
        <div className="actions"><button type="button" onClick={() => exportSession(session)}>파일 내려받기</button></div>
      </section>

      <section className="panel">
        <h2>버그 보고용 재현 정보</h2>
        <p className="muted small">
          같은 연도·구단·시드에서 아래 조작 기록을 같은 날에 다시 하면 똑같은 결과가 나옵니다.
          버그를 보고할 때 이 내용과 저장 파일을 함께 붙여 주세요.
        </p>
        <dl className="facts">
          <dt>시드</dt><dd><code>{repro.seed}</code></dd>
          <dt>진행</dt><dd>{repro.day}일차 (일정 색인)</dd>
          <dt>조작 기록</dt><dd>{repro.actions.length}건</dd>
          <dt>데이터 지문</dt><dd><code>{session.season.baseRoster}</code></dd>
        </dl>
        <textarea readOnly rows={4} value={JSON.stringify(repro)} aria-label="재현 정보" onFocus={(e) => e.currentTarget.select()} />
        <div className="actions">
          <button type="button" onClick={() => void copyRepro()}>{copied ? '복사했습니다' : '재현 정보 복사'}</button>
        </div>
      </section>
    </div>
  );
}
