// 코치진 (league/coaches.ts): 지금 코치와 효과, 오프시즌에는 후보 고용.
import { useState } from 'react';
import {
  COACH_BUYOUT, COACH_DECLINE, COACH_EDGE, COACH_GROWTH, COACH_ROLE_LABEL, COACH_ROLES, COACH_STYLE_LABEL, coachCostPerWin, coachEdge, coachOf, coachPayroll,
  coachWins, FA_WIN_WON, recommendCoach, type Coach,
} from '../../league/coaches';
import { wageIndex } from '../../league/salary';
import { useGame, useWon } from '../context';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const pct = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}`;

export function CoachPanel() {
  const { session, changed, autosave } = useGame();
  const won = useWon();
  const [msg, setMsg] = useState<string | null>(null);
  const L = session.league;
  const me = session.teamIdx;
  const edge = coachEdge(L, me);
  const off = session.phase === 'offseason' ? session.offseason : null;
  const market = session.coachCandidates();
  const inSeason = session.phase === 'season';
  const year = off ? off.year : session.year;
  // 후보 연봉에 곱해진 연봉 상승 지수 (오프시즌 후보는 다음 시즌 계약)
  const wage = wageIndex(inSeason ? year : year + 1, L);
  const picks = new Set(COACH_ROLES.map((r) => recommendCoach(market.filter((c) => c.role === r), wage)?.id).filter(Boolean));
  const perWin = (c: Coach) => { const v = coachCostPerWin(c, wage); return v === null ? '-' : won(v); };

  const effect = (c: Coach) => {
    const sgn = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))}%`;
    if (c.role === 'dev') return `2군에서 뛴 선수 성장 ${sgn((c.level - 3) * COACH_GROWTH * (c.style === 'young' ? 125 : 100))}`;
    if (c.role === 'def') return `투수진 경기력 ${pct((c.level - 3) * COACH_EDGE * 0.5)}`;
    const grow = (c.level - 3) * COACH_GROWTH * (c.style === 'veteran' ? 50 : 100);
    return `경기력 ${pct((c.level - 3) * COACH_EDGE)} · 성장 ${sgn(grow)}${c.style === 'young' ? ' (25세 이하 1.5배)' : ''}${c.style === 'veteran' && c.level > 3 ? ` · 31세+ 하락 −${Math.round((c.level - 3) * COACH_DECLINE * 100)}%` : ''}`;
  };

  return (
    <section className="panel">
      <h2>코치진 <span className="muted small">연봉 합 {won(coachPayroll(L, me))} / 년</span></h2>
      <p className="muted small">
        코치는 실명 자료가 없어 역할·등급·성향으로만 나옵니다. 3등급이 리그 평균이고, 시즌 중 경기력(타석마다 유리한 정도, %p)과 결산 때 선수 성장에 영향을 줍니다.
        지금: 타자 {pct(edge.bat)}, 투수 {pct(edge.pit)}. 아래 후보 가운데서 시즌 중에도 오프시즌에도 데려올 수 있습니다 (빈자리는 개막 때 직원 추천으로 채웁니다).
        연봉은 기대 승 1승마다 FA 시장 1승당 값(약 {won(FA_WIN_WON * wage)})씩 비싸집니다 (같은 등급도 후보마다 ±15%). 직원 추천은 1등급보다 더 내는 연봉에 비해 효과가 가장 큰 후보입니다.
      </p>
      <table>
        <thead><tr><th className="l">역할</th><th>등급</th><th>성향</th><th className="l">경력</th><th>연봉</th><th>계약</th><th className="l">효과</th></tr></thead>
        <tbody>
          {COACH_ROLES.map((role) => {
            const c = coachOf(L, me, role);
            return (
              <tr key={role}>
                <td className="l">{COACH_ROLE_LABEL[role]}</td>
                {c ? (
                  <>
                    <td className="stars">{stars(c.level)}</td><td>{COACH_STYLE_LABEL[c.style]}</td><td className="l small">{c.career}</td>
                    <td>{won(c.salary)}</td><td>{c.until}년까지</td><td className="l small">{effect(c)}</td>
                  </>
                ) : <td colSpan={6} className="muted small">비어 있음 (오프시즌에 고용)</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {msg && <p className="note small" role="status">{msg}</p>}
      {market.length > 0 && (
        <>
          <h3>코치 후보 <span className="muted small">{inSeason ? `${year} 시즌 오늘부터` : `${year + 1} 시즌부터`}</span></h3>
          <p className="muted small">같은 역할 코치가 있으면 남은 계약 연봉의 {Math.round(COACH_BUYOUT * 100)}%를 위약금으로 내고 바꿉니다.</p>
          <div className="scroll">
            <table>
              <thead><tr><th className="l">역할</th><th>등급</th><th>성향</th><th className="l">경력</th><th>연봉</th><th title="1등급 코치보다 한 시즌에 더 이기는 승수 (성장이 몇 해 남는 몫 포함, 성향은 빼고 셈)">기대 승</th><th title="1등급보다 더 내는 연봉 ÷ 기대 승">1승당</th><th>계약</th><th /></tr></thead>
              <tbody>
                {[...market].sort((a, b) => COACH_ROLES.indexOf(a.role) - COACH_ROLES.indexOf(b.role) || b.level - a.level).map((c) => {
                  const cur = coachOf(L, me, c.role);
                  const buyout = cur ? Math.round(cur.salary * Math.max(0, cur.until - year) * COACH_BUYOUT) : 0;
                  return (
                    <tr key={c.id}>
                      <td className="l">{COACH_ROLE_LABEL[c.role]}{picks.has(c.id) && <span className="tag on" title="직원 추천: 더 내는 연봉에 비해 효과가 가장 큰 후보">추천</span>}</td>
                      <td className="stars">{stars(c.level)}</td><td>{COACH_STYLE_LABEL[c.style]}</td>
                      <td className="l small">{c.career}</td><td>{won(c.salary)}</td><td>{coachWins(c).toFixed(2)}</td><td>{perWin(c)}</td><td>{c.until}년까지</td>
                      <td>
                        <button type="button" className="small-btn" title={buyout ? `위약금 ${won(buyout)}` : undefined}
                          onClick={() => { const r = inSeason ? session.hireCoachInSeason(c.id) : session.hireCoach(c.id); setMsg(r.message); if (r.ok) { changed(); void autosave(); } }}>
                          {cur ? '교체' : '고용'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
