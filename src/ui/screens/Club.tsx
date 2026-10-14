// 구단 현황 (M7, 화면 11): 구단주 목표와 신뢰도, 예산·샐러리캡, 지난 포스트시즌, 부임 이력, 업적, 해고 뒤 영입 제의.
import { settingsLabel } from '../../league/difficulty';
import { CoachPanel } from './Coaches';
import { ScenarioBanner } from '../ScenarioBanner';
import { FinancePanel } from './Finance';
import { StadiumPanel } from './Stadium';
import { ManagerPanel } from './Manager';
import { capPayroll, salaryCap } from '../../league/salary';
import {
  ACHIEVEMENTS, budgetFor, FIRE_BELOW, GOAL_LABEL, parentGrade, START_TRUST,
} from '../../league/owner';
import { ROUND_LABEL } from '../../league/postseason';
import { useGame, useWon } from '../context';
import { ruleOf } from '../../league/rules';
import { REP_FA, REP_TRADE, repLabel, repOf } from '../../league/reputation';

// 2026-10-12 UI 개편: 탭(개요·재정·구장·팬·감독·코치·이력·업적)은 위쪽 '구단' 메뉴의 작은 탭으로 올렸다 (GameShell NAV)
export type ClubTab = 'overview' | 'finance' | 'stadium' | 'coach' | 'history';

