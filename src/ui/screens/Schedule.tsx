// 일정·결과: 달력, 그날의 전체 경기, 박스스코어.
// 앞날은 그날 아침까지 알려진 일정(knownSchedule)만 보여 준다: 앞날의 우천 취소·경기 중 비는 모른다 (일정 개편 15단계)
import { useMemo, useState } from 'react';
import { isNoGame, type GameLog, type PlanCancel, type PlanGame } from '../../engine';
import { dateOf, formatDate, shortDate, WEEKDAYS } from '../../game/calendar';
import { PlayerLink, TeamLink, useGame } from '../context';
import { GameCast } from '../GameCast';
import { BoxView } from '../BoxScore';
import { useShell } from '../shell';
import type { CastGame } from '../../game/session';

interface CellGame extends PlanGame {
  /** 치렀으면 log 색인 */
  logIdx?: number;
}

interface Cell {
  day: number;
  date: number;
  /** 이 날 우리 경기 (더블헤더면 둘) */
  games: CellGame[];
  /** 이 날 우천 취소된 우리 경기 (경기 전 취소, 알려진 것만) */
  cancels: PlanCancel[];
}

export function Schedule({ focusGame }: { focusGame?: number }) {
  const { session } = useGame();
  const { density } = useShell();
  const s = session.season;
  const year = session.world.year;
  const me = session.teamIdx;
  const { cancels, remainingFrom, held } = s.plan;
  const ours = (g: { home: number; away: number }) => g.home === me || g.away === me;

  // 오늘 아침까지 알려진 일정 (시즌이 끝났으면 실제 일정 전체)
  const known = useMemo(() => s.knownSchedule(s.day), [s, s.day]);
  const days = known.days;

  // 날짜 색인 → 그날 경기 로그 색인들
  const byDay = useMemo(() => {
    const m = new Map<number, number[]>();
    s.log.forEach((g, i) => m.set(g.day, [...(m.get(g.day) ?? []), i]));
    return m;
  }, [s.log, s.log.length]); // 로그는 뒤에만 붙으므로 길이가 바뀔 때만 다시 만든다

  /** 그날 경기 전 우천 취소 (그날 아침에 알려진다) */
  const cancelsOn = (d: number) => (d <= s.day ? cancels.filter((c) => c[0] === d && !c[4]) : []);
  /** 그날 노게임이 된 경기 (치른 뒤에 알려진다). 노게임 점수는 저장하지 않으므로 일정(plan)으로만 본다 */
  const noGamesOn = (d: number) => (d < s.day ? (s.plan.days[d] ?? []).filter((g) => isNoGame(g.rainInning)) : []);
  /** 다시 치르는 날 (오늘 아침 기준, session.replayWhen과 같은 기준): 잔여 경기 발표 전의 잔여 경기면 "추후 편성" */
  const replayText = (c: PlanCancel) => {
    if (held.includes(cancels.indexOf(c)) && s.day < remainingFrom) return '추후 편성';
    const dh = days[c[3]]?.find((g) => g.home === c[1] && g.away === c[2] && g.dh === 1);
    return `${shortDate(year, c[3])}${dh ? ' 더블헤더 1차전' : ''}`;
  };
  /** 같은 날 같은 대진 취소가 둘이면 더블헤더 두 경기 함께 취소 (1차전이 먼저 적힌다): 몇 차전인지, 아니면 0 */
  const dhOf = (list: PlanCancel[], c: PlanCancel) => {
    const same = list.filter((x) => x[1] === c[1] && x[2] === c[2]);
    return same.length > 1 ? same.indexOf(c) + 1 : 0;
  };
  const nogameCancel = (d: number, g: PlanGame) => cancels.find((c) => c[4] && c[0] === d && c[1] === g.home && c[2] === g.away);

  const initialDay = focusGame !== undefined ? s.log[focusGame]?.day : Math.min(s.day, days.length - 1);
  const [selDay, setSelDay] = useState<number>(Math.max(0, initialDay ?? 0));
  const [selGame, setSelGame] = useState<number | undefined>(focusGame ?? lastMyGame(s.log, me));
  const months = useMemo(() => {
    const set = new Set<number>();
    for (let d = 0; d < days.length; d++) set.add(dateOf(year, d).month);
    return [...set];
  }, [days.length, year]);
  const [month, setMonth] = useState<number>(dateOf(year, selDay).month);

  const cells: (Cell | null)[] = [];
  for (let d = 0; d < days.length; d++) {
    const dt = dateOf(year, d);
    if (dt.month !== month) continue;
    if (cells.length === 0) for (let k = 0; k < dt.weekday; k++) cells.push(null);
    const logs = (byDay.get(d) ?? []).filter((i) => ours(s.log[i]));
    const games = days[d].filter(ours).map((g) => ({ ...g, logIdx: logs.find((i) => (s.log[i].dh ?? 0) === (g.dh ?? 0)) }));
    cells.push({ day: d, date: dt.date, games, cancels: cancelsOn(d).filter((c) => ours({ home: c[1], away: c[2] })) });
  }

  const [cast, setCast] = useState<CastGame | null>(null);
  const pick = (c: Cell) => {
    setSelDay(c.day);
    setSelGame(c.games.find((g) => g.logIdx !== undefined)?.logIdx);
  };

  const dayGames = byDay.get(selDay) ?? [];
  const box = selGame !== undefined ? s.boxes.get(selGame) : undefined;
  const opp = (g: { home: number; away: number }) => `${g.home === me ? 'vs' : '@'} ${session.world.teams[g.home === me ? g.away : g.home].name}`;
  const pending = known.pending.filter(ours);
  const dayCancels = cancelsOn(selDay);
  const dayNoGames = noGamesOn(selDay);
  const upcoming = selDay >= s.day ? days[selDay] ?? [] : [];
  const announced = remainingFrom >= 0 && remainingFrom <= s.day;

  return (
    <div className="stack">
      {pending.length > 0 && (
        <p className="note small">
          날짜 미정(추후 편성) 우리 경기 {pending.length}경기: {pending.map(opp).join(', ')}. 잔여 경기 일정 발표 때 날짜가 정해집니다.
        </p>
      )}
      {announced && <p className="muted small">잔여 경기 일정 발표: {formatDate(year, remainingFrom)}</p>}
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
          let last: string | null = null;
          const lines = c.games.map((g) => {
            const played = g.logIdx !== undefined ? s.log[g.logIdx] : undefined;
            let res: string | null = null;
            if (played) {
              const mine = played.home === me ? played.homeRuns : played.awayRuns;
              const theirs = played.home === me ? played.awayRuns : played.homeRuns;
              res = `${mine > theirs ? '승' : mine < theirs ? '패' : '무'} ${mine}:${theirs}`;
              last = res;
            }
            const nogame = c.day < s.day && isNoGame(g.rainInning);
            return (
              <span key={g.dh ?? 0} className="cal-line">
                <span className="cal-opp">{opp(g)}{g.dh ? <span className="muted"> {g.dh}차</span> : null}</span>
                {res && <span className={`res res-${res[0]}`}>{res}</span>}
                {played?.rain === 'cold' && <span className="tag rain">콜드</span>}
                {nogame && <span className="tag rain">노게임</span>}
              </span>
            );
          });
          const res = last as string | null;
          const rainOut = c.cancels.length > 0;
          return (
            <button key={c.day} type="button" role="gridcell"
              className={`cal-cell${c.day === selDay ? ' on' : ''}${c.day === s.day && !session.done ? ' today' : ''}${!c.games.length && !rainOut ? ' off' : ''}${res ? ` r-${res[0]}` : ''}`}
              onClick={() => pick(c)} aria-label={formatDate(year, c.day)}>
              <span className="cal-date">{c.date}</span>
              {lines}
              {c.cancels.map((x, i) => (
                <span key={`c${i}`} className="cal-line">
                  <span className="cal-opp"><span className="cancel">{opp({ home: x[1], away: x[2] })}</span>{dhOf(c.cancels, x) ? <span className="muted"> {dhOf(c.cancels, x)}차</span> : null}</span>
                  <span className="tag rain">우천 취소</span>
                </span>
              ))}
              {!c.games.length && !rainOut && <span className="muted small">{days[c.day].length ? '' : '휴식'}</span>}
              {announced && c.day === remainingFrom && <span className="tag">잔여 발표</span>}
            </button>
          );
        })}
      </div>

      <section className="card sched-day">
        <h2>{formatDate(year, selDay)} 경기</h2>
        {announced && selDay === remainingFrom && <p className="muted small">잔여 경기 일정이 발표된 날입니다.</p>}
        {!days[selDay]?.length && !dayCancels.length && <p className="muted">경기가 없는 날입니다.</p>}
        {upcoming.length > 0 && (
          <ul className="plain">
            {upcoming.map((g, k) => (
              <li key={k}><TeamLink idx={g.away} /> @ <TeamLink idx={g.home} /> <span className="muted small">{g.dh ? `더블헤더 ${g.dh}차전 ` : ''}예정</span></li>
            ))}
          </ul>
        )}
        {dayCancels.length > 0 && (
          <ul className="plain">
            {dayCancels.map((c, k) => (
              <li key={k}>
                <TeamLink idx={c[2]} /> @ <TeamLink idx={c[1]} /> {dhOf(dayCancels, c) ? <span className="muted small">더블헤더 {dhOf(dayCancels, c)}차전 </span> : null}<span className="tag rain">우천 취소</span> <span className="muted small">→ {replayText(c)}</span>
              </li>
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
                    <TeamLink idx={g.away} /> <strong>{g.awayRuns} : {g.homeRuns}</strong> <TeamLink idx={g.home} />
                    {g.dh && <span className="muted small">{g.dh}차전</span>}
                    {g.rain === 'cold'
                      ? <span className="tag rain">{g.innings}회 강우 콜드</span>
                      : g.innings !== 9 && <span className="muted small"> ({g.innings}회)</span>}
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
        {dayNoGames.length > 0 && (
          <ul className="plain">
            {dayNoGames.map((g, k) => {
              const c = nogameCancel(selDay, g);
              return (
                <li key={k}>
                  <TeamLink idx={g.away} /> @ <TeamLink idx={g.home} />{g.dh ? <span className="muted small"> {g.dh}차전</span> : null} <span className="tag rain">{g.rainInning}회 노게임</span>
                  <span className="muted small"> 기록 없음{c ? ` → ${replayText(c)}` : ''}</span>
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
