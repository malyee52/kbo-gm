// 오프시즌: 단계별 진행 (FA → 외국인 → 드래프트 → 연봉 협상 → 정원 정리 → 개막).
import { isStarterSkill } from '../../engine';
import { CAMP_DAYS, CAMP_FOCUSES, CAMP_PLACES, FOCUS as CAMP_FOCUS, PLACE as CAMP_PLACE, type CampFocus, type CampPick, type CampPlace } from '../../league/camp';
import { useMemo, useState } from 'react';
import { OfferPanel } from './Club';
import { PICK_MAX_ROUND, PICK_TRADE_FROM } from '../../league/picks';
import { DRAFT_ROUNDS, FA_ROUNDS, LOG_LABEL, STAGE_LABEL, STAGES, canSignForeign, draftTeamAt, draftTotal, foreignLimits, foreignSlots, pickKindAt, pickNoAt } from '../../league/offseason';
import * as Off from '../../league/offseason';
import { AgentTalk } from './FantasyNegotiate';
import {
  dollarText, FA_COMP, FA_GRADE_FROM, faGradeLabel, franchiseTag, franchiseTagEligible, FRANCHISE_TAG_FROM, FRANCHISE_TAG_SEASONS,
  FRANCHISE_TAG_SHARE, isPreGrade, MIN_SALARY, salaryCap, salaryFloor, teamCapPayroll,
} from '../../league/salary';
import { seasonsWith } from '../../league/stadium';
import type { LeaguePlayer } from '../../league/types';
import { posName, TeamName, useGame, usePriceIndex, useWon } from '../context';
import { runsGrade } from '../grades';
import { ruleOf } from '../../league/rules';
import { previewOrder } from '../../league/ruleNews';
import { RuleNewsBody, StatusBadge } from '../RuleNews';

/** 오프시즌 화면에서 쓰는 선수 한 줄 정보 */
function useInfo() {
  const { session } = useGame();
  const next = session.year + 1;
  return (p: LeaguePlayer) => {
    const age = p.birthYear ? next - p.birthYear : null;
    return {
      age,
      role: p.isPitcher ? (isStarterSkill(p.pit) ? '선발' : '구원') : posName(p.pos),
      now: runsGrade(session.nextRuns(p.id), session.year),
      // 잠재력은 전성기 상한이라 31세 이상에게는 뜻이 없다 (2026-10-09 전수조사 M5)
      pot: age !== null && age >= 31 ? null : runsGrade(p.scoutPotential ?? p.potential, session.year),
    };
  };
}

