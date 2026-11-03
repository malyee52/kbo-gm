// 구단 재정 (재정 상세형, docs/finance.md): 지금 자금, 올해 수입·지출, 월별 흐름, 지난 결산.
import { dateOf } from '../../game/calendar';
import {
  FINANCE_LABEL, investCostOf, INVEST_EFFECT, marketingStock, INVEST_KINDS, INVEST_LABEL, investCost, ledgerItems, OPS_KINDS, type FinanceKind, type OpsKind,
} from '../../league/finance';
import { wageIndex } from '../../league/salary';
import { useGame, useWon } from '../context';

// 표의 줄 차례 (재정 2 기획안 4.1: 수입 R1~R7, 지출 E1~E10). 수입·지출 어느 쪽인지는 금액 부호로 가른다
const ORDER: FinanceKind[] = [
  'gate', 'postseason', 'broadcast', 'sponsor', 'parent', 'rescue', 'faSupport', 'champion', 'posting',
  'payroll', 'foreign', 'coach', 'opsFront', 'opsGame', 'opsPark', 'opsFutures', 'ops', 'invest', 'scouting', 'signing',
  'compensation', 'fine', 'transfer', 'stadium', 'release', 'trade', 'event', 'editor', 'other',
];
const orderOf = (k: FinanceKind) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i; };

interface Row { kind: FinanceKind; plan: number; sofar: number; end: number }

/** 계획 / 지금까지 / 시즌 끝 예상 줄 (시즌 중). 오프시즌에는 다음 시즌 계획과 다음 시즌 장부에 이미 적힌 것 */
function useMoneyRows(): { rows: Row[]; season: boolean } {
  const { session } = useGame();
  const v = session.budgetView();
  if (v.rows) return { rows: v.rows, season: true };
  const booked = ledgerItems(session.league, session.teamIdx, session.year + 1);
  const rows = (Object.keys(v.plan.items) as FinanceKind[]).map((k) => ({ kind: k, plan: v.plan.items[k] ?? 0, sofar: booked[k] ?? 0, end: v.plan.items[k] ?? 0 }));
  return { rows, season: false };
}

const sideOf = (r: Row) => Math.sign(r.end || r.plan || r.sofar);
const sumRows = (xs: Row[]): Row => xs.reduce((s, r) => ({ kind: s.kind, plan: s.plan + r.plan, sofar: s.sofar + r.sofar, end: s.end + r.end }), { kind: 'other' as FinanceKind, plan: 0, sofar: 0, end: 0 });

function MoneyTable() {
  const plain = useWon();
  const won = (v: number) => (v < 0 ? `−${plain(-v)}` : plain(v + 0));
  const { rows, season } = useMoneyRows();
  const part = (sign: 1 | -1) => rows.filter((r) => sideOf(r) === sign).sort((a, b) => orderOf(a.kind) - orderOf(b.kind));
  const line = (r: Row, label: string, sign: 1 | -1, bold = false) => {
    // 차이: 시즌 끝 예상 − 계획. 수입이 늘거나 지출이 줄면 +
    // 지급마다 반올림한 차이(몇만 원)는 없는 것으로 본다
    const diff = Math.abs(r.end - r.plan) < 100 ? 0 : (r.end - r.plan) * sign;
    const b = bold ? ' strong' : '';
    return (
      <tr key={label}>
        <td className={`l${b}`}>{label}</td>
        <td className={b.trim() || undefined}>{won(r.plan * sign)}</td>
        <td className={b.trim() || undefined}>{won(r.sofar * sign)}</td>
        {season && <td className={b.trim() || undefined}>{won(r.end * sign)}</td>}
        {season && <td className={`${diff < 0 ? 'down' : diff > 0 ? 'up' : ''}${b}`.trim() || undefined}>{diff ? `${diff > 0 ? '+' : '−'}${plain(Math.abs(r.end - r.plan))}` : '-'}</td>}
      </tr>
    );
  };
  const inc = part(1);
  const exp = part(-1);
  const net = sumRows([...inc, ...exp]);
  const cols = season ? 5 : 3;
  return (
    <>
      <table className="money-table">
        <thead><tr><th className="l">항목</th><th>계획</th><th>지금까지</th>{season && <th>시즌 끝 예상</th>}{season && <th title="시즌 끝 예상 − 계획. 수입이 늘거나 지출이 줄면 +">차이</th>}</tr></thead>
        <tbody>
          <tr><th className="l" colSpan={cols}>수입</th></tr>
          {inc.map((r) => line(r, FINANCE_LABEL[r.kind], 1))}
          {line(sumRows(inc), '수입 합', 1, true)}
          <tr><th className="l" colSpan={cols}>지출</th></tr>
          {exp.map((r) => line(r, FINANCE_LABEL[r.kind], -1))}
          {line(sumRows(exp), '지출 합', -1, true)}
          {line(net, '수지', 1, true)}
        </tbody>
      </table>
      <p className="muted small">
        계획은 개막 때 모습(지난 시즌 승률 그대로, 가을야구 없음)으로 잡은 한 해 금액입니다.
        {season ? ' 시즌 끝 예상은 지금까지에 남은 지급(지금 소속 연봉)과 남은 홈 경기의 계획 관중 수입을 더하고, 스폰서는 지금 승률로 다시 셉니다.' : ' 지금까지는 다음 시즌 장부에 이미 적힌 돈(계약금·보상금 등)입니다.'}
        {' '}운영비는 프런트·원정·경기 운영·구장 운영·2군 운영 네 줄로 나눠 적습니다 (예전 결산의 운영비는 한 줄).
      </p>
    </>
  );
}

