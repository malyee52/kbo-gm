// 게임 화면 틀 (2026-10-22 UI 대개편 1차, 짚쨩 안1 "결정 브리핑"): 왼쪽 세로 메뉴(대분류 6개 + 공통 도구), 위쪽 상태 줄,
// 대분류 안 하위 화면 목록, 본문, 선수 상세 창. 휴대폰(≤768px)은 아래 4칸(브리핑·전력·영입·전체) + 아래 고정 진행 버튼.
// 메뉴 구조는 menu.ts, 결정함은 decisions.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserStore } from '../data/loadBrowser';
import { computeGrades } from '../engine';
import { formatDate } from '../game/calendar';
import type { GameSession } from '../game/session';
import { GameProvider, type GameUi, type Screen } from './context';
import { autosaveSession, summaryOf } from './saving';
import { Briefing } from './screens/Briefing';
import { Inbox } from './screens/Inbox';
import { ClubNews } from './screens/ClubNews';
import { Leaders } from './screens/Leaders';
import { PlayerDetail } from './screens/PlayerDetail';
import { Roster } from './screens/Roster';
import { LineupBoard } from './screens/LineupBoard';
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
import { EnlistPanel } from './screens/Enlist';
import { currentSeries, ROUND_LABEL, stillAlive } from '../league/postseason';
import { STAGE_LABEL } from '../league/offseason';
import { teamVars } from './teams';
import { gamesBehind } from '../game/stats';
import { ErrorBoundary } from './ErrorBoundary';
import { EventDialog } from './EventDialog';
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
import { blockOf, entryOf, GROUPS, hidden, itemBlock, itemOf, itemsOf, MOBILE_GROUPS, tabLabel, type Group, type MenuItem } from './menu';
import { countByGroup, decisions, loadAcked, saveAcked, type Acked } from './decisions';
import { DensityToggle, loadDensity, saveDensity, ShellProvider, type Density, type ShellUi } from './shell';

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** 상태 줄의 성적 (중계 창이 열려 있는 동안은 경기 전 값을 보여 준다: 결과가 미리 보이지 않게) */
interface Head { when: string; left: number; rec: { w: number; l: number; t: number; g: number; rank: number; behind: number | null } | null }

function headOf(session: GameSession): Head {
  const off = session.phase === 'offseason';
  const psCur = session.postseasonRunning ? currentSeries(session.postseason!) : null;
  const when = off
    ? `${session.world.year} 오프시즌 · ${STAGE_LABEL[session.offseason!.stage]}`
    : psCur ? `${session.world.year} 가을야구 · ${ROUND_LABEL[psCur.round]} ${psCur.games.length + 1}차전`
      : session.done ? `${session.world.year} ${session.postseason?.done ? '가을야구 종료' : '정규시즌 종료'}`
        : formatDate(session.world.year, session.day, true);
  const left = session.season.schedule.slice(session.day).filter((d) => d.some((g) => g.home === session.teamIdx || g.away === session.teamIdx)).length;
  if (off) return { when, left, rec: null };
  const s = session.season;
  const r = s.teams[session.teamIdx];
  const order = s.standings();
  const rank = order.indexOf(session.teamIdx) + 1;
  const lead = rank > 1 ? s.teams[order[0]] : null;
  return { when, left, rec: { w: r.w, l: r.l, t: r.t, g: r.g, rank, behind: lead ? gamesBehind(lead, r) : null } };
}

