// 순위표: 승·패·무, 승률, 게임차, 득실, 홈·원정, 최근 10경기, 연속 기록.
import { winPct } from '../../engine';
import { gamesBehind, rate3, recentForm } from '../../game/stats';
import { useMemo, useState } from 'react';
import { TeamName, useGame } from '../context';

export function Standings() {
  const { session, version } = useGame();
  const fut = useMemo(() => session.futures().teams, [session, version]);
  const s = session.season;
  const order = s.standings();
  const leader = s.teams[order[0]];
  const cut = session.world.rules.postseasonTeams;
  // 2026-10-12 UI 개편: 1군과 퓨처스를 한 화면에 쌓지 않고 골라 본다
  const [league, setLeague] = useState<'kbo' | 'futures'>('kbo');

  return (
    <div className="stack tight">
      <div className="row-between wrap">
        <div className="seg" role="tablist" aria-label="리그">
          <button type="button" role="tab" aria-selected={league === 'kbo'} className={league === 'kbo' ? 'on' : ''} onClick={() => setLeague('kbo')}>1군</button>
          <button type="button" role="tab" aria-selected={league === 'futures'} className={league === 'futures' ? 'on' : ''} onClick={() => setLeague('futures')}>퓨처스리그</button>
        </div>
        <span className="muted small">{league === 'kbo' ? `승률(무승부 제외) 순 · 점선 위 상위 ${cut}팀이 가을야구 · 홈·원정·최근 10은 승-무-패` : '2군 성적은 능력과 출전 몫으로 만듭니다 (1군 경기 수의 약 80%)'}</span>
      </div>
      {league === 'kbo' && <div className="scroll">
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
      </div>}

      {league === 'futures' && <>
      <details className="help small">
        <summary>퓨처스리그는?</summary>
        2군 경기는 한 타석씩 돌리지 않고, 2군에 있는 선수의 능력과 출전 몫으로 성적을 만듭니다. 득점·실점에서 승률을 정합니다. 1군 진입 전 창단 구단도 여기서 뜁니다. 퓨처스 출전량과 활약은 시즌 뒤 성장 판정에 들어갑니다.
      </details>
      <div className="scroll">
        <table>
          <thead><tr><th>순위</th><th className="l">팀</th><th>경기</th><th>승</th><th>패</th><th>승률</th><th>득점</th><th>실점</th></tr></thead>
          <tbody>
            {fut.map((t, k) => (
              <tr key={t.team} className={t.team === session.teamIdx ? 'me' : ''}>
                <td>{k + 1}</td><td className="l"><TeamName idx={t.team} /></td><td>{t.g}</td><td>{t.w}</td><td>{t.l}</td>
                <td>{t.g ? rate3(t.w / t.g) : '-'}</td><td>{t.rs}</td><td>{t.ra}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}
