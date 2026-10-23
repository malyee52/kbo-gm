// 올스타전 (league/allstar.ts): 올해 일정·예상 선발, 지난 올스타전 결과(라인스코어·MVP·명단·홈런 더비).
import { useMemo, useState } from 'react';
import { formatDate } from '../../game/calendar';
import { josa } from '../../league/articles';
import { allStarSideNames, allStarSides, pickAllStars, recordSideNames, type AllStarPick, type AllStarRecord } from '../../league/allstar';
import { posName, TeamName, useGame } from '../context';

const POS_LABEL = (pos: string) => (pos === 'SP' ? '선발' : pos === 'RP' ? '구원' : posName(pos));

export function AllStar() {
  const { session, version } = useGame();
  const records = session.league.allStars ?? [];
  const inSeason = session.phase === 'season';
  const year = inSeason ? session.world.year : session.year;
  const years = [...new Set([...(inSeason ? [year] : []), ...records.map((r) => r.year)])].sort((a, b) => b - a);
  const [pick, setPick] = useState<number | null>(null);
  const shown = pick ?? years[0] ?? year;
  const rec = records.find((r) => r.year === shown) ?? null;
  const upcoming = inSeason && shown === year && !rec;
  const day = inSeason ? session.allStarDay : -1;
  // 양대 리그 해(1999·2000)는 드림 올스타 대 매직 올스타
  const upcomingNames = allStarSideNames(session.world);

  // 아직 열리지 않았으면 지금 기준 예상 선발
  const preview = useMemo<AllStarPick[]>(() => {
    if (!upcoming || day < 0 || session.done) return [];
    return pickAllStars(session.world, session.season, session.values, allStarSides(session.world));
  }, [upcoming, day, session, version]);

  return (
    <div className="stack">
      <section className="panel">
        <div className="row-between wrap">
          <h2>올스타전</h2>
          {years.length > 1 && (
            <label className="inline small">연도{' '}
              <select value={shown} onChange={(e) => setPick(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          )}
        </div>
        {upcoming ? (
          day < 0 ? <p className="muted small">{year} 시즌에는 올스타전이 열리지 않습니다 (실제로도 열리지 않은 해).</p> : (
            <p className="small">
              {year} 올스타전은 <strong>{formatDate(year, day)}</strong>에 열립니다. {josa(upcomingNames[0], '과', '와')} {josa(upcomingNames[1], '이', '가')} 맞붙고, 홈런 더비도 함께 열립니다.
              <span className="muted"> 선발은 그날까지의 시즌 WAR와 지금 능력으로 정해지고(팬 투표 대신), 그날 모든 투수가 쉬어 피로가 풀립니다. 우리 선수가 뽑히면 팬 만족도가 조금 오릅니다.</span>
            </p>
          )
        ) : !rec ? <p className="muted small">{shown}년 올스타전 기록이 없습니다.</p> : <Result rec={rec} />}
      </section>
      {upcoming && preview.length > 0 && (
        <section className="panel">
          <h2>지금 기준 예상 선발</h2>
          <Rosters roster={preview} names={upcomingNames} />
        </section>
      )}
      {rec && (
        <>
          <section className="panel"><h2>명단</h2><p className="muted small">경기는 선발 출전 9명이 끝까지 뛰고, 투수는 여럿이 짧게 이어 던집니다.</p><Rosters roster={rec.roster} rec={rec} names={recordSideNames(rec)} /></section>
          <Derby rec={rec} />
        </>
      )}
    </div>
  );
}

function Result({ rec }: { rec: AllStarRecord }) {
  const { session } = useGame();
  const name = (id: string | null) => (id ? rec.roster.find((x) => x.id === id)?.name ?? id : '-');
  const away: 0 | 1 = rec.home === 0 ? 1 : 0;
  const n = Math.max(rec.game.line.away.length, 9);
  const cell = (v: number | undefined) => (v === undefined ? '' : v < 0 ? 'X' : String(v));
  const sideOf = new Map(rec.roster.map((x) => [x.id, x.side]));
  const hits = (s: 0 | 1) => rec.game.bat.reduce((a, b) => a + (sideOf.get(b[0]) === s ? b[2] : 0), 0);
  const mvp = rec.roster.find((x) => x.id === rec.game.mvp);
  const [d, nn] = rec.game.score;
  const sides = recordSideNames(rec);
  return (
    <>
      <p>
        {formatDate(rec.year, rec.day, true)} · {d === nn ? <strong>{d}-{nn} 무승부</strong> : <strong>{sides[d > nn ? 0 : 1]} {Math.max(d, nn)}-{Math.min(d, nn)} 승리</strong>}
        {' · MVP '}<strong>{name(rec.game.mvp)}</strong>{mvp && <span className="muted"> (<TeamName idx={mvp.team} />)</span>}
        {mvp?.team === session.teamIdx && <span className="tag">우리 선수</span>}
      </p>
      <div className="scroll fit">
        <table className="linescore">
          <thead><tr><th className="l">팀</th>{Array.from({ length: n }, (_, i) => <th key={i}>{i + 1}</th>)}<th>R</th><th>H</th></tr></thead>
          <tbody>
            <tr><td className="l">{sides[away]}</td>{Array.from({ length: n }, (_, i) => <td key={i}>{cell(rec.game.line.away[i])}</td>)}<td><strong>{rec.game.score[away]}</strong></td><td>{hits(away)}</td></tr>
            <tr><td className="l">{sides[rec.home]}</td>{Array.from({ length: n }, (_, i) => <td key={i}>{cell(rec.game.line.home[i])}</td>)}<td><strong>{rec.game.score[rec.home]}</strong></td><td>{hits(rec.home)}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function Rosters({ roster, rec, names }: { roster: AllStarPick[]; rec?: AllStarRecord; names: [string, string] }) {
  const { session } = useGame();
  const bat = new Map(rec?.game.bat.map((b) => [b[0], b]) ?? []);
  const pit = new Map(rec?.game.pit.map((b) => [b[0], b]) ?? []);
  const line = (id: string) => {
    const b = bat.get(id);
    const p = pit.get(id);
    if (p) return `${Math.floor(p[1] / 3)}${p[1] % 3 ? `.${p[1] % 3}` : ''}이닝 ${p[2]}실점 ${p[3]}K`;
    if (b) return `${b[1]}타수 ${b[2]}안타${b[3] ? ` ${b[3]}홈런` : ''}${b[4] ? ` ${b[4]}타점` : ''}`;
    return '';
  };
  // 경기 엔진의 AI 감독은 대타를 쓰지 않아 후보 야수는 경기에 나오지 않는다
  const idle = (x: AllStarPick) => (x.pos === 'SP' || x.pos === 'RP' ? '등판 안 함' : '벤치');
  return (
    <div className="cards">
      {([0, 1] as const).map((s) => {
        const mine = roster.filter((x) => x.side === s);
        const group = (label: string, rows: AllStarPick[]) => rows.length > 0 && (
          <>
            <tr><th colSpan={rec ? 4 : 3} className="l small muted">{label}</th></tr>
            {rows.map((x) => (
              <tr key={x.id}>
                <td>{POS_LABEL(x.pos)}</td>
                <td className="l">{x.team === session.teamIdx ? <strong>{x.name}</strong> : x.name}{rec?.game.mvp === x.id && <span className="tag">MVP</span>}</td>
                <td className="l small"><TeamName idx={x.team} /></td>
                {rec && <td className="l small">{line(x.id) || <span className="muted">{idle(x)}</span>}</td>}
              </tr>
            ))}
          </>
        );
        return (
          <div key={s}>
            <h3>{names[s]}</h3>
            <div className="scroll flat">
              <table>
                <tbody>
                  {group('선발 출전', mine.filter((x) => x.starter && x.pos !== 'SP'))}
                  {group('후보', mine.filter((x) => !x.starter && x.pos !== 'SP' && x.pos !== 'RP'))}
                  {group('투수', mine.filter((x) => x.pos === 'SP' || x.pos === 'RP'))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Derby({ rec }: { rec: AllStarRecord }) {
  const { session } = useGame();
  if (!rec.derby.round1.length) return null;
  const who = (id: string) => rec.roster.find((x) => x.id === id);
  const final = new Map(rec.derby.final);
  const rows = [...rec.derby.round1].sort((a, b) => (final.get(b[0]) ?? -1) - (final.get(a[0]) ?? -1) || b[1] - a[1]);
  return (
    <section className="panel">
      <h2>홈런 더비</h2>
      <p className="muted small">그날까지 홈런 상위 8명이 아웃 7개씩 치고, 1라운드 상위 2명이 결승에서 다시 아웃 7개로 겨룹니다.</p>
      <div className="scroll flat">
        <table>
          <thead><tr><th className="l">선수</th><th className="l">구단</th><th>1라운드</th><th>결승</th></tr></thead>
          <tbody>
            {rows.map(([id, n]) => {
              const x = who(id);
              return (
                <tr key={id}>
                  <td className="l">{x?.team === session.teamIdx ? <strong>{x?.name}</strong> : x?.name ?? id}{rec.derby.winner === id && <span className="tag">우승</span>}</td>
                  <td className="l small">{x && <TeamName idx={x.team} />}</td>
                  <td>{n}</td>
                  <td>{final.get(id) ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
