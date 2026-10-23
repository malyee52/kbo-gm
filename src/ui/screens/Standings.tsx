// 순위표: 승·패·무, 승률, 게임차, 득실, 홈·원정, 최근 10경기, 연속 기록.
// 양대 리그 해(1999·2000)는 드림·매직·통합 탭 (일정 개편 기획안 10.4). 표 꾸밈은 UI 개편 몫
import { winPct } from '../../engine';
import { seasonPostseasonPlaces } from '../../game/rank';
import { gamesBehind, rate3, recentForm } from '../../game/stats';
import { useMemo, useState } from 'react';
import { TeamName, useGame } from '../context';

export function Standings() {
  const { session, version } = useGame();
  const fut = useMemo(() => session.futures().teams, [session, version]);
  const s = session.season;
  const order = s.standings();
  const divs = s.divisionStandings();
  const cut = session.world.rules.postseasonTeams;
  const me = session.teamIdx;
  // 지금 순위로 가을야구에 나가는 구단. 양대 리그 해에 리그 3위가 들어 있으면 그 팀과 다른 리그 2위가 준플레이오프
  const ps = seasonPostseasonPlaces(s, cut);
  const leagueOf = new Map<number, string>();
  divs?.forEach((d) => d.teams.forEach((t) => leagueOf.set(t, d.name)));
  const semi = new Set<number>();
  if (divs) {
    for (const [a, b] of [[0, 1], [1, 0]] as const) {
      if (ps.includes(divs[a].teams[2])) { semi.add(divs[a].teams[2]); semi.add(divs[b].teams[1]); }
    }
  }
  // 2026-10-12 UI 개편: 1군과 퓨처스를 한 화면에 쌓지 않고 골라 본다. 양대 리그 해의 첫 탭은 우리 구단의 리그 (임시 규칙)
  const myLeague = divs?.findIndex((d) => d.teams.includes(me)) ?? -1;
  const [tab, setTab] = useState<string>(myLeague >= 0 ? `div${myLeague}` : 'kbo');
  const view = tab === 'futures' ? 'futures' : divs && tab.startsWith('div') ? Number(tab.slice(3)) : 'kbo';
  const tabs: [string, string][] = [
    ...(divs ? divs.map((d, k) => [`div${k}`, `${d.name}리그`] as [string, string]) : []),
    ['kbo', divs ? '통합' : '1군'], ['futures', '퓨처스리그'],
  ];
  const rows = typeof view === 'number' ? divs![view].teams : order;

  return (
    <div className="stack tight">
      <div className="row-between wrap">
        <div className="seg" role="tablist" aria-label="리그">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <span className="muted small">{view === 'futures' ? '2군 성적은 능력과 출전 몫으로 만듭니다 (1군 경기 수의 약 80%)'
          : divs ? `승률(무승부 제외) 순 · ${typeof view === 'number' ? '점선 위 리그 1·2위가 가을야구, 게임차는 리그 1위 기준' : '게임차는 통합 1위 기준'} · 홈·원정·최근 10은 승-무-패`
          : `승률(무승부 제외) 순 · 점선 위 상위 ${cut}팀이 가을야구 · 홈·원정·최근 10은 승-무-패`}</span>
      </div>
      {divs && view !== 'futures' && <p className="muted small">
        {session.world.year}년은 {divs.map((d) => d.name).join('·')} 양대 리그입니다. 각 리그 1·2위가 가을야구에 나가고, 한 리그 3위의 승률이 다른 리그 2위보다 높으면 둘이 준플레이오프를 치릅니다.
        {semi.size > 0 && ` 지금 순위로는 ${[...semi].map((t) => session.world.teams[t].name).join('·')}이(가) 준플레이오프에 해당합니다.`}
      </p>}
      {view !== 'futures' && <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>순위</th><th className="l">팀</th>{divs && view === 'kbo' && <th>리그</th>}<th>경기</th><th>승</th><th>패</th><th>무</th><th>승률</th><th>게임차</th>
              <th>득점</th><th>실점</th><th>득실차</th><th>홈</th><th>원정</th><th>최근 10</th><th>연속</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i, k) => {
              const t = s.teams[i];
              const f = recentForm(s.log, i);
              const away = { w: t.w - t.homeW, l: t.l - t.homeL, t: t.t - t.homeT };
              // 가을야구 선: 단일 리그는 상위 cut팀 아래, 리그 탭은 2위 아래 (준플레이오프 조건을 채운 3위는 표시만)
              const line = divs ? typeof view === 'number' && k === 1 : k === cut - 1;
              return (
                <tr key={i} className={`${i === me ? 'me' : ''}${line ? ' cutline' : ''}`}>
                  <td>{k + 1}</td>
                  <td className="l"><TeamName idx={i} />{semi.has(i) && (typeof view === 'number' ? k === 2 : true) && <span className="tag" title="한 리그 3위 승률이 다른 리그 2위보다 높아 준플레이오프">준PO</span>}</td>
                  {divs && view === 'kbo' && <td>{leagueOf.get(i)}</td>}
                  <td>{t.g}</td><td>{t.w}</td><td>{t.l}</td><td>{t.t}</td><td>{rate3(winPct(t))}</td>
                  <td>{k === 0 ? '-' : gamesBehind(s.teams[rows[0]], t).toFixed(1)}</td>
                  <td>{t.rs}</td><td>{t.ra}</td><td>{t.rs - t.ra > 0 ? `+${t.rs - t.ra}` : t.rs - t.ra}</td>
                  <td>{t.homeW}-{t.homeT}-{t.homeL}</td><td>{away.w}-{away.t}-{away.l}</td>
                  <td>{f.w}-{f.t}-{f.l}</td><td>{f.streak || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>}

      {view === 'futures' && <>
      <details className="help small">
        <summary>퓨처스리그는?</summary>
        2군 경기는 한 타석씩 돌리지 않고, 2군에 있는 선수의 능력과 출전 몫으로 성적을 만듭니다. 득점·실점에서 승률을 정합니다. 1군 진입 전 창단 구단도 여기서 뜁니다. 퓨처스 출전량과 활약은 시즌 뒤 성장 판정에 들어갑니다.
      </details>
      <div className="scroll">
        <table>
          <thead><tr><th>순위</th><th className="l">팀</th><th>경기</th><th>승</th><th>패</th><th>승률</th><th>득점</th><th>실점</th></tr></thead>
          <tbody>
            {fut.map((t, k) => (
              <tr key={t.team} className={t.team === me ? 'me' : ''}>
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