export function Offseason() {
  const { session, changed, autosave, go } = useGame();
  const off = session.offseason;
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!off) {
    return (
      <div className="stack">
        <h1>오프시즌</h1>
        <p className="muted">정규시즌이 끝나면 오프시즌을 시작할 수 있습니다.</p>
      </div>
    );
  }

  const act = (r: { ok: boolean; message: string }, okText?: string) => {
    setMsg(r.ok ? (okText || r.message ? { text: okText ?? r.message } : null) : { text: r.message, error: true });
    changed();
    if (r.ok) void autosave();
  };

  const next = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    const r = session.nextStage();
    setBusy(false);
    act(r);
  };

  const open = async () => {
    setBusy(true);
    setMsg({ text: `${session.year + 1} 시즌을 준비하는 중입니다 (리그 환경 맞춤)` });
    await new Promise((r) => setTimeout(r, 30));
    const r = session.openNextSeason();
    setBusy(false);
    if (!r.ok) {
      setMsg({ text: r.message, error: true });
      return;
    }
    changed();
    await autosave();
    go('home');
  };

  const stageIdx = STAGES.indexOf(off.stage);
  const nextLabel = off.stage === 'fa'
    ? (off.fa.round < FA_ROUNDS ? `${off.fa.round}라운드 마감` : `${off.fa.round}라운드 마감 → 다음 단계`)
    : `다음: ${STAGE_LABEL[STAGES[stageIdx + 1]] ?? ''}`;

  return (
    <div className="stack">
      <OfferPanel />
      <section className="row-between wrap">
        <div>
          <h1>{off.year} 오프시즌</h1>
          <p className="muted small">결산(성장·연차·은퇴·병역)은 끝났습니다. 단계를 차례로 마치면 {off.year + 1} 시즌이 열립니다.</p>
        </div>
        {off.stage !== 'ready' && (
          <button type="button" onClick={() => void next()} disabled={busy}>{busy ? '처리 중' : nextLabel}</button>
        )}
      </section>

      <ol className="steps" aria-label="오프시즌 단계">
        {STAGES.map((s, i) => (
          <li key={s} className={i < stageIdx ? 'done' : i === stageIdx ? 'now' : ''} aria-current={i === stageIdx ? 'step' : undefined}>
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ol>

      {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}

      {/* 2026-10-12 UI 개편: 지금 단계와 다년 계약은 본문, 지명권·포스팅·소식은 오른쪽 곁 칸 (좁으면 아래로) */}
      <div className="off-split">
      <div className="stack off-main">
      {off.stage === 'fa' && <FaPanel act={act} />}
      {off.stage === 'comp' && <CompPanel act={act} />}
      {off.stage === 'second' && <SecondPanel act={act} />}
      {off.stage === 'foreign' && <ForeignPanel act={act} />}
      {off.stage === 'draft' && <DraftPanel act={act} />}
      {off.stage === 'salary' && <SalaryPanel act={act} />}
      {off.stage === 'release' && <ReleasePanel act={act} />}
      {off.stage === 'ready' && (
        <section className="panel">
          <h2>{off.year + 1} 시즌 개막 준비 완료</h2>
          <p className="muted">선수단 구성이 끝났습니다. 개막하면 1군 엔트리는 AI가 짠 명단으로 시작하고, 선수단 화면에서 바꿀 수 있습니다.</p>
          <div className="actions"><button type="button" onClick={() => void open()} disabled={busy}>{busy ? '준비 중' : `${off.year + 1} 시즌 개막`}</button></div>
        </section>
      )}
      {off.stage === 'ready' && <CapRulesPanel act={act} />}
      {off.stage === 'ready' && <RulePreview year={off.year + 1} />}
      {off.stage !== 'ready' && <ExtensionPanel act={act} />}
      </div>
      <aside className="stack off-side">
        {stageIdx <= STAGES.indexOf('draft') && <PickPanel />}
        <CampPanel act={act} />
        <section className="panel">
          <h2>감독·코치</h2>
          <p className="muted small">감독 교체와 코치 고용은 오프시즌 내내 할 수 있습니다 (시즌 중에도 가능).</p>
          <button type="button" className="ghost" onClick={() => go('staff')}>감독·코치 화면으로</button>
        </section>
        <PostingPanel act={act} />
        <OffLog />
      </aside>
      </div>
    </div>
  );
}

type Act = (r: { ok: boolean; message: string }, okText?: string) => void;

/** 지명 구분 짧은 표시: 1R, 우선, 특별 */
function pickShort(kind: number): string {
  return kind >= 1 ? `${kind}R` : kind === 0 ? '우선' : '특별';
}

/** FA 보상선수 (2026-10-08): 영입 구단은 보호선수 명단을, 원 소속 구단은 보상선수 또는 보상금만을 고른다 */
function CompPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const off = session.offseason!;
  const info = useInfo();
  const me = session.teamIdx;
  const cases = off.comp ?? [];
  const name = (id: string) => session.leaguePlayer(id)?.name ?? id;
  const mineIn = cases.filter((c) => c.to === me);
  const mineOut = cases.filter((c) => c.from === me);
  const others = cases.filter((c) => c.to !== me && c.from !== me);

  return (
    <section className="stack">
      <div className="panel">
        <h2>FA 보상선수</h2>
        {off.year >= FA_GRADE_FROM ? (
          <p className="muted small">
            A·B등급 FA를 데려간 구단은 보호선수 명단(A 20명, B 25명)을 내고, 원 소속 구단은 명단 밖 선수 1명과 보상금
            (A 직전 연봉 200%, B 100%) 또는 보상금만(A 300%, B 200%)을 고릅니다. 외국인·군 보류(복무 중)·이번 FA 계약 선수는 자동으로 보호됩니다.
            "다음" 단계로 넘어가면 확정됩니다.
          </p>
        ) : (
          <p className="muted small">
            등급제(2020 시즌 뒤) 전이라 모든 FA가 같은 보상입니다: 데려간 구단은 보호선수 {FA_COMP[off.year <= 2010 ? 'P1' : 'P2'].protect}명을 내고,
            원 소속 구단은 명단 밖 선수 1명과 직전 연봉 {FA_COMP[off.year <= 2010 ? 'P1' : 'P2'].withPlayer! * 100}% 또는 보상금만 {FA_COMP[off.year <= 2010 ? 'P1' : 'P2'].cashOnly * 100}%를 고릅니다.
            외국인·군 보류(복무 중)·이번 FA 계약 선수는 자동으로 보호됩니다. <StatusBadge status="research" />
          </p>
        )}
      </div>

      {mineIn.map((c) => <ProtectEditor key={c.fa} c={c} act={act} />)}

      {mineOut.map((c) => {
        const cands = Off.compCandidates(session.league, off, c)
          .map((p) => ({ p, runs: session.nextRuns(p.id) }))
          .sort((a, b) => b.runs - a.runs);
        return (
          <div className="panel mine" key={c.fa}>
            <h2>
              {name(c.fa)} 보상 <span className="muted small">{session.league.teams[c.to].name} 영입 · {faGradeLabel(c.grade)} · 직전 연봉 {won(c.prevSalary)}</span>
            </h2>
            <p className="small">
              지금 선택: <strong>{c.pick === null ? '아직 고르지 않음' : c.pick === 'cash' ? `보상금만 (${won(FA_COMP[c.grade].cashOnly * c.prevSalary)})` : `${name(c.pick)} + 보상금 ${won(FA_COMP[c.grade].withPlayer! * c.prevSalary)}`}</strong>
            </p>
            <div className="actions">
              <button type="button" className={c.pick === 'cash' ? '' : 'ghost'} onClick={() => act(session.pickComp(c.fa, 'cash'))}>
                보상금만 받기 ({won(FA_COMP[c.grade].cashOnly * c.prevSalary)})
              </button>
              <button type="button" className="ghost" onClick={() => act(session.autoComp(), '추천 기준으로 골랐습니다.')}>추천대로 고르기</button>
            </div>
            <table>
              <thead><tr><th className="l">보호 명단 밖 선수</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>연봉</th><th /></tr></thead>
              <tbody>
                {cands.map(({ p }) => {
                  const i = info(p);
                  return (
                    <tr key={p.id} className={c.pick === p.id ? 'me' : ''}>
                      <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td>
                      <td>{won(p.contract.salary)}</td>
                      <td><button type="button" className="small-btn" onClick={() => act(session.pickComp(c.fa, p.id))}>지명</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {others.length > 0 && (
        <div className="panel">
          <h2>다른 구단 보상 건</h2>
          <ul className="small">
            {others.map((c) => (
              <li key={c.fa}>{name(c.fa)} ({faGradeLabel(c.grade)}): {session.league.teams[c.from].name} → {session.league.teams[c.to].name}. 단계를 마감하면 원 소속 구단이 고릅니다.</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ProtectEditor({ c, act }: { c: Off.CompCase; act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const off = session.offseason!;
  const info = useInfo();
  const limit = FA_COMP[c.grade].protect!;
  const prot = new Set(c.protect);
  const pool = Off.protectPool(session.league, off, c)
    .map((p) => ({ p, runs: session.nextRuns(p.id) }))
    .sort((a, b) => Number(prot.has(b.p.id)) - Number(prot.has(a.p.id)) || b.runs - a.runs);
  const auto = session.league.players.filter((p) => p.team === c.to && Off.autoProtected(off, p)).length;
  const toggle = (id: string) => {
    const next = prot.has(id) ? c.protect.filter((x) => x !== id) : [...c.protect, id];
    act(session.setProtect(c.fa, next));
  };
  return (
    <div className="panel mine">
      <h2>
        {session.leaguePlayer(c.fa)?.name} 영입: 보호선수 명단 <span className="muted small">{c.protect.length}/{limit}명 · 자동 보호 {auto}명 · 원 소속 {session.league.teams[c.from].name}</span>
      </h2>
      <p className="muted small">처음에는 가치 높은 순 추천 명단이 들어 있습니다. 체크를 풀거나 넣어 바꾸세요. 명단 밖 선수 중 1명을 상대 구단이 데려갈 수 있습니다.</p>
      <table>
        <thead><tr><th>보호</th><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>연봉</th></tr></thead>
        <tbody>
          {pool.map(({ p }) => {
            const i = info(p);
            const on = prot.has(p.id);
            return (
              <tr key={p.id} className={on ? 'me' : ''}>
                <td><input type="checkbox" checked={on} disabled={!on && c.protect.length >= limit} onChange={() => toggle(p.id)} aria-label={`${p.name} 보호`} /></td>
                <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td><td>{won(p.contract.salary)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 2차 드래프트·창단 특별 지명 (offseason.ts ProtectDraft): 우리 보호 명단과 지명 희망 순서. "다음"을 누르면 지명이 진행된다 */
function SecondPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  return (
    <section className="stack">
      {off.expansion && <ProtectDraftPanel d={off.expansion} act={act} />}
      {off.second && <ProtectDraftPanel d={off.second} act={act} />}
    </section>
  );
}

function ProtectDraftPanel({ d, act }: { d: Off.ProtectDraft; act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const info = useInfo();
  const off = session.offseason!;
  const me = session.teamIdx;
  const L = session.league;
  const [showAll, setShowAll] = useState(false);
  const title = d.kind === 'second' ? `${off.year} 2차 드래프트` : `${L.teams[d.team!].name} 창단 특별 지명`;
  const takesPart = Off.protectDraftTeams(L, off, d).includes(me);
  const prot = new Set(d.protect[String(me)] ?? []);
  const pool = takesPart ? Off.protectDraftPool(L, off, d, me)
    .map((p) => ({ p, runs: session.nextRuns(p.id) }))
    .sort((a, b) => Number(prot.has(b.p.id)) - Number(prot.has(a.p.id)) || b.runs - a.runs) : [];
  const toggle = (id: string) => act(session.setDraftProtect(d.kind, prot.has(id) ? [...prot].filter((x) => x !== id) : [...prot, id]));
  const picker = d.kind === 'second' || d.team === me;
  const wish = new Set(d.wish);
  const cands = picker ? Off.protectDraftCandidates(L, off, d, me)
    .map((p) => ({ p, runs: session.nextRuns(p.id) }))
    .sort((a, b) => Number(wish.has(b.p.id)) - Number(wish.has(a.p.id)) || b.runs - a.runs) : [];
  const toggleWish = (id: string) => act(session.setDraftWish(d.kind, wish.has(id) ? d.wish.filter((x) => x !== id) : [...d.wish, id]));
  const rule = d.kind === 'second' ? Off.secondRule(off.year) : null;
  return (
    <>
      <div className="panel">
        <h2>{title}</h2>
        <p className="muted small">
          {d.kind === 'second'
            ? <>구단마다 보호선수 {d.limit}명을 내고, 성적 역순으로 다른 구단의 명단 밖 선수를 지명합니다 ({rule!.rounds}라운드{rule!.extra ? `, 하위 3개 구단은 ${rule!.extra}명 더` : ''}).
                양도금은 라운드마다 {rule!.fees.slice(0, rule!.rounds).map((f) => `${f / 10000}억`).join('·')} 원. 입단 1~3년차·이번 FA 신청 선수·외국인·군 복무 중·육성선수는 자동 제외됩니다.
                한 구단은 {Off.SECOND_MAX_LOSS}명까지 잃습니다 (임시값).</>
            : <>1군에 들어오는 {L.teams[d.team!].name}이(가) 기존 구단마다 보호 {d.limit}명 밖 1명을 데려갑니다. 외국인·군 복무 중·육성선수는 자동 제외됩니다.</>}
          {' '}"다음" 단계로 넘어가면 지명이 진행됩니다.
        </p>
      </div>
      {takesPart && (
        <div className="panel mine">
          <h2>우리 보호선수 명단 <span className="muted small">{prot.size}/{d.limit}명 · 대상 {pool.length}명</span></h2>
          <p className="muted small">처음에는 가치 높은 순 추천 명단이 들어 있습니다. 체크를 풀거나 넣어 바꾸세요.</p>
          <div className="scroll flat">
            <table>
              <thead><tr><th>보호</th><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>연봉</th></tr></thead>
              <tbody>
                {(showAll ? pool : pool.slice(0, d.limit + 15)).map(({ p }) => {
                  const i = info(p);
                  const on = prot.has(p.id);
                  return (
                    <tr key={p.id} className={on ? 'me' : ''}>
                      <td><input type="checkbox" checked={on} disabled={!on && prot.size >= d.limit} onChange={() => toggle(p.id)} aria-label={`${p.name} 보호`} /></td>
                      <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td><td>{won(p.contract.salary)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!showAll && pool.length > d.limit + 15 && <button type="button" className="ghost small-btn" onClick={() => setShowAll(true)}>나머지 {pool.length - d.limit - 15}명 보기</button>}
        </div>
      )}
      {picker && (
        <div className="panel mine">
          <h2>지명 희망 <span className="muted small">{d.wish.length}명 고름 · 고른 순서대로, 우리 차례에 남아 있는 선수를 지명</span></h2>
          {d.kind === 'second' && <p className="muted small">아무도 고르지 않으면 지명하지 않습니다 (패스).</p>}
          {d.wish.length > 0 && <p className="small">순서: {d.wish.map((id, k) => <span key={id}>{k > 0 && ' → '}{L.players.find((p) => p.id === id)?.name ?? id}</span>)}</p>}
          <div className="scroll flat">
            <table>
              <thead><tr><th>지명</th><th className="l">선수</th><th className="l">구단</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>연봉</th></tr></thead>
              <tbody>
                {cands.slice(0, 40).map(({ p }) => {
                  const i = info(p);
                  const on = wish.has(p.id);
                  return (
                    <tr key={p.id} className={on ? 'me' : ''}>
                      <td><input type="checkbox" checked={on} onChange={() => toggleWish(p.id)} aria-label={`${p.name} 지명 희망`} /></td>
                      <td className="l">{p.name}</td><td className="l"><TeamName idx={p.team} /></td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td><td>{won(p.contract.salary)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">가치 높은 순 40명까지 보입니다.</p>
        </div>
      )}
    </>
  );
}

function CapLine() {
  const { session } = useGame();
  const won = useWon();
  const cap = salaryCap(session.year + 1, session.league);
  const floor = salaryFloor(session.year + 1, session.league);
  const pay = teamCapPayroll(session.league, session.teamIdx, session.year + 1);
  const size = session.league.players.filter((p) => p.team === session.teamIdx).length;
  return (
    <p className="muted small">
      {session.year + 1} {cap ? '샐러리캡 대상 ' : ''}연봉 총액(외국인·신인 제외 상위 {ruleOf(session.league, 'capTopN')}명) {won(pay)}{cap ? ` / 상한 ${won(cap)}` : ''}{floor ? ` · 하한 ${won(floor)}` : ''} · 소속 선수 {size}/{ruleOf(session.league, 'orgLimit')}명
    </p>
  );
}

function FaPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const px = usePriceIndex();
  const won = useWon();
  const off = session.offseason!;
  const info = useInfo();
  const [draft, setDraft] = useState<Record<string, { salary: string; years: string }>>({});
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const entries = off.fa.entries;
  const mineLeaving = entries.filter((e) => e.from === session.teamIdx && e.status === 'open');
  const externalOffers = Object.keys(off.fa.userOffers).filter((id) => entries.find((e) => e.id === id)?.from !== session.teamIdx).length;

  return (
    <section className="stack">
      <div className="panel">
        <h2>FA 시장 <span className="muted small">{off.fa.round}/{FA_ROUNDS}라운드</span></h2>
        <p className="muted small">
          라운드를 마감하면 AI 구단도 제시하고, 선수는 가장 좋은 조건을 고릅니다 (원 소속 구단은 조금 더 쳐줍니다). 라운드가 지날수록 선수가 눈높이를 낮춥니다.
          외부 FA는 한 오프시즌에 {ruleOf(session.league, 'maxFaSignings')}명까지, 다른 구단 선수를 데려오면 원 소속 구단에 보상금(A 300%, B 200%, C 150%)을 냅니다.
        </p>
        <p className="small">외부 FA: 계약 {off.fa.signings[session.teamIdx]}명 · 이번 라운드 제시 {externalOffers}명 / 한도 {ruleOf(session.league, 'maxFaSignings')}명</p>
        <p className="small">
          지금 자금 <strong>{won(session.cashNow())}</strong> · 계약금은 계약 총액(연봉 × 기간)의 30%를 계약할 때 한 번에 내고, 나머지는 시즌 중 월말에 나갑니다.
          계약금을 낼 자금이 모자라면 계약할 때 모기업이 모자란 몫을 지원합니다 (장부에 '모기업 지원 (FA 계약금)').
        </p>
        <CapLine />
        {mineLeaving.length > 0 && (
          <p className="note small">우리 구단 FA {mineLeaving.length}명이 시장에 나와 있습니다. 붙잡으려면 제시하세요. 마지막 라운드까지 계약하지 못하면 떠납니다.</p>
        )}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">선수</th><th className="l">원 소속</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>등급</th>
              <th>전년 연봉</th><th>요구 (연)</th><th>기간</th><th className="l">상태 · 우리 제시</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const p = players.get(e.id)!;
              const i = info(p);
              const mine = off.fa.userOffers[e.id];
              // 제시 연봉은 억 원 단위로 입력한다 (소수 한 자리). 내부 계산은 만 원 단위.
              // 기본값은 요구액을 0.1억 단위로 올림 (내림하면 요구액보다 모자라 1라운드에서 거절된다)
              const d = draft[e.id] ?? { salary: (Math.ceil((e.ask * px) / 1000) / 10).toFixed(1), years: String(e.years) };
              return (
                <tr key={e.id} className={e.from === session.teamIdx ? 'me' : ''}>
                  <td className="l">{p.name}</td><td className="l"><TeamName idx={e.from} /></td><td>{i.role}</td><td>{i.age ?? '-'}</td>
                  <td>{i.now}</td><td>{i.pot ?? '-'}</td><td>{isPreGrade(e.grade) ? '-' : e.grade}</td><td>{won(e.prevSalary)}</td>
                  <td>{won(e.ask)}{e.status === 'open' && <AgentTalk p={p} situation={`FA ${faGradeLabel(e.grade)}, 전년 연봉 ${Math.round(e.prevSalary / 1000) / 10}억 원, 요구 연 ${Math.round(e.ask / 1000) / 10}억 원 ${e.years}년. 원 소속 ${session.league.teams[e.from]?.name ?? ''}, 설득하는 구단 ${session.team.name}`} />}</td><td>{e.years}년</td>
                  <td className="l">
                    {e.status === 'signed' ? (
                      <span>{e.team === e.from ? '잔류' : '이적'} · <TeamName idx={e.team!} /> {e.signedYears}년 연 {won(e.salary!)}</span>
                    ) : e.status === 'left' ? (
                      <span className="muted">미계약 (무적: 2차 드래프트·육성선수 후보)</span>
                    ) : mine ? (
                      <span className="inline">제시함: {mine.years}년 연 {won(mine.salary)}
                        <button type="button" className="small-btn" onClick={() => act(session.withdrawFa(e.id), '제시를 거뒀습니다.')}>거두기</button>
                      </span>
                    ) : (
                      <span className="inline">
                        <input type="number" min={(MIN_SALARY * px) / 10000} step={0.1} value={d.salary} aria-label={`${p.name} 제시 연봉(억 원)`}
                          onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, salary: ev.target.value } })} style={{ width: '6em' }} />억 원
                        <select value={d.years} aria-label="계약 기간" onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, years: ev.target.value } })}>
                          {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>{y}년</option>)}
                        </select>
                        <button type="button" className="small-btn" onClick={() => act(session.offerFa(e.id, Math.round((Number(d.salary) * 10000) / px), Number(d.years)))}>제시</button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">현재·잠재는 한 시즌 기여를 20~80으로 바꾼 값입니다 (50 = 리그 평균 주전). FA 제시 연봉은 억 원 단위로 입력합니다 (소수 한 자리, 예: 3.5 = 3억 5,000만 원).</p>
    </section>
  );
}

function ForeignPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  const f = off.foreign!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const slots = foreignSlots(session.league, session.teamIdx, off);
  const lim = foreignLimits(off);
  const myTurn = f.order[f.pointer] === session.teamIdx;
  const pool = f.pool.map((id) => players.get(id)!).sort((a, b) => session.nextRuns(b.id) - session.nextRuns(a.id));
  const expiringMine = Object.keys(f.keep).map((id) => players.get(id)!);
  const pickedBefore = f.order.slice(0, f.pointer).filter((t) => t !== session.teamIdx);

  return (
    <section className="stack">
      <div className="panel">
        <h2>외국인 선수</h2>
        <p className="muted small">
          보유 한도: {lim.asia ? `아시아쿼터를 빼고 ${lim.regular}명 + 아시아쿼터 ${lim.asia}명` : `${lim.regular}명`}. 신규 계약은 {dollarText(ruleOf(session.league, 'foreignNewCap'))}, 아시아쿼터 신규는 {dollarText(ruleOf(session.league, 'asiaNewCap'))}까지,{' '}
          {lim.asia ? '아시아쿼터를 뺀 ' : ''}{lim.regular}명 총액은 {dollarText(ruleOf(session.league, 'foreignTotalCap'))}까지입니다. 직전 시즌 성적 역순으로 고릅니다.
        </p>
        <p className="small">
          우리 외국인: {slots.regular}/{lim.regular}명 (총액 {dollarText(slots.regularPay)}){lim.asia ? ` · 아시아쿼터 ${slots.asia}/${lim.asia}명` : ''}
          {pickedBefore.length > 0 && <span className="muted"> · 우리보다 먼저 고른 구단: {pickedBefore.map((t) => session.league.teams[t].name).join(', ')}</span>}
        </p>
        {!myTurn && <p className="muted small">다음 단계로 넘기면 남은 구단이 고릅니다.</p>}
      </div>

      {expiringMine.length > 0 && (
        <div>
          <h2>재계약 대상 <span className="muted small">계약이 끝난 우리 외국인</span></h2>
          <div className="scroll">
            <table>
              <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>지난 연봉</th><th className="l">결정</th></tr></thead>
              <tbody>
                {expiringMine.map((p) => {
                  const i = info(p);
                  const keep = f.keep[p.id];
                  return (
                    <tr key={p.id}>
                      <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{dollarText(p.contract.salary)}</td>
                      <td className="l">
                        <label className="inline small">
                          <input type="checkbox" checked={keep} onChange={(e) => act(session.setForeignKeep(p.id, e.target.checked))} /> 재계약
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">재계약 연봉은 성적에 따라 정해지고, 3명 총액 상한을 넘으면 남은 몫까지만 줍니다.</p>
        </div>
      )}

      <div>
        <h2>후보 <span className="muted small">{pool.length}명 (실존 선수는 다른 구단에서 재계약하지 않은 선수, 나머지는 가상 선수)</span></h2>
        <div className="scroll pick">
          <table>
            <thead><tr><th className="l">선수</th><th>구분</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>요구액</th><th>이적료</th><th /></tr></thead>
            <tbody>
              {pool.map((p) => {
                const i = info(p);
                const check = canSignForeign(session.league, off, session.teamIdx, p);
                return (
                  <tr key={p.id}>
                    <td className="l">{p.name}{!p.real && <span className="tag" title="가상 선수">가상</span>}</td>
                    <td>{p.asia ? '아시아쿼터' : '일반'}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td><td>{dollarText(p.contract.salary)}</td>
                    <td>{p.transferFee ? dollarText(p.transferFee) : '-'}</td>
                    <td>
                      <button type="button" className="small-btn" disabled={!myTurn || !check.ok} title={check.ok ? '' : check.message}
                        onClick={() => act(session.signForeign(p.id), `${p.name}와 계약했습니다.`)}>계약</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DraftPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  const d = off.draft!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const total = draftTotal(off);
  const done = d.pick >= total || d.pool.length === 0;
  const onClock = !done && draftTeamAt(off, d.pick) === session.teamIdx;
  const pool = d.pool.map((id) => players.get(id)!).sort((a, b) => (b.scoutPotential ?? 0) - (a.scoutPotential ?? 0) || a.id.localeCompare(b.id));
  const mine = d.picks.filter((p) => p.team === session.teamIdx);

  return (
    <section className="stack">
      <div className="panel">
        <h2>신인 드래프트 <span className="muted small">{DRAFT_ROUNDS}라운드 전면 드래프트, 직전 시즌 성적 역순</span></h2>
        <p className="small">
          {done ? '드래프트가 끝났습니다.' : onClock
            ? <strong>우리 차례입니다: {pickKindAt(off, d.pick) >= 1 ? `${pickKindAt(off, d.pick)}라운드 ${pickNoAt(off, d.pick)}순위` : Off.pickKindLabel(pickKindAt(off, d.pick))}</strong>
            : `지명 진행 중 (${d.pick + 1}/${total})`}
        </p>
        <p className="muted small">
          잠재는 스카우트 평가라 실제와 다를 수 있습니다. 모든 구단이 같은 평가를 봅니다.{' '}
          {[...d.pool, ...d.picks.map((x) => x.id)].some((id) => players.get(id)?.real)
            ? `후보는 ${off.year + 1}년 입단 실제 신인 지명 선수입니다 (출처: baseballchart.kr, 나무위키 신인 드래프트 문서 정리, CC BY-NC-SA 2.0 KR). 지명은 게임 속 순위로 다시 하므로 실제 구단과 다를 수 있고, 아직 프로 기록이 없어 능력은 실제 지명 순번으로 가늠한 추정값입니다.`
            : '지명 선수는 모두 가상 선수입니다.'}
        </p>
        <div className="actions">
          <button type="button" className="ghost" disabled={done} onClick={() => act(session.autoDraft(), '남은 지명을 자동으로 했습니다.')}>남은 지명 자동</button>
        </div>
      </div>
      <div className="two">
        <div>
          <h2>지명 가능 선수 <span className="muted small">{pool.length}명</span></h2>
          <div className="scroll pick">
            <table>
              <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>학력</th><th>현재</th><th>잠재(평가)</th><th /></tr></thead>
              <tbody>
                {pool.map((p) => {
                  const i = info(p);
                  return (
                    <tr key={p.id}>
                      <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{p.school === 'UNIV' ? '대졸' : '고졸'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td>
                      <td><button type="button" className="small-btn" disabled={!onClock} onClick={() => act(session.draft(p.id))}>지명</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>우리 지명 <span className="muted small">{mine.length}/{DRAFT_ROUNDS}</span></h2>
          <div className="scroll">
            <table>
              <tbody>
                {mine.map((pk) => {
                  const p = players.get(pk.id)!;
                  const i = info(p);
                  return <tr key={pk.id}><td>{pickShort(pk.round)}</td><td className="l">{p.name}</td><td>{i.role}</td><td>{p.school === 'UNIV' ? '대졸' : '고졸'}</td><td>잠재 {i.pot ?? '-'}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <h2>최근 지명</h2>
          <ul className="plain small">
            {d.picks.slice(-8).reverse().map((pk) => (
              <li key={pk.id}>{pickShort(pk.round)} <TeamName idx={pk.team} /> {players.get(pk.id)!.name}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** 비FA 다년 계약 (league/offseason.ts extendByUser): 기간별 요구 연봉을 보고 맺는다 */
function ExtensionPanel({ act }: { act: Act }) {
  const { session, version } = useGame();
  const won = useWon();
  const info = useInfo();
  const [open, setOpen] = useState(false);
  const [years, setYears] = useState<Record<string, number>>({});
  const rows = useMemo(() => (open ? session.extensionOffers() : []), [session, version, open]);
  const sorted = [...rows].sort((a, b) => b.p.potential - a.p.potential || a.p.id.localeCompare(b.p.id)).slice(0, 25);
  return (
    <section className="panel">
      <div className="row-between">
        <h2>비FA 다년 계약 <span className="muted small">FA 전에 묶어 두기</span></h2>
        <button type="button" className="ghost small-btn" onClick={() => setOpen(!open)}>{open ? '접기' : '후보 보기'}</button>
      </div>
      <p className="muted small">
        보류·신인 계약인 국내 선수와 {Off.EXT_MIN_YEARS}~{ruleOf(session.league, 'extMaxYears')}년 계약을 맺습니다. 계약 동안 연봉 협상과 FA가 없고, 총액의 {Off.EXT_BONUS_SHARE * 100}%를 계약금으로 먼저 냅니다.
        FA가 멀수록 싸게(최대 20% 할인), 길게 맺을수록 해마다 조금 더 쌉니다. AI 구단도 FA가 가까운 주축과 다년 계약을 맺습니다.
      </p>
      {open && (
        <div className="scroll">
          <table>
            <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>FA까지</th><th>지금 연봉</th><th>기간</th><th>요구 연봉</th><th /></tr></thead>
            <tbody>
              {sorted.map(({ p, toFa, demands }) => {
                const i = info(p);
                const y = years[p.id] ?? 4;
                const d = demands.find((x) => x.years === y)!;
                return (
                  <tr key={p.id}>
                    <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td>
                    <td>{toFa}시즌</td><td className="small">{won(p.contract.salary)}</td>
                    <td>
                      <select value={y} onChange={(e) => setYears({ ...years, [p.id]: Number(e.target.value) })} aria-label={`${p.name} 계약 기간`}>
                        {demands.map((x) => <option key={x.years} value={x.years}>{x.years}년</option>)}
                      </select>
                    </td>
                    <td className="small">{won(d.salary)} <span className="muted">(계약금 {won(Math.round(d.salary * y * Off.EXT_BONUS_SHARE))})</span>
                      <AgentTalk p={p} situation={`비FA 다년 계약 협상. FA까지 ${toFa}시즌, 지금 연봉 ${Math.round(p.contract.salary / 1000) / 10}억 원, ${y}년 요구 연 ${Math.round(d.salary / 1000) / 10}억 원. 구단 ${session.team.name}`} /></td>
                    <td><button type="button" className="small-btn" onClick={() => act(session.extend(p.id, y))}>계약</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 우리 선수의 포스팅(해외 진출) 요청과 해외에서 뛰는 선수 (league/overseas.ts) */
/** 스프링캠프 (league/camp.ts): 다음 시즌 캠프 장소·훈련 방향. 개막 때 비용을 내고 효과가 난다 */
function CampPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const pick = session.campPlan;
  const set = (p: Partial<CampPick>) => act(session.setCamp({ ...pick, ...p }), '스프링캠프를 바꿨습니다.');
  const place = CAMP_PLACE[pick.place];
  const focus = CAMP_FOCUS[pick.focus];
  return (
    <section className="panel">
      <h2>{session.year + 1} 스프링캠프</h2>
      <div className="form-row">
        <label>장소
          <select value={pick.place} onChange={(e) => set({ place: e.target.value as CampPlace })}>
            {CAMP_PLACES.map((p) => <option key={p} value={p}>{CAMP_PLACE[p].label}</option>)}
          </select>
        </label>
        <label>훈련 방향
          <select value={pick.focus} onChange={(e) => set({ focus: e.target.value as CampFocus })}>
            {CAMP_FOCUSES.map((f) => <option key={f} value={f}>{CAMP_FOCUS[f].label}</option>)}
          </select>
        </label>
      </div>
      <p className="small">비용 {won(place.cost)} · 효과 배율 {place.factor}{place.injury > 1 ? ' · 추운 날씨로 부상 조금 늘어남' : ''}</p>
      <p className="muted small">{focus.label}: {focus.note}. 컨디션 효과는 개막 뒤 {CAMP_DAYS}일 동안 이어지고, 개막할 때 비용을 냅니다.</p>
    </section>
  );
}

function PostingPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  const won = useWon();
  const pending = (off.postings ?? []).filter((x) => !x.decided);
  const abroad = session.abroadPlayers();
  const open = off.stage !== 'release' && off.stage !== 'ready';
  if (!pending.length && !abroad.length) return null;
  const name = (id: string) => session.league.players.find((p) => p.id === id)?.name ?? id;
  return (
    <section className="panel">
      {pending.length > 0 && (
        <>
          <h2>해외 진출 요청</h2>
          <p className="muted small">보내면 포스팅 이적료를 받고 선수는 해외로 갑니다. 나중에 돌아오면 우리 구단으로 복귀합니다(보류권). 정원 정리 단계 전까지 답하지 않으면 붙잡은 것으로 합니다.</p>
          <ul className="plain">
            {pending.map((x) => (
              <li key={x.id} className="row-between">
                <span><strong>{name(x.id)}</strong> · 이적료 약 {won(x.fee)}</span>
                <span className="inline">
                  <button type="button" className="small-btn" disabled={!open} onClick={() => act(session.answerPosting(x.id, true))}>보낸다</button>
                  <button type="button" className="small-btn ghost" disabled={!open} onClick={() => act(session.answerPosting(x.id, false))}>붙잡는다</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {abroad.length > 0 && (
        <details className="small">
          <summary>해외에서 뛰는 선수 {abroad.length}명</summary>
          <ul className="plain">
            {abroad.map((p) => (
              <li key={p.id}>
                {p.name} · {p.abroad!.since}년부터 · 원 소속 {session.league.teams[p.abroad!.origin]?.name ?? '-'}
                · {p.abroad!.mode === 'posting' ? '돌아오면 원 소속 구단으로' : '돌아오면 FA'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function SalaryPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const px = usePriceIndex();
  const won = useWon();
  const off = session.offseason!;
  const s = off.salary!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const ids = Object.keys(s.offers).sort((a, b) => s.demands[b] - s.demands[a]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const total = ids.reduce((sum, id) => sum + s.offers[id], 0);

  return (
    <section className="stack">
      <div className="panel">
        <h2>연봉 협상 <span className="muted small">계약이 끝난 국내 선수 {ids.length}명</span></h2>
        <p className="muted small">
          선수 요구액은 기여와 연차로 정해집니다. 요구액 이상을 제시하면 그대로 계약하고, 모자라면 조정을 거쳐 제시액과 요구액의 가운데로 정합니다.
          다음 단계로 넘길 때 확정합니다.
        </p>
        <p className="small">제시 합계 {won(total)}</p>
        <CapLine />
      </div>
      <div className="scroll">
        <table>
          <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>지난 연봉</th><th>요구액</th><th className="l">제시액 (억 원)</th></tr></thead>
          <tbody>
            {ids.map((id) => {
              const p = players.get(id)!;
              const i = info(p);
              // 제시액은 억 원 단위로 보여 주고 입력한다 (0.01억 = 100만 원). 기본값은 지금 제시액을 0.01억 단위로 올림.
              // 값을 고쳤을 때만 제시액을 바꾼다 (보여 주려고 올린 값 때문에 제시액이 바뀌지 않게)
              const shown = (Math.ceil((s.offers[id] * px) / 100) / 100).toFixed(2);
              const v = edit[id] ?? shown;
              const low = s.offers[id] < s.demands[id];
              return (
                <tr key={id}>
                  <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td>
                  <td>{won(p.contract.salary)}</td><td>{won(s.demands[id])}</td>
                  <td className="l">
                    <span className="inline">
                      <input type="number" min={(MIN_SALARY * px) / 10000} step={0.01} value={v} aria-label={`${p.name} 제시액(억 원)`} style={{ width: '6em' }}
                        onChange={(e) => setEdit({ ...edit, [id]: e.target.value })}
                        onBlur={() => { if (edit[id] !== undefined && edit[id] !== shown) act(session.setSalaryOffer(id, Math.round((Number(v) * 10000) / px))); }} />억 원
                      {low && <span className="status temp">조정 예상</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReleasePanel({ act }: { act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const info = useInfo();
  // 복무 중인 선수는 정원에 들지 않는다 (league/offseason.ts orgSize와 같은 기준. 2026-10-09 전수조사 H4)
  const serving = session.league.players.filter((p) => p.team === session.teamIdx && p.military?.state === 'serving').length;
  // 자동 방출과 같은 순서 (Off.releaseOrder): 내보낼 수 있는 선수 → 최소 인원 때문에 미룬 선수 → 방출 순서에 없는 선수(외국인·FA·다년 계약)
  const plan = session.releasePlan();
  const ranked = [...plan.order, ...plan.kept];
  const mine = [
    ...ranked,
    ...session.league.players.filter((p) => p.team === session.teamIdx && p.military?.state !== 'serving' && !p.dev && !ranked.includes(p)),
  ];
  const devs = session.league.players.filter((p) => p.team === session.teamIdx && p.dev);
  const devPool = session.devPool().sort((a, b) => (b.scoutPotential ?? b.potential) - (a.scoutPotential ?? a.potential) || a.id.localeCompare(b.id));
  const ageOf = (p: (typeof mine)[number]) => (p.birthYear ? session.offseason!.year + 1 - p.birthYear : 99);
  const canDev = (p: (typeof mine)[number]) => !p.foreign && ageOf(p) <= ruleOf(session.league, 'devMaxAge') && p.contract.kind !== 'fa' && devs.length < ruleOf(session.league, 'devLimit');
  const over = mine.length - ruleOf(session.league, 'orgLimit');
  const claimable = session.claimable().sort((a, b) => session.nextRuns(b.id) - session.nextRuns(a.id) || a.id.localeCompare(b.id));
  return (
    <section className="stack">
      <div className="panel">
        <h2>정원 정리 <span className="muted small">소속 선수 {mine.length}/{ruleOf(session.league, 'orgLimit')}명</span></h2>
        <p className="muted small">
          방출은 되돌릴 수 없고, 방출한 선수는 다른 구단이 데려갈 수 있습니다. 자동 방출 순서대로 늘어놓았습니다: 앞으로 8시즌 가치(잠재력·나이 반영)가 낮은 순,
          입단 {Off.ROOKIE_GRACE}년 안의 신인은 뒤로. 포수 {Off.MIN_CATCHERS}명·투수 {Off.MIN_PITCHERS}명·야수 {Off.MIN_HITTERS}명 아래로 내려가게 하는 선수는 맨 뒤로 미룹니다.
          {serving ? ` 복무 중 ${serving}명은 정원에 들지 않아 여기 없습니다.` : ''}
        </p>
        {over > 0 ? <p className="note small">{over}명을 더 방출해야 다음 단계로 갈 수 있습니다.</p> : <p className="small">정원 안입니다.</p>}
        <div className="actions">
          <button type="button" className="ghost" disabled={over <= 0} onClick={() => act(session.autoRelease(), '정원에 맞게 방출했습니다.')}>정원까지 자동 방출</button>
        </div>
      </div>
      <div className="scroll pick">
        <table>
          <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>계약</th><th /></tr></thead>
          <tbody>
            {mine.map((p) => {
              const i = info(p);
              return (
                <tr key={p.id}>
                  <td className="l">
                    {p.name}{p.foreign && <span className="tag">외</span>}{!p.real && <span className="tag">가상</span>}{p.contract.kind === 'rookie' && <span className="tag">신인</span>}
                    {over > 0 && plan.order.indexOf(p) >= 0 && plan.order.indexOf(p) < over && <span className="tag" title="정원까지 자동 방출하면 나갑니다">방출 대상</span>}
                  </td>
                  <td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td>
                  <td className="small">{p.foreign ? dollarText(p.contract.salary) : won(p.contract.salary)}</td>
                  <td>
                    {canDev(p) && <button type="button" className="small-btn" title="방출하지 않고 육성선수로 돌립니다 (정원에서 빠지고, 시즌 중 5월 1일부터 정식 등록)" onClick={() => act(session.toDev(p.id))}>육성 전환</button>}{' '}
                    <button type="button" className="small-btn danger" onClick={() => act(session.release(p.id))}>방출</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>육성선수 <span className="muted small">{devs.length}/{ruleOf(session.league, 'devLimit')}명</span></h2>
        <p className="muted small">
          육성선수는 정원({ruleOf(session.league, 'orgLimit')}명) 밖이고 최저 연봉입니다. 2군(퓨처스리그)에서 뛰며 성장하고, 1군에는 정식 선수로 등록한 뒤에만 나갈 수 있습니다
          (시즌 중 5월 1일부터 7월 31일까지, 또는 오프시즌 정원 정리 때, 정원 안에서). {ruleOf(session.league, 'devMaxAge')}세 이하 국내 선수만 육성선수로 돌리거나 데려올 수 있습니다.
        </p>
        {devs.length > 0 && (
          <table>
            <tbody>
              {devs.map((p) => {
                const i = info(p);
                return (
                  <tr key={p.id}>
                    <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>잠재 {i.pot ?? '-'}</td>
                    <td><button type="button" className="small-btn" disabled={mine.length >= ruleOf(session.league, 'orgLimit')} title={mine.length >= ruleOf(session.league, 'orgLimit') ? '정원이 차 있습니다' : undefined} onClick={() => act(session.promoteDevOff(p.id))}>정식 등록</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {devPool.length > 0 && (
        <div className="panel">
          <h3>육성선수로 데려오기 <span className="muted small">드래프트 미지명·방출 선수·무적 FA {devPool.length}명</span></h3>
          <div className="scroll pick">
            <table>
              <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>잠재(평가)</th><th /></tr></thead>
              <tbody>
                {devPool.slice(0, 40).map((p) => {
                  const i = info(p);
                  return (
                    <tr key={p.id}>
                      <td className="l">{p.name}{!p.real && <span className="tag">가상</span>}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td>
                      <td><button type="button" className="small-btn" disabled={devs.length >= ruleOf(session.league, 'devLimit')} onClick={() => act(session.signDev(p.id))}>육성 영입</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">단계를 마감하면 AI 구단이 남은 선수 가운데 잠재력이 높은 선수를 육성선수로 데려갑니다.</p>
        </div>
      )}
      <div className="panel">
        <h2>방출 선수 영입 <span className="muted small">{claimable.length}명</span></h2>
        <p className="muted small">
          다른 구단이 이번에 방출한 선수를 최저 연봉({won(Off.CLAIM_SALARY)}) 1년 계약으로 데려옵니다. 데려오면 정원이 늘어나니 다음 단계 전에 그만큼 방출해야 합니다.
          단계를 마감하면 AI 구단이 남은 방출 선수 중 쓸 만한 선수를 데려갑니다 (구단당 {Off.CLAIM_PER_TEAM}명까지).
        </p>
      </div>
      {claimable.length > 0 && (
        <div className="scroll pick">
          <table>
            <thead><tr><th className="l">선수</th><th className="l">방출 구단</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th /></tr></thead>
            <tbody>
              {claimable.map((p) => {
                const i = info(p);
                const from = session.offseason!.released!.find((r) => r.id === p.id)!.from;
                return (
                  <tr key={p.id}>
                    <td className="l">{p.name}{!p.real && <span className="tag">가상</span>}</td>
                    <td className="l"><TeamName idx={from} /></td>
                    <td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot ?? '-'}</td>
                    <td><button type="button" className="small-btn" onClick={() => act(session.claim(p.id))}>영입</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 우리 지명권: 다음 두 드래프트의 트레이드 대상 라운드 (넘긴 것·받은 것) */
function PickPanel() {
  const { session } = useGame();
  const rows = session.pickLedger();
  const drafts = [...new Set(rows.map((r) => r.draft))];
  const traded = rows.some((r) => !r.own || r.extra.length);
  const slot = session.nextDraftSlot();
  return (
    <section className="panel">
      <div className="row-between wrap">
        <h2>우리 지명권</h2>
        <span className="muted small">
          {drafts[0]} 입단 드래프트 1라운드 예상 {slot}순위 (지난 시즌 역순){!session.pickTradeOpen && ` · 지명권 트레이드는 ${PICK_TRADE_FROM}년부터 (세부 난이도에서 바꿀 수 있음)`}
        </span>
      </div>
      <div className="scroll">
        <table>
          <thead><tr><th className="l">드래프트</th>{rows.filter((r) => r.draft === drafts[0]).map((r) => <th key={r.round}>{r.round}라운드</th>)}</tr></thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d}>
                <td className="l">{d} 입단</td>
                {rows.filter((r) => r.draft === d).map((r) => (
                  <td key={r.round}>
                    {r.own ? '우리' : <span className="down">→ <TeamName idx={r.givenTo!} /></span>}
                    {r.extra.map((t) => <div key={t} className="up small">+ <TeamName idx={t} /></div>)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {traded ? '→ 는 트레이드로 넘긴 지명권, + 는 받아 온 다른 구단 지명권입니다. ' : ''}
        {PICK_MAX_ROUND + 1}라운드부터 {DRAFT_ROUNDS}라운드까지는 트레이드 대상이 아니라 늘 우리 지명권입니다.
      </p>
    </section>
  );
}

function OffLog() {
  const { session } = useGame();
  const off = session.offseason!;
  const [all, setAll] = useState(false);
  const rows = off.log.filter((l) => all || l.mine || l.major || l.text.includes('→')).slice().reverse();
  return (
    <section>
      <div className="row-between">
        <h2>오프시즌 소식</h2>
        <label className="inline small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 전체 보기</label>
      </div>
      {rows.length === 0 ? <p className="muted">아직 소식이 없습니다.</p> : (
        <ul className="news">
          {rows.map((l, k) => (
            <li key={k} className={l.mine ? 'news-season' : ''}><span className="muted small">{LOG_LABEL[l.stage]}</span><span>{l.text}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 개막 준비: 2026년 샐러리캡 개편 (프랜차이즈 예외 고르기, 2027~ 하한). 캡이 없거나 2026년 전이면 숨긴다 */
function CapRulesPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const L = session.league;
  const me = session.teamIdx;
  const year = session.year + 1;
  const cap = salaryCap(year, L);
  if (cap === null || year < FRANCHISE_TAG_FROM) return null;
  const floor = salaryFloor(year, L);
  const pay = teamCapPayroll(L, me, year);
  const tag = franchiseTag(L, me, year);
  const chosen = L.franchiseTags?.[me] ?? null;
  const cands = L.players.filter((p) => franchiseTagEligible(L, p, me)).sort((a, b) => b.contract.salary - a.contract.salary || a.id.localeCompare(b.id));
  return (
    <section className="panel">
      <h2>{year} 샐러리캡 <StatusBadge status="research" /></h2>
      <p className="muted small">
        캡 대상 연봉 {won(pay)} / 상한 {won(cap)}{floor ? ` · 하한 ${won(floor)}` : ''}.
        초과 제재: 1회 30%, 2회 연속 50%, 3회 연속부터 100%와 1라운드 지명권 9단계 하락 (연속 횟수는 2023년부터 이어 셈, 임시값).
      </p>
      {floor !== null && pay < floor && (
        <p className="error-text small">하한보다 {won(floor - pay)} 적습니다. 하한 미달 제재는 확인 전이라 게임에서는 개막 때 알림만 합니다.</p>
      )}
      <h3>프랜차이즈 예외</h3>
      <p className="muted small">
        우리 구단에서 {FRANCHISE_TAG_SEASONS}시즌 이상 뛴 국내 선수 1명의 연봉은 {FRANCHISE_TAG_SHARE * 100}%만 캡에 넣습니다.
        고르지 않으면 자격 선수 중 연봉이 가장 높은 선수로 자동 지정합니다.
      </p>
      {cands.length === 0 ? <p className="muted small">자격 선수가 없습니다.</p> : (
        <label className="inline">
          <span>예외 선수</span>
          <select value={chosen && cands.some((p) => p.id === chosen) ? chosen : ''}
            onChange={(e) => act(session.setFranchiseTag(e.target.value || null))}>
            <option value="">자동 지정{tag && !(chosen && cands.some((p) => p.id === chosen)) ? ` (${tag.name})` : ''}</option>
            {cands.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {seasonsWith(p, L, me)}시즌 · {won(p.contract.salary)}</option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}

/** 개막 준비: 다음 시즌 "달라지는 규칙" 미리 보기 (FA·외국인·캡·엔트리처럼 오프시즌 결정에 닿는 것을 앞에) */
function RulePreview({ year }: { year: number }) {
  const { session, go } = useGame();
  const news = session.ruleNewsFor(year);
  return (
    <section className="panel">
      <h2>{year} 시즌, 달라지는 규칙</h2>
      <RuleNewsBody news={news} lines={previewOrder(news)} />
      <div className="actions"><button type="button" className="ghost" onClick={() => go('rules')}>규칙 연표 전체 보기</button></div>
    </section>
  );
}