/**
 * 예산안 (재정 2 F1a, 읽기 전용): 한 시즌 예상 수입·지출 계획과 예상 수지, 연말 자금 전 → 후.
 * 시즌 중에는 이번 시즌 계획(개막 때 확정), 오프시즌에는 다음 시즌 계획. 예산 입력은 F2에서
 */
export function BudgetPanel() {
  const { session } = useGame();
  const plain = useWon();
  const won = (v: number) => (v < 0 ? `−${plain(-v)}` : plain(v + 0));
  const v = session.budgetView();
  const season = !!v.rows;
  const year = v.plan.year;
  const items = v.plan.items;
  const kinds = (Object.keys(items) as FinanceKind[]).filter((k) => items[k]).sort((a, b) => orderOf(a) - orderOf(b));
  const inc = kinds.filter((k) => (items[k] ?? 0) > 0);
  const exp = kinds.filter((k) => (items[k] ?? 0) < 0);
  const sum = (ks: FinanceKind[]) => ks.reduce((s, k) => s + (items[k] ?? 0), 0);
  const net = sum(inc) + sum(exp);
  const cash = session.cashNow();
  // 연말 자금 예상: 지금 자금 + 아직 들어오거나 나가지 않은 몫 (시즌 중 = 시즌 끝 예상 − 지금까지, 오프시즌 = 계획 − 이미 장부에 적힌 것)
  const booked = ledgerItems(session.league, session.teamIdx, year);
  const rest = season
    ? v.rows!.reduce((s, r) => s + r.end - r.sofar, 0)
    : kinds.reduce((s, k) => s + (items[k] ?? 0) - (booked[k] ?? 0), 0);
  const endCash = cash + rest;
  const ops = OPS_KINDS.reduce((s, k) => s + (items[k] ?? 0), 0);
  return (
    <section className="panel">
      <h2>예산안 <span className="muted small">{year} 시즌 · {season ? '개막 때 확정 (읽기만)' : '다음 시즌 예상 (읽기만, 예산 조정은 다음 단계에서)'}</span></h2>
      <div className="stats">
        <div className="stat"><span className="stat-label">예상 수입</span><span className="stat-value">{won(sum(inc))}</span></div>
        <div className="stat"><span className="stat-label">예상 지출</span><span className="stat-value">{won(-sum(exp))}</span></div>
        <div className="stat"><span className="stat-label">예상 수지</span><span className={`stat-value ${net < 0 ? 'down' : 'up'}`}>{won(net)}</span></div>
        <div className="stat"><span className="stat-label">연말 자금 (지금 → 예상)</span><span className={`stat-value${endCash < 0 ? ' down' : ''}`}>{won(cash)} → {won(endCash)}</span></div>
      </div>
      <div className="cards">
        <div>
          <h3>예상 수입</h3>
          <table className="narrow"><tbody>
            {inc.map((k) => <tr key={k}><td className="l">{FINANCE_LABEL[k]}</td><td>{won(items[k] ?? 0)}</td></tr>)}
            <tr><td className="l strong">합</td><td className="strong">{won(sum(inc))}</td></tr>
          </tbody></table>
          <p className="muted small">
            관중 수입은 {v.plan.homeGames ? `홈 ${v.plan.homeGames}경기 × 한 경기 ${won(Math.round(v.plan.perGame))}` : '홈 경기 없음'},
            지난 시즌 승률 {v.plan.winPct.toFixed(3)} 그대로 가정 (가을야구 없음). 스폰서·상품도 같은 승률로 셉니다.
          </p>
        </div>
        <div>
          <h3>지출 계획</h3>
          <table className="narrow"><tbody>
            {exp.map((k) => <tr key={k}><td className="l">{FINANCE_LABEL[k]}{OPS_KINDS.includes(k as OpsKind) ? <span className="muted small"> · 운영비</span> : null}</td><td>{won(-(items[k] ?? 0))}</td></tr>)}
            <tr><td className="l strong">합</td><td className="strong">{won(-sum(exp))}</td></tr>
          </tbody></table>
          <p className="muted small">운영비 {won(-ops)}는 프런트·원정·경기 운영·구장 운영·2군 운영 네 줄입니다 (나눈 몫은 임시값). 투자는 {season ? '개막 때 확정한 단계' : '재정 화면의 다음 시즌 계획'} 금액입니다.</p>
        </div>
      </div>
      <p className="muted small">결산 때 자금이 0보다 작으면 모기업이 메우고(구단주 신뢰도 −), 100억 원을 넘으면 넘는 몫의 절반을 모기업에 돌려줍니다. 예산안의 연말 자금은 그 전 금액입니다.</p>
    </section>
  );
}

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
  // 투자비는 그 해 연봉 상승 지수만큼 오른다 (오프시즌에는 계획이 적용될 다음 시즌 값)
  const investWage = wageIndex(session.phase === 'offseason' ? session.year + 1 : session.year, L);
  const last = fin?.history.at(-1);
  // 시즌 중이면 진행 중인 시즌의 흐름, 오프시즌이면 다음 시즌 장부(보상금·계약금 등)
  const year = session.phase === 'season' ? session.year : session.year + 1;
  const items: Partial<Record<FinanceKind, number>> = { ...(flows?.items ?? {}) };
  const booked = ledgerItems(L, me, year);
  for (const k of Object.keys(booked) as FinanceKind[]) if (k !== 'start') items[k] = (items[k] ?? 0) + (booked[k] ?? 0);
  const vals = Object.values(items).map((v) => v ?? 0);
  const income = vals.filter((v) => v > 0).map((v) => ({ v }));
  const expense = vals.filter((v) => v < 0).map((v) => ({ v }));
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
        관중 수입은 홈 경기마다 들어오고, 연봉·운영비·투자비는 2~11월 10번 지급일에 나갑니다. 중계권·모기업 지원금·스폰서 기본액도 같은 지급일에 나눠 들어오며,
        스폰서·상품은 시즌 결산 때 실제 성적과 인기로 다시 매겨 차액을 정산합니다. 결산 뒤 자금이 모자라면 모기업이 메우지만 구단주 신뢰도가 떨어지고
        다음 해 지원금이 줄어듭니다. 금액은 그 해 물가로 표시하며, 수치는 임시값입니다.
      </p>

      <MoneyTable />

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
                <td>{won(investCostOf(k, lv, investWage))}</td>
                <td className="l small">{INVEST_EFFECT[k][lv]}{k === 'marketing' && ` · 지금 쌓인 효과 ${marketingStock(session.league, session.teamIdx).toFixed(1)}단계`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        투자는 오프시즌에 다음 시즌 계획을 정하고, 개막 때 확정됩니다. 비용은 시즌 동안 지급일마다 나눠 냅니다
        ({session.phase === 'offseason' ? `계획 합계 연 ${won(investCost(fin, true, investWage))}` : `연 ${won(investCost(fin, false, investWage))}`}).
        의료는 그 시즌 동안, 마케팅은 개막 때마다 고른 단계 쪽으로 효과가 조금씩 쌓이고(끊으면 천천히 빠짐), 육성·스카우트는 그 시즌이 끝난 뒤 성장 판정과 드래프트·외국인 후보 평가에 효과가 납니다.
      </p>

      {flows && (
        <>
          <h3>지급일별 <span className="muted small">홈 관중 {flows.attendance.toLocaleString('ko-KR')}명 ({flows.homeGames}경기{flows.homeGames ? `, 평균 ${Math.round(flows.attendance / flows.homeGames).toLocaleString('ko-KR')}명` : ''})</span></h3>
          <table className="narrow">
            <thead><tr><th className="l">지급일</th><th className="l">낸 달</th><th>수지</th></tr></thead>
            <tbody>
              {flows.months.map((m) => {
                const paid = m.when === 'open' || (m.when === 'day' && m.day < session.currentDay);
                const d = dateOf(session.year, m.day);
                const label = m.when === 'open' ? `개막일 (${d.month}월 ${d.date}일)` : m.when === 'settle' ? '결산' : `${d.month}월 ${d.date}일`;
                const next = flows.months.find((x) => x.when === 'day' && x.day >= session.currentDay);
                const state = paid ? '' : m.when === 'settle' ? ' (결산 때)' : m === next ? ' (진행 중)' : ' (예정)';
                return (
                  <tr key={`${m.when}-${m.day}`}>
                    <td className="l">{label}{state}</td>
                    <td className="l small">{m.months.map((x) => `${x}월`).join('·')}분</td>
                    <td className={m.net < 0 ? 'down' : m.net > 0 ? 'up' : undefined}>{m.net ? won(m.net) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            연봉·감독·코치·운영비·투자비와 중계권·모기업 지원금·스폰서 기본액은 2~11월 10번(규약의 10회 분할)에 나눠 냅니다:
            개막 전 달 몫은 개막일에, 경기가 있는 달은 그 달 마지막 날에, 시즌 뒤 달 몫은 결산 때. 관중 수입은 그 경기 뒤 첫 지급일 칸에 셉니다.
            다음 지급일: {(() => { const n = flows.months.find((m) => m.when === 'day' && m.day >= session.currentDay); if (!n) return '결산'; const d = dateOf(session.year, n.day); return `${d.month}월 ${d.date}일`; })()}
          </p>
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
