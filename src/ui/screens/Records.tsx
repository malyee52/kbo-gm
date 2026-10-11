// 기록실 (역사와 서사 1단계, league/history.ts): 연표, 통산 순위, 단일 시즌 기록, 구단 역사.
// 통산은 게임 시작 전 실제 기록 + 게임 안 기록. 시즌 중이면 진행 중인 시즌도 더한다.
import { useMemo, useState } from 'react';
import {
  CAREER_STATS, careerLeaders, careers, franchiseHistory, hallOfFame, LEGEND_SEASONS, legendCandidates, SEASON_STATS, seasonBests, yearbook,
} from '../../league/history';
import type { SeasonLine } from '../../league/types';
import { useGame } from '../context';

type Tab = 'years' | 'career' | 'season' | 'teams' | 'hof';
const TABS: [Tab, string][] = [['years', '연표'], ['career', '통산 순위'], ['season', '단일 시즌 기록'], ['teams', '구단 역사'], ['hof', '명예의 전당']];

export function Records() {
  const { session, store, version, changed, autosave } = useGame();
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('years');
  const [stat, setStat] = useState('hr');
  const [sstat, setSstat] = useState('hr');
  const L = session.league;
  const me = session.team.franchise;

  // 시즌 중이면 진행 중인 시즌 기록을 통산에 더한다
  const all = useMemo(() => {
    const current = new Map<string, SeasonLine>();
    if (session.phase === 'season') {
      for (const p of session.world.players) {
        const b = session.season.bat[p.idx];
        const pt = session.season.pit[p.idx];
        if (b.pa === 0 && pt.bf === 0) continue;
        current.set(p.id, {
          year: session.year, team: session.world.teams[p.teamIdx].name,
          ...(b.pa > 0 ? { bat: Object.values(b) } : {}), ...(pt.bf > 0 ? { pit: Object.values(pt) } : {}),
        });
      }
    }
    return careers(L, store, current);
  }, [L, store, session, version]);
  const years = useMemo(() => [...yearbook(L, store)].reverse(), [L, store, version]);
  const teams = useMemo(() => franchiseHistory(L, store), [L, store, version]);

  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <h1>기록실</h1>
          <p className="muted small">
            {L.startYear}년 이전은 실제 기록, 그 뒤는 이 게임에서 쌓인 기록입니다. 통산은 둘을 합칩니다
            {session.phase === 'season' ? ' (진행 중인 시즌 포함)' : ''}.
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="기록실 구분">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </section>

      {tab === 'years' && (
        <section className="panel">
          <h2>연표</h2>
          <div className="scroll">
            <table>
              <thead><tr><th className="l">시즌</th><th className="l">우승</th><th className="l">준우승</th><th className="l">정규시즌 1위</th><th className="l">우리 구단</th></tr></thead>
              <tbody>
                {years.map((y) => {
                  const mine = y.teams.findIndex((t) => t.franchise === me);
                  return (
                    <tr key={y.year} className={y.champion && y.teams.find((t) => t.name === y.champion)?.franchise === me ? 'me' : ''}>
                      <td className="l">{y.year}{y.inGame ? '' : <span className="muted small"> 실제</span>}</td>
                      <td className="l"><strong>{y.champion ?? '-'}</strong></td>
                      <td className="l">{y.runnerUp ?? '-'}</td>
                      <td className="l">{y.teams[0] ? `${y.teams[0].name} (${y.teams[0].w}승 ${y.teams[0].l}패)` : '-'}</td>
                      <td className="l">{mine >= 0 ? `${mine + 1}위 (${y.teams[mine].w}승 ${y.teams[mine].l}패 ${y.teams[mine].t}무)` : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'career' && (
        <section className="panel">
          <h2>
            통산 순위{' '}
            <select value={stat} onChange={(e) => setStat(e.target.value)} aria-label="통산 부문">
              {CAREER_STATS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </h2>
          <table>
            <thead><tr><th>순위</th><th className="l">선수</th><th>기간</th><th>기록</th><th className="l" /></tr></thead>
            <tbody>
              {careerLeaders(all, stat, 30).map(({ c, v }, i) => {
                const def = CAREER_STATS.find((s) => s.key === stat)!;
                return (
                  <tr key={c.id} className={c.active ? 'me' : ''}>
                    <td>{i + 1}</td>
                    <td className="l">{c.name}</td>
                    <td className="small">{c.firstYear}~{c.active ? '' : c.lastYear}</td>
                    <td><strong>{def.fmt ? def.fmt(v) : v.toLocaleString('ko-KR')}</strong></td>
                    <td className="l small">{c.active ? <span className="tag">현역</span> : ''}{!c.hasReal ? <span className="tag">게임</span> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">"현역"은 지금 리그에 있는 선수, "게임"은 이 게임에서 데뷔한 선수입니다.</p>
        </section>
      )}

      {tab === 'season' && (
        <section className="panel">
          <h2>
            단일 시즌 기록{' '}
            <select value={sstat} onChange={(e) => setSstat(e.target.value)} aria-label="단일 시즌 부문">
              {SEASON_STATS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </h2>
          <table>
            <thead><tr><th>순위</th><th className="l">선수</th><th className="l">구단</th><th>시즌</th><th>기록</th></tr></thead>
            <tbody>
              {seasonBests(L, store, sstat, 20).map((e, i) => {
                const def = SEASON_STATS.find((s) => s.key === sstat)!;
                return (
                  <tr key={`${e.id}-${e.year}`} className={e.year >= L.startYear ? 'me' : ''}>
                    <td>{i + 1}</td><td className="l">{e.name}</td><td className="l">{e.team}</td><td>{e.year}</td>
                    <td><strong>{def.fmt ? def.fmt(e.value) : e.value.toLocaleString('ko-KR')}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">타율·평균자책은 규정(타석: 경기 수 × 3.1, 이닝: 경기 수)을 채운 시즌만. 강조한 줄은 이 게임에서 나온 기록입니다. 게임 안 기록은 결산 때 반영됩니다.</p>
        </section>
      )}

      {tab === 'hof' && (() => {
        const hof = hallOfFame(L, all);
        const fr = session.team.franchise;
        const legends = (L.legends ?? []).filter((l) => l.franchise === fr);
        const cands = legendCandidates(all, fr).filter((c) => !legends.some((l) => l.id === c.id));
        return (
          <>
            <section className="panel">
              <h2>명예의 전당 <span className="muted small">{hof.length}명</span></h2>
              <p className="muted small">은퇴한 선수 가운데 통산 2,000안타·300홈런·1,200타점·150승·300세이브·2,000탈삼진 또는 게임 안 MVP 2회 이상 (기록 기준, 임시값). 헌액 연도는 은퇴 다음 해입니다.</p>
              <div className="scroll">
                <table>
                  <thead><tr><th>헌액</th><th className="l">선수</th><th>기간</th><th className="l">기준</th><th className="l">대표 기록</th></tr></thead>
                  <tbody>
                    {hof.map((h) => (
                      <tr key={h.c.id} className={(h.c.franchiseSeasons[fr] ?? 0) >= LEGEND_SEASONS ? 'me' : ''}>
                        <td>{h.year}</td>
                        <td className="l">{h.c.name}{!h.c.hasReal && <span className="tag">게임</span>}</td>
                        <td className="small">{h.c.firstYear}~{h.c.lastYear}</td>
                        <td className="l small">{h.reasons.join(', ')}</td>
                        <td className="l small">
                          {h.c.bat.pa > 1000 ? `${h.c.bat.h.toLocaleString('ko-KR')}안타 ${h.c.bat.hr}홈런 ${h.c.bat.rbi.toLocaleString('ko-KR')}타점` : ''}
                          {h.c.pit.outs > 900 ? ` ${h.c.pit.w}승 ${h.c.pit.sv}세이브 ${h.c.pit.so.toLocaleString('ko-KR')}탈삼진` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <h2>{session.team.name} 구단 레전드 <span className="muted small">{legends.length}명</span></h2>
              <p className="muted small">
                우리 구단에서 {LEGEND_SEASONS}시즌 이상 뛰고 은퇴한 선수를 레전드로 지정할 수 있습니다 (영구결번 대신, 오프시즌에).
                레전드 한 명당 홈 관중률 +1%p (최대 +3%p). 한 구단에서 10시즌 이상 뛰고 통산 기록이 뚜렷한 선수(1,000안타·60승·100세이브 등)가 은퇴하면 다음 시즌 개막 사흘 동안 은퇴식으로 관중이 늡니다.
              </p>
              {legends.length > 0 && <p className="small">{legends.map((l) => `${l.name} (${l.year})`).join(' · ')}</p>}
              {msg && <p className="note small" role="status">{msg}</p>}
              <table>
                <thead><tr><th className="l">후보</th><th>우리 구단 시즌</th><th>기간</th><th /></tr></thead>
                <tbody>
                  {cands.slice(0, 30).map((c) => (
                    <tr key={c.id}>
                      <td className="l">{c.name}</td><td>{c.franchiseSeasons[fr]}</td><td className="small">{c.firstYear}~{c.lastYear}</td>
                      <td>
                        <button type="button" className="small-btn" disabled={session.phase !== 'offseason'} title={session.phase !== 'offseason' ? '오프시즌에 지정할 수 있습니다' : ''}
                          onClick={() => { const r = session.designateLegend(c.id); setMsg(r.message); if (r.ok) { changed(); void autosave(); } }}>레전드 지정</button>
                      </td>
                    </tr>
                  ))}
                  {cands.length === 0 && <tr><td className="muted small" colSpan={4}>후보가 없습니다.</td></tr>}
                </tbody>
              </table>
            </section>
          </>
        );
      })()}

      {tab === 'teams' && (
        <section className="panel">
          <h2>구단 역사</h2>
          <div className="scroll">
            <table>
              <thead><tr><th className="l">구단</th><th>우승</th><th>준우승</th><th>가을야구</th><th>시즌</th><th className="l">최고 성적</th><th className="l">최저 성적</th></tr></thead>
              <tbody>
                {teams.map((f) => (
                  <tr key={f.franchise} className={f.franchise === me ? 'me' : ''}>
                    <td className="l">{f.name}</td>
                    <td title={f.titles.join(', ')}><strong>{f.titles.length}</strong></td>
                    <td title={f.runnerUps.join(', ')}>{f.runnerUps.length}</td>
                    <td>{f.postseasons}</td>
                    <td>{f.seasons}</td>
                    <td className="l small">{f.best ? `${f.best.year} ${f.best.name} ${f.best.w}승 ${f.best.l}패` : '-'}</td>
                    <td className="l small">{f.worst ? `${f.worst.year} ${f.worst.name} ${f.worst.w}승 ${f.worst.l}패` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">계보(이름이 바뀐 구단 포함)별로 셉니다. 우승 연도는 숫자 위에 마우스를 올리면 보입니다. 가을야구는 그 해 진출 구단 수 안의 정규시즌 순위로 셉니다.</p>
        </section>
      )}
    </div>
  );
}
