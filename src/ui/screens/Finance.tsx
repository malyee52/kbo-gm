// 구단 재정 (재정 상세형, docs/finance.md): 지금 자금, 올해 수입·지출, 월별 흐름, 지난 결산.
import { dateOf } from '../../game/calendar';
import {
  FINANCE_LABEL, INVEST_COST, INVEST_EFFECT, INVEST_KINDS, INVEST_LABEL, investCost, ledgerItems, type FinanceKind,
} from '../../league/finance';
import { useGame, useWon } from '../context';

const INCOME: FinanceKind[] = ['gate', 'postseason', 'broadcast', 'sponsor', 'parent', 'champion', 'rescue', 'compensation', 'trade', 'event', 'other'];
const EXPENSE: FinanceKind[] = ['payroll', 'foreign', 'ops', 'invest', 'signing', 'transfer', 'compensation', 'fine', 'trade', 'event', 'other'];

export function FinancePanel() {
  const { session, changed, autosave } = useGame();
  const plain = useWon();
  // 음수는 "−6억 3,474만 원"처럼 (wonText는 음수를 단위마다 부호를 붙인다)
  const won = (v: number) => (v < 0 ? `−${plain(-v)}` : plain(v + 0)); // + 0: −0을 0으로
  const me = session.teamIdx;
  const L = session.league;
  const cash = session.cashNow();
  const flows = session.seasonFinance();
  const fin = L.finance?.[me];
  const last = fin?.history.at(-1);
  // 시즌 중이면 진행 중인 시즌의 흐름, 오프시즌이면 다음 시즌 장부(보상금·계약금 등)
  const year = session.phase === 'season' ? session.year : session.year + 1;
  const items: Partial<Record<FinanceKind, number>> = { ...(flows?.items ?? {}) };
  const booked = ledgerItems(L, me, year);
  for (const k of Object.keys(booked) as FinanceKind[]) if (k !== 'start') items[k] = (items[k] ?? 0) + (booked[k] ?? 0);
  const rows = (keys: FinanceKind[], sign: 1 | -1) => keys
    .map((k) => ({ k, v: items[k] ?? 0 }))
    .filter((x) => x.v * sign > 0);
  const income = rows(INCOME, 1);
  const expense = rows(EXPENSE, -1);
  const sum = (xs: { v: number }[]) => xs.reduce((s, x) => s + x.v, 0);

  return (
    <section className="panel">
      <h2>
        재정 <span className="muted small">{session.phase === 'season' ? `${session.year} 시즌 진행 중` : `${session.year} 결산 뒤 · ${session.year + 1} 시즌 준비`}</span>
      </h2>
      <div className="stats">
        <div className="stat"><span className="stat-label">지금 자금</span><span className={`stat-value${cash < 0 ? ' down' : ''}`}>{won(cash)}</span></div>
        <div className="stat"><span className="stat-label">{year} 수입</span><span className="stat-value">{won(sum(income))}</span></div>
        <div className="stat"><span className="stat-label">{year} 지출</span><span className="stat-value">{won(-sum(expense))}</span></div>
        <div className="stat"><span className="stat-label">{year} 수지</span><span className={`stat-value ${sum(income) + sum(expense) < 0 ? 'down' : 'up'}`}>{won(sum(income) + sum(expense))}</span></div>
      </div>
      <p className="muted small">
        관중 수입은 홈 경기마다 들어오고, 연봉·운영비·투자비는 월말마다 나갑니다. 중계권·모기업 지원금·스폰서 기본액도 월말에 나눠 들어오며,
        스폰서·상품은 시즌 결산 때 실제 성적과 인기로 다시 매겨 차액을 정산합니다. 결산 뒤 자금이 모자라면 모기업이 메우지만 구단주 신뢰도가 떨어지고
        다음 해 지원금이 줄어듭니다. 금액은 그 해 물가로 표시하며, 수치는 임시값입니다.
      </p>

      <div className="cards">
        <div>
          <h3>수입</h3>
          <table className="narrow">
            <tbody>
              {income.length === 0 && <tr><td className="muted small">아직 없습니다</td></tr>}
              {income.map((x) => <tr key={x.k}><td className="l">{FINANCE_LABEL[x.k]}</td><td>{won(x.v)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div>
          <h3>지출</h3>
          <table className="narrow">
            <tbody>
              {expense.length === 0 && <tr><td className="muted small">아직 없습니다</td></tr>}
              {expense.map((x) => <tr key={x.k}><td className="l">{FINANCE_LABEL[x.k]}</td><td>{won(-x.v)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      <h3>투자 <span className="muted small">{session.phase === 'offseason' ? `${session.year + 1} 시즌 계획 (개막 때 확정)` : `${session.year} 시즌 적용 중`}</span></h3>
      <table>
        <thead><tr><th className="l">항목</th><th>단계</th><th>연간 비용</th><th className="l">효과</th></tr></thead>
        <tbody>
          {INVEST_KINDS.map((k) => {
            const lv = session.phase === 'offseason' ? fin?.invest[k] ?? 0 : (fin?.active ?? fin?.invest)?.[k] ?? 0;
            return (
              <tr key={k}>
                <td className="l">{INVEST_LABEL[k]}</td>
                <td>
                  {session.phase === 'offseason' ? (
                    <select value={lv} aria-label={`${INVEST_LABEL[k]} 단계`} onChange={(e) => {
                      const r = session.setInvest(k, Number(e.target.value));
                      if (r.ok) { changed(); void autosave(); }
                    }}>
                      {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}단계</option>)}
                    </select>
                  ) : `${lv}단계`}
                </td>
                <td>{won(INVEST_COST[k][lv])}</td>
                <td className="l small">{INVEST_EFFECT[k][lv]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        투자는 오프시즌에 다음 시즌 계획을 정하고, 개막 때 확정됩니다. 비용은 시즌 동안 월말에 나눠 냅니다
        ({session.phase === 'offseason' ? `계획 합계 연 ${won(investCost(fin, true))}` : `연 ${won(investCost(fin))}`}).
        의료·마케팅은 그 시즌 동안, 육성·스카우트는 그 시즌이 끝난 뒤 성장 판정과 드래프트·외국인 후보 평가에 효과가 납니다.
      </p>

      {flows && (
        <>
          <h3>월별 <span className="muted small">홈 관중 {flows.attendance.toLocaleString('ko-KR')}명 ({flows.homeGames}경기{flows.homeGames ? `, 평균 ${Math.round(flows.attendance / flows.homeGames).toLocaleString('ko-KR')}명` : ''})</span></h3>
          <table className="narrow">
            <thead><tr><th className="l">월</th><th>수지</th></tr></thead>
            <tbody>
              {flows.months.filter((m) => m.net !== 0 || m.day < session.currentDay).map((m) => (
                <tr key={m.month}><td className="l">{m.month}월 {m.day < session.currentDay ? '' : '(진행 중)'}</td><td className={m.net < 0 ? 'down' : 'up'}>{won(m.net)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">다음 월말 지급일: {(() => { const n = flows.months.find((m) => m.day >= session.currentDay); if (!n) return '없음'; const d = dateOf(session.year, n.day); return `${d.month}월 ${d.date}일`; })()}</p>
        </>
      )}

      {fin && fin.history.length > 0 && (
        <>
          <h3>지난 결산</h3>
          <table>
            <thead><tr><th className="l">시즌</th><th>수입</th><th>지출</th><th>수지</th><th>모기업 긴급 지원</th><th title="결산 뒤 자금이 100억 원을 넘으면 넘는 금액의 절반을 모기업에 돌려준다">모기업 환원</th><th>결산 뒤 자금</th></tr></thead>
            <tbody>
              {[...fin.history].reverse().map((y) => {
                const vals = Object.values(y.items).map((v) => v ?? 0);
                return (
                  <tr key={y.year}>
                    <td className="l">{y.year}</td>
                    <td>{won(vals.filter((v) => v > 0).reduce((s, v) => s + v, 0))}</td>
                    <td>{won(-vals.filter((v) => v < 0).reduce((s, v) => s + v, 0))}</td>
                    <td className={y.net < 0 ? 'down' : 'up'}>{won(y.net)}</td>
                    <td>{y.rescue ? won(y.rescue) : '-'}</td>
                    <td>{y.dividend ? won(y.dividend) : '-'}</td>
                    <td>{won(y.cash)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {last && <p className="muted small">{last.year} 결산은 시즌 결과 화면과 알림에도 있습니다.</p>}
        </>
      )}
    </section>
  );
}
