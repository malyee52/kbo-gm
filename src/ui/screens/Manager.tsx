// 감독 (league/managers.ts): 지금 감독과 기록으로 본 운영 경향, 오프시즌 해임·선임, 리그 감독 목록.
import { useState } from 'react';
import {
  CANDIDATE_MAX, careerLine, candidates, infoOf, MANAGER_BUYOUT, MANAGER_YEARS, managerOf, managerSalary, tacticsOf, tendencyLabel,
} from '../../league/managers';
import type { ManagerInfo } from '../../data/types';
import { TeamName, useGame, useWon } from '../context';

const ratio = (v: number) => {
  const n = Math.round((v - 1) * 100);
  return n === 0 ? '±0%' : `${n > 0 ? '+' : '−'}${Math.abs(n)}%`;
};

function Tendency({ info }: { info: ManagerInfo | undefined }) {
  if (!info?.full) return <span className="muted small">기록 부족 (보통으로 봄)</span>;
  return (
    <span className="small">
      도루 시도 {tendencyLabel(info.steal)} <span className="muted">({ratio(info.steal)})</span> · 희생번트 {tendencyLabel(info.bunt)} <span className="muted">({ratio(info.bunt)})</span>
      {' '}· 구원 등판 {tendencyLabel(info.relief)} <span className="muted">({ratio(info.relief)})</span>
    </span>
  );
}

export function ManagerPanel() {
  const { session, changed, autosave } = useGame();
  const won = useWon();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmFire, setConfirmFire] = useState(false);
  const L = session.league;
  const me = session.teamIdx;
  const store = session.store;
  if (!store.managers || !L.managers) return null;
  const off = session.phase === 'offseason' ? session.offseason : null;
  const year = off ? off.year : session.year;
  const m = managerOf(L, me);
  const info = m ? infoOf(store, m.name) : undefined;
  const t = tacticsOf(info);
  const pool = off && !m ? candidates(L, store, year + 1).slice(0, CANDIDATE_MAX) : [];
  const act = (r: { ok: boolean; message: string }) => {
    setMsg({ text: r.message, error: !r.ok });
    setConfirmFire(false);
    if (r.ok) { changed(); void autosave(); }
  };
  const buyout = m ? Math.round(m.salary * Math.max(0, m.until - year) * MANAGER_BUYOUT) : 0;

  return (
    <>
      <section className="panel">
        <h2>감독</h2>
        {m ? (
          <>
            <div className="stats">
              <div className="stat"><span className="stat-label">감독</span><strong className="stat-value">{m.name}</strong><span className="small muted">{m.since}년부터</span></div>
              <div className="stat"><span className="stat-label">연봉</span><strong className="stat-value">{won(m.salary)}</strong></div>
              <div className="stat"><span className="stat-label">계약</span><strong className="stat-value">{m.until}년까지</strong></div>
            </div>
            <p className="small">실제 경력: {careerLine(info)}</p>
            <p>운영 경향: <Tendency info={info} /></p>
            <p className="muted small">
              운영 경향은 이 감독이 시즌 내내 맡은 해의 팀 기록을 그 해 리그 평균과 견준 것입니다 (성격·능력 평가가 아닙니다). 팀 기록에는 선수 구성도 섞여 있어 경기에는 일부만 반영합니다:
              도루 시도 ×{t.steal.toFixed(2)}, 희생번트 ×{t.bunt.toFixed(2)}, 선발 투구 한계 ×{t.hook.toFixed(2)}. 경기 중 작전은 지금처럼 감독이 합니다.
            </p>
            {off && (confirmFire
              ? <span className="inline"><button type="button" className="small-btn danger" onClick={() => act(session.fireManager())}>정말 해임 (위약금 {won(buyout)})</button><button type="button" className="small-btn" onClick={() => setConfirmFire(false)}>취소</button></span>
              : <button type="button" className="small-btn" onClick={() => setConfirmFire(true)}>해임</button>)}
            {!off && <p className="muted small">감독 교체는 오프시즌에 합니다. 해임하면 남은 계약 연봉의 {Math.round(MANAGER_BUYOUT * 100)}%를 위약금으로 냅니다.</p>}
          </>
        ) : (
          <p className="note">감독 자리가 비어 있습니다. 아래 후보 가운데서 고르세요. 고르지 않으면 개막 때 첫 후보가 맡습니다.</p>
        )}
        {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
        {pool.length > 0 && (
          <>
            <h3>감독 후보 <span className="muted small">{year + 1}~{year + MANAGER_YEARS} 시즌 계약</span></h3>
            <p className="muted small">실제 KBO 감독(대행 포함)을 맡았던 사람 가운데 지금 다른 구단에 없는 사람입니다. 경력이 긴 순서입니다.</p>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">이름</th><th className="l">경력</th><th className="l">운영 경향</th><th>연봉</th><th /></tr></thead>
                <tbody>
                  {pool.map((name) => {
                    const i = infoOf(store, name);
                    return (
                      <tr key={name}>
                        <td className="l">{name}</td><td className="l small">{careerLine(i)}</td><td className="l"><Tendency info={i} /></td>
                        <td>{won(managerSalary(i))}</td>
                        <td><button type="button" className="small-btn" onClick={() => act(session.hireManager(name))}>선임</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>리그 감독</h2>
        <div className="scroll">
          <table>
            <thead><tr><th className="l">구단</th><th className="l">감독</th><th>부임</th><th>계약</th><th className="l">운영 경향</th></tr></thead>
            <tbody>
              {L.teams.map((_, k) => {
                const x = managerOf(L, k);
                return (
                  <tr key={k} className={k === me ? 'me' : ''}>
                    <td className="l"><TeamName idx={k} /></td><td className="l">{x?.name ?? '공석'}</td><td>{x?.since ?? ''}</td><td>{x ? `${x.until}년까지` : ''}</td>
                    <td className="l">{x && <Tendency info={infoOf(store, x.name)} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(L.managerLog?.length ?? 0) > 0 && (
          <>
            <h3>감독 교체 기록</h3>
            <ul className="plain small">
              {[...L.managerLog!].reverse().slice(0, 12).map((c, k) => (
                <li key={k}><span className="muted">{c.year}</span> {L.teams[c.team]?.name}: {c.to ? `${c.from ? `${c.from} → ` : ''}${c.to} ${c.reason}` : `${c.from} ${c.reason}`}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
