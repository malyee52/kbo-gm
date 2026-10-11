// 오류 경계: 화면을 그리다 예외가 나도 앱 전체가 흰 화면이 되지 않게 막고, 버그 보고 정보를 남긴다.
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import type { GameSession } from '../game/session';
import { exportSession, reproOf } from './saving';

interface Props {
  /** 없으면 (데이터를 불러오기 전 등) 재현 정보·내려받기 없이 안내만 */
  session: GameSession | null;
  /** 이 값이 바뀌면 (다른 메뉴로 가면) 오류를 지우고 다시 그린다 */
  resetKey?: unknown;
  onQuit(): void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kbo-gm] 화면 오류', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, stack: '' });
  }

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return <ErrorPanel error={error} stack={stack} session={this.props.session} onQuit={this.props.onQuit} />;
  }
}

/** 보고용 문자열: 오류 + 화면 위치 + 재현 정보. 재현 정보를 만들다 또 실패해도 오류 내용은 남긴다 */
function reportOf(error: Error, stack: string, session: GameSession | null): string {
  let repro: unknown = null;
  try {
    repro = session ? reproOf(session) : null;
  } catch (e) {
    repro = `재현 정보를 만들지 못했습니다: ${(e as Error).message}`;
  }
  const where = stack.trim().split('\n').slice(0, 8).map((l) => l.trim());
  return JSON.stringify({ error: `${error.name}: ${error.message}`, where, repro });
}

function ErrorPanel({ error, stack, session, onQuit }: { error: Error; stack: string; session: GameSession | null; onQuit(): void }) {
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const report = reportOf(error, stack, session);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setNote('클립보드에 복사하지 못했습니다. 아래 내용을 직접 복사하세요.');
    }
  };
  const download = () => {
    try {
      if (session) exportSession(session);
    } catch (e) {
      setNote(`저장 파일을 만들지 못했습니다: ${(e as Error).message}`);
    }
  };

  return (
    <section className="panel" role="alert">
      <h2>이 화면을 그리지 못했습니다</h2>
      <p>
        게임 진행 상태는 그대로입니다. 왼쪽 메뉴로 다른 화면에 가거나 시작 화면으로 나갈 수 있습니다.
        버그를 알려 주실 때 아래 재현 정보와 저장 파일을 함께 붙여 주세요.
      </p>
      <p className="error small"><code>{error.name}: {error.message}</code></p>
      {note && <p className="error small">{note}</p>}
      <textarea readOnly rows={4} value={report} aria-label="오류 보고 정보" onFocus={(e) => e.currentTarget.select()} />
      <div className="actions">
        {session && <button type="button" onClick={() => void copy()}>{copied ? '복사했습니다' : '재현 정보 복사'}</button>}
        {session && <button type="button" onClick={download}>저장 파일 내려받기</button>}
        <button type="button" className="ghost" onClick={onQuit}>시작 화면으로</button>
      </div>
    </section>
  );
}
