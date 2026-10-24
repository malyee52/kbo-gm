// 브리핑 > 결정함 (2026-10-22 UI 대개편 1차): 지금 처리할 일 전체 (decisions.ts). 항목마다 이유·단계 조건과 처리할 화면.
// 이벤트는 이 화면 위쪽(틀의 EventDialog)에서 바로 답한다.
import { useGame } from '../context';
import { byKind } from '../decisions';
import { blockOf, itemOf, tabLabel } from '../menu';
import { useShell } from '../shell';

export function Inbox() {
  const { session, go } = useGame();
  const { decisions, ack } = useShell();
  if (!decisions.length) {
    return (
      <div className="stack">
        <section className="panel">
          <h2>확인 완료</h2>
          <p className="muted">지금 답하거나 처리해야 할 일이 없습니다. 다음 경기를 진행하세요.</p>
          <div className="actions"><button type="button" onClick={() => go('home')}>브리핑으로</button></div>
        </section>
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="muted small">게임에 이미 있는 처리 대상만 모았습니다. 기한은 실제 단계 조건이고, 날짜가 정해지지 않은 일은 기한을 적지 않습니다.</p>
      {byKind(decisions).map(({ kind, items }) => (
        <section key={kind} className="panel inbox-group">
          <h2>{kind} <b className="badge">{items.length}</b></h2>
          <ul className="inbox-list">
            {items.map((d) => {
              const target = itemOf(d.go);
              const blocked = blockOf(session, d.go);
              return (
                <li key={d.key} className={d.blocking ? 'urgent' : ''}>
                  <div>
                    <strong>{d.title}</strong>
                    {d.when && <span className="tag">{d.when}</span>}
                    {d.blocking && <span className="tag urgent-tag">먼저 처리</span>}
                    <p className="small muted">{d.why}</p>
                  </div>
                  {d.key.startsWith('event:')
                    ? <span className="small muted">이 화면 위쪽에서 답합니다</span>
                    : (
                      <span className="inline">
                        {/* 일부러 둔 상태면 확인으로 내려 둔다. 상태가 바뀌면 다시 뜬다 (UI 2차 결정 3) */}
                        {d.ack !== undefined && <button type="button" className="ghost" title="이 상태가 바뀔 때까지 다시 띄우지 않습니다" onClick={() => ack(d.key, d.ack!)}>확인</button>}
                        <button type="button" className="ghost" disabled={!!blocked} onClick={() => go(d.go)}>{target ? `${target.group === '공통' ? '' : `${target.group} › `}${tabLabel(session, target)}` : '열기'} ›</button>
                      </span>
                    )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