export function GameShell({ store, session, onQuit }: { store: BrowserStore; session: GameSession; onQuit: () => void }) {
  const [version, setVersion] = useState(0);
  const [screen, setScreen] = useState<Screen>('home');
  const [screenArg, setScreenArg] = useState<number | undefined>(undefined);
  const [player, setPlayer] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // 새 시즌이 열리면 월드가 바뀌므로 월드에 맞춰 다시 계산한다. 시즌 중에도 능력이 바뀌는 조작(자유 모드 선수 만들기·능력 변경,
  // 이도류 등)이 있어 조작마다 다시 계산한다 (2026-10-13 사용자 보고: 자유 모드로 만든 선동열이 오버롤 70인데 세부 능력은 빈 자리의 40대로 보였다)
  const world = session.world;
  const grades = useMemo(() => computeGrades(world), [world, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // 저장하지 않은 조작 수: 진행 버튼 밖의 조작(트레이드·엔트리·기용표 등)도 잠시 뒤 자동 저장한다
  const dirty = useRef(0);
  const changed = useCallback(() => { dirty.current++; setVersion((v) => v + 1); }, []);
  // 대분류마다 마지막으로 본 화면 (대분류를 다시 누르면 그 화면으로)
  const lastInGroup = useRef<Partial<Record<Group, Screen>>>({});
  // 진행 설정 (하루·일주일·한 달·시즌 끝까지·멈춤 설정)과 휴대폰 '전체' 메뉴
  const [progressOpen, setProgressOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  // 상태 줄 검색 칸 → 영입 > 선수 검색의 이름 조건
  const [searchText, setSearchText] = useState('');
  const [searchKey, setSearchKey] = useState(0);
  const [density, setDensityState] = useState<Density>(loadDensity);
  const setDensity = (d: Density) => { setDensityState(d); saveDensity(d); };
  // 결정함에서 "확인"한 알림 (게임마다 이 브라우저에 기억, decisions.ts)
  const gameKey = `${session.league.startYear}:${session.league.seed}`;
  const [acked, setAcked] = useState<Acked>(() => loadAcked(gameKey));
  useEffect(() => setAcked(loadAcked(gameKey)), [gameKey]);
  // 막힌 화면을 누르면 사유를 잠시 보여 준다
  const go = useCallback((s: Screen, arg?: number) => {
    setScreen(s);
    setScreenArg(arg);
    setProgressOpen(false);
    setAllOpen(false);
    const group = itemOf(s)?.group;
    if (group && group !== '공통') lastInGroup.current[group] = s;
    window.scrollTo({ top: 0 });
  }, []);

  // 휴대폰 '전체' 판이 열려 있는 동안 뒤 본문은 스크롤하지 않는다 (닫으면 보던 자리 그대로). Esc로 닫는다
  useEffect(() => {
    if (!allOpen) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAllOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { root.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [allOpen]);

  const autosave = useCallback(async () => {
    dirty.current = 0;
    try {
      await autosaveSession(session);
      setSaveError(null);
      setSavedAt(new Date());
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
    setProgressOpen(false);
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
  // 중계 창이 열려 있는 동안 상태 줄에 보일 경기 전 성적 (2026-10-22 화면 점검: 개막일 '다음 경기' 뒤 머리 부분·홈에 결과가 미리 보였다)
  const [castHead, setCastHead] = useState<Head | null>(null);
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
  // 직접 지휘 (CommandView): 진행 설정의 "직접 지휘", 또는 자동 진행이 위기에서 멈췄을 때
  const [cmd, setCmd] = useState<CommandPreview | null>(null);
  // 진행 중이 아닐 때 바뀐 것이 있으면 1.5초 뒤 자동 저장 (창을 바로 닫아도 트레이드·엔트리 변경이 남는다)
  useEffect(() => {
    if (busy || cmd || !dirty.current) return; // 직접 지휘 중에는 경기가 끝난 뒤 저장한다
    const t = setTimeout(() => { if (dirty.current) void autosave(); }, 1500);
    return () => clearTimeout(t);
  }, [version, busy, cmd, autosave]);

  const startCommand = async () => {
    if (busy || session.phase !== 'season' || (session.done && !session.postseasonRunning)) return;
    setProgressOpen(false);
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
  /** 진행 전 경기 수와 성적을 받아, 그 뒤 우리 경기 가운데 마지막 것 (중계 기록이 있을 때) */
  const castAfter = (before: number, head: Head) => {
    if (!stops.cast) return false;
    const games = session.ourGames();
    const g = games.slice(before).reverse().find((x) => x.plays?.length);
    if (!g) return false;
    setCastHead(head);
    setCast(g);
    return true;
  };
  const closeCast = () => { setCast(null); setCastHead(null); };

  /** 가을야구 진행 (경기 수, 또는 '우리 경기까지'·'시리즈 끝까지') */
  const advancePs = async (how: 'one' | 'ours' | 'series' | 'all', label: string) => {
    if (busy || !session.postseasonRunning) return;
    setProgressOpen(false);
    setBusy(label);
    await nextFrame();
    const before = session.ourGames().length;
    const head = headOf(session);
    if (how === 'one') session.advancePostseason(1);
    else if (how === 'ours') session.advanceToOurPostseasonGame();
    else if (how === 'series') session.advanceSeries();
    else session.advancePostseason(10_000);
    changed();
    await autosave();
    setBusy(null);
    const casting = (how === 'one' || how === 'ours') && castAfter(before, head);
    // 중계를 보는 동안은 뒤 화면을 바꾸지 않는다 (결과가 미리 보이지 않게). 닫으면 그 자리에서 이어 본다
    if (!casting) go('postseason');
  };

  const advanceNextGame = async () => {
    if (busy || session.done) return;
    setProgressOpen(false);
    setBusy('진행 중');
    await nextFrame();
    const before = session.ourGames().length;
    const head = headOf(session);
    session.advanceToNextGameDay(stops);
    const attention = [...session.attention];
    autoAnswer(stops);
    changed();
    await autosave();
    setBusy(null);
    if (session.crisis) setCmd(session.crisis);
    else if (attention.length) setSummary({ snap: takeSnapshotAfter(), attention });
    else castAfter(before, head);
    if (session.done) go(session.postseason ? 'postseason' : 'season-end');
  };

  const ui: GameUi = { store, session, grades, version, changed, go, openPlayer: setPlayer, autosave, command: () => void startCommand() };
  const team = session.teamInfo(session.teamIdx);
  const off = session.phase === 'offseason';
  const { when, left, rec: head } = (cast && castHead) || headOf(session);
  const lastRank = off ? (session.league.lastSeason?.standings ?? []).indexOf(session.teamIdx) + 1 : 0;
  const pending = !!session.pendingEvent;
  const seasonRunning = !off && !session.done;
  const advanceDisabled = !!busy || pending || (!seasonRunning && !session.postseasonRunning);
  const list = useMemo(() => decisions(session, acked), [session, version, acked]); // eslint-disable-line react-hooks/exhaustive-deps
  const ack = (key: string, sig: string) => {
    const next = { ...acked, [key]: sig };
    setAcked(next);
    saveAcked(gameKey, next);
  };
  const badges = countByGroup(list);

  const advanceNext = () => {
    if (session.postseasonRunning) void advancePs('one', '경기 진행 중');
    else void advanceNextGame();
  };
  const shell: ShellUi = { busy, advanceDisabled, advanceNext, openProgress: () => setProgressOpen(true), density, setDensity, decisions: list, ack };

  const curItem = itemOf(screen);
  const curGroup = curItem?.group;
  const goItem = (m: MenuItem) => go(entryOf(session, m));
  const goGroup = (g: Group) => {
    const items = itemsOf(g).filter((m) => !hidden(session, m));
    const last = lastInGroup.current[g];
    if (last && !blockOf(session, last)) { go(last); return; }
    go(entryOf(session, items.find((m) => !itemBlock(session, m)) ?? items[0]));
  };
  const block = blockOf(session, screen);

  const saveText = saveError ? '저장 실패' : busy ? '진행 중' : savedAt ? `자동 저장 ${savedAt.getHours()}:${String(savedAt.getMinutes()).padStart(2, '0')}` : '불러옴';

  // 주 진행 단추: 시즌 중 '다음 경기', 가을야구 '다음 경기', 시즌 끝·오프시즌은 그 단계 화면으로
  const primary = seasonRunning || session.postseasonRunning
    ? { label: '다음 경기', act: advanceNext, disabled: advanceDisabled, title: session.postseasonRunning ? '가을야구 한 경기' : '휴식일은 건너뛰고 다음 경기일까지' }
    : off
      ? { label: session.offseason!.stage === 'ready' ? '개막 준비' : `오프시즌 ${STAGE_LABEL[session.offseason!.stage]}`, act: () => go('offseason'), disabled: !!busy, title: '오프시즌 단계 화면으로' }
      : { label: '시즌 결산', act: () => go('season-end'), disabled: !!busy, title: '시즌 결산 화면으로' };

  const progressMenu = (
    <div className="progress-pop" role="dialog" aria-label="진행 설정">
      {seasonRunning && (<>
        <p className="muted small">진행 범위를 고릅니다. 멈춤 설정대로 멈추고, <strong>시즌 끝까지</strong>는 멈추지 않고 이벤트를 첫 번째 선택지로 처리합니다.</p>
        <div className="progress-grid">
          <button type="button" className="ghost" onClick={() => void advance(1, '하루 진행 중')} disabled={advanceDisabled}>하루</button>
          <button type="button" className="ghost" onClick={() => void advance(7, '일주일 진행 중')} disabled={advanceDisabled}>일주일</button>
          <button type="button" className="ghost" onClick={() => void advance(30, '한 달 진행 중')} disabled={advanceDisabled}>한 달</button>
          <button type="button" className="ghost" onClick={() => void advance(10000, '시즌 끝까지 진행 중 (완전 자동)', true)} disabled={advanceDisabled} title="완전 자동: 무엇이 생겨도 멈추지 않고, 이벤트는 첫 번째 선택지로 자동 처리합니다">시즌 끝까지</button>
          <button type="button" className="ghost" onClick={() => void startCommand()} disabled={advanceDisabled} title="오늘(또는 다음) 우리 경기를 타석마다 직접 지휘합니다: 대타·대주자·작전·투수 교체">직접 지휘</button>
        </div>
      </>)}
      {session.postseasonRunning && (
        <div className="progress-grid">
          <button type="button" className="ghost" onClick={() => void advancePs('ours', '우리 경기까지 진행 중')} disabled={!!busy}>우리 경기까지</button>
          <button type="button" className="ghost" onClick={() => void advancePs('series', '시리즈 진행 중')} disabled={!!busy}>시리즈 끝까지</button>
          <button type="button" className="ghost" onClick={() => void advancePs('all', '가을야구 진행 중')} disabled={!!busy}>가을야구 끝까지</button>
          {session.postseason && stillAlive(session.postseason, session.teamIdx) && (
            <button type="button" className="ghost" onClick={() => void startCommand()} disabled={!!busy} title="우리 가을야구 다음 경기를 타석마다 직접 지휘합니다">직접 지휘</button>
          )}
        </div>
      )}
      {!seasonRunning && !session.postseasonRunning && <p className="muted small">{off ? '오프시즌은 계약·지명 화면에서 단계를 넘깁니다.' : '정규시즌이 끝났습니다. 결산 화면에서 마무리합니다.'}</p>}
      <div className="row-between">
        <StopSettings value={stops} onChange={setStops} />
        <button type="button" className="ghost" onClick={() => setProgressOpen(false)}>닫기</button>
      </div>
    </div>
  );

  const navButton = (g: Group, mobile = false) => {
    const n = badges[g] ?? 0;
    const on = curGroup === g && !allOpen;
    return (
      <button key={g} type="button" className={`nav-group${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => goGroup(g)}>
        {mobile && <i className={`nav-ico ico-${GROUPS.indexOf(g)}`} aria-hidden />}
        <span>{g}</span>
        {n > 0 && <b className="badge" aria-label={`처리할 일 ${n}건`}>{n}</b>}
      </button>
    );
  };
  const hiddenBadge = GROUPS.filter((g) => !MOBILE_GROUPS.includes(g)).reduce((a, g) => a + (badges[g] ?? 0), 0);

  const subItems = curGroup ? itemsOf(curGroup).filter((m) => !hidden(session, m)) : [];
  const tabs = curItem && curItem.tabs.length > 1 ? curItem.tabs : null;

  return (
    <GameProvider value={ui}>
      <ShellProvider value={shell}>
      <div className={`shell tv density-${density}`} style={teamVars(team.franchise, team.name)}>
        <aside className="side-nav" aria-label="메뉴">
          <div className="side-brand">KBO 단장</div>
          <nav className="side-groups">{GROUPS.map((g) => navButton(g))}</nav>
          <div className="side-tools">
            <button type="button" className={`nav-tool${screen === 'save' ? ' on' : ''}`} onClick={() => go('save')}>저장·설정</button>
            <button type="button" className={`nav-tool${screen === 'about' ? ' on' : ''}`} onClick={() => go('about')}>정보·출처</button>
            <button type="button" className="nav-tool" onClick={onQuit}>시작 화면</button>
          </div>
        </aside>

        <div className="shell-main">
          <header className="status-bar">
            <div className="sb-team">
              <i className="sb-band" aria-hidden />
              <strong>{team.name}</strong>
            </div>
            <span className="sb-when">{when}{(seasonRunning || (cast && left > 0)) && <span className="muted"> · 남은 경기 {left}</span>}</span>
            <span className="sb-score" title={summaryOf(session)}>
              {head && head.g > 0 && <><b>{head.rank}위</b> <span className="num">{head.w}–{head.l}{head.t ? `–${head.t}` : ''}</span>{density === 'full' && <span className="muted small"> {head.behind === null ? '선두' : `선두와 ${head.behind.toFixed(1)}`}</span>}</>}
              {head && head.g === 0 && <span className="muted">개막 전</span>}
              {off && lastRank > 0 && <><b>{lastRank}위</b> <span className="muted small">지난 시즌</span></>}
            </span>
            <form className="sb-search" role="search" onSubmit={(e) => { e.preventDefault(); setSearchKey((k) => k + 1); go('search'); }}>
              <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="선수 찾기" aria-label="선수 이름으로 찾기" />
            </form>
            <span className={`sb-save${saveError ? ' error-text' : ''}`} role="status">{saveText}</span>
            <DensityToggle />
            <div className="sb-advance">
              {busy && <span className="sb-busy" role="status">{busy}</span>}
              <button type="button" className="go" onClick={primary.act} disabled={primary.disabled} title={pending ? '이벤트에 답한 뒤 진행할 수 있습니다' : primary.title}>{primary.label} ▶</button>
              <button type="button" className="ghost" aria-expanded={progressOpen} onClick={() => setProgressOpen((o) => !o)}>진행 설정</button>
              {progressOpen && progressMenu}
            </div>
          </header>

          {curGroup && curGroup !== '공통' && (
            <nav className="sub-nav" aria-label={`${curGroup} 화면`}>
              <span className="crumb"><b>{curGroup}</b> › {curItem ? tabLabel(session, curItem) : ''}</span>
              <div className="sub-items">
                {subItems.map((m) => {
                  const b = itemBlock(session, m);
                  const on = m === curItem;
                  return (
                    <button key={m.key} type="button" className={`sub-item${on ? ' on' : ''}${b ? ' blocked' : ''}`} aria-current={on ? 'page' : undefined}
                      aria-disabled={b ? true : undefined} title={b ?? undefined} onClick={() => goItem(m)}>
                      {tabLabel(session, m)}
                      {b && <small>{b.split(' · ').at(-1)!.replace(/\s*\(.*\)$/, '')}</small>}
                    </button>
                  );
                })}
              </div>
            </nav>
          )}

          <div className="main">
            {saveError && <p className="error banner" role="alert">{saveError}</p>}
            <main className="content" aria-busy={!!busy}>
              <ErrorBoundary session={session} resetKey={`${screen}:${screenArg ?? ''}:${version}`} onQuit={onQuit}>
                <EventDialog />
                {summary && !session.pendingEvent && (
                  <AdvanceSummary snap={summary.snap} attention={summary.attention} onClose={() => setSummary(null)} />
                )}
                {cast && !session.pendingEvent && <GameCast key={cast.key} game={cast} onClose={closeCast} live />}
                {cmd && !session.pendingEvent && <CommandView start={cmd} onDone={() => void endCommand(true)} onCancel={() => void endCommand(false)} />}
                {party.length > 0 && !cast && !cmd && !summary && !session.pendingEvent && <Celebration items={party} onDone={endParty} />}
                {tabs && (
                  <div className="seg screen-tabs" role="tablist" aria-label={`${curItem!.label} 화면`}>
                    {tabs.map((t) => {
                      const b = blockOf(session, t.screen);
                      return (
                        <button key={t.screen} type="button" role="tab" aria-selected={screen === t.screen} className={`${screen === t.screen ? 'on' : ''}${b ? ' blocked' : ''}`}
                          aria-disabled={b ? true : undefined} title={b ?? undefined} onClick={() => go(t.screen)}>{tabLabel(session, t)}</button>
                      );
                    })}
                  </div>
                )}
                {/* 중계를 보는 동안은 뒤 화면을 그리지 않는다: 결과(최근 경기·순위)가 미리 보이지 않게 */}
                {cast ? <p className="muted cast-cover">경기 중계 중입니다. 중계 창을 닫으면 결과가 반영된 화면이 보입니다.</p> : block ? (
                  <section className="panel blocked-panel" role="status">
                    <h2>{curItem ? tabLabel(session, curItem) : ''}: 지금은 열 수 없습니다</h2>
                    <p>{block}</p>
                    <div className="actions"><button type="button" className="ghost" onClick={() => go('home')}>브리핑으로</button></div>
                  </section>
                ) : (
                <div key={screen} className="screen-in">
                {screen === 'home' && <Briefing />}
                {screen === 'inbox' && <Inbox />}
                {screen === 'news' && <ClubNews />}
                {screen === 'roster' && <Roster />}
                {screen === 'lineup' && <LineupBoard />}
                {screen === 'enlist' && <EnlistPanel />}
                {screen === 'schedule' && <Schedule focusGame={screenArg} />}
                {screen === 'standings' && <Standings />}
                {screen === 'leaders' && <Leaders />}
                {screen === 'trade' && <Trade />}
                {screen === 'market' && <Market />}
                {screen === 'search' && <Search key={searchKey} initialText={searchText.trim()} />}
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
                {screen === 'owner' && <Club tab="owner" />}
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
                </div>
                )}
              </ErrorBoundary>
            </main>
          </div>
        </div>

        {/* 휴대폰: 아래 고정 진행 버튼 + 4칸 메뉴 */}
        <div className="dock">
          <div className="dock-advance">
            {busy && <span className="sb-busy" role="status">{busy}</span>}
            <button type="button" className="go" onClick={primary.act} disabled={primary.disabled}>{primary.label} ▶</button>
            <button type="button" className="ghost" aria-expanded={progressOpen} onClick={() => setProgressOpen((o) => !o)}>진행 설정</button>
          </div>
          <nav className="dock-tabs" aria-label="메뉴">
            {MOBILE_GROUPS.map((g) => navButton(g, true))}
            <button type="button" className={`nav-group${allOpen || (curGroup && !MOBILE_GROUPS.includes(curGroup as Group)) ? ' on' : ''}`} aria-expanded={allOpen} onClick={() => setAllOpen((o) => !o)}>
              <i className="nav-ico ico-all" aria-hidden />
              <span>전체</span>
              {hiddenBadge > 0 && <b className="badge" aria-label={`다른 메뉴에 처리할 일 ${hiddenBadge}건`}>{hiddenBadge}</b>}
            </button>
          </nav>
          {progressOpen && <div className="dock-pop">{progressMenu}</div>}
        </div>

        {allOpen && <div className="all-scrim" aria-hidden onClick={() => setAllOpen(false)} />}
        {allOpen && (
          <div className="all-sheet" role="dialog" aria-modal="true" aria-label="전체 메뉴">
            <div className="sheet-head">
              <i className="sheet-grip" aria-hidden />
              <button type="button" className="ghost small-btn" onClick={() => setAllOpen(false)}>닫기</button>
            </div>
            <div className="all-grid">
              {GROUPS.map((g) => (
                <section key={g}>
                  <h2>{g}{badges[g] ? <b className="badge">{badges[g]}</b> : null}</h2>
                  {itemsOf(g).filter((m) => !hidden(session, m)).map((m) => {
                    const b = itemBlock(session, m);
                    return (
                      <button key={m.key} type="button" className={`sub-item${m === curItem ? ' on' : ''}${b ? ' blocked' : ''}`} aria-disabled={b ? true : undefined} onClick={() => goItem(m)}>
                        {tabLabel(session, m)}{b && <small>{b.split(' · ').at(-1)}</small>}
                      </button>
                    );
                  })}
                </section>
              ))}
              <section>
                <h2>공통</h2>
                <button type="button" className="sub-item" onClick={() => go('search')}>선수 찾기</button>
                <button type="button" className="sub-item" onClick={() => go('save')}>저장·설정</button>
                <button type="button" className="sub-item" onClick={() => go('about')}>정보·출처</button>
                <button type="button" className="sub-item" onClick={onQuit}>시작 화면</button>
              </section>
            </div>
          </div>
        )}

        {/* 판을 연 채 다른 선수를 누르면 내용만 바뀐다 (key 없음, U2-2) */}
        {player !== null && <PlayerDetail idx={player} onClose={() => setPlayer(null)} />}
      </div>
      </ShellProvider>
    </GameProvider>
  );
}
