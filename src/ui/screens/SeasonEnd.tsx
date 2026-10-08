// 시즌 종료 결과: 최종 순위, 우리 구단 성적과 주요 선수, 부문별 1위.
import type { BatLine, PitLine } from '../../engine';
import { winPct } from '../../engine';
import {
  BAT_CATEGORIES, PIT_CATEGORIES, avg, batQualified, era, fixed2, gamesBehind, ipText, leaders, ops, pitQualified, rate3,
} from '../../game/stats';
import { PlayerLink, TeamName, useGame } from '../context';

const TITLE_BAT = ['avg', 'hr', 'rbi', 'h', 'sb', 'ops'];
const TITLE_PIT = ['era', 'w', 'sv', 'so'];

export function SeasonEnd() {
  const { session, go, changed, autosave } = useGame();
  const s = session.season;
  const me = session.teamIdx;
  const year = session.world.year;
  const order = s.standings();
  const rank = order.indexOf(me) + 1;
  const rec = s.teams[me];
  const cut = session.world.rules.postseasonTeams;
  const leader = s.teams[order[0]];

  if (!session.done) {
    return (
      <div className="stack">
        <h1>시즌 결과</h1>
        <p className="muted">아직 시즌이 끝나지 않았습니다.</p>
      </div>
    );
  }

  const verdict = rank === 1 ? '정규시즌 1위' : rank <= cut ? `포스트시즌 진출권 (${rank}위)` : rank === order.length ? '최하위' : `${rank}위, 포스트시즌 진출 실패`;
  const org = session.team.org;
  // 타석이 적은 선수는 OPS를 깎아서 줄 세운다 (300타석 미만 비례)
  const batScore = (i: number) => {
    const v = ops(s.bat[i]);
    return Number.isFinite(v) ? v * Math.min(1, s.bat[i].pa / 300) : -1;
  };
  const topBat = org.filter((p) => !p.isPitcher).sort((a, b) => batScore(b.idx) - batScore(a.idx)).slice(0, 5);
  const topPit = org.filter((p) => p.isPitcher && s.pit[p.idx].outs > 0).sort((a, b) => s.pit[b.idx].outs - s.pit[a.idx].outs).slice(0, 5);
  const players = session.world.players;

  return (
    <div className="stack">
      <h1>{year} 정규시즌 결과</h1>
      <section className="cards">
        <div className="card hero">
          <h2><TeamName idx={me} /></h2>
          <p className="big">{verdict}</p>
          <p>{rec.w}승 {rec.l}패 {rec.t}무 · 승률 {rate3(winPct(rec))} · 득점 {rec.rs} 실점 {rec.ra}{rank > 1 ? ` · 1위와 ${gamesBehind(leader, rec)}경기 차` : ''}</p>
          <p className="muted small">포스트시즌 경기는 아직 치르지 않습니다. 결산하면 성장 판정과 1군 연차가 반영되고 오프시즌(FA·외국인·드래프트·연봉)으로 넘어갑니다.</p>
        </div>
      </section>

      <section>
        <h2>최종 순위</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>순위</th><th className="l">팀</th><th>승</th><th>패</th><th>무</th><th>승률</th><th>게임차</th><th>득점</th><th>실점</th></tr></thead>
            <tbody>
              {order.map((i, k) => {
                const t = s.teams[i];
                return (
                  <tr key={i} className={`${i === me ? 'me' : ''}${k === cut - 1 ? ' cutline' : ''}`}>
                    <td>{k + 1}</td><td className="l"><TeamName idx={i} /></td><td>{t.w}</td><td>{t.l}</td><td>{t.t}</td>
                    <td>{rate3(winPct(t))}</td><td>{k === 0 ? '-' : gamesBehind(leader, t).toFixed(1)}</td><td>{t.rs}</td><td>{t.ra}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="two">
        <div>
          <h2>우리 구단 주요 타자</h2>
          <div className="scroll">
            <table>
              <thead><tr><th className="l">선수</th><th>타석</th><th>타율</th><th>홈런</th><th>타점</th><th>OPS</th></tr></thead>
              <tbody>
                {topBat.map((p) => {
                  const b = s.bat[p.idx];
                  return <tr key={p.idx}><td className="l"><PlayerLink p={p} /></td><td>{b.pa}</td><td>{rate3(avg(b))}</td><td>{b.hr}</td><td>{b.rbi}</td><td>{rate3(ops(b))}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>우리 구단 주요 투수</h2>
          <div className="scroll">
            <table>
              <thead><tr><th className="l">선수</th><th>이닝</th><th>승-패-세</th><th>평균자책</th><th>탈삼진</th></tr></thead>
              <tbody>
                {topPit.map((p) => {
                  const x = s.pit[p.idx];
                  return <tr key={p.idx}><td className="l"><PlayerLink p={p} /></td><td>{ipText(x.outs)}</td><td>{x.w}-{x.l}-{x.sv}</td><td>{fixed2(era(x))}</td><td>{x.so}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h2>부문별 1위</h2>
        <div className="scroll fit">
          <table>
            <tbody>
              {BAT_CATEGORIES.filter((c) => TITLE_BAT.includes(c.key)).map((c) => {
                const top = leaders<BatLine>(players.filter((p) => !p.isPitcher), s.bat, c, s.teams, batQualified, 1)[0];
                return <tr key={c.key}><td className="l">{c.label}</td><td className="l">{top ? <PlayerLink p={top.player} showTeam /> : '-'}</td><td>{top?.value ?? '-'}</td></tr>;
              })}
              {PIT_CATEGORIES.filter((c) => TITLE_PIT.includes(c.key)).map((c) => {
                const top = leaders<PitLine>(players.filter((p) => p.isPitcher), s.pit, c, s.teams, pitQualified, 1)[0];
                return <tr key={c.key}><td className="l">{c.label}</td><td className="l">{top ? <PlayerLink p={top.player} showTeam /> : '-'}</td><td>{top?.value ?? '-'}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="actions">
        {session.phase === 'season' && (
          <button type="button" onClick={() => {
            session.beginOffseason();
            changed();
            void autosave();
            go('offseason');
          }}>오프시즌 시작 (결산)</button>
        )}
        {session.phase === 'offseason' && <button type="button" onClick={() => go('offseason')}>오프시즌으로</button>}
        <button type="button" className="ghost" onClick={() => go('leaders')}>기록 전체 보기</button>
        <button type="button" className="ghost" onClick={() => go('save')}>저장·내보내기</button>
      </div>
    </div>
  );
}
