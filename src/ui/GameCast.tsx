// 경기 중계 화면 (2026-10-12 사용자 요청 "애니메이션"): 엔진이 남긴 중계 기록을 한 장면씩 보여 준다.
// 스코어보드는 이닝마다 채워지고, 다이아몬드에 주자·아웃, 아래에 문자 중계. 속도 조절·건너뛰기.
// 경기는 이미 끝난 결과를 다시 보여 주는 것이라 게임 결과에 영향이 없다.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Play } from '../engine';
import { formatDate } from '../game/calendar';
import { highlights, inningLabel, lineScoreUpTo, playText } from '../game/highlights';
import type { CastGame } from '../game/session';
import { useGame } from './context';
import { teamVars } from './teams';

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

export function GameCast({ game, onClose }: { game: CastGame; onClose: () => void }) {
  const { session } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const plays = useMemo(() => game.plays ?? [], [game]);
  const [step, setStep] = useState(() => (reducedMotion() ? plays.length : 0));
  const [speed, setSpeedState] = useState(loadSpeed);
  const [paused, setPaused] = useState(false);
  const setSpeed = (v: number) => { setSpeedState(v); try { localStorage.setItem(SPEED_KEY, String(v)); } catch { /* 저장 막힘 */ } };
  const done = step >= plays.length;

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
  const ls = done ? (game.box?.lineScore ?? lineScoreUpTo(plays, step)) : lineScoreUpTo(plays, step);
  const innings = Math.max(9, ls.away.length, ls.home.length);
  const awayRuns = done ? game.awayRuns : cur?.away ?? 0;
  const homeRuns = done ? game.homeRuns : cur?.home ?? 0;
  const me = session.teamIdx;
  const feed = plays.slice(0, step).map((p, i) => ({ p, i })).reverse();
  const moments = done ? highlights(plays, name, game.home === me ? 'home' : 'away') : [];
  const close = () => { ref.current?.close(); onClose(); };
  const result = game.homeRuns === game.awayRuns ? '무승부' : (game.homeRuns > game.awayRuns) === (game.home === me) ? '승리' : '패배';

  return (
    <dialog ref={ref} className="player cast tv" onClose={onClose} style={teamVars(session.team.franchise, session.team.name)}>
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2>{teamName(game.away)} <span className="muted">@</span> {teamName(game.home)}</h2>
            <p className="muted small">{game.label ? `${game.label} · ` : ''}{formatDate(game.year, game.day)}</p>
          </div>
          <button type="button" className="ghost" onClick={close}>닫기</button>
        </header>

        {plays.length === 0 ? <p className="muted">이 경기의 중계 기록이 없습니다 (불러온 게임의 지난 경기이거나 오래된 경기입니다).</p> : (
          <>
            <div className="scroll">
              <table className="linescore cast-score">
                <thead><tr><th className="l">팀</th>{Array.from({ length: innings }, (_, i) => <th key={i} className={cur && !done && cur.inn === i + 1 ? 'now' : ''}>{i + 1}</th>)}<th>R</th></tr></thead>
                <tbody>
                  {(['away', 'home'] as const).map((side) => {
                    const arr = ls[side];
                    const t = side === 'away' ? game.away : game.home;
                    return (
                      <tr key={side} className={t === me ? 'me' : ''}>
                        <td className="l">{teamName(t)}</td>
                        {Array.from({ length: innings }, (_, i) => <td key={i} className={arr[i] > 0 ? 'scored' : ''}>{arr[i] === undefined ? '' : arr[i] < 0 ? 'X' : arr[i]}</td>)}
                        <td><strong key={side === 'away' ? awayRuns : homeRuns} className="pop">{side === 'away' ? awayRuns : homeRuns}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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

            {moments.length > 0 && (
              <section>
                <h3>하이라이트</h3>
                <ul className="plain small">{moments.map((m, k) => <li key={k} className={`moment tag-${m.tag}`}>{m.text}</li>)}</ul>
              </section>
            )}

            <section>
              <h3>문자 중계</h3>
              <ol className="cast-feed small" reversed>
                {feed.map(({ p, i }) => (
                  <li key={i} className={`${p.runs > 0 ? 'scored' : ''} kind-${p.kind}`}>
                    <span className="muted">{inningLabel(p)}</span> {playText(p, name)}{p.runs > 0 && <span className="muted"> · {p.away}:{p.home}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </dialog>
  );
}
