// 시즌 뒤 성장·하락 결과 (2026-10-08 사용자 요청). 오프시즌을 시작할 때 판정한 능력 변화를 보여 준다.
import { useState } from 'react';
import type { GrowthEntry } from '../../league/offseason';
import { posName, TeamName, useGame } from '../context';
import { runsGrade } from '../grades';

type Scope = 'mine' | 'league';

export function Growth() {
  const { session, openPlayer } = useGame();
  const off = session.offseason;
  const [scope, setScope] = useState<Scope>('mine');
  const list = off?.growth;

  if (!off || !list) {
    return (
      <div className="stack">
        <h1>선수 성장</h1>
        <p className="muted">시즌이 끝나고 오프시즌을 시작하면 선수들의 성장·하락 결과를 볼 수 있습니다.</p>
      </div>
    );
  }

  const me = off.userTeam;
  const delta = (g: GrowthEntry) => g.after - g.before;
  const mine = list.filter((g) => g.team === me).sort((a, b) => delta(b) - delta(a));
  const others = list.filter((g) => !g.tags?.includes('복무 중'));
  const ups = [...others].sort((a, b) => delta(b) - delta(a)).slice(0, 15);
  const downs = [...others].sort((a, b) => delta(a) - delta(b)).slice(0, 15);
  const upN = mine.filter((g) => runsGrade(g.after) > runsGrade(g.before)).length;
  const downN = mine.filter((g) => runsGrade(g.after) < runsGrade(g.before)).length;
  const net = mine.reduce((s, g) => s + delta(g), 0);

  const rows = (items: GrowthEntry[], showTeam: boolean) => (
    <table>
      <thead>
        <tr>
          <th className="l">선수</th>{showTeam && <th className="l">구단</th>}<th>자리</th><th>나이</th>
          <th>현재 (전 → 후)</th><th>기여 변화</th><th className="l">비고</th>
        </tr>
      </thead>
      <tbody>
        {items.map((g) => {
          const p = session.leaguePlayer(g.id);
          if (!p) return null;
          const sp = session.world.players.find((x) => x.id === g.id);
          const d = delta(g);
          const gb = runsGrade(g.before);
          const ga = runsGrade(g.after);
          return (
            <tr key={g.id}>
              <td className="l">{sp ? <button type="button" className="link" onClick={() => openPlayer(sp.idx)}>{p.name}</button> : p.name}</td>
              {showTeam && <td className="l"><TeamName idx={g.team} /></td>}
              <td>{p.isPitcher ? (p.pit!.startShare >= 0.5 ? '선발' : '구원') : posName(p.pos)}</td>
              <td>{g.age ?? '-'}</td>
              <td>{gb} → <strong>{ga}</strong> {ga > gb ? <span className="up">▲{ga - gb}</span> : ga < gb ? <span className="down">▼{gb - ga}</span> : ''}</td>
              <td className={d > 0.5 ? 'up' : d < -0.5 ? 'down' : ''}>{d > 0 ? '+' : ''}{d.toFixed(1)}</td>
              <td className="l small">{g.tags?.join(', ')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <h1>{off.year} 시즌 뒤 선수 성장</h1>
          <p className="muted small">
            "현재"는 한 시즌 기여를 20~80 등급으로 나타낸 값이고, "기여 변화"는 한 시즌 기여(대체 선수 대비 런)가 얼마나 바뀌었는지입니다.
            성장은 잠재력과의 차이·나이·출전 기회·운으로 정해집니다. 기량 변화는 다음 시즌 성적으로 이어집니다.
          </p>
        </div>
        <div className="inline">
          <button type="button" className={scope === 'mine' ? '' : 'ghost'} onClick={() => setScope('mine')}>우리 구단</button>
          <button type="button" className={scope === 'league' ? '' : 'ghost'} onClick={() => setScope('league')}>리그 전체</button>
        </div>
      </section>

      {scope === 'mine' ? (
        <section className="panel">
          <h2>
            <TeamName idx={me} />{' '}
            <span className="muted small">등급 상승 {upN}명 · 하락 {downN}명 · 기여 합계 {net > 0 ? '+' : ''}{net.toFixed(1)}런</span>
          </h2>
          {mine.length ? rows(mine, false) : <p className="muted small">판정한 선수가 없습니다.</p>}
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>가장 많이 성장한 선수</h2>
            {rows(ups, true)}
          </section>
          <section className="panel">
            <h2>가장 많이 하락한 선수</h2>
            {rows(downs, true)}
          </section>
        </>
      )}
    </div>
  );
}
