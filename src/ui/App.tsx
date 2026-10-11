// 게임 최상위: 데이터를 불러오고 시작 화면과 게임 화면을 오간다.
import { useEffect, useState } from 'react';
import { loadBrowserStore, type BrowserStore } from '../data/loadBrowser';
import type { GameSession } from '../game/session';
import { ErrorBoundary } from './ErrorBoundary';
import { GameShell } from './GameShell';
import { StartScreen } from './StartScreen';

export function App() {
  const [store, setStore] = useState<BrowserStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    loadBrowserStore().then(setStore, (e: Error) => setError(e.message));
  }, []);

  if (error) return <main className="center"><p className="error">{error}</p></main>;
  if (!store) return <main className="center"><p className="muted">데이터를 불러오는 중입니다.</p></main>;

  // 화면 틀까지 깨지면 여기서 잡는다. 시작 화면이 깨지면 다시 불러오는 것밖에 없다
  if (!session) {
    return (
      <ErrorBoundary session={null} onQuit={() => window.location.reload()}>
        <StartScreen
          store={store}
          onStart={(s) => {
            setSession(s);
            setSessionKey((k) => k + 1);
          }}
        />
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary key={sessionKey} session={session} onQuit={() => setSession(null)}>
      <GameShell key={sessionKey} store={store} session={session} onQuit={() => setSession(null)} />
    </ErrorBoundary>
  );
}
