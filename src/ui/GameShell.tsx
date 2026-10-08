// 게임 화면 틀: 왼쪽 메뉴, 위쪽 날짜·진행 버튼, 본문, 선수 상세 창.
import { useCallback, useMemo, useState } from 'react';
import type { BrowserStore } from '../data/loadBrowser';
import { computeGrades } from '../engine';
import { formatDate } from '../game/calendar';
import type { GameSession } from '../game/session';
import { AUTO_SLOT } from '../game/storage';
import { GameProvider, type GameUi, type Screen } from './context';
import { saveSession, summaryOf } from './saving';
import { Home } from './screens/Home';
import { Leaders } from './screens/Leaders';
import { PlayerDetail } from './screens/PlayerDetail';
import { Roster } from './screens/Roster';
import { SaveScreen } from './screens/SaveScreen';
import { Schedule } from './screens/Schedule';
import { SeasonEnd } from './screens/SeasonEnd';
import { Standings } from './screens/Standings';
import { Trade } from './screens/Trade';
import { Offseason } from './screens/Offseason';
import { Club } from './screens/Club';
import { Postseason } from './screens/Postseason';
import { currentSeries, ROUND_LABEL } from '../league/postseason';
import { teamColor } from './teams';

const NAV: { id: Screen; label: string; offLabel?: string; season?: boolean }[] = [
  { id: 'home', label: '홈' },
  { id: 'offseason', label: '오프시즌' },
  { id: 'roster', label: '선수단', season: true },
  { id: 'schedule', label: '일정·결과', offLabel: '지난 시즌 일정' },
  { id: 'standings', label: '순위', offLabel: '지난 시즌 순위' },
  { id: 'leaders', label: '기록', offLabel: '지난 시즌 기록' },
  { id: 'trade', label: '트레이드', season: true },
  { id: 'club', label: '구단' },
  { id: 'save', label: '저장·설정' },
];

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export function GameShell({ store, session, onQuit }: { store: BrowserStore; session: GameSession; onQuit: () => void }) {
  const [version, setVersion] = useState(0);
  const [screen, setScreen] = useState<Screen>(session.phase === 'offseason' ? 'offseason' : session.done ? 'season-end' : 'home');
  const [screenArg, setScreenArg] = useState<number | undefined>(undefined);
  const [player, setPlayer] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 새 시즌이 열리면 월드가 바뀌므로 월드에 맞춰 다시 계산한다
  const world = session.world;
  const grades = useMemo(() => computeGrades(world), [world]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const go = useCallback((s: Screen, arg?: number) => {
    setScreen(s);
    setScreenArg(arg);
    window.scrollTo({ top: 0 });
  }, []);

  const autosave = useCallback(async () => {
    try {
      await saveSession(session, AUTO_SLOT);
      setSaveError(null);
    } catch (e) {
      setSaveError(`자동 저장 실패: ${(e as Error).message}`);
    }
  }, [session]);

  /** days일 진행. 길면 일주일씩 끊어 화면이 멈추지 않게 한다 */
  const advance = async (days: number, label: string) => {
    if (busy || session.done) return;
    setBusy(label);
    await nextFrame();
    let left = days;
    while (left > 0 && !session.done) {
      left -= session.advance(Math.min(7, left));
      if (left > 0) {
        setVersion((v) => v + 1);
        await nextFrame();
      }
    }
    changed();
    await autosave();
    setBusy(null);
    if (session.done) go(session.postseasonRunning ? 'postseason' : 'season-end');
  };

  /** 가을야구 진행 (경기 수, 또는 '우리 경기까지'·'시리즈 끝까지') */
  const advancePs = async (how: 'one' | 'ours' | 'series' | 'all', label: string) => {
    if (busy || !session.postseasonRunning) return;
    setBusy(label);
    await nextFrame();
    if (how === 'one') session.advancePostseason(1);
    else if (how === 'ours') session.advanceToOurPostseasonGame();
    else if (how === 'series') session.advanceSeries();
    else session.advancePostseason(10_000);
    changed();
    await autosave();
    setBusy(null);
    go('postseason');
  };

  const advanceNextGame = async () => {
    if (busy || session.done) return;
    setBusy('진행 중');
    await nextFrame();
    session.advanceToNextGameDay();
    changed();
    await autosave();
    setBusy(null);
    if (session.done) go(session.postseasonRunning ? 'postseason' : 'season-end');
  };

  const ui: GameUi = { store, session, grades, version, changed, go, openPlayer: setPlayer, autosave };
  const team = session.team;
  const off = session.phase === 'offseason';
  const nav = NAV.filter((n) => (off ? !n.season : n.id !== 'offseason'));
  const psCur = session.postseasonRunning ? currentSeries(session.postseason!) : null;
  const left = session.season.schedule.slice(session.day).filter((d) => d.some((g) => g.home === session.teamIdx || g.away === session.teamIdx)).length;

  return (
    <GameProvider value={ui}>
      <div className="shell" style={{ ['--team' as string]: teamColor(team.franchise) }}>
        <aside className="nav">
          <div className="brand">
            <span className="small muted">{session.world.year} {off ? '오프시즌' : '시즌'}</span>
            <strong>{team.name}</strong>
          </div>
          <nav aria-label="메뉴">
            {nav.map((n) => (
              <button key={n.id} type="button" className={screen === n.id ? 'on' : ''} aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                {off && n.offLabel ? n.offLabel : n.label}
              </button>
            ))}
            {(session.done || off) && (session.postseason || session.league.lastSeason?.postseason) && (
              <button type="button" className={screen === 'postseason' ? 'on' : ''} onClick={() => go('postseason')}>가을야구</button>
            )}
            {session.done && (
              <button type="button" className={screen === 'season-end' ? 'on' : ''} onClick={() => go('season-end')}>시즌 결과</button>
            )}
          </nav>
          <button type="button" className="ghost quit" onClick={onQuit}>시작 화면으로</button>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="when">
              <strong>{off ? `${session.world.year} 오프시즌` : psCur ? `${session.world.year} 가을야구 · ${ROUND_LABEL[psCur.round]} ${psCur.games.length + 1}차전` : session.done ? `${session.world.year} ${session.postseason?.done ? '가을야구 종료' : '정규시즌 종료'}` : formatDate(session.world.year, session.day, true)}</strong>
              <span className="muted small">
                {summaryOf(session)}{!session.done && ` · 남은 경기 ${left}`}
              </span>
            </div>
            {!off && session.postseasonRunning && <div className="advance">
              {busy && <span className="muted small" role="status">{busy}</span>}
              <button type="button" onClick={() => void advancePs('one', '경기 진행 중')} disabled={!!busy}>다음 경기</button>
              <button type="button" onClick={() => void advancePs('ours', '우리 경기까지 진행 중')} disabled={!!busy}>우리 경기까지</button>
              <button type="button" onClick={() => void advancePs('series', '시리즈 진행 중')} disabled={!!busy}>시리즈 끝까지</button>
              <button type="button" className="ghost" onClick={() => void advancePs('all', '가을야구 진행 중')} disabled={!!busy}>가을야구 끝까지</button>
            </div>}
            {!off && !session.done && <div className="advance">
              {busy && <span className="muted small" role="status">{busy}</span>}
              <button type="button" onClick={() => void advanceNextGame()} disabled={!!busy || session.done} title="휴식일은 건너뛰고 다음 경기일까지">다음 경기</button>
              <button type="button" onClick={() => void advance(1, '하루 진행 중')} disabled={!!busy || session.done}>하루</button>
              <button type="button" onClick={() => void advance(7, '일주일 진행 중')} disabled={!!busy || session.done}>일주일</button>
              <button type="button" className="ghost" onClick={() => void advance(10000, '시즌 끝까지 진행 중')} disabled={!!busy || session.done}>시즌 끝까지</button>
            </div>}
          </header>
          {saveError && <p className="error banner" role="alert">{saveError}</p>}
          <main className="content" aria-busy={!!busy}>
            {screen === 'home' && <Home />}
            {screen === 'roster' && <Roster />}
            {screen === 'schedule' && <Schedule focusGame={screenArg} />}
            {screen === 'standings' && <Standings />}
            {screen === 'leaders' && <Leaders />}
            {screen === 'trade' && <Trade />}
            {screen === 'save' && <SaveScreen onQuit={onQuit} />}
            {screen === 'season-end' && <SeasonEnd />}
            {screen === 'offseason' && <Offseason />}
            {screen === 'club' && <Club />}
            {screen === 'postseason' && <Postseason />}
          </main>
        </div>
        {player !== null && <PlayerDetail key={player} idx={player} onClose={() => setPlayer(null)} />}
      </div>
    </GameProvider>
  );
}
