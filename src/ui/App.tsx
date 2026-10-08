// 게임 최상위: 데이터를 불러오고 시작 화면과 게임 화면을 오간다.
import { useEffect, useState } from 'react';
import { loadBrowserStore, type BrowserStore } from '../data/loadBrowser';
import type { GameSession } from '../game/session';
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

  if (!session) {
    return (
      <StartScreen
        store={store}
        onStart={(s) => {
          setSession(s);
          setSessionKey((k) => k + 1);
        }}
      />
    );
  }
  return <GameShell key={sessionKey} store={store} session={session} onQuit={() => setSession(null)} />;
}
