// 시상식 (2026-10-08 사용자 요청): MVP, 신인상, 골든글러브, 타이틀 홀더. 게임 안에서 치른 시즌마다 남는다.
import { useState } from 'react';
import { GG_LABEL, type AwardWinner } from '../../league/awards';
import { TeamName, useGame } from '../context';

export function Awards() {
  const { session, openPlayer } = useGame();
  const all = session.league.awards ?? [];
  const [year, setYear] = useState<number | null>(null);

  if (!all.length) {
    return (
      <div className="stack">
        <h1>시상식</h1>
        <p className="muted">시즌을 결산하면 MVP·신인상·골든글러브·타이틀 홀더를 발표합니다.</p>
      </div>
    );
  }
  const aw = all.find((a) => a.year === year) ?? all[all.length - 1];
  const me = session.teamIdx;

  const Name = ({ w }: { w: AwardWinner }) => {
    const sp = session.world.players.find((x) => x.id === w.id);
    return sp ? <button type="button" className="link" onClick={() => openPlayer(sp.idx)}>{w.name}</button> : <>{w.name}</>;
  };
  const Big = ({ title, w }: { title: string; w: AwardWinner | null }) => (
    <section className={`panel${w?.team === me ? ' mine' : ''}`}>
      <h2>{title}</h2>
      {w ? (
        <>
          <p><strong className="big-name"><Name w={w} /></strong> <span className="muted"><TeamName idx={w.team} /></span></p>
          <p className="small">{w.line}</p>
          <p className="muted small">종합 가치(WAR 근사) {w.war.toFixed(1)}</p>
        </>
      ) : <p className="muted small">자격을 갖춘 선수가 없습니다.</p>}
    </section>
  );

  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <h1>{aw.year} 시상식</h1>
          <p className="muted small">
            투표 대신 기록으로 정합니다. MVP는 종합 가치(WAR 근사)에 타이틀 수를 더해, 골든글러브는 주 포지션별 종합 가치 1위(외야 3명)로 뽑습니다.
            타율·출루율·장타율은 규정타석, 평균자책점은 규정이닝, 승률은 10승 이상. 신인상은 입단 5년 이내·이전 시즌까지 60타석·30이닝 이하.
          </p>
        </div>
        {all.length > 1 && (
          <select value={aw.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="시즌">
            {[...all].reverse().map((a) => <option key={a.year} value={a.year}>{a.year}</option>)}
          </select>
        )}
      </section>

      <section className="cards">
        <Big title="정규시즌 MVP" w={aw.mvp} />
        <Big title="신인상" w={aw.rookie} />
      </section>

      <section className="panel">
        <h2>골든글러브</h2>
        <table>
          <thead><tr><th className="l">부문</th><th className="l">선수</th><th className="l">구단</th><th className="l">기록</th><th>WAR</th></tr></thead>
          <tbody>
            {aw.goldenGlove.map((x, i) => (
              <tr key={i} className={x.winner.team === me ? 'me' : ''}>
                <td className="l">{GG_LABEL[x.pos]}</td>
                <td className="l"><Name w={x.winner} /></td>
                <td className="l"><TeamName idx={x.winner.team} /></td>
                <td className="l small">{x.winner.line}</td>
                <td>{x.winner.war.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>타이틀 홀더</h2>
        <table>
          <thead><tr><th className="l">부문</th><th className="l">선수</th><th className="l">구단</th><th>기록</th></tr></thead>
          <tbody>
            {aw.titles.map((t) => (
              <tr key={t.key} className={t.winners.some((w) => w.team === me) ? 'me' : ''}>
                <td className="l">{t.label}</td>
                <td className="l">{t.winners.map((w, i) => <span key={w.id}>{i > 0 && ', '}<Name w={w} /></span>)}</td>
                <td className="l">{t.winners.map((w, i) => <span key={w.id}>{i > 0 && ', '}<TeamName idx={w.team} /></span>)}</td>
                <td><strong>{t.value}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
