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
import { Market } from './screens/Market';
import { Search } from './screens/Search';
import { AllStar } from './screens/AllStar';
import { Fantasy } from './screens/Fantasy';
import { autoEventDue, makeEvent } from '../fantasy/ai';
import { loadAiSettings } from '../fantasy/settings';
import { Offseason } from './screens/Offseason';
import { Club } from './screens/Club';
import { Postseason } from './screens/Postseason';
import { Growth } from './screens/Growth';
import { Awards } from './screens/Awards';
import { Records } from './screens/Records';
import { Articles } from './screens/Articles';
import { currentSeries, ROUND_LABEL, stillAlive } from '../league/postseason';
import { teamVars } from './teams';
import { gamesBehind, recentForm } from '../game/stats';
import { ErrorBoundary } from './ErrorBoundary';
import { EventDialog } from './EventDialog';
import { RuleNewsDialog, ruleDialogMuted } from './RuleNews';
import { Rules } from './screens/Rules';
import { AdvanceSummary, takeSnapshot, type AdvanceSnapshot } from './AdvanceSummary';
import { GameCast } from './GameCast';
import { CommandView } from './CommandView';
import { Celebration } from './Motion';
import { achievements, type Achievement } from '../game/celebrate';
import type { CastGame, CommandPreview } from '../game/session';
import { loadStops, NO_STOPS, saveStops, stopsOnEvent, type Attention, type StopRules } from '../game/stops';
import { StopSettings } from './StopSettings';
import { settlePromises } from '../fantasy/free';
import { duePromises } from '../fantasy/promises';
import { rivalDue, rivalMove } from '../fantasy/rivals';
import { About } from './screens/About';
import { chronicleDue, writeChronicle } from '../fantasy/chronicle';

/**
 * 메뉴 (2026-10-12 UI 개편): 위쪽 큰 메뉴 5개(묶음) + 그 아래 작은 탭(화면).
 * season: 시즌 중에만, off: 오프시즌에만. 묶음에 고를 화면이 없으면 그 묶음은 숨긴다.
 */
