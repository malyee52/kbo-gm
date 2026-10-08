// 엔진 시험 화면. 게임 화면(M3)이 들어오기 전까지 엔진 결과를 눈으로 확인하는 용도다.
import { useEffect, useMemo, useState } from 'react';
import { loadBrowserStore, type BrowserStore } from '../data/loadBrowser';
import { computeGrades, DEFAULT_PARAMS, simulateSeason, winPct, worldForYear, type SeasonResult, type World } from '../engine';

interface Run {
  world: World;
  result: SeasonResult;
  ms: number;
}

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3).replace(/^0/, '') : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const innings = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? `.${outs % 3}` : ''}`;

export function EngineLab() {
  const [store, setStore] = useState<BrowserStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(2025);
  const [seed, setSeed] = useState('1');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [teamIdx, setTeamIdx] = useState(0);

  useEffect(() => {
    loadBrowserStore().then(setStore, (e: Error) => setError(e.message));
  }, []);

  const simulate = async () => {
    if (!store) return;
    setBusy(true);
    setError(null);
    try {
      await store.ensureYear(year);
      await new Promise((r) => setTimeout(r, 20)); // "계산 중" 표시가 먼저 그려지도록
      const t0 = performance.now();
      const world = worldForYear(store, year);
      const result = simulateSeason(world, DEFAULT_PARAMS, `${year}-${seed}`);
      setRun({ world, result, ms: performance.now() - t0 });
      setTeamIdx(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const actual = run && store ? store.season(run.world.year) : undefined;
  const grades = useMemo(() => (run ? computeGrades(run.world) : null), [run]);

  if (error && !store) return <main className="lab"><p className="error">{error}</p></main>;
  if (!store) return <main className="lab"><p>데이터를 불러오는 중입니다.</p></main>;

  const years = [...store.meta.years].reverse();

  return (
    <main className="lab">
      <header>
        <h1>KBO 단장 게임 <span>엔진 시험 화면</span></h1>
        <p>
          그 해의 실제 선수단에 직전 3시즌 기준 능력을 주고 한 시즌을 돌립니다. 같은 연도와 시드는 항상 같은 결과를 냅니다.
        </p>
      </header>

      <form className="controls" onSubmit={(e) => { e.preventDefault(); void simulate(); }}>
        <label>
          연도
          <select id="year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}{store.meta.inProgress.includes(y) ? ' (진행 중 자료)' : ''}</option>)}
          </select>
        </label>
        <label>
          시드
          <input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} size={10} />
        </label>
        <button type="submit" disabled={busy}>{busy ? '계산 중' : '시즌 돌리기'}</button>
        {run && <span className="muted">{(run.ms / 1000).toFixed(1)}초 걸림</span>}
      </form>
      {year < 2001 && <p className="note">2000년 이전은 선발 투수 기용 방식이 지금과 달라 득점이 실제보다 높게 나옵니다 (M8에서 보정 예정).</p>}
      {error && <p className="error">{error}</p>}

      {run && actual && (
        <>
          <section>
            <h2>{run.world.year}년 순위</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>순위</th><th className="l">팀</th><th>승</th><th>패</th><th>무</th><th>승률</th><th>득점</th><th>실점</th><th>실제 승률</th></tr>
                </thead>
                <tbody>
                  {run.result.standings.map((i, rank) => {
                    const t = run.result.teams[i];
                    const real = actual.teams.find((x) => x.name === run.world.teams[i].name);
                    return (
                      <tr key={i}>
                        <td>{rank + 1}</td><td className="l">{run.world.teams[i].name}</td>
                        <td>{t.w}</td><td>{t.l}</td><td>{t.t}</td><td>{f3(winPct(t))}</td><td>{t.rs}</td><td>{t.ra}</td>
                        <td className="muted">{real ? f3(real.w / (real.w + real.l)) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>리그 평균</h2>
            <LeagueCompare run={run} actual={actual.league} />
          </section>

          <section className="two">
            <div>
              <h2>홈런 순위</h2>
              <div className="scroll">
                <table>
                  <thead><tr><th className="l">선수</th><th className="l">팀</th><th>타석</th><th>타율</th><th>홈런</th><th>타점</th><th>도루</th></tr></thead>
                  <tbody>
                    {run.world.players.filter((p) => !p.isPitcher).sort((a, b) => run.result.bat[b.idx].hr - run.result.bat[a.idx].hr).slice(0, 10).map((p) => {
                      const b = run.result.bat[p.idx];
                      return <tr key={p.id}><td className="l">{p.name}</td><td className="l">{run.world.teams[p.teamIdx].name}</td><td>{b.pa}</td><td>{f3(b.h / b.ab)}</td><td>{b.hr}</td><td>{b.rbi}</td><td>{b.sb}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h2>다승 순위</h2>
              <div className="scroll">
                <table>
                  <thead><tr><th className="l">선수</th><th className="l">팀</th><th>승</th><th>패</th><th>이닝</th><th>평균자책</th><th>탈삼진</th></tr></thead>
                  <tbody>
                    {run.world.players.filter((p) => p.isPitcher).sort((a, b) => run.result.pit[b.idx].w - run.result.pit[a.idx].w).slice(0, 10).map((p) => {
                      const s = run.result.pit[p.idx];
                      return <tr key={p.id}><td className="l">{p.name}</td><td className="l">{run.world.teams[p.teamIdx].name}</td><td>{s.w}</td><td>{s.l}</td><td>{innings(s.outs)}</td><td>{f2((s.er * 27) / s.outs)}</td><td>{s.so}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <h2>
              선수 능력
              <select id="team" value={teamIdx} onChange={(e) => setTeamIdx(Number(e.target.value))}>
                {run.world.teams.map((t) => <option key={t.idx} value={t.idx}>{t.name}</option>)}
              </select>
            </h2>
            <p className="muted">20~80 등급. 50이 리그 주전 평균이고 10이 1 표준편차입니다. 타석·이닝은 이번 시뮬레이션 결과입니다.</p>
            <div className="two">
              <div className="scroll">
                <table>
                  <thead><tr><th className="l">야수</th><th>포지션</th><th>나이</th><th>컨택</th><th>파워</th><th>선구안</th><th>주력</th><th>타석</th></tr></thead>
                  <tbody>
                    {run.world.teams[teamIdx].org.filter((p) => !p.isPitcher).sort((a, b) => b.value - a.value).slice(0, 18).map((p) => {
                      const g = grades!.batters.get(p.id)!;
                      return <tr key={p.id}><td className="l">{p.name}</td><td>{p.pos ?? '-'}</td><td>{p.age ?? '-'}</td><td>{g.contact}</td><td>{g.power}</td><td>{g.eye}</td><td>{g.speed}</td><td>{run.result.bat[p.idx].pa}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <div className="scroll">
                <table>
                  <thead><tr><th className="l">투수</th><th>나이</th><th>구위</th><th>제구</th><th>장타 억제</th><th>체력</th><th>이닝</th></tr></thead>
                  <tbody>
                    {run.world.teams[teamIdx].org.filter((p) => p.isPitcher).sort((a, b) => a.value - b.value).slice(0, 18).map((p) => {
                      const g = grades!.pitchers.get(p.id)!;
                      return <tr key={p.id}><td className="l">{p.name}</td><td>{p.age ?? '-'}</td><td>{g.stuff}</td><td>{g.control}</td><td>{g.hrSuppression}</td><td>{g.stamina ?? '-'}</td><td>{innings(run.result.pit[p.idx].outs)}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function LeagueCompare({ run, actual }: { run: Run; actual: NonNullable<ReturnType<BrowserStore['season']>>['league'] }) {
  const T = run.result.totals;
  const rows: [string, string, string][] = [
    ['타율', f3(T.h / T.ab), f3(actual.avg)],
    ['팀 경기당 득점', f2(T.r / (T.games * 2)), f2(actual.runsPerTeamGame)],
    ['평균자책', f2((T.er * 27) / T.outs), f2(actual.era)],
    ['홈런', String(T.hr), String(actual.hr)],
    ['볼넷', String(T.bb), String(actual.bb)],
    ['삼진', String(T.so), String(actual.so)],
  ];
  return (
    <div className="scroll fit">
      <table className="narrow">
        <thead><tr><th className="l">지표</th><th>시뮬</th><th>실제</th></tr></thead>
        <tbody>{rows.map(([k, a, b]) => <tr key={k}><td className="l">{k}</td><td>{a}</td><td className="muted">{b}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
