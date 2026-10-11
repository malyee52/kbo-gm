// 구장·팬 (구단 운영 탭, stadium.ts): 우리 구장과 공사 주문, 팬 만족도와 그 변화, 리그 구단 비교.
import { useState } from 'react';
import {
  downPayment, fanFill, fanLevel, fanSponsor, HONEYMOON, installment, REMODEL, seatsAt, stadiumFill, stadiumOptions, ticketScale, underConstruction, yearlyPayment,
} from '../../league/stadium';
import { TeamName, useGame, useWon } from '../context';

const levelClass = (v: number) => (v >= 75 ? 'g-hi' : v >= 60 ? 'g-up' : v <= 25 ? 'g-lo' : v <= 40 ? 'g-dn' : '');
const pctp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%p`;

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div className="gbar">
      <span>{label}</span>
      <span className="track" aria-hidden><i className={levelClass(v)} style={{ width: `${v}%` }} /></span>
      <strong>{Math.round(v)}</strong>
    </div>
  );
}

export function StadiumPanel() {
  const { session, changed, autosave } = useGame();
  const won = useWon();
  const L = session.league;
  const me = session.teamIdx;
  const off = session.phase === 'offseason';
  // 오프시즌이면 다음 시즌 기준
  const year = off ? session.year + 1 : session.year;
  const s = L.stadiums?.[me];
  const fans = fanLevel(L, me, session.year, off ? undefined : session.day - 1);
  const log = [...(L.fans?.[me]?.log ?? [])].reverse().slice(0, 14);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  if (!s) return <section className="panel"><p className="muted">구장 정보가 없습니다 (예전 저장). 다음 결산 뒤에 생깁니다.</p></section>;

  const order = (id: string) => {
    const r = session.orderStadium(id);
    setMsg({ text: r.message, error: !r.ok });
    setConfirm(null);
    changed();
    if (r.ok) void autosave();
  };
  const p = s.project;
  const building = p && p.open > session.year;
  const honey = s.opened !== undefined ? HONEYMOON[year - s.opened] ?? 0 : 0;

  return (
    <>
      <section className="panel">
        <h2>우리 구장 <span className="muted small">{s.opened !== undefined ? `${s.opened}년 개장` : '기존 구장'}</span></h2>
        <div className="stats">
          <div className="stat"><span className="stat-label">수용 인원</span><strong className="stat-value">{s.capacity.toLocaleString()}석</strong>
            {underConstruction(s, year) && p?.kind === 'remodel' && <span className="small down">{year} 시즌 공사 중 {seatsAt(s, year).toLocaleString()}석만</span>}</div>
          <div className="stat"><span className="stat-label">관중률 보정 (시설{honey ? '·새 구장' : ''})</span><strong className="stat-value">{pctp(stadiumFill(s, year))}</strong></div>
          <div className="stat"><span className="stat-label">객단가</span><strong className="stat-value">×{ticketScale(s).toFixed(2)}</strong></div>
        </div>
        <Meter label="시설" v={s.quality} />
        <p className="muted small">시설은 해마다 1씩 낡습니다 (바닥 20). 50이 보통이고, 높을수록 관중이 더 들고 입장권을 비싸게 받을 수 있습니다. 신구장은 개장 뒤 세 시즌 동안 관중이 더 듭니다.</p>

        {building && p && (
          <div className="note">
            <strong>{p.kind === 'new' ? '신구장 건설' : '리모델링'} 중</strong>: {p.start}~{p.open - 1} 시즌 공사, {p.open} 시즌 개장 ({p.capacity.toLocaleString()}석).
            {' '}구단 부담 {won(p.cost)} (착공금 {won(downPayment(p.cost))}, 해마다 결산 때 {won(yearlyPayment(p.cost, p.open - p.start))}씩).
            {installment(s, session.year) > 0 && !off && ` 이번 시즌 결산 때 ${won(installment(s, session.year))}을 냅니다.`}
          </div>
        )}

        {off && !building && (
          <>
            <h3>공사 주문 <span className="muted small">{year} 시즌부터 공사</span></h3>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">공사</th><th>구단 부담</th><th>착공금</th><th>기간</th><th>해마다</th><th>완공 뒤</th><th className="l">공사 중</th><th /></tr></thead>
                <tbody>
                  {stadiumOptions().map((o) => (
                    <tr key={o.id}>
                      <td className="l">{o.label}</td><td>{won(o.cost)}</td><td>{won(downPayment(o.cost))}</td><td>{o.years}시즌</td><td>{won(yearlyPayment(o.cost, o.years))}</td>
                      <td>{o.capacity(s.capacity).toLocaleString()}석 · 시설 {o.kind === 'new' ? 100 : Math.min(90, s.quality - 1 + REMODEL.quality)}</td>
                      <td className="l small">{o.kind === 'remodel' ? `그 시즌 관중석 ${Math.round(REMODEL.closed * 100)}% 못 씀` : '옛 구장을 그대로 씀'}</td>
                      <td>
                        {confirm === o.id
                          ? <span className="inline"><button type="button" className="small-btn danger" onClick={() => order(o.id)}>정말 주문</button><button type="button" className="small-btn" onClick={() => setConfirm(null)}>취소</button></span>
                          : <button type="button" className="small-btn" onClick={() => setConfirm(o.id)}>주문</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">신구장은 지자체와 함께 짓는 것으로 보고 구단 몫만 냅니다. 공사비 때문에 적자가 나면 모기업이 메우지만 구단주 신뢰도가 떨어집니다. 수치는 임시값입니다.</p>
          </>
        )}
        {!off && !building && <p className="muted small">공사는 오프시즌에 주문합니다.</p>}
        {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
      </section>

      <section className="panel">
        <h2>팬 만족도</h2>
        <Meter label="만족도" v={fans} />
        <div className="stats">
          <div className="stat"><span className="stat-label">관중률 보정</span><strong className="stat-value">{pctp(fanFill(fans))}</strong></div>
          <div className="stat"><span className="stat-label">스폰서·상품</span><strong className="stat-value">×{fanSponsor(fans).toFixed(2)}</strong></div>
        </div>
        <p className="muted small">성적·가을야구·우승이 만족도를 올립니다. 우리 구단에서 5시즌 넘게 뛴 주축(프랜차이즈 스타)을 트레이드하거나 FA로 잃으면 크게 떨어지고, FA에서 붙잡으면 오릅니다. 해마다 연고 기본값 쪽으로 조금씩 돌아갑니다.</p>
        {log.length > 0 && (
          <ul className="plain small">
            {log.map((e, k) => (
              <li key={k}><span className={e.delta >= 0 ? 'up' : 'down'}>{e.delta >= 0 ? '+' : '−'}{Math.abs(e.delta).toFixed(1)}</span> <span className="muted">{e.year}{e.day === -2 ? ' 오프시즌' : ''}</span> {e.reason}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>리그 구장·팬</h2>
        <div className="scroll">
          <table>
            <thead><tr><th className="l">구단</th><th>수용 인원</th><th>시설</th><th>팬 만족도</th><th className="l">공사</th></tr></thead>
            <tbody>
              {L.teams.map((_, t) => {
                const st = L.stadiums?.[t];
                if (!st) return null;
                const pr = st.project && st.project.open > session.year ? st.project : null;
                return (
                  <tr key={t} className={t === me ? 'me' : ''}>
                    <td className="l"><TeamName idx={t} /></td><td>{st.capacity.toLocaleString()}</td><td>{st.quality}</td>
                    <td>{Math.round(fanLevel(L, t, session.year, off ? undefined : session.day - 1))}</td>
                    <td className="l small">{pr ? `${pr.kind === 'new' ? '신구장' : '리모델링'} ${pr.open} 개장` : st.opened !== undefined ? `${st.opened} 개장` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
