// 게임 화면 틀: 왼쪽 메뉴, 위쪽 날짜·진행 버튼, 본문, 선수 상세 창.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserStore } from '../data/loadBrowser';
import { computeGrades } from '../engine';
import { formatDate } from '../game/calendar';
import type { GameSession } from '../game/session';
import { GameProvider, type GameUi, type Screen } from './context';
import { autosaveSession, summaryOf } from './saving';
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
import { Growth } from './screens/Growth';
import { Awards } from './screens/Awards';
import { Records } from './screens/Records';
import { Articles } from './screens/Articles';
import { currentSeries, ROUND_LABEL } from '../league/postseason';
import { teamColor } from './teams';
import { ErrorBoundary } from './ErrorBoundary';
import { EventDialog } from './EventDialog';
import { AdvanceSummary, takeSnapshot, type AdvanceSnapshot } from './AdvanceSummary';
import { GameCast } from './GameCast';
import { Celebration } from './Motion';
import { achievements, type Achievement } from '../game/celebrate';
import type { CastGame } from '../game/session';
import { loadStops, NO_STOPS, saveStops, stopsOnEvent, type Attention, type StopRules } from '../game/stops';
import { StopSettings } from './StopSettings';

/** 왼쪽 메뉴. 묶음(group)별로 나눠 보여 주고, season이 true인 항목은 오프시즌에 숨긴다 */
// 메뉴 묶음 (2026-10-12 정리): 우리 구단 / 리그(이번 시즌) / 역사 / 시스템
const NAV: { id: Screen; label: string; offLabel?: string; season?: boolean; group: '우리 구단' | '리그' | '역사' | '시스템' }[] = [
  { id: 'home', label: '홈', group: '우리 구단' },
  { id: 'offseason', label: '오프시즌', group: '우리 구단' },
  { id: 'roster', label: '선수단', season: true, group: '우리 구단' },
  { id: 'trade', label: '트레이드', season: true, group: '우리 구단' },
  { id: 'club', label: '구단 운영', group: '우리 구단' },
  { id: 'schedule', label: '일정·결과', offLabel: '지난 시즌 일정', group: '리그' },
  { id: 'standings', label: '순위', offLabel: '지난 시즌 순위', group: '리그' },
  { id: 'leaders', label: '기록', offLabel: '지난 시즌 기록', group: '리그' },
  { id: 'records', label: '기록실', group: '역사' },
  { id: 'articles', label: '기사', group: '역사' },
  { id: 'save', label: '저장·설정', group: '시스템' },
];
const GROUPS = ['우리 구단', '리그', '역사', '시스템'] as const;

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** 지금 화면 이름 (휴대폰 메뉴 버튼) */
const EXTRA_LABEL: Partial<Record<Screen, string>> = { postseason: '가을야구', 'season-end': '시즌 결과', awards: '시상식', growth: '선수 성장' };
function screenLabel(s: Screen, off: boolean): string {
  const n = NAV.find((x) => x.id === s);
  return n ? (off && n.offLabel ? n.offLabel : n.label) : EXTRA_LABEL[s] ?? '메뉴';
}

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
  // 휴대폰 화면: 메뉴를 펼쳐 고른다 (game.css 좁은 화면)
  const [menuOpen, setMenuOpen] = useState(false);
  const go = useCallback((s: Screen, arg?: number) => {
    setScreen(s);
    setScreenArg(arg);
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const autosave = useCallback(async () => {
    try {
      await autosaveSession(session);
      setSaveError(null);
    } catch (e) {
      setSaveError(`자동 저장 실패: ${(e as Error).message}`);
    }
  }, [session]);

  // 진행 멈춤 설정 (브라우저에 저장, stops.ts)
  const [stops, setStopsState] = useState<StopRules>(loadStops);
  const setStops = (r: StopRules) => { setStopsState(r); saveStops(r); };

  /** 진행이 이벤트 날에 끝났는데 그 이벤트에서 멈추지 않는 설정이면 첫 번째 선택지로 답한다 (조작 기록에 남겨 재현이 맞게) */
  const autoAnswer = (rules: StopRules) => {
    const ev = session.pendingEvent;
    if (ev && !stopsOnEvent(rules, ev)) session.answerEvent(0);
  };

  /**
   * days일 진행. 길면 일주일씩 끊어 화면이 멈추지 않게 한다.
   * full(시즌 끝까지): 완전 자동. 무엇이 생겨도 멈추지 않고 이벤트는 첫 번째 선택지로 처리한다.
   * 아니면 멈춤 설정(stops)대로 멈춘다.
   */
  const advance = async (days: number, label: string, full = false) => {
    if (busy || session.done) return;
    const rules = full ? NO_STOPS : stops;
    setBusy(label);
    await nextFrame();
    // 여러 날 진행이면 끝나고 요약 창을 띄운다 (AdvanceSummary)
    const snap = days >= 7 ? takeSnapshot(session) : null;
    let left = days;
    let attention: Attention[] = [];
    while (left > 0 && !session.done) {
      const did = session.advance(Math.min(7, left), rules);
      left -= did;
      if (session.attention.length) attention = [...session.attention];
      if (session.stopped || did === 0) break;
      if (left > 0) {
        setVersion((v) => v + 1);
        await nextFrame();
      }
    }
    autoAnswer(rules);
    changed();
    await autosave();
    setBusy(null);
    if (snap || attention.length) setSummary({ snap: snap ?? takeSnapshotAfter(), attention });
    if (session.done) go(session.postseasonRunning ? 'postseason' : 'season-end');
  };
  /** 하루 진행 중 멈춘 경우: 요약할 기간이 없으니 지금 상태를 기준으로 (손볼 일만 보여 준다) */
  const takeSnapshotAfter = () => takeSnapshot(session);
  const [summary, setSummary] = useState<{ snap: AdvanceSnapshot; attention: Attention[] } | null>(null);
  // 경기 중계 (GameCast): 다음 경기·가을야구 한 경기 진행 뒤 우리 경기
  const [cast, setCast] = useState<CastGame | null>(null);
  // 축하 연출 (celebrate.ts): 이 화면을 연 뒤 새로 이룬 일만. 처음 연 때 이미 이룬 일은 축하하지 않는다
  const seen = useRef<Set<string> | null>(null);
  const [party, setParty] = useState<Achievement[]>([]);
  useEffect(() => {
    const list = achievements(session);
    if (!seen.current) { seen.current = new Set(list.map((a) => a.key)); return; }
    const fresh = list.filter((a) => !seen.current!.has(a.key));
    for (const a of fresh) seen.current.add(a.key);
    if (fresh.length) setParty((p) => [...p, ...fresh]);
  }, [version, session]);
  const endParty = useCallback(() => setParty([]), []);
  /** 진행 전 경기 수를 받아, 그 뒤 우리 경기 가운데 마지막 것 (중계 기록이 있을 때) */
  const castAfter = (before: number) => {
    if (!stops.cast) return;
    const games = session.ourGames();
    const g = games.slice(before).reverse().find((x) => x.plays?.length);
    if (g) setCast(g);
  };

  /** 가을야구 진행 (경기 수, 또는 '우리 경기까지'·'시리즈 끝까지') */
  const advancePs = async (how: 'one' | 'ours' | 'series' | 'all', label: string) => {
    if (busy || !session.postseasonRunning) return;
    setBusy(label);
    await nextFrame();
    const before = session.ourGames().length;
    if (how === 'one') session.advancePostseason(1);
    else if (how === 'ours') session.advanceToOurPostseasonGame();
    else if (how === 'series') session.advanceSeries();
    else session.advancePostseason(10_000);
    changed();
    await autosave();
    setBusy(null);
    go('postseason');
    if (how === 'one' || how === 'ours') castAfter(before);
  };

  const advanceNextGame = async () => {
    if (busy || session.done) return;
    setBusy('진행 중');
    await nextFrame();
    const before = session.ourGames().length;
    session.advanceToNextGameDay(stops);
    const attention = [...session.attention];
    autoAnswer(stops);
    changed();
    await autosave();
    setBusy(null);
    if (attention.length) setSummary({ snap: takeSnapshotAfter(), attention });
    else castAfter(before);
    if (session.done) go(session.postseasonRunning ? 'postseason' : 'season-end');
  };

  const ui: GameUi = { store, session, grades, version, changed, go, openPlayer: setPlayer, autosave };
  const team = session.teamInfo(session.teamIdx);
  const off = session.phase === 'offseason';
  const nav = NAV.filter((n) => (off ? !n.season : n.id !== 'offseason'));
  const psCur = session.postseasonRunning ? currentSeries(session.postseason!) : null;
  const left = session.season.schedule.slice(session.day).filter((d) => d.some((g) => g.home === session.teamIdx || g.away === session.teamIdx)).length;

  return (
    <GameProvider value={ui}>
      <div className="shell" style={{ ['--team' as string]: teamColor(team.franchise) }}>
        <aside className={`nav${menuOpen ? ' open' : ''}`}>
          <div className="brand">
            <i className="brand-mark" aria-hidden />
            <div>
              <span className="brand-sub">{session.world.year} {off ? '오프시즌' : '시즌'}</span>
              <strong>{team.name}</strong>
            </div>
          </div>
          <button type="button" className="menu-toggle" aria-expanded={menuOpen} aria-controls="game-menu" onClick={() => setMenuOpen((o) => !o)}>
            <span>{screenLabel(screen, off)}</span> <span aria-hidden>{menuOpen ? '✕' : '☰'}</span><span className="sr-only">메뉴 {menuOpen ? '닫기' : '열기'}</span>
          </button>
          <nav aria-label="메뉴" id="game-menu">
            {GROUPS.map((g) => (
              <div key={g} className="nav-group">
                <span className="nav-head" aria-hidden>{g}</span>
                {nav.filter((n) => n.group === g).map((n) => (
                  <button key={n.id} type="button" className={screen === n.id ? 'on' : ''} aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                    {off && n.offLabel ? n.offLabel : n.label}
                  </button>
                ))}
                {g === '리그' && (session.done || off) && (session.postseason || session.league.lastSeason?.postseason) && (
                  <button type="button" className={screen === 'postseason' ? 'on' : ''} onClick={() => go('postseason')}>가을야구</button>
                )}
                {g === '리그' && session.done && (
                  <button type="button" className={screen === 'season-end' ? 'on' : ''} onClick={() => go('season-end')}>시즌 결과</button>
                )}
                {g === '리그' && !!session.league.awards?.length && (
                  <button type="button" className={screen === 'awards' ? 'on' : ''} onClick={() => go('awards')}>시상식</button>
                )}
                {g === '우리 구단' && off && session.offseason?.growth && (
                  <button type="button" className={screen === 'growth' ? 'on' : ''} onClick={() => go('growth')}>선수 성장</button>
                )}
              </div>
            ))}
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
              <button type="button" onClick={() => void advanceNextGame()} disabled={!!busy || session.done || !!session.pendingEvent} title="휴식일은 건너뛰고 다음 경기일까지">다음 경기</button>
              <button type="button" onClick={() => void advance(1, '하루 진행 중')} disabled={!!busy || session.done || !!session.pendingEvent}>하루</button>
              <button type="button" onClick={() => void advance(7, '일주일 진행 중')} disabled={!!busy || session.done || !!session.pendingEvent}>일주일</button>
              <button type="button" onClick={() => void advance(30, '한 달 진행 중')} disabled={!!busy || session.done || !!session.pendingEvent}>한 달</button>
              <button type="button" className="ghost" onClick={() => void advance(10000, '시즌 끝까지 진행 중 (완전 자동)', true)} disabled={!!busy || session.done || !!session.pendingEvent} title="완전 자동: 무엇이 생겨도 멈추지 않고, 이벤트는 첫 번째 선택지로 자동 처리합니다">시즌 끝까지</button>
              <StopSettings value={stops} onChange={setStops} />
            </div>}
          </header>
          {saveError && <p className="error banner" role="alert">{saveError}</p>}
          <main className="content" aria-busy={!!busy}>
            <ErrorBoundary session={session} resetKey={`${screen}:${screenArg ?? ''}:${version}`} onQuit={onQuit}>
              <EventDialog />
              {summary && !session.pendingEvent && (
                <AdvanceSummary snap={summary.snap} attention={summary.attention} onClose={() => setSummary(null)} />
              )}
              {cast && !session.pendingEvent && <GameCast key={cast.key} game={cast} onClose={() => setCast(null)} />}
              {party.length > 0 && !cast && !summary && !session.pendingEvent && <Celebration items={party} onDone={endParty} />}
              <div key={screen} className="screen-in">
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
              {screen === 'growth' && <Growth />}
              {screen === 'awards' && <Awards />}
              {screen === 'records' && <Records />}
              {screen === 'articles' && <Articles />}
              </div>
            </ErrorBoundary>
          </main>
        </div>
        {player !== null && <PlayerDetail key={player} idx={player} onClose={() => setPlayer(null)} />}
      </div>
    </GameProvider>
  );
}
