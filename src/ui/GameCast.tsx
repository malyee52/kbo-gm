// 경기 결과 창 (2026-10-23 UI 2단계 U2-3, 기획안 2.2.1): 머리(날짜·시각·구장·차전) + 라인스코어(R·H·E·B) + 승·패·세 투수(이닝·투구 수),
// 탭 셋: 요점(하이라이트·오늘의 선수·다음 선발) / 박스스코어 / 문자 중계.
// 문자 중계 탭은 예전 중계 화면 (2026-10-12 사용자 요청 "애니메이션"): 엔진이 남긴 중계 기록을 한 장면씩 보여 준다.
// "다음 경기는 중계로 보기"로 열면(live) 문자 중계 탭에서 처음부터 흘러가고, 그동안 라인스코어는 그 장면까지만 보인다.
// 다른 탭을 누르면 중계를 끝까지 넘긴다 (결과가 보이는 탭이라). 일정·결과 등에서 다시 열면 요점 탭에서 결과부터 보인다.
// 경기는 이미 끝난 결과를 다시 보여 주는 것이라 게임 결과에 영향이 없다.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameLog, Play } from '../engine';
import { formatDate, gameTime, shortDate } from '../game/calendar';
import { highlights, inningLabel, lineScoreUpTo, playText } from '../game/highlights';
import { lastOutings, meetingNumber, outingText, pitchSummary, playerOfGame } from '../game/boxscore';
import type { CastGame } from '../game/session';
import { stadiumName } from '../league/naming';
import { PlayerLink, TeamName, useGame } from './context';
import { BoxTables, LineScore } from './BoxScore';
import { useShell } from './shell';
import { teamVars } from './teams';
import { gameStory, storyOf } from '../fantasy/gameday';
import { loadAiSettings } from '../fantasy/settings';

const SPEEDS = [{ label: '느리게', ms: 1300 }, { label: '보통', ms: 650 }, { label: '빠르게', ms: 220 }];
const SPEED_KEY = 'kbo-gm.cast-speed';