type Hub = '오늘' | '선수단' | '리그' | '구단' | '기록실';
const HUBS: Hub[] = ['오늘', '선수단', '리그', '구단', '기록실'];
interface NavItem { id: Screen; label: string; offLabel?: string; season?: boolean; off?: boolean; hub: Hub }
const NAV: NavItem[] = [
  { id: 'home', label: '홈', season: true, hub: '오늘' },
  { id: 'fantasy', label: '판타지', hub: '오늘' },
  { id: 'offseason', label: '오프시즌', off: true, hub: '오늘' },
  { id: 'schedule', label: '일정·결과', offLabel: '지난 시즌 일정', hub: '오늘' },
  { id: 'articles', label: '기사', hub: '오늘' },
  { id: 'roster', label: '선수단', season: true, hub: '선수단' },
  { id: 'trade', label: '트레이드', season: true, hub: '선수단' },
  { id: 'market', label: '선수 시장', season: true, hub: '선수단' },
  { id: 'search', label: '선수 찾기', season: true, hub: '선수단' },
  { id: 'growth', label: '선수 성장', off: true, hub: '선수단' },
  { id: 'standings', label: '순위', offLabel: '지난 시즌 순위', hub: '리그' },
  { id: 'leaders', label: '개인 기록', offLabel: '지난 시즌 기록', hub: '리그' },
  { id: 'allstar', label: '올스타전', hub: '리그' },
  { id: 'postseason', label: '가을야구', hub: '리그' },
  { id: 'season-end', label: '시즌 결과', hub: '리그' },
  { id: 'awards', label: '시상식', hub: '리그' },
  { id: 'rules', label: '규칙 연표', hub: '리그' },
  { id: 'club', label: '개요', hub: '구단' },
  { id: 'finance', label: '재정', hub: '구단' },
  { id: 'stadium', label: '구장·팬', hub: '구단' },
  { id: 'staff', label: '감독·코치', hub: '구단' },
  { id: 'club-history', label: '이력·업적', hub: '구단' },
  { id: 'save', label: '저장·설정', hub: '구단' },
  { id: 'about', label: '정보·출처', hub: '구단' },
  { id: 'records', label: '연표', hub: '기록실' },
  { id: 'rec-career', label: '통산 순위', hub: '기록실' },
  { id: 'rec-season', label: '단일 시즌 기록', hub: '기록실' },
  { id: 'rec-teams', label: '구단 역사', hub: '기록실' },
  { id: 'rec-dynasty', label: '왕조·라이벌', hub: '기록실' },
  { id: 'rec-hof', label: '명예의 전당', hub: '기록실' },
];

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export function GameShell({ store, session, onQuit }: { store: BrowserStore; session: GameSession; onQuit: () => void }) {
  const [version, setVersion] = useState(0);
  const [screen, setScreen] = useState<Screen>(session.phase === 'offseason' ? 'offseason' : session.done ? 'season-end' : 'home');
  const [screenArg, setScreenArg] = useState<number | undefined>(undefined);
  const [player, setPlayer] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 개막일 "달라지는 규칙" 창: 시즌마다 한 번 (진행 중이면 띄우지 않고 소식만). 본 해는 메모리에만 (불러오면 다시 볼 수 있다)
  const [ruleYear, setRuleYear] = useState<number | null>(null);
  const ruleSeen = useRef<number | null>(null);
  useEffect(() => {
    if (session.phase !== 'season' || ruleSeen.current === session.year) return;
    if (session.day !== 0 || session.done) { ruleSeen.current = session.year; return; }
    if (busy) return;
    ruleSeen.current = session.year;
    if (!ruleDialogMuted()) setRuleYear(session.year);
  }, [session, session.phase, session.year, session.day, session.done, busy, version]);
  // 새 시즌이 열리면 월드가 바뀌므로 월드에 맞춰 다시 계산한다. 시즌 중에도 능력이 바뀌는 조작(자유 모드 선수 만들기·능력 변경,
  // 이도류 등)이 있어 조작마다 다시 계산한다 (2026-10-13 사용자 보고: 자유 모드로 만든 선동열이 오버롤 70인데 세부 능력은 빈 자리의 40대로 보였다)
  const world = session.world;
  const grades = useMemo(() => computeGrades(world), [world, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // 저장하지 않은 조작 수: 진행 버튼 밖의 조작(트레이드·엔트리·기용표 등)도 잠시 뒤 자동 저장한다
  const dirty = useRef(0);
  const changed = useCallback(() => { dirty.current++; setVersion((v) => v + 1); }, []);
  // 묶음마다 마지막으로 본 화면 (큰 메뉴를 다시 누르면 그 화면으로)
  const lastInHub = useRef<Partial<Record<Hub, Screen>>>({});
  // 휴대폰 화면: 진행 버튼 가운데 '다음 경기' 말고는 '더 진행'을 눌러 펼친다 (game.css 좁은 화면)
  const [moreOpen, setMoreOpen] = useState(false);
  const go = useCallback((s: Screen, arg?: number) => {
    setScreen(s);
    setScreenArg(arg);
    setMoreOpen(false);
    const hub = NAV.find((n) => n.id === s)?.hub;
    if (hub) lastInHub.current[hub] = s;
    window.scrollTo({ top: 0 });
  }, []);

  const autosave = useCallback(async () => {
    dirty.current = 0;
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
    void autoFantasyEvent();
    const rest = attention.filter((x) => x.kind !== 'crisis');
    if (session.crisis) setCmd(session.crisis);
    else if (snap || rest.length) setSummary({ snap: snap ?? takeSnapshotAfter(), attention: rest });
    if (session.done) go(session.postseason ? 'postseason' : 'season-end');
  };
  /**
   * 판타지 4단계: 진행이 끝나면 때가 됐을 때 AI가 사건을 만든다 (src/fantasy/ai.ts autoEventDue). 기다리지 않고 뒤에서.
   * AI 키가 없거나 시험용 제공자면 만들지 않는다. 실패하면 조용히 넘기고 다음 진행 때 다시
   */
  const fantasyBusy = useRef(false);
  const autoFantasyEvent = async () => {
    if (fantasyBusy.current || !session.fantasy) return;
    const s = loadAiSettings();
    if (s.provider === 'mock' || !s.key.trim()) return;
    // 자유 모드: 기한이 된 약속부터 판정 (src/fantasy/promises.ts)
    if (session.fantasy.free && duePromises(session.fantasy, session.promiseNow).length) {
      fantasyBusy.current = true;
      try {
        const r = await settlePromises(session, store, s);
        if (r) { session.addFantasy(r.entry); changed(); await autosave(); }
      } catch {
        /* 다음 진행 때 다시 */
      } finally {
        fantasyBusy.current = false;
      }
    }
    // 자유 모드: 다른 구단 단장의 움직임 (src/fantasy/rivals.ts)
    if (!fantasyBusy.current && session.fantasy.free && rivalDue(session)) {
      fantasyBusy.current = true;
      try {
        const r = await rivalMove(session, store, s);
        session.addFantasy(r.entry);
        changed();
        await autosave();
      } catch {
        /* 다음 진행 때 다시 */
      } finally {
        fantasyBusy.current = false;
      }
    }
    if (fantasyBusy.current || !autoEventDue(session)) return;
    fantasyBusy.current = true;
    try {
      const e = await makeEvent(session, store, s);
      session.addFantasy(e);
      changed();
      await autosave();
    } catch {
      /* 다음 진행 때 다시 */
    } finally {
      fantasyBusy.current = false;
    }
  };
  // 다른 구단 단장의 오프시즌 움직임 (src/fantasy/rivals.ts): FA·외국인 단계마다 한 번 (자유 모드, 키가 있을 때)
  useEffect(() => {
    if (session.phase !== 'offseason' || !rivalDue(session) || fantasyBusy.current) return;
    const s = loadAiSettings();
    if (s.provider === 'mock' || !s.key.trim()) return;
    fantasyBusy.current = true;
    rivalMove(session, store, s)
      .then((r) => { if (rivalDue(session)) { session.addFantasy(r.entry); changed(); void autosave(); } })
      .catch(() => { /* 다음에 다시 */ })
      .finally(() => { fantasyBusy.current = false; });
  }, [version, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // 구단 연대기 (src/fantasy/chronicle.ts): 오프시즌에 들어서면 그 해 연대기를 쓴다 (키가 있을 때, 해마다 한 번)
  useEffect(() => {
    const year = chronicleDue(session);
    if (year === null || fantasyBusy.current) return;
    const s = loadAiSettings();
    if (s.provider === 'mock' || !s.key.trim()) return;
    fantasyBusy.current = true;
    writeChronicle(session, s, year)
      .then((e) => { if (chronicleDue(session) === year) { session.addFantasy(e); changed(); void autosave(); } })
      .catch(() => { /* 다음에 다시 */ })
      .finally(() => { fantasyBusy.current = false; });
  }, [version, session]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // 직접 지휘 (CommandView): 진행 버튼 옆 "직접 지휘", 또는 자동 진행이 위기에서 멈췄을 때
  const [cmd, setCmd] = useState<CommandPreview | null>(null);
  // 진행 중이 아닐 때 바뀐 것이 있으면 1.5초 뒤 자동 저장 (창을 바로 닫아도 트레이드·엔트리 변경이 남는다)
  useEffect(() => {
    if (busy || cmd || !dirty.current) return; // 직접 지휘 중에는 경기가 끝난 뒤 저장한다
    const t = setTimeout(() => { if (dirty.current) void autosave(); }, 1500);
    return () => clearTimeout(t);
  }, [version, busy, cmd, autosave]);

  const startCommand = async () => {
    if (busy || session.phase !== 'season' || (session.done && !session.postseasonRunning)) return;
    setBusy('직접 지휘 준비 중');
    await nextFrame();
    // 가을야구: 다음 경기가 우리 경기가 될 때까지 다른 시리즈를 진행 (2026-10-12 가을야구 직접 지휘)
    if (session.postseasonRunning) {
      while (session.postseasonRunning && !session.ourPostseasonGameNext) session.advancePostseason(1);
      changed();
      setBusy(null);
      if (session.canCommand) setCmd(session.commandPreview([], 'next'));
      else go('postseason');
      return;
    }
    // 오늘 경기가 없으면 경기 날까지 (멈춤 설정대로)
    let attention: Attention[] = [];
    while (!session.hasGameToday && !session.done) {
      session.advance(1, stops);
      if (session.attention.length) attention = [...session.attention];
      if (session.stopped) break;
    }
    autoAnswer(stops);
    changed();
    setBusy(null);
    if (session.crisis) { setCmd(session.crisis); return; }
    if (attention.length) { setSummary({ snap: takeSnapshotAfter(), attention }); return; }
    if (session.canCommand) setCmd(session.commandPreview([], 'next'));
  };
  const endCommand = async (done: boolean) => {
    setCmd(null);
    session.crisis = null;
    changed();
    if (!done) return;
    await autosave();
    if (session.done) go(session.postseason ? 'postseason' : 'season-end');
    else if (session.postseasonRunning) go('postseason');
  };
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
    if (session.crisis) setCmd(session.crisis);
    else if (attention.length) setSummary({ snap: takeSnapshotAfter(), attention });
    else castAfter(before);
    if (session.done) go(session.postseason ? 'postseason' : 'season-end');
  };

  const ui: GameUi = { store, session, grades, version, changed, go, openPlayer: setPlayer, autosave, command: () => void startCommand() };
  const team = session.teamInfo(session.teamIdx);
  const off = session.phase === 'offseason';
  const lastPs = session.league.lastSeason?.postseason;
  const shown = (n: NavItem): boolean => {
    if (n.season && off) return false;
    if (n.off && !off) return false;
    if (n.id === 'postseason') return (session.done || off) && !!(session.postseason || lastPs);
    if (n.id === 'season-end') return session.done;
    if (n.id === 'awards') return !!session.league.awards?.length;
    if (n.id === 'growth') return !!session.offseason?.growth;
    if (n.id === 'fantasy') return !!session.fantasy;
    return true;
  };
  const nav = NAV.filter(shown);
  const curHub = NAV.find((n) => n.id === screen)?.hub;
  const hubItems = (h: Hub) => nav.filter((n) => n.hub === h);
  const goHub = (h: Hub) => {
    const items = hubItems(h);
    const last = lastInHub.current[h];
    go(last && items.some((n) => n.id === last) ? last : items[0].id);
  };
  const psCur = session.postseasonRunning ? currentSeries(session.postseason!) : null;
  const left = session.season.schedule.slice(session.day).filter((d) => d.some((g) => g.home === session.teamIdx || g.away === session.teamIdx)).length;
  // 머리 부분 성적: 시즌 중이면 이번 시즌, 오프시즌이면 지난 시즌 순위
  const recNow = off ? null : session.season.teams[session.teamIdx];
  const order = off ? session.league.lastSeason?.standings ?? [] : session.season.standings();
  const rankNow = order.indexOf(session.teamIdx) + 1;
  const lead = !off && recNow && rankNow > 1 ? session.season.teams[order[0]] : null;
  const form = !off ? recentForm(session.season.log, session.teamIdx) : null;
  const disabled = !!busy || session.done || !!session.pendingEvent;

  return (
    <GameProvider value={ui}>
      <div className="shell tv" style={teamVars(team.franchise, team.name)}>
        <header className="mast">
          <div className="mast-top">
            <span className="mast-brand">KBO 단장</span>
            <span className="mast-when">
              {off ? `${session.world.year} 오프시즌` : psCur ? `${session.world.year} 가을야구 · ${ROUND_LABEL[psCur.round]} ${psCur.games.length + 1}차전` : session.done ? `${session.world.year} ${session.postseason?.done ? '가을야구 종료' : '정규시즌 종료'}` : formatDate(session.world.year, session.day, true)}
              {!off && !session.done && ` · 남은 경기 ${left}`}
            </span>
            <span className="mast-tools">
              <button type="button" className="mast-ghost" onClick={() => go('save')}>저장·설정</button>
              <button type="button" className="mast-ghost" onClick={onQuit}>시작 화면</button>
            </span>
          </div>
          <div className="mast-main">
            <strong className="mast-team">{team.name}</strong>
            <span className="mast-score" title={summaryOf(session)}>
              {recNow && recNow.g > 0 && <span className="mast-rec">{recNow.w}<span className="dim">–{recNow.l}{recNow.t ? `–${recNow.t}` : ''}</span></span>}
              {rankNow > 0 && (!recNow || recNow.g > 0) && <span className="mast-rank"><b>{rankNow}</b>위{off && <small> 지난 시즌</small>}</span>}
              {recNow && recNow.g === 0 && <span className="mast-sub">개막 전</span>}
              {recNow && recNow.g > 0 && <span className="mast-sub">{lead ? `선두와 ${gamesBehind(lead, recNow).toFixed(1)}` : '선두'}{form?.streak ? ` · ${form.streak}` : ''}</span>}
            </span>
            {!off && session.postseasonRunning && <div className="advance">
              {busy && <span className="mast-busy" role="status">{busy}</span>}
              <button type="button" className="go" onClick={() => void advancePs('one', '경기 진행 중')} disabled={!!busy}>다음 경기 ▶</button>
              <button type="button" className="more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>더 진행 {moreOpen ? '▴' : '▾'}</button>
              <div className={`adv-rest${moreOpen ? ' open' : ''}`}>
                <button type="button" onClick={() => void advancePs('ours', '우리 경기까지 진행 중')} disabled={!!busy}>우리 경기까지</button>
                <button type="button" onClick={() => void advancePs('series', '시리즈 진행 중')} disabled={!!busy}>시리즈 끝까지</button>
                <button type="button" onClick={() => void advancePs('all', '가을야구 진행 중')} disabled={!!busy}>가을야구 끝까지</button>
                {session.postseason && stillAlive(session.postseason, session.teamIdx) && (
                  <button type="button" onClick={() => void startCommand()} disabled={!!busy} title="우리 가을야구 다음 경기를 타석마다 직접 지휘합니다">직접 지휘</button>
                )}
              </div>
            </div>}
            {!off && !session.done && <div className="advance">
              {busy && <span className="mast-busy" role="status">{busy}</span>}
              <button type="button" className="go" onClick={() => void advanceNextGame()} disabled={disabled} title="휴식일은 건너뛰고 다음 경기일까지">다음 경기 ▶</button>
              <button type="button" className="more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>더 진행 {moreOpen ? '▴' : '▾'}</button>
              <div className={`adv-rest${moreOpen ? ' open' : ''}`}>
                <button type="button" onClick={() => void startCommand()} disabled={disabled} title="오늘(또는 다음) 우리 경기를 타석마다 직접 지휘합니다: 대타·대주자·작전·투수 교체">직접 지휘</button>
                <button type="button" onClick={() => void advance(1, '하루 진행 중')} disabled={disabled}>하루</button>
                <button type="button" onClick={() => void advance(7, '일주일 진행 중')} disabled={disabled}>일주일</button>
                <button type="button" onClick={() => void advance(30, '한 달 진행 중')} disabled={disabled}>한 달</button>
                <button type="button" onClick={() => void advance(10000, '시즌 끝까지 진행 중 (완전 자동)', true)} disabled={disabled} title="완전 자동: 무엇이 생겨도 멈추지 않고, 이벤트는 첫 번째 선택지로 자동 처리합니다">시즌 끝까지</button>
                <StopSettings value={stops} onChange={setStops} />
              </div>
            </div>}
          </div>
          <nav className="hubs" aria-label="메뉴">
            {HUBS.filter((h) => hubItems(h).length).map((h) => (
              <button key={h} type="button" className={curHub === h ? 'on' : ''} aria-current={curHub === h ? 'page' : undefined} onClick={() => goHub(h)}>{h}</button>
            ))}
          </nav>
        </header>
        {curHub && hubItems(curHub).length > 1 && (
          <nav className="subtabs" aria-label={`${curHub} 화면`}>
            {hubItems(curHub).map((n) => (
              <button key={n.id} type="button" className={screen === n.id ? 'on' : ''} aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                {off && n.offLabel ? n.offLabel : n.label}
              </button>
            ))}
          </nav>
        )}
        <div className="main">
          {saveError && <p className="error banner" role="alert">{saveError}</p>}
          <main className="content" aria-busy={!!busy}>
            <ErrorBoundary session={session} resetKey={`${screen}:${screenArg ?? ''}:${version}`} onQuit={onQuit}>
              <EventDialog />
              {ruleYear !== null && !session.pendingEvent && <RuleNewsDialog news={session.ruleNewsFor(ruleYear)} onClose={() => setRuleYear(null)} />}
              {summary && !session.pendingEvent && (
                <AdvanceSummary snap={summary.snap} attention={summary.attention} onClose={() => setSummary(null)} />
              )}
              {cast && !session.pendingEvent && <GameCast key={cast.key} game={cast} onClose={() => setCast(null)} />}
              {cmd && !session.pendingEvent && <CommandView start={cmd} onDone={() => void endCommand(true)} onCancel={() => void endCommand(false)} />}
              {party.length > 0 && !cast && !cmd && !summary && !session.pendingEvent && <Celebration items={party} onDone={endParty} />}
              <div key={screen} className="screen-in">
              {screen === 'home' && <Home />}
              {screen === 'roster' && <Roster />}
              {screen === 'schedule' && <Schedule focusGame={screenArg} />}
              {screen === 'standings' && <Standings />}
              {screen === 'leaders' && <Leaders />}
              {screen === 'trade' && <Trade />}
              {screen === 'market' && <Market />}
              {screen === 'search' && <Search />}
              {screen === 'allstar' && <AllStar />}
              {screen === 'fantasy' && <Fantasy />}
              {screen === 'save' && <SaveScreen onQuit={onQuit} />}
              {screen === 'about' && <About />}
              {screen === 'season-end' && <SeasonEnd />}
              {screen === 'offseason' && <Offseason />}
              {screen === 'club' && <Club />}
              {screen === 'finance' && <Club tab="finance" />}
              {screen === 'stadium' && <Club tab="stadium" />}
              {screen === 'staff' && <Club tab="coach" />}
              {screen === 'club-history' && <Club tab="history" />}
              {screen === 'postseason' && <Postseason />}
              {screen === 'growth' && <Growth />}
              {screen === 'awards' && <Awards />}
              {screen === 'records' && <Records />}
              {screen === 'rec-career' && <Records tab="career" />}
              {screen === 'rec-season' && <Records tab="season" />}
              {screen === 'rec-teams' && <Records tab="teams" />}
              {screen === 'rec-dynasty' && <Records tab="dynasty" />}
              {screen === 'rec-hof' && <Records tab="hof" />}
              {screen === 'articles' && <Articles />}
              {screen === 'rules' && <Rules />}
              </div>
            </ErrorBoundary>
          </main>
        </div>
        {player !== null && <PlayerDetail key={player} idx={player} onClose={() => setPlayer(null)} />}
      </div>
    </GameProvider>
  );
}
