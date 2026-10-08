// 홈: 우리 구단 요약, 다음 경기, 최근 결과, 알림, 순위 요약.
import { formatDate, shortDate } from '../../game/calendar';
import { fixed2, gamesBehind, rate3, recentForm } from '../../game/stats';
import { winPct } from '../../engine';
import { PlayerLink, TeamName, useGame } from '../context';

export function Home() {
  const { session, go } = useGame();
  const s = session.season;
  const me = session.teamIdx;
  const year = session.world.year;
  const rec = s.teams[me];
  const order = s.standings();
  const rank = order.indexOf(me) + 1;
  const leader = s.teams[order[0]];
  const form = recentForm(s.log, me);
  const next = session.nextGame();
  const myGames = s.log.map((g, i) => ({ g, i })).filter(({ g }) => g.home === me || g.away === me);
  const recent = myGames.slice(-5).reverse();
  const news = [...session.news].reverse().slice(0, 14);
  const cut = session.world.rules.postseasonTeams;

  return (
    <div className="stack">
      {session.done && (
        <div className="note row-between">
          <span>정규시즌이 끝났습니다. 최종 {rank}위.</span>
          <button type="button" onClick={() => go('season-end')}>시즌 결과 보기</button>
        </div>
      )}
      <section className="cards">
        <div className="card">
          <h2>우리 구단</h2>
          <p className="big">{rec.g === 0 ? '개막 전' : <>{rank}위 <span className="muted">/ {s.teams.length}</span></>}</p>
          <p>{rec.w}승 {rec.l}패 {rec.t}무 · 승률 {rate3(winPct(rec))} · {rank === 1 ? '선두' : `선두와 ${gamesBehind(leader, rec)}경기 차`}</p>
          <p className="muted small">
            최근 10경기 {form.w}승 {form.l}패{form.t ? ` ${form.t}무` : ''}{form.streak && ` · ${form.streak}`} · 득점 {rec.rs} 실점 {rec.ra}
          </p>
          <p className="muted small">포스트시즌 진출권: 상위 {cut}팀</p>
        </div>
        <div className="card">
          <h2>다음 경기</h2>
          {next ? <NextGame next={next} /> : <p className="muted">남은 경기가 없습니다.</p>}
        </div>
      </section>

      <section className="two">
        <div>
          <h2>최근 결과</h2>
          {recent.length === 0 ? (
            <p className="muted">아직 치른 경기가 없습니다. 위의 진행 버튼으로 시즌을 시작하세요.</p>
          ) : (
            <div className="scroll">
              <table>
                <tbody>
                  {recent.map(({ g, i }) => {
                    const home = g.home === me;
                    const mine = home ? g.homeRuns : g.awayRuns;
                    const theirs = home ? g.awayRuns : g.homeRuns;
                    const r = mine > theirs ? '승' : mine < theirs ? '패' : '무';
                    return (
                      <tr key={i}>
                        <td className="l muted">{shortDate(year, g.day)}</td>
                        <td className="l">{home ? 'vs' : '@'} <TeamName idx={home ? g.away : g.home} /></td>
                        <td><span className={`res res-${r}`}>{r}</span> {mine}:{theirs}{g.innings > 9 ? ` (${g.innings}회)` : ''}</td>
                        <td><button type="button" className="link" onClick={() => go('schedule', i)}>박스스코어</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <h2>순위 요약</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>순위</th><th className="l">팀</th><th>승</th><th>패</th><th>무</th><th>게임차</th></tr></thead>
              <tbody>
                {order.map((t, k) => (
                  <tr key={t} className={`${t === me ? 'me' : ''}${k === cut - 1 ? ' cutline' : ''}`}>
                    <td>{k + 1}</td><td className="l"><TeamName idx={t} /></td>
                    <td>{s.teams[t].w}</td><td>{s.teams[t].l}</td><td>{s.teams[t].t}</td>
                    <td>{k === 0 ? '-' : gamesBehind(leader, s.teams[t]).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2>알림</h2>
        {news.length === 0 ? <p className="muted">알림이 없습니다.</p> : (
          <ul className="news">
            {news.map((n, k) => (
              <li key={k} className={`news-${n.kind}`}>
                <span className="muted small">{formatDate(year, n.day)}</span>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NextGame({ next }: { next: { day: number; home: number; away: number } }) {
  const { session } = useGame();
  const me = session.teamIdx;
  const home = next.home === me;
  const opp = home ? next.away : next.home;
  const mySp = session.probableStarter(me);
  const oppSp = session.probableStarter(opp);
  const line = (idx: number | undefined) => {
    if (idx === undefined) return '';
    const p = session.season.pit[idx];
    return p.g ? `${p.w}승 ${p.l}패 평균자책 ${fixed2((p.er * 27) / Math.max(1, p.outs))}` : '시즌 첫 등판';
  };
  return (
    <>
      <p className="big">{home ? 'vs' : '@'} <TeamName idx={opp} /></p>
      <p>{formatDate(session.world.year, next.day)} · {home ? '홈' : '원정'}</p>
      <p className="muted small">
        예상 선발: {mySp ? <PlayerLink p={mySp} /> : '-'} <span>({line(mySp?.idx)})</span>
        {' '}대 {oppSp ? <PlayerLink p={oppSp} /> : '-'} <span>({line(oppSp?.idx)})</span>
      </p>
    </>
  );
}