export function Club({ tab = 'overview' }: { tab?: ClubTab }) {
  const { session, go } = useGame();
  const won = useWon();
  const L = session.league;
  const o = session.owner;
  const me = session.teamIdx;
  const team = L.teams[me];
  // 오프시즌이면 다음 시즌 기준 예산
  const year = session.phase === 'offseason' ? session.year + 1 : session.year;
  const cap = salaryCap(year, L);
  const payroll = capPayroll(L.players, me, ruleOf(L, 'capTopN'));
  const ps = L.lastSeason?.postseason;
  const name = (t: number) => L.teams[t].name;
  const strikes = L.capStrikes?.[me] ?? 0;

  return (
    <div className="stack">
      <OfferPanel />
      {session.phase === 'offseason' && !o.offers?.length && (
        <div className="note row-between">
          <span>{session.year} 시즌 결산이 끝났습니다. 오프시즌(FA·외국인·드래프트·연봉)을 진행하세요.</span>
          <span className="inline">
            {!!session.league.awards?.length && <button type="button" className="ghost" onClick={() => go('awards')}>시상식</button>}
            {session.offseason?.growth && <button type="button" className="ghost" onClick={() => go('growth')}>선수 성장 결과</button>}
            <button type="button" onClick={() => go('offseason')}>오프시즌으로</button>
          </span>
        </div>
      )}

      <ScenarioBanner />

      {tab === 'finance' && <FinancePanel />}
      {tab === 'stadium' && <StadiumPanel />}
      {tab === 'coach' && <><ManagerPanel /><CoachPanel /></>}

      {tab === 'overview' && (<>
      <section className="cards">
        <div className="card">
          <h2>구단주 평가</h2>
          <p className="big">신뢰도 {o.trust}</p>
          <div className="track trust" aria-label={`신뢰도 ${o.trust} / 100`}><i style={{ width: `${o.trust}%` }} /></div>
          <p className="muted small">{FIRE_BELOW} 아래로 떨어지면 해고됩니다. 새 구단에 부임하면 {START_TRUST}에서 다시 시작합니다.</p>
          {o.goal && (
            <p>
              {o.goal.year} 시즌 목표: <strong>{GOAL_LABEL[o.goal.kind]}</strong>
              <span className="muted small"> (개막 때 전력 예상 {o.goal.projectedRank}위)</span>
            </p>
          )}
          <p className="muted small">
            목표는 개막 때 전력 예상 순위로 정합니다: 예상 1~2위는 한국시리즈 우승, 3~{session.world.rules.postseasonTeams + 1}위는 가을야구 진출, 그 아래는 탈꼴찌.
            달성 +12, 목표보다 한 단계 높을 때마다 +8 / 미달 -10, 한 단계 낮을 때마다 -6 (최대 -25), 샐러리캡 초과 -10.
          </p>
          <p className="muted small">난이도: {settingsLabel(L)}</p>
        </div>

        <RepCard />

        <div className="card">
          <h2>연봉·샐러리캡 <span className="muted small">{year} 시즌</span></h2>
          <dl className="facts">
            <dt>구단</dt><dd>{team.name} (모기업 등급 {parentGrade(L, me)})</dd>
            <dt>연봉 총액</dt><dd>{won(payroll)} <span className="muted small">외국인·신인 제외 상위 40명</span></dd>
            <dt>샐러리캡</dt><dd>{cap === null ? '없음' : won(cap)}</dd>
            <dt>캡 여유</dt><dd>{cap === null ? '-' : won(cap - payroll)}</dd>
            <dt>구단 자금</dt><dd>{won(session.cashNow())}</dd>
            {strikes > 0 && <><dt>캡 초과</dt><dd className="error-text">{strikes}회 연속 초과 (2회부터 1라운드 지명권 9단계 하락)</dd></>}
          </dl>
          <p className="muted small">
            FA 제시는 샐러리캡(2023년부터)을 넘을 수 없고, 계약금(계약 총액의 30%)을 낼 자금이 있어야 합니다. 외국인 신규 계약은 이적료를 낼 자금이 있어야 합니다.
            모기업 등급은 모기업 지원금(재정)에 반영됩니다. 등급과 금액은 임시값입니다.
          </p>
        </div>
      </section>

      {ps && (
        <section className="panel">
          <h2>{ps.year} 포스트시즌 <span className="muted small">우승 {name(ps.champion)} · 준우승 {name(ps.runnerUp)}</span></h2>
          <table>
            <thead><tr><th className="l">시리즈</th><th className="l">대진</th><th>결과</th><th className="l">경기</th></tr></thead>
            <tbody>
              {ps.series.map((x) => (
                <tr key={x.round} className={x.high === me || x.low === me ? 'me' : ''}>
                  <td className="l">{ROUND_LABEL[x.round]}</td>
                  <td className="l">{name(x.high)} vs {name(x.low)}</td>
                  <td>{x.winsHigh} - {x.winsLow}{x.round === 'wc' ? ' *' : ''} → {name(x.winner)}</td>
                  <td className="l small">{x.games.map((g) => `${name(g.away)} ${g.awayRuns}-${g.homeRuns} ${name(g.home)}`).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{ps.series.some((x) => x.round === 'wc') ? '* 와일드카드 결정전은 4위가 1승을 안고 시작합니다. ' : ''}시리즈 길이·어드밴티지는 임시값입니다.</p>
        </section>
      )}

      </>)}

      {tab === 'history' && (<>
      <section className="panel">
        <h2>부임 이력</h2>
        {o.history.length === 0 ? <p className="muted small">아직 마친 시즌이 없습니다.</p> : (
          <table>
            <thead><tr><th>시즌</th><th className="l">구단</th><th className="l">목표</th><th className="l">결과</th><th>평가</th><th>신뢰도</th></tr></thead>
            <tbody>
              {o.history.map((h) => (
                <tr key={`${h.year}-${h.team}`}>
                  <td>{h.year}</td><td className="l">{h.teamName ?? name(h.team)}</td><td className="l">{GOAL_LABEL[h.goal]}</td>
                  <td className="l">{h.result}{h.capOver ? ' · 캡 초과' : ''}</td>
                  <td>{h.achieved ? '달성' : '미달'}</td><td>{h.trustBefore} → {h.trustAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {o.firedYears.length > 0 && <p className="muted small">해고: {o.firedYears.join(', ')}년</p>}
      </section>

      <section className="panel">
        <h2>업적 <span className="muted small">{o.achievements.length} / {Object.keys(ACHIEVEMENTS).length}</span></h2>
        <ul className="achievements">
          {(Object.keys(ACHIEVEMENTS) as (keyof typeof ACHIEVEMENTS)[]).map((id) => {
            const got = o.achievements.find((a) => a.id === id);
            return (
              <li key={id} className={got ? 'on' : 'muted'}>
                <strong>{ACHIEVEMENTS[id].label}</strong> <span className="small">{ACHIEVEMENTS[id].note}</span>
                {got && <span className="small"> · {got.year} {name(got.team)}</span>}
              </li>
            );
          })}
        </ul>
      </section>
      </>)}
    </div>
  );
}

/** 해고된 뒤 받은 영입 제의. 하나를 받아들여야 오프시즌을 이어갈 수 있다 */
export function OfferPanel() {
  const { session, changed, autosave } = useGame();
  const won = useWon();
  const o = session.owner;
  if (!o.offers?.length) return null;
  const L = session.league;
  const st = L.lastSeason?.standings ?? [];
  const year = session.year + 1;
  const accept = async (t: number) => {
    session.acceptOffer(t);
    changed();
    await autosave();
  };
  return (
    <section className="panel offer" role="alert">
      <h2>해고되었습니다</h2>
      <p>구단주 신뢰도가 바닥났습니다. 아래 구단에서 영입 제의가 왔습니다. 한 곳을 골라야 오프시즌을 이어갈 수 있습니다.</p>
      <table>
        <thead><tr><th className="l">구단</th><th>지난 시즌</th><th>모기업 등급</th><th>{year} 예산</th><th /></tr></thead>
        <tbody>
          {o.offers.map((t) => (
            <tr key={t}>
              <td className="l"><strong>{L.teams[t].name}</strong></td>
              <td>{st.indexOf(t) + 1}위</td>
              <td>{parentGrade(L, t)}</td>
              <td>{(() => { const b = budgetFor(L, t, year); return b === null ? '-' : won(b); })()}</td>
              <td><button type="button" onClick={() => void accept(t)}>부임</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 단장 평판 (league/reputation.ts): 구단을 옮겨도 따라간다 */
function RepCard() {
  const { session } = useGame();
  const v = repOf(session.league);
  const log = (session.league.reputation?.log ?? []).slice(-8).reverse();
  return (
    <div className="card">
      <h2>단장 평판</h2>
      <p className="big">{v} <span className="muted small">{repLabel(v)}</span></p>
      <div className="track trust" aria-label={`단장 평판 ${v} / 100`}><i style={{ width: `${v}%` }} /></div>
      <p className="muted small">
        리그가 단장을 보는 눈입니다. 구단을 옮겨도 따라가고, 해마다 50 쪽으로 조금 돌아갑니다.
        높으면 FA·다년 계약 선수가 덜 부르고(100이면 −{REP_FA * 100}%), 트레이드 상대가 조금 너그러우며(±{REP_TRADE}런), 해고되더라도 강팀에서 제의가 옵니다.
      </p>
      {log.length > 0 && (
        <ul className="plain small">
          {log.map((x, i) => <li key={i}><span className="muted">{x.year}</span> {x.reason} <strong>{x.delta > 0 ? '+' : ''}{x.delta}</strong></li>)}
        </ul>
      )}
    </div>
  );
}
