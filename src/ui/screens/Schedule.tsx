// 일정·결과: 달력, 그날의 전체 경기, 박스스코어.
import { useMemo, useState } from 'react';
import type { GameLog } from '../../engine';
import { dateOf, formatDate, WEEKDAYS } from '../../game/calendar';
import { PlayerLink, TeamName, useGame } from '../context';
import { GameCast } from '../GameCast';
import { BoxView } from '../BoxScore';
import { useShell } from '../shell';
import type { CastGame } from '../../game/session';

interface Cell {
  day: number;
  date: number;
  /** 이 날 우리 경기 (치렀으면 log 색인 포함) */
  game?: { home: number; away: number; logIdx?: number };
}

export function Schedule({ focusGame }: { focusGame?: number }) {
  const { session } = useGame();
  const { density } = useShell();
  const s = session.season;
  const year = session.world.year;
  const me = session.teamIdx;

  // 날짜 색인 → 그날 경기 로그 색인들
  const byDay = useMemo(() => {
    const m = new Map<number, number[]>();
    s.log.forEach((g, i) => m.set(g.day, [...(m.get(g.day) ?? []), i]));
    return m;
  }, [s.log, s.log.length]); // 로그는 뒤에만 붙으므로 길이가 바뀔 때만 다시 만든다

  const initialDay = focusGame !== undefined ? s.log[focusGame]?.day : Math.min(s.day, s.schedule.length - 1);
  const [selDay, setSelDay] = useState<number>(Math.max(0, initialDay ?? 0));
  const [selGame, setSelGame] = useState<number | undefined>(focusGame ?? lastMyGame(s.log, me));
  const months = useMemo(() => {
    const set = new Set<number>();
    for (let d = 0; d < s.schedule.length; d++) set.add(dateOf(year, d).month);
    return [...set];
  }, [s.schedule.length, year]);
  const [month, setMonth] = useState<number>(dateOf(year, selDay).month);

  const cells: (Cell | null)[] = [];
  for (let d = 0; d < s.schedule.length; d++) {
    const dt = dateOf(year, d);
    if (dt.month !== month) continue;
    if (cells.length === 0) for (let k = 0; k < dt.weekday; k++) cells.push(null);
    const g = s.schedule[d].find((x) => x.home === me || x.away === me);
    const logIdx = (byDay.get(d) ?? []).find((i) => s.log[i].home === me || s.log[i].away === me);
    cells.push({ day: d, date: dt.date, game: g ? { ...g, logIdx } : undefined });
  }

  const [cast, setCast] = useState<CastGame | null>(null);
  const pick = (c: Cell) => {
    setSelDay(c.day);
    setSelGame(c.game?.logIdx);
  };

  const dayGames = byDay.get(selDay) ?? [];
  const box = selGame !== undefined ? s.boxes.get(selGame) : undefined;

  return (
    <div className="stack">
      <div className="seg" role="tablist" aria-label="월">
        {months.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === month} className={m === month ? 'on' : ''} onClick={() => setMonth(m)}>{m}월</button>
        ))}
      </div>
      <div className="sched-split">
      <div className="calendar" role="grid" aria-label={`${month}월 일정`}>
        {WEEKDAYS.map((w) => <div key={w} className="cal-head" role="columnheader">{w}</div>)}
        {cells.map((c, k) => {
          if (!c) return <div key={`e${k}`} className="cal-cell empty" />;
          const g = c.game;
          const played = g?.logIdx !== undefined ? s.log[g.logIdx] : undefined;
          let res: string | null = null;
          if (played) {
            const mine = played.home === me ? played.homeRuns : played.awayRuns;
            const theirs = played.home === me ? played.awayRuns : played.homeRuns;
            res = `${mine > theirs ? '승' : mine < theirs ? '패' : '무'} ${mine}:${theirs}`;
          }
          return (
            <button key={c.day} type="button" role="gridcell"
              className={`cal-cell${c.day === selDay ? ' on' : ''}${c.day === s.day && !session.done ? ' today' : ''}${!g ? ' off' : ''}${res ? ` r-${res[0]}` : ''}`}
              onClick={() => pick(c)} aria-label={formatDate(year, c.day)}>
              <span className="cal-date">{c.date}</span>
              {g ? (
                <>
                  <span className="cal-opp">{g.home === me ? 'vs' : '@'} {session.world.teams[g.home === me ? g.away : g.home].name}</span>
                  {res && <span className={`res res-${res[0]}`}>{res}</span>}
                </>
              ) : (
                <span className="muted small">{s.schedule[c.day].length ? '' : '휴식'}</span>
              )}
            </button>
          );
        })}
      </div>

      <section className="card sched-day">
        <h2>{formatDate(year, selDay)} 경기</h2>
        {s.schedule[selDay]?.length === 0 && <p className="muted">경기가 없는 날입니다.</p>}
        {dayGames.length === 0 && s.schedule[selDay]?.length > 0 && (
          <ul className="plain">
            {s.schedule[selDay].map((g, k) => (
              <li key={k}><TeamName idx={g.away} /> @ <TeamName idx={g.home} /> <span className="muted small">예정</span></li>
            ))}
          </ul>
        )}
        {dayGames.length > 0 && (
          <ul className="day-games">
            {dayGames.map((i) => {
              const g = s.log[i];
              const P = (x: number | null) => (x === null ? null : <PlayerLink p={session.world.players[x]} />);
              const w = P(g.win);
              const l = P(g.loss);
              const sv = P(g.save);
              return (
                <li key={i} className={g.home === me || g.away === me ? 'me' : ''}>
                  <div className="dg-score">
                    <TeamName idx={g.away} /> <strong>{g.awayRuns} : {g.homeRuns}</strong> <TeamName idx={g.home} />
                    {g.innings !== 9 && <span className="muted small"> ({g.innings}회)</span>}
                    <span className="dg-links">
                      {s.boxes.has(i) && <button type="button" className="link small" onClick={() => setSelGame(i)}>박스</button>}
                      {(s.boxes.has(i) || s.plays.has(i)) && (g.home === me || g.away === me) && (
                        <button type="button" className="link small" onClick={() => setCast(session.ourGames().find((x) => x.key === `${year}-${i}`) ?? null)}>경기 결과</button>
                      )}
                    </span>
                  </div>
                  <div className="small muted">{w && <>승 {w}</>}{l && <> · 패 {l}</>}{sv && <> · 세 {sv}</>}</div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      </div>

      {box && selGame !== undefined && <BoxView log={s.log[selGame]} box={box} full={density === 'full'} />}
      {cast && <GameCast key={cast.key} game={cast} onClose={() => setCast(null)} />}
    </div>
  );
}

function lastMyGame(log: GameLog[], me: number): number | undefined {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].home === me || log[i].away === me) return i;
  return undefined;
}
