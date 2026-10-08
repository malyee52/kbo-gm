// 일정·결과: 달력, 그날의 전체 경기, 박스스코어.
import { useMemo, useState } from 'react';
import type { BoxScore, BoxSide, GameLog } from '../../engine';
import { dateOf, formatDate, WEEKDAYS } from '../../game/calendar';
import { ipText } from '../../game/stats';
import { PlayerLink, TeamName, useGame } from '../context';

interface Cell {
  day: number;
  date: number;
  /** 이 날 우리 경기 (치렀으면 log 색인 포함) */
  game?: { home: number; away: number; logIdx?: number };
}

export function Schedule({ focusGame }: { focusGame?: number }) {
  const { session } = useGame();
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

  const pick = (c: Cell) => {
    setSelDay(c.day);
    setSelGame(c.game?.logIdx);
  };

  const dayGames = byDay.get(selDay) ?? [];
  const box = selGame !== undefined ? s.boxes.get(selGame) : undefined;

  return (
    <div className="stack">
      <h1>일정·결과</h1>
      <div className="seg" role="tablist" aria-label="월">
        {months.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === month} className={m === month ? 'on' : ''} onClick={() => setMonth(m)}>{m}월</button>
        ))}
      </div>
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

      <section>
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
          <div className="scroll">
            <table>
              <thead><tr><th className="l">원정</th><th>점수</th><th className="l">홈</th><th className="l">승리</th><th className="l">패전</th><th className="l">세이브</th><th /></tr></thead>
              <tbody>
                {dayGames.map((i) => {
                  const g = s.log[i];
                  const P = (x: number | null) => (x === null ? <span className="muted">-</span> : <PlayerLink p={session.world.players[x]} />);
                  return (
                    <tr key={i} className={g.home === me || g.away === me ? 'me' : ''}>
                      <td className="l"><TeamName idx={g.away} /></td>
                      <td>{g.awayRuns} : {g.homeRuns}{g.innings !== 9 ? <span className="muted small"> ({g.innings}회)</span> : null}</td>
                      <td className="l"><TeamName idx={g.home} /></td>
                      <td className="l">{P(g.win)}</td><td className="l">{P(g.loss)}</td><td className="l">{P(g.save)}</td>
                      <td>{s.boxes.has(i) ? <button type="button" className="link" onClick={() => setSelGame(i)}>박스스코어</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {box && selGame !== undefined && <BoxView log={s.log[selGame]} box={box} />}
    </div>
  );
}

function lastMyGame(log: GameLog[], me: number): number | undefined {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].home === me || log[i].away === me) return i;
  return undefined;
}

export function BoxView({ log, box }: { log: GameLog; box: BoxScore }) {
  const { session } = useGame();
  const n = Math.max(box.lineScore.away.length, 9);
  const cell = (v: number | undefined) => (v === undefined ? '' : v < 0 ? 'X' : String(v));
  const hits = (side: BoxSide) => side.batters.reduce((a, b) => a + b.h, 0);
  return (
    <section className="box">
      <h2>박스스코어 <span className="muted small">{formatDate(session.world.year, log.day)}</span></h2>
      <div className="scroll fit">
        <table className="linescore">
          <thead><tr><th className="l">팀</th>{Array.from({ length: n }, (_, i) => <th key={i}>{i + 1}</th>)}<th>R</th><th>H</th></tr></thead>
          <tbody>
            <tr><td className="l"><TeamName idx={log.away} /></td>{Array.from({ length: n }, (_, i) => <td key={i}>{cell(box.lineScore.away[i])}</td>)}<td><strong>{log.awayRuns}</strong></td><td>{hits(box.away)}</td></tr>
            <tr><td className="l"><TeamName idx={log.home} /></td>{Array.from({ length: n }, (_, i) => <td key={i}>{cell(box.lineScore.home[i])}</td>)}<td><strong>{log.homeRuns}</strong></td><td>{hits(box.home)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="two">
        {([['away', log.away], ['home', log.home]] as const).map(([k, t]) => (
          <div key={k}>
            <h3><TeamName idx={t} /></h3>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">타자</th><th>타수</th><th>득점</th><th>안타</th><th>타점</th><th>홈런</th><th>볼넷</th><th>삼진</th></tr></thead>
                <tbody>
                  {box[k].batters.map((b, i) => (
                    <tr key={b.idx}><td className="l"><span className="muted small">{i + 1}</span> <PlayerLink p={session.world.players[b.idx]} /></td>
                      <td>{b.ab}</td><td>{b.r}</td><td>{b.h}</td><td>{b.rbi}</td><td>{b.hr}</td><td>{b.bb}</td><td>{b.so}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">투수</th><th>이닝</th><th>타자</th><th>피안타</th><th>실점</th><th>자책</th><th>볼넷</th><th>삼진</th><th>피홈런</th></tr></thead>
                <tbody>
                  {box[k].pitchers.map((p) => {
                    const dec = p.idx === log.win ? '승' : p.idx === log.loss ? '패' : p.idx === log.save ? '세' : '';
                    return (
                      <tr key={p.idx}><td className="l"><PlayerLink p={session.world.players[p.idx]} />{dec && <span className="tag">{dec}</span>}</td>
                        <td>{ipText(p.outs)}</td><td>{p.bf}</td><td>{p.h}</td><td>{p.r}</td><td>{p.er}</td><td>{p.bb}</td><td>{p.so}</td><td>{p.hr}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