function loadSpeed(): number {
  try {
    const raw = localStorage.getItem(SPEED_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isInteger(v) && v >= 0 && v < SPEEDS.length ? v : 1;
  } catch {
    return 1;
  }
}

/** 움직임을 줄이라는 설정이면 처음부터 끝 장면 */
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Diamond({ play }: { play: Play | undefined }) {
  const on = (i: number) => (play ? play.bases[i] >= 0 && play.outs < 3 : false);
  const base = (x: number, y: number, i: number) => (
    <rect x={x - 9} y={y - 9} width={18} height={18} transform={`rotate(45 ${x} ${y})`} className={`base${on(i) ? ' on' : ''}`} />
  );
  return (
    <svg viewBox="0 0 120 110" className="diamond" role="img" aria-label={`주자 ${[0, 1, 2].filter(on).map((i) => `${i + 1}루`).join('·') || '없음'}`}>
      <path d="M60 96 L100 56 L60 16 L20 56 Z" className="infield" />
      {base(100, 56, 0)}{base(60, 16, 1)}{base(20, 56, 2)}
      <rect x={53} y={89} width={14} height={14} className="base home" />
    </svg>
  );
}

/** 판타지·자유 모드: AI 중계석 후일담 (src/fantasy/gameday.ts). 경기마다 한 편, 이야기 기록에 남는다 */
function GameStory({ game, moments }: { game: CastGame; moments: string[] }) {
  const { session, changed, autosave } = useGame();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const story = storyOf(session, game.key);
  const write = async () => {
    setBusy(true);
    setErr(null);
    try {
      session.addFantasy(await gameStory(session, loadAiSettings(), game, moments));
      changed();
      void autosave();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cast-story">
      <h3>중계석 후일담 <span className="muted small">AI</span></h3>
      {story ? (
        <>
          <p><strong>{story.title}</strong></p>
          {story.text.split('\n').filter(Boolean).map((line, k) => <p key={k}>{line}</p>)}
        </>
      ) : <button type="button" className="ghost" onClick={() => void write()} disabled={busy}>{busy ? '쓰는 중…' : '후일담 쓰기'}</button>}
      {err && <p className="note error-box">{err}</p>}
    </section>
  );
}

type Tab = 'sum' | 'box' | 'cast';
const TAB_LABEL: Record<Tab, string> = { sum: '요점', box: '박스스코어', cast: '문자 중계' };

/** live: 경기 진행 직후 "중계로 보기" (문자 중계 탭에서 처음부터 흘러간다) */
export function GameCast({ game, onClose, live = false }: { game: CastGame; onClose: () => void; live?: boolean }) {
  const { session } = useGame();
  const { density } = useShell();
  const full = density === 'full';
  const ref = useRef<HTMLDialogElement>(null);
  const plays = useMemo(() => game.plays ?? [], [game]);
  const startLive = live && plays.length > 0 && !reducedMotion();
  const [tab, setTabState] = useState<Tab>(startLive ? 'cast' : 'sum');
  const [step, setStep] = useState(() => (startLive ? 0 : plays.length));
  const [speed, setSpeedState] = useState(loadSpeed);
  const [paused, setPaused] = useState(false);
  const setSpeed = (v: number) => { setSpeedState(v); try { localStorage.setItem(SPEED_KEY, String(v)); } catch { /* 저장 막힘 */ } };
  const done = step >= plays.length;
  // 결과가 보이는 탭으로 가면 중계를 끝까지 넘긴다
  const setTab = (t: Tab) => { setTabState(t); if (t !== 'cast') setStep(plays.length); };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    if (done || paused) return;
    const id = window.setTimeout(() => setStep((s) => s + 1), SPEEDS[speed].ms);
    return () => window.clearTimeout(id);
  }, [step, speed, paused, done]);

  const world = session.world;
  const name = (idx: number) => world.players[idx]?.name ?? '?';
  const teamName = (t: number) => session.teamInfo(t).name;
  const cur = plays[step - 1];
  const me = session.teamIdx;
  const feed = plays.slice(0, step).map((p, i) => ({ p, i })).reverse();
  const moments = done && plays.length ? highlights(plays, name, game.home === me ? 'home' : 'away') : [];
  const close = () => { ref.current?.close(); onClose(); };
  const result = game.homeRuns === game.awayRuns ? '무승부' : (game.homeRuns > game.awayRuns) === (game.home === me) ? '승리' : '패배';
  // 정규시즌 경기는 로그에서 승·패·세 투수와 차전. 가을야구는 시리즈 이름
  const log: GameLog | undefined = game.logIdx !== undefined && game.year === world.year ? session.season.log[game.logIdx] : undefined;
  const meet = log ? meetingNumber(session.season.log, game.logIdx!) : null;
  const park = stadiumName(session.league, game.home, game.year);
  const decisionLog = log ?? { ...game, win: null, loss: null, save: null };
  const tabs: Tab[] = plays.length ? ['sum', 'box', 'cast'] : ['sum', 'box'];

  return (
    <dialog ref={ref} className="player cast tv" onClose={onClose} style={teamVars(session.team.franchise, session.team.name)} aria-labelledby="game-title">
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2 id="game-title">{teamName(game.away)} <span className="muted">@</span> {teamName(game.home)}</h2>
            <p className="muted small">
              {game.label ? `${game.label} · ` : ''}{formatDate(game.year, game.day)}{!game.label && ` ${gameTime(game.year, game.day)}`}
              {park && ` · ${park}`}{meet !== null && ` · ${meet}차전`}
            </p>
          </div>
          <button type="button" className="ghost" onClick={close}>닫기</button>
        </header>

        <LineScore log={game} box={done ? game.box : undefined}
          ls={done ? (game.box ? undefined : lineScoreUpTo(plays, plays.length)) : lineScoreUpTo(plays, step)}
          runs={done ? undefined : { away: cur?.away ?? 0, home: cur?.home ?? 0 }} now={!done ? cur?.inn : undefined} />
        {done && <Decisions game={game} log={log} />}

        <div className="seg small game-tabs" role="tablist" aria-label="경기 결과">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === 'sum' && (
            <>
              <p className={`cast-result ${result === '승리' ? 'up' : result === '패배' ? 'down' : ''}`}><strong>{game.home === me || game.away === me ? result : '경기 끝'}</strong></p>
              {moments.length > 0 && (
                <section>
                  <h3>결정적 장면</h3>
                  <ul className="plain small">{moments.map((m, k) => <li key={k} className={`moment tag-${m.tag}`}>{m.text}</li>)}</ul>
                </section>
              )}
              {game.box && <PlayerOfGameLine log={decisionLog} game={game} />}
              <NextUp game={game} />
              {!game.box && !plays.length && <p className="muted small">이 경기의 박스스코어와 중계 기록이 없습니다 (불러온 게임의 지난 경기이거나 오래된 경기입니다).</p>}
              {session.fantasy && plays.length > 0 && <GameStory game={game} moments={moments.map((m) => m.text)} />}
            </>
          )}

          {tab === 'box' && (game.box
            ? <BoxTables log={decisionLog} box={game.box} full={full} />
            : <p className="muted small">이 경기의 박스스코어가 없습니다.</p>)}

          {tab === 'cast' && (
            <>
              <div className="cast-field">
                <Diamond play={cur} />
                <div className="cast-now">
                  {cur ? (
                    <>
                      <p className="muted small">{inningLabel(cur)} · {Math.min(3, cur.outs)}아웃</p>
                      <p className="outs" aria-hidden>{[0, 1, 2].map((i) => <i key={i} className={i < cur.outs ? 'on' : ''} />)}</p>
                      <p key={step} className={`cast-line pop kind-${cur.kind}`}>{playText(cur, name)}</p>
                      {cur.kind !== 'PC' && cur.kind !== 'WP' && <p className="muted small">투수 {name(cur.pit)}</p>}
                    </>
                  ) : <p className="muted">경기 시작</p>}
                  {done && <p className={`cast-result ${result === '승리' ? 'up' : result === '패배' ? 'down' : ''}`}><strong>경기 끝 · {result}</strong></p>}
                </div>
              </div>

              <div className="actions cast-controls">
                {!done && <button type="button" className="ghost" onClick={() => setPaused((x) => !x)}>{paused ? '이어 보기' : '멈춤'}</button>}
                <span className="seg" role="group" aria-label="중계 속도">
                  {SPEEDS.map((s, i) => <button key={s.label} type="button" className={speed === i ? 'on' : ''} aria-pressed={speed === i} onClick={() => setSpeed(i)}>{s.label}</button>)}
                </span>
                {!done && <button type="button" onClick={() => setStep(plays.length)}>결과 바로 보기</button>}
                {done && <button type="button" className="ghost" onClick={() => { setStep(0); setPaused(false); }}>처음부터</button>}
              </div>

              <ol className="cast-feed small" reversed aria-label="문자 중계">
                {feed.map(({ p, i }) => (
                  <li key={i} className={`${p.runs > 0 ? 'scored' : ''} kind-${p.kind}`}>
                    <span className="muted">{inningLabel(p)}</span> {playText(p, name)}{p.runs > 0 && <span className="muted"> · {p.away}:{p.home}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** 승·패·세 투수 (이닝·투구 수·실점). 가을야구는 로그가 없어 보이지 않는다 */
function Decisions({ game, log }: { game: CastGame; log: GameLog | undefined }) {
  const { session } = useGame();
  if (!log || !game.box) return null;
  const all = [...game.box.away.pitchers, ...game.box.home.pitchers];
  const item = (label: string, idx: number | null) => {
    if (idx === null) return null;
    const p = all.find((x) => x.idx === idx);
    return <span key={label}>{label} <PlayerLink p={session.world.players[idx]} />{p && <span className="muted"> ({pitchSummary(p)})</span>}</span>;
  };
  const list = [item('승', log.win), item('패', log.loss), item('세', log.save)].filter(Boolean);
  if (!list.length) return null;
  return <p className="small decisions">{list}</p>;
}

/** 오늘의 선수: 이긴 팀에서 경기 기여가 가장 큰 선수 (game/boxscore.ts playerOfGame, 임시값) */
function PlayerOfGameLine({ log, game }: { log: Pick<GameLog, 'home' | 'away' | 'homeRuns' | 'awayRuns' | 'win' | 'save'>; game: CastGame }) {
  const { session } = useGame();
  const pog = playerOfGame(log, game.box!);
  if (!pog) return null;
  return (
    <section>
      <h3>오늘의 선수</h3>
      <p className="small"><PlayerLink p={session.world.players[pog.idx]} /> <span className="muted">(<TeamName idx={pog.team} />)</span> {pog.line}</p>
    </section>
  );
}

/** 우리 선수의 다음 일: 이 경기가 우리 마지막 경기이고 시즌이 남았으면 다음 경기와 선발 예정 (지난 등판 투구 수·휴식) */
function NextUp({ game }: { game: CastGame }) {
  const { session } = useGame();
  const me = session.teamIdx;
  if (session.phase !== 'season' || session.done || game.label || game.year !== session.world.year) return null;
  const s = session.season;
  let last = s.log.length - 1;
  while (last >= 0 && s.log[last].home !== me && s.log[last].away !== me) last--;
  if (last !== game.logIdx) return null;
  const next = session.nextGame();
  if (!next) return null;
  const sp = session.probableStarter(me);
  const o = sp ? lastOutings(s, me, next.day).get(sp.idx) : undefined;
  const home = next.home === me;
  return (
    <section>
      <h3>다음 경기</h3>
      <p className="small">
        {shortDate(session.world.year, next.day)} {home ? 'vs' : '@'} {session.teamInfo(home ? next.away : next.home).name}
        {sp && <> · 선발 예정 <PlayerLink p={sp} />{o && <span className="muted"> (지난 등판 {outingText(o, session.world.year)})</span>}</>}
      </p>
    </section>
  );
}
