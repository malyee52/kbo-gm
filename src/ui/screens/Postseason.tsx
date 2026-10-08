// 가을야구 (M7): 대진표, 시리즈별 경기 결과, 박스스코어. 진행은 위쪽 버튼으로 한 경기씩.
import { useState } from 'react';
import { formatDate } from '../../game/calendar';
import { currentSeries, ROUND_LABEL, RULES, stillAlive, type SeriesGame } from '../../league/postseason';
import { TeamName, useGame } from '../context';
import { BoxView } from './Schedule';

export function Postseason() {
  const { session } = useGame();
  const st = session.postseason;
  const last = session.league.lastSeason?.postseason;
  const [sel, setSel] = useState<{ round: number; game: number } | null>(null);
  const me = session.teamIdx;
  const year = session.world.year;

  if (!st && !last) {
    return (
      <div className="stack">
        <h1>가을야구</h1>
        <p className="muted">정규시즌이 끝나면 상위 {session.world.rules.postseasonTeams}팀이 가을야구를 치릅니다.</p>
      </div>
    );
  }
  // 진행 상태가 있으면 그것을 (박스스코어 포함), 없으면 결산 때 남긴 결과를 보여 준다
  const seeds = st?.seeds ?? last!.seeds;
  const series = st?.series ?? last!.series;
  const cur = st ? currentSeries(st) : null;
  const done = st ? st.done : true;
  const champion = done ? series[series.length - 1].winner : -1;
  const selGame: SeriesGame | undefined = sel ? series[sel.round]?.games[sel.game] : undefined;

  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <h1>{year} 가을야구</h1>
          <p className="muted small">
            {done ? <>한국시리즈 우승 <strong><TeamName idx={champion} /></strong></>
              : cur ? <>지금 {ROUND_LABEL[cur.round]} {cur.games.length + 1}차전 · {formatDate(year, st!.day)}</> : null}
            {!done && st && (seeds.includes(me)
              ? (stillAlive(st, me) ? ' · 우리 구단 진출 중 (선수단 화면에서 엔트리·기용표를 바꿀 수 있습니다)' : ' · 우리 구단 탈락')
              : ' · 우리 구단은 진출하지 못했습니다')}
          </p>
        </div>
      </section>

      <section className="panel">
        <h2>대진</h2>
        <p className="small">{seeds.map((t, i) => <span key={t} className={t === me ? 'me-text' : ''}>{i > 0 && ' · '}{i + 1}위 <TeamName idx={t} /></span>)}</p>
        <p className="muted small">
          4위 대 5위 와일드카드(4위 1승 어드밴티지, 최대 2경기) → 준플레이오프(3위, 5전 3선승) → 플레이오프(2위, 5전 3선승) → 한국시리즈(1위, 7전 4선승).
          시리즈 길이·어드밴티지는 임시값입니다. 무승부는 승수에 넣지 않고, 경기 수 한도까지 승부가 안 나면 상위 팀이 올라갑니다.
        </p>
      </section>

      {series.map((x, ri) => (
        <section key={x.round} className={`panel${x.high === me || x.low === me ? ' mine' : ''}`}>
          <h2>
            {ROUND_LABEL[x.round]}{' '}
            <span className="muted small">
              <TeamName idx={x.high} /> {x.winsHigh} - {x.winsLow} <TeamName idx={x.low} />
              {x.round === 'wc' && ` (4위 ${RULES.wc.highHeadStart}승 포함)`}
              {x.winner >= 0 ? <> · <TeamName idx={x.winner} /> 진출</> : ' · 진행 중'}
            </span>
          </h2>
          {x.games.length === 0 ? <p className="muted small">아직 경기를 치르지 않았습니다.</p> : (
            <table>
              <thead><tr><th>경기</th><th className="l">날짜</th><th className="l">원정</th><th>점수</th><th className="l">홈</th><th /></tr></thead>
              <tbody>
                {x.games.map((g, gi) => (
                  <tr key={gi} className={sel?.round === ri && sel.game === gi ? 'me' : ''}>
                    <td>{gi + 1}차전</td>
                    <td className="l small">{formatDate(year, g.day)}</td>
                    <td className="l"><TeamName idx={g.away} /></td>
                    <td><strong>{g.awayRuns} - {g.homeRuns}</strong>{g.innings > 9 ? <span className="muted small"> ({g.innings}회)</span> : ''}{g.homeRuns === g.awayRuns ? ' 무' : ''}</td>
                    <td className="l"><TeamName idx={g.home} /></td>
                    <td>{g.box && <button type="button" className="small-btn" onClick={() => setSel({ round: ri, game: gi })}>박스스코어</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {selGame?.box && (
        <BoxView
          log={{ day: selGame.day, home: selGame.home, away: selGame.away, homeRuns: selGame.homeRuns, awayRuns: selGame.awayRuns, innings: selGame.innings, win: null, loss: null, save: null }}
          box={selGame.box}
        />
      )}
      {!st && last && <p className="muted small">결산 뒤에는 박스스코어 없이 결과만 남습니다.</p>}
    </div>
  );
}
