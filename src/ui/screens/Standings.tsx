// 순위표: 승·패·무, 승률, 게임차, 득실, 홈·원정, 최근 10경기, 연속 기록.
import { winPct } from '../../engine';
import { gamesBehind, rate3, recentForm } from '../../game/stats';
import { TeamName, useGame } from '../context';

export function Standings() {
  const { session } = useGame();
  const s = session.season;
  const order = s.standings();
  const leader = s.teams[order[0]];
  const cut = session.world.rules.postseasonTeams;

  return (
    <div className="stack">
      <h1>순위</h1>
      <p className="muted small">승률(무승부 제외) 순. 점선 위가 포스트시즌 진출권(상위 {cut}팀)입니다. 정규시즌이 끝나면 가을야구를 치릅니다.</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>순위</th><th className="l">팀</th><th>경기</th><th>승</th><th>패</th><th>무</th><th>승률</th><th>게임차</th>
              <th>득점</th><th>실점</th><th>득실차</th><th>홈</th><th>원정</th><th>최근 10</th><th>연속</th>
            </tr>
          </thead>
          <tbody>
            {order.map((i, k) => {
              const t = s.teams[i];
              const f = recentForm(s.log, i);
              const away = { w: t.w - t.homeW, l: t.l - t.homeL, t: t.t - t.homeT };
              return (
                <tr key={i} className={`${i === session.teamIdx ? 'me' : ''}${k === cut - 1 ? ' cutline' : ''}`}>
                  <td>{k + 1}</td><td className="l"><TeamName idx={i} /></td>
                  <td>{t.g}</td><td>{t.w}</td><td>{t.l}</td><td>{t.t}</td><td>{rate3(winPct(t))}</td>
                  <td>{k === 0 ? '-' : gamesBehind(leader, t).toFixed(1)}</td>
                  <td>{t.rs}</td><td>{t.ra}</td><td>{t.rs - t.ra > 0 ? `+${t.rs - t.ra}` : t.rs - t.ra}</td>
                  <td>{t.homeW}-{t.homeT}-{t.homeL}</td><td>{away.w}-{away.t}-{away.l}</td>
                  <td>{f.w}-{f.t}-{f.l}</td><td>{f.streak || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">홈·원정·최근 10경기는 승-무-패 순입니다.</p>
    </div>
  );
}
