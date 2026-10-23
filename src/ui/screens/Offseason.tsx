// 오프시즌: 단계별 진행 (FA → 외국인 → 드래프트 → 연봉 협상 → 정원 정리 → 개막).
import { isStarterSkill } from '../../engine';
import { CAMP_DAYS, CAMP_FOCUSES, CAMP_PLACES, FOCUS as CAMP_FOCUS, PLACE as CAMP_PLACE, type CampFocus, type CampPick, type CampPlace } from '../../league/camp';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { OfferPanel } from './Club';
import { useCurrentStep, useShell } from '../shell';
import { PICK_MAX_ROUND, PICK_TRADE_FROM } from '../../league/picks';
import { DRAFT_ROUNDS, FA_ROUNDS, LOG_LABEL, STAGE_LABEL, STAGES, type LogStage, canSignForeign, draftTeamAt, draftTotal, foreignLimits, foreignSlots, pickKindAt, pickNoAt } from '../../league/offseason';
import * as Off from '../../league/offseason';
import { AgentTalk } from './FantasyNegotiate';
import {
  dollarText, FA_COMP, FA_GRADE_FROM, faGradeLabel, franchiseTag, franchiseTagEligible, FRANCHISE_TAG_FROM, FRANCHISE_TAG_SEASONS,
  FRANCHISE_TAG_SHARE, foreignCap, foreignContractTotal, isPreGrade, minSalary, salaryCap, salaryFloor, teamCapPayroll,
} from '../../league/salary';
import { seasonsWith } from '../../league/stadium';
import type { LeaguePlayer } from '../../league/types';
import { posName, TeamName, useGame, usePriceIndex, useWon } from '../context';
import { runsGrade } from '../grades';
import { DataTable, PotCell, potentialSortValue, usePotentialOf } from '../parts';
import type { Column } from '../table';
import { ruleOf } from '../../league/rules';
import { WatchStar } from './Watch';
import { previewOrder } from '../../league/ruleNews';
import { RulePreviewBody, StatusBadge } from '../RuleNews';
import { FIX_LABEL, stageHeadline, stageLeftovers, stageRecord, type Leftover, type LeftoverFix } from '../offStage';
import { teamVars } from '../teams';
import { useNarrow } from '../BoxScore';

/** 오프시즌 화면에서 쓰는 선수 한 줄 정보 */
function useInfo() {
  const { session } = useGame();
  const next = session.year + 1;
  const potOf = usePotentialOf();
  return (p: LeaguePlayer) => {
    const age = p.birthYear ? next - p.birthYear : null;
    return {
      age,
      role: p.isPitcher ? (isStarterSkill(p.pit) ? '선발' : '구원') : posName(p.pos),
      now: runsGrade(session.nextRuns(p.id), session.year),
      // 잠재 표시는 선수 상세와 같은 규칙 (UI 2단계 결정 5): 27세 이하 범위, 28~30세 숫자, 31세 이상 숨김
      // (31세 이상은 잠재력이 전성기 상한이라 뜻이 없다, 2026-10-09 전수조사 M5)
      pot: potOf(p, age),
    };
  };
}

export function Offseason() {
  const { session, changed, autosave, go } = useGame();
  const { setPrimary } = useShell();
  const off = session.offseason;
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // 지난 단계 기록 보기 (단계 표시줄에서 지난 단계를 누름, 읽기 전용). null이면 지금 단계 판
  const [record, setRecord] = useState<LogStage | null>(null);
  // 남은 처리 확인 창: 남은 처리가 있는데 '다음'을 눌렀을 때 (기획안 2.5.1)
  const [confirm, setConfirm] = useState<Leftover[] | null>(null);
  const steps = useCurrentStep<HTMLOListElement>(off?.stage);

  const act = (r: { ok: boolean; message: string }, okText?: string) => {
    setMsg(r.ok ? (okText || r.message ? { text: okText ?? r.message } : null) : { text: r.message, error: true });
    changed();
    if (r.ok) void autosave();
  };

  // 단계 넘기기. fix가 있으면 그 자동 처리(조작 하나)를 먼저 하고 넘긴다
  const step = async (fix?: LeftoverFix) => {
    setConfirm(null);
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    if (fix) {
      const f = fix === 'auto-comp' ? session.autoComp() : fix === 'auto-draft' ? session.autoDraft() : session.autoRelease();
      if (!f.ok) { setBusy(false); act(f); return; }
    }
    const r = session.nextStage();
    setBusy(false);
    setRecord(null);
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

  const left = off ? stageLeftovers(session) : [];
  const next = () => {
    if (!off) return;
    if (off.stage === 'ready') { void open(); return; }
    if (left.length) setConfirm(left);
    else void step();
  };
  const stageIdx = off ? STAGES.indexOf(off.stage) : -1;
  const nextLabel = !off ? '' : off.stage === 'ready'
    ? `${off.year + 1} 시즌 개막`
    : off.stage === 'fa'
      ? (off.fa.round < FA_ROUNDS ? `FA ${off.fa.round}라운드 마감` : `FA ${off.fa.round}라운드 마감 → ${STAGE_LABEL[STAGES[stageIdx + 1]]}`)
      : `다음: ${STAGE_LABEL[STAGES[stageIdx + 1]] ?? ''}`;

  // 주 진행 단추(상태 줄·휴대폰 아래 고정)가 이 화면의 '다음'·'개막'을 맡는다
  const nextRef = useRef(next);
  nextRef.current = next;
  const label = busy ? '처리 중' : nextLabel;
  useEffect(() => {
    if (!off) return;
    setPrimary({ label, act: () => nextRef.current(), disabled: busy, title: left.length ? `남은 처리 ${left.length}건 (넘기기 전에 확인 창이 뜹니다)` : undefined });
    return () => setPrimary(null);
  }, [off, label, busy, left.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!off) {
    return (
      <div className="stack">
        <h1>오프시즌</h1>
        <p className="muted">정규시즌이 끝나면 오프시즌을 시작할 수 있습니다.</p>
      </div>
    );
  }

  const head = stageHeadline(session);
  const viewing = record !== null && record !== off.stage;

  return (
    <div className="stack">
      <OfferPanel />
      <section>
        <h1>{off.year} 오프시즌</h1>
        <p className="muted small">결산(성장·연차·은퇴·병역)은 끝났습니다. 단계를 차례로 마치면 {off.year + 1} 시즌이 열립니다. 지난 단계를 누르면 그 단계 기록을 봅니다.</p>
      </section>

      {/* 단계 표시줄: 지난 단계 ✓(누르면 기록), 지금 단계, 남은 단계. 휴대폰에서는 지금 단계로 저절로 밀린다 */}
      <ol className="steps" aria-label="오프시즌 단계" ref={steps}>
        <li className={`done${record === 'settle' ? ' viewing' : ''}`}>
          <button type="button" className="step-btn" aria-pressed={record === 'settle'} onClick={() => setRecord(record === 'settle' ? null : 'settle')} title="결산 기록 보기">결산</button>
        </li>
        {STAGES.map((s, i) => (
          <li key={s} className={`${i < stageIdx ? 'done' : i === stageIdx ? 'now' : ''}${record === s && i < stageIdx ? ' viewing' : ''}`} aria-current={i === stageIdx ? 'step' : undefined}>
            {i < stageIdx && s === 'second' && !off.second && !off.expansion
              ? <span title="이번 오프시즌은 2차 드래프트·특별 지명이 없어 건너뛰었습니다">{STAGE_LABEL[s]} <span className="muted">(없음)</span></span>
              : i < stageIdx
              ? <button type="button" className="step-btn" aria-pressed={record === s} onClick={() => setRecord(record === s ? null : s)} title={`${STAGE_LABEL[s]} 기록 보기`}>{STAGE_LABEL[s]}</button>
              : i === stageIdx && viewing
                ? <button type="button" className="step-btn" onClick={() => setRecord(null)} title="지금 단계로 돌아가기">{STAGE_LABEL[s]}</button>
                : STAGE_LABEL[s]}
          </li>
        ))}
      </ol>

      {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}

      {/* 2026-10-12 UI 개편: 지금 단계와 다년 계약은 본문, 지명권·포스팅·소식은 오른쪽 곁 칸 (좁으면 아래로) */}
      <div className="off-split">
      <div className="stack off-main">
      {viewing ? <StageRecord stage={record!} onBack={() => setRecord(null)} /> : (<>
      {head.length > 0 && (
        <p className="off-head" aria-label={`${STAGE_LABEL[off.stage]} 요약`}>
          <strong>{STAGE_LABEL[off.stage]}</strong>{head.map((h) => <span key={h}>{h}</span>)}
        </p>
      )}
      {off.stage === 'fa' && <FaPanel act={act} />}
      {off.stage === 'comp' && <CompPanel act={act} />}
      {off.stage === 'second' && <SecondPanel act={act} />}
      {off.stage === 'foreign' && <ForeignPanel act={act} />}
      {off.stage === 'draft' && <DraftPanel act={act} />}
      {off.stage === 'salary' && <SalaryPanel act={act} />}
      {off.stage === 'release' && <ReleasePanel act={act} />}
      {off.stage === 'ready' && <ReadyCard busy={busy} onOpen={() => void open()} />}
      {off.stage === 'ready' && <CapRulesPanel act={act} />}
      {off.stage !== 'ready' && <ExtensionPanel act={act} />}
      {off.stage !== 'ready' && (
        <section className="off-next" aria-label="남은 처리">
          <div className="off-left">
            {left.length === 0 ? <span className="muted small">남은 처리 없음</span> : (
              <>
                <span className="small"><b>남은 처리</b> {left.length}건</span>
                <ul className="plain small">{left.map((l) => <li key={l.key}>{l.blocking && <span className="tag warn-tag">먼저</span>} {l.title}</li>)}</ul>
              </>
            )}
          </div>
          <button type="button" onClick={next} disabled={busy}>{label} ▶</button>
        </section>
      )}
      </>)}
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
      {confirm && <LeftoverDialog items={confirm} stage={off.stage} label={nextLabel} onCancel={() => setConfirm(null)} onGo={(fix) => void step(fix)} />}
    </div>
  );
}

/** 남은 처리 확인 창 (기획안 2.5.1): 남은 일과 "넘기면 일어나는 일". 막히는 일이 있으면 그대로 넘기기는 없고 자동 처리 길만 */
function LeftoverDialog({ items, stage, label, onCancel, onGo }: {
  items: Leftover[]; stage: Off.Stage; label: string; onCancel: () => void; onGo: (fix?: LeftoverFix) => void;
}) {
  const { session } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const blocked = items.some((l) => l.blocking);
  const fixes = [...new Set(items.flatMap((l) => (l.fix ? [l.fix] : [])))];
  return (
    <dialog ref={ref} className="player summary off-confirm" onClose={onCancel} aria-label="남은 처리 확인" style={teamVars(session.team.franchise, session.team.name)}>
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2>{STAGE_LABEL[stage]}: 남은 처리 {items.length}건</h2>
            <p className="muted small">{blocked ? '먼저 해야 하는 일이 있어 그대로는 넘길 수 없습니다.' : '그대로 넘기면 아래처럼 됩니다.'}</p>
          </div>
        </header>
        <ul className="plain leftover-list">
          {items.map((l) => (
            <li key={l.key}>
              <b>{l.blocking && <span className="tag warn-tag">먼저</span>} {l.title}</b>
              <div className="small">{l.blocking ? l.then : `넘기면: ${l.then}`}</div>
            </li>
          ))}
        </ul>
        <div className="actions">
          {fixes.map((f) => <button key={f} type="button" onClick={() => onGo(f)}>{FIX_LABEL[f]}</button>)}
          {!blocked && <button type="button" onClick={() => onGo()}>그대로 넘기기 ({label})</button>}
          <button type="button" className="ghost" onClick={() => { ref.current?.close(); onCancel(); }}>돌아가서 처리하기</button>
        </div>
      </div>
    </dialog>
  );
}

/** 지난 단계 기록 (읽기 전용): 그 단계 소식 묶음 */
function StageRecord({ stage, onBack }: { stage: LogStage; onBack: () => void }) {
  const { session } = useGame();
  const [all, setAll] = useState(false);
  const rows = stageRecord(session, stage, all);
  return (
    <section className="panel stage-record">
      <div className="row-between wrap">
        <h2>{LOG_LABEL[stage]} 기록 <span className="muted small">읽기 전용 · 지난 단계는 바꿀 수 없습니다</span></h2>
        <button type="button" className="ghost small-btn" onClick={onBack}>지금 단계({STAGE_LABEL[session.offseason!.stage]})로</button>
      </div>
      <label className="inline small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 다른 구단 소식도</label>
      {rows.length === 0 ? <p className="muted">{all ? '이 단계 소식이 없습니다.' : '우리 구단·큰 소식이 없습니다. "다른 구단 소식도"를 켜 보세요.'}</p> : (
        <ul className="news">
          {rows.map((l, k) => <li key={k} className={l.mine ? 'news-season' : ''}><span>{l.text}</span></li>)}
        </ul>
      )}
    </section>
  );
}

/** 개막 준비 카드 (기획안 2.5.3): 준비 확인 줄 → 달라지는 규칙 미리 보기 → 개막 */
function ReadyCard({ busy, onOpen }: { busy: boolean; onOpen: () => void }) {
  const { session, go } = useGame();
  const won = useWon();
  const narrow = useNarrow();
  const L = session.league;
  const me = session.teamIdx;
  const year = session.year + 1;
  const size = Off.userOrgSize(L, session.offseason!);
  const limit = ruleOf(L, 'orgLimit');
  const cap = salaryCap(year, L);
  const floor = salaryFloor(year, L);
  const pay = teamCapPayroll(L, me, year);
  const capOver = cap !== null && pay > cap;
  const under = floor !== null && pay < floor;
  const news = session.ruleNewsFor(year);
  const showCapRules = cap !== null && year >= FRANCHISE_TAG_FROM;
  return (
    <section className="panel ready-card">
      <h2>{year} 시즌 개막 준비 완료</h2>
      <ul className="plain ready-checks">
        <li className={size > limit ? 'warn' : 'ok'}>{size > limit ? '⚠' : '✓'} 선수단 {size}/{limit}명</li>
        <li className="ok">✓ 1군 엔트리: 개막하면 AI가 짠 명단으로 시작 (개막 뒤 전력 &gt; 기용 보드에서 바꿈)</li>
        <li className={capOver || under ? 'warn' : 'ok'}>
          {capOver || under ? '⚠' : '✓'} {cap ? '캡 대상 연봉' : '연봉 총액'} {won(pay)}{cap ? ` / 상한 ${won(cap)}` : ' (샐러리캡 없는 시대)'}{floor ? ` · 하한 ${won(floor)}` : ''}
          {showCapRules && <> <button type="button" className="link small" onClick={() => document.getElementById('cap-rules')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>프랜차이즈 예외 고르기 ▾</button></>}
        </li>
      </ul>
      <h3>{year}년 달라지는 규칙 <span className="muted small">미리 보기 · 개막 때 창으로 한 번 더 보입니다</span></h3>
      <RulePreviewBody news={news} lines={previewOrder(news)} top={narrow ? 2 : 4} />
      <div className="actions">
        <button type="button" className="ghost" onClick={() => go('rules')}>규칙 연표 전체 보기</button>
        <button type="button" onClick={onOpen} disabled={busy}>{busy ? '준비 중' : `${year} 시즌 개막 ▶`}</button>
      </div>
    </section>
  );
}

type Act = (r: { ok: boolean; message: string }, okText?: string) => void;

type Info = ReturnType<ReturnType<typeof useInfo>>;
interface PRow { p: LeaguePlayer; i: Info }

/** 요약/상세 (정보 깊이) */
const useFull = () => useShell().density === 'full';

// 오프시즌 표의 공통 열 (UI 2단계 U2-6: 단계 판 표를 공통 표 부품 DataTable로). 이름은 늘 보이고(휴대폰 왼쪽 고정), brief 열은 요약에서도 보인다
// 조작 칸(보호·지명·계약·제시·결정)은 fixed로 두어 열 고르기로 숨길 수 없게 한다
function nameCol<R extends PRow>(extra?: (r: R) => ReactNode): Column<R> {
  return { key: 'name', label: '선수', text: true, fixed: true, value: (r) => r.p.name, cell: (r) => <>{r.p.name}{extra?.(r)}</> };
}
function baseCols<R extends PRow>(potLabel = '잠재'): Column<R>[] {
  return [
    { key: 'role', label: '자리', brief: true, value: (r) => r.i.role },
    { key: 'age', label: '나이', brief: true, value: (r) => r.i.age },
    { key: 'now', label: '종합', brief: true, title: '다음 시즌 예상 기여를 20~80으로 (50 = 리그 평균 주전)', value: (r) => r.i.now },
    { key: 'pot', label: potLabel, brief: true, value: (r) => potentialSortValue(r.i.pot), cell: (r) => <PotCell v={r.i.pot} /> },
  ];
}
function payCol<R extends PRow>(won: (man: number) => string, label = '연봉', brief = true): Column<R> {
  return {
    key: 'pay', label, brief, value: (r) => (r.p.foreign ? foreignContractTotal(r.p.contract) : r.p.contract.salary),
    cell: (r) => (r.p.foreign ? dollarText(foreignContractTotal(r.p.contract)) : won(r.p.contract.salary)),
  };
}
function teamCol<R extends PRow>(names: string[], team: (r: R) => number, label = '구단', brief = true): Column<R> {
  return { key: 'team', label, text: true, brief, value: (r) => names[team(r)] ?? '', cell: (r) => <TeamName idx={team(r)} /> };
}
const byName = (r: PRow) => r.p.name;
const virtualTag = (r: PRow) => (!r.p.real ? <span className="tag" title="가상 선수">가상</span> : null);


/** 지명 구분 짧은 표시: 1R, 우선, 특별 */
function pickShort(kind: number): string {
  return kind >= 1 ? `${kind}R` : kind === 0 ? '우선' : '특별';
}

/** FA 보상선수 (2026-10-08): 영입 구단은 보호선수 명단을, 원 소속 구단은 보상선수 또는 보상금만을 고른다 */
function CompPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const full = useFull();
  const off = session.offseason!;
  const info = useInfo();
  const me = session.teamIdx;
  const cases = off.comp ?? [];
  const name = (id: string) => session.leaguePlayer(id)?.name ?? id;
  const mineIn = cases.filter((c) => c.to === me);
  const mineOut = cases.filter((c) => c.from === me);
  const others = cases.filter((c) => c.to !== me && c.from !== me);
  // 추천(자동 선택과 같은 기준)은 우리가 고를 건에만 한 번씩 계산한다
  const recs = useMemo(() => Object.fromEntries(mineOut.map((c) => [c.fa, session.compRecommendation(c.fa)])), [session, off.comp]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const rec = recs[c.fa];
        const rows = Off.compCandidates(session.league, off, c)
          .map((p) => ({ p, i: info(p), runs: session.nextRuns(p.id) }))
          .sort((a, b) => b.runs - a.runs);
        const cols: Column<(typeof rows)[number]>[] = [
          nameCol((r) => (r.p.id === rec ? <span className="tag" title="자동 선택과 같은 기준 (보호 밖 최고 가치)">추천</span> : null)),
          ...baseCols(), payCol(won),
          { key: 'act', label: '', fixed: true, value: () => null, cell: (r) => <button type="button" className="small-btn" disabled={c.pick === r.p.id} onClick={() => act(session.pickComp(c.fa, r.p.id))}>{c.pick === r.p.id ? '고름' : '지명'}</button> },
        ];
        return (
          <div className="panel mine" key={c.fa}>
            <h2>
              {name(c.fa)} 보상 <span className="muted small">{session.league.teams[c.to].name} 영입 · {faGradeLabel(c.grade)} · 직전 연봉 {won(c.prevSalary)}</span>
            </h2>
            <p className="small">
              지금 선택: <strong>{c.pick === null ? '아직 고르지 않음' : c.pick === 'cash' ? `보상금만 (${won(FA_COMP[c.grade].cashOnly * c.prevSalary)})` : `${name(c.pick)} + 보상금 ${won(FA_COMP[c.grade].withPlayer! * c.prevSalary)}`}</strong>
              {rec && <span className="muted"> · 추천: {rec === 'cash' ? '보상금만' : name(rec)}</span>}
            </p>
            <div className="actions">
              <button type="button" className={c.pick === 'cash' ? '' : 'ghost'} onClick={() => act(session.pickComp(c.fa, 'cash'))}>
                보상금만 받기 ({won(FA_COMP[c.grade].cashOnly * c.prevSalary)})
              </button>
              <button type="button" className="ghost" onClick={() => act(session.autoComp(), '추천 기준으로 골랐습니다.')}>추천대로 고르기</button>
            </div>
            {full && <p className="muted small">보상선수를 고르면 보상금 {FA_COMP[c.grade].withPlayer! * 100}%({won(FA_COMP[c.grade].withPlayer! * c.prevSalary)})를 함께 받고, 보상금만이면 {FA_COMP[c.grade].cashOnly * 100}%({won(FA_COMP[c.grade].cashOnly * c.prevSalary)})를 받습니다.</p>}
            <div className="pick-table">
              <DataTable id="off-comp-pick" label="보호 명단 밖 선수" cols={cols} rows={rows} rowKey={(r) => r.p.id} full={full} searchText={byName}
                rowClass={(r) => (c.pick === r.p.id ? 'me' : undefined)} empty="보호 명단 밖 선수가 없습니다 (보상금만)." />
            </div>
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
  const full = useFull();
  const off = session.offseason!;
  const info = useInfo();
  const limit = FA_COMP[c.grade].protect!;
  const prot = new Set(c.protect);
  const rows = Off.protectPool(session.league, off, c)
    .map((p) => ({ p, i: info(p), runs: session.nextRuns(p.id) }))
    .sort((a, b) => Number(prot.has(b.p.id)) - Number(prot.has(a.p.id)) || b.runs - a.runs);
  const auto = session.league.players.filter((p) => p.team === c.to && Off.autoProtected(off, p)).length;
  const toggle = (id: string) => {
    const next = prot.has(id) ? c.protect.filter((x) => x !== id) : [...c.protect, id];
    act(session.setProtect(c.fa, next));
  };
  const cols: Column<(typeof rows)[number]>[] = [
    nameCol(),
    { key: 'on', label: '보호', fixed: true, value: (r) => Number(prot.has(r.p.id)), cell: (r) => <input type="checkbox" checked={prot.has(r.p.id)} disabled={!prot.has(r.p.id) && c.protect.length >= limit} onChange={() => toggle(r.p.id)} aria-label={`${r.p.name} 보호`} /> },
    ...baseCols(), payCol(won),
  ];
  return (
    <div className="panel mine">
      <h2>
        {session.leaguePlayer(c.fa)?.name} 영입: 보호선수 명단 <span className="muted small">{c.protect.length}/{limit}명 · 자동 보호 {auto}명 · 원 소속 {session.league.teams[c.from].name}</span>
      </h2>
      <p className="muted small">처음에는 가치 높은 순 추천 명단이 들어 있습니다. 체크를 풀거나 넣어 바꾸세요. 명단 밖 선수 중 1명을 상대 구단이 데려갈 수 있습니다.</p>
      <div className="pick-table">
        <DataTable id="off-comp-protect" label="보호선수 명단" cols={cols} rows={rows} rowKey={(r) => r.p.id} full={full} searchText={byName}
          rowClass={(r) => (prot.has(r.p.id) ? 'me' : undefined)} />
      </div>
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
      {!off.expansion && !off.second && <p className="panel muted">이번 오프시즌에는 2차 드래프트·특별 지명이 없습니다. 다음 단계로 넘기세요.</p>}
    </section>
  );
}

function ProtectDraftPanel({ d, act }: { d: Off.ProtectDraft; act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const full = useFull();
  const info = useInfo();
  const off = session.offseason!;
  const me = session.teamIdx;
  const L = session.league;
  const names = L.teams.map((t) => t.name);
  const title = d.kind === 'second' ? `${off.year} 2차 드래프트` : `${L.teams[d.team!].name} 창단 특별 지명`;
  const takesPart = Off.protectDraftTeams(L, off, d).includes(me);
  const prot = new Set(d.protect[String(me)] ?? []);
  const pool = takesPart ? Off.protectDraftPool(L, off, d, me)
    .map((p) => ({ p, i: info(p), runs: session.nextRuns(p.id) }))
    .sort((a, b) => Number(prot.has(b.p.id)) - Number(prot.has(a.p.id)) || b.runs - a.runs) : [];
  const toggle = (id: string) => act(session.setDraftProtect(d.kind, prot.has(id) ? [...prot].filter((x) => x !== id) : [...prot, id]));
  const picker = d.kind === 'second' || d.team === me;
  const wish = new Set(d.wish);
  const cands = picker ? Off.protectDraftCandidates(L, off, d, me)
    .map((p) => ({ p, i: info(p), runs: session.nextRuns(p.id) }))
    .sort((a, b) => Number(wish.has(b.p.id)) - Number(wish.has(a.p.id)) || b.runs - a.runs) : [];
  const toggleWish = (id: string) => act(session.setDraftWish(d.kind, wish.has(id) ? d.wish.filter((x) => x !== id) : [...d.wish, id]));
  const rule = d.kind === 'second' ? Off.secondRule(off.year) : null;
  const protCols: Column<(typeof pool)[number]>[] = [
    nameCol(),
    { key: 'on', label: '보호', fixed: true, value: (r) => Number(prot.has(r.p.id)), cell: (r) => <input type="checkbox" checked={prot.has(r.p.id)} disabled={!prot.has(r.p.id) && prot.size >= d.limit} onChange={() => toggle(r.p.id)} aria-label={`${r.p.name} 보호`} /> },
    ...baseCols(), payCol(won),
  ];
  const wishCols: Column<(typeof cands)[number]>[] = [
    nameCol(),
    { key: 'on', label: '지명', fixed: true, value: (r) => Number(wish.has(r.p.id)), cell: (r) => <input type="checkbox" checked={wish.has(r.p.id)} onChange={() => toggleWish(r.p.id)} aria-label={`${r.p.name} 지명 희망`} /> },
    teamCol(names, (r) => r.p.team), ...baseCols(), payCol(won),
  ];
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
          <div className="pick-table">
            <DataTable id="off-pd-protect" label="우리 보호선수 명단" cols={protCols} rows={pool} rowKey={(r) => r.p.id} full={full} searchText={byName}
              rowClass={(r) => (prot.has(r.p.id) ? 'me' : undefined)} />
          </div>
        </div>
      )}
      {picker && (
        <div className="panel mine">
          <h2>지명 희망 <span className="muted small">{d.wish.length}명 고름 · 고른 순서대로, 우리 차례에 남아 있는 선수를 지명</span></h2>
          {d.kind === 'second' && <p className="muted small">아무도 고르지 않으면 지명하지 않습니다 (패스).</p>}
          {d.wish.length > 0 && <p className="small">순서: {d.wish.map((id, k) => <span key={id}>{k > 0 && ' → '}{L.players.find((p) => p.id === id)?.name ?? id}</span>)}</p>}
          <div className="pick-table">
            <DataTable id="off-pd-wish" label="지명 후보" cols={wishCols} rows={cands.slice(0, 40)} rowKey={(r) => r.p.id} full={full} searchText={byName}
              rowClass={(r) => (wish.has(r.p.id) ? 'me' : undefined)} />
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
  const full = useFull();
  const off = session.offseason!;
  const info = useInfo();
  const [draft, setDraft] = useState<Record<string, { salary: string; years: string }>>({});
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const names = session.league.teams.map((t) => t.name);
  const entries = off.fa.entries;
  const mineLeaving = entries.filter((e) => e.from === session.teamIdx && e.status === 'open');
  const externalOffers = Object.keys(off.fa.userOffers).filter((id) => entries.find((e) => e.id === id)?.from !== session.teamIdx).length;
  const rows = entries.map((e) => { const p = players.get(e.id)!; return { p, i: info(p), e }; });
  type Row = (typeof rows)[number];
  const state = ({ p, e }: Row) => {
    const mine = off.fa.userOffers[e.id];
    // 제시 연봉은 억 원 단위로 입력한다 (소수 한 자리). 내부 계산은 만 원 단위.
    // 기본값은 요구액을 0.1억 단위로 올림 (내림하면 요구액보다 모자라 1라운드에서 거절된다)
    const d = draft[e.id] ?? { salary: (Math.ceil((e.ask * px) / 1000) / 10).toFixed(1), years: String(e.years) };
    return e.status === 'signed' ? (
      <span>{e.team === e.from ? '잔류' : '이적'} · <TeamName idx={e.team!} /> {e.signedYears}년 연 {won(e.salary!)}</span>
    ) : e.status === 'left' ? (
      <span className="muted">미계약 (무적: 2차 드래프트·육성선수 후보)</span>
    ) : mine ? (
      <span className="inline">제시함: {mine.years}년 연 {won(mine.salary)}
        <button type="button" className="small-btn" onClick={() => act(session.withdrawFa(e.id), '제시를 거뒀습니다.')}>거두기</button>
      </span>
    ) : (
      <span className="inline">
        <input type="number" min={(minSalary(session.offseason!.year + 1, session.league) * px) / 10000} step={0.1} value={d.salary} aria-label={`${p.name} 제시 연봉(억 원)`}
          onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, salary: ev.target.value } })} style={{ width: '6em' }} />억 원
        <select value={d.years} aria-label="계약 기간" onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, years: ev.target.value } })}>
          {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <button type="button" className="small-btn" onClick={() => act(session.offerFa(e.id, Math.round((Number(d.salary) * 10000) / px), Number(d.years)))}>제시</button>
      </span>
    );
  };
  const statusOrder = (r: Row) => (r.e.status === 'open' ? (off.fa.userOffers[r.e.id] ? 1 : 0) : r.e.status === 'signed' ? 2 : 3);
  const cols: Column<Row>[] = [
    nameCol((r) => <> <WatchStar id={r.p.id} name={r.p.name} small bare /></>),
    teamCol(names, (r) => r.e.from, '원 소속', false),
    ...baseCols(),
    { key: 'grade', label: '등급', brief: true, value: (r) => (isPreGrade(r.e.grade) ? null : r.e.grade), cell: (r) => (isPreGrade(r.e.grade) ? '-' : r.e.grade) },
    { key: 'prev', label: '전년 연봉', brief: true, value: (r) => r.e.prevSalary, cell: (r) => won(r.e.prevSalary) },
    {
      key: 'ask', label: '요구 (연)', brief: true, value: (r) => r.e.ask,
      cell: ({ p, e }) => <>{won(e.ask)}{e.status === 'open' && <AgentTalk p={p} situation={`FA ${faGradeLabel(e.grade)}, 전년 연봉 ${Math.round(e.prevSalary / 1000) / 10}억 원, 요구 연 ${Math.round(e.ask / 1000) / 10}억 원 ${e.years}년. 원 소속 ${session.league.teams[e.from]?.name ?? ''}, 설득하는 구단 ${session.team.name}`} />}</>,
    },
    { key: 'years', label: '기간', brief: true, value: (r) => r.e.years, cell: (r) => `${r.e.years}년` },
    {
      key: 'vs', label: '제시/요구', title: '우리 제시 연봉이 요구 연봉의 몇 %인가', value: (r) => (off.fa.userOffers[r.e.id] ? off.fa.userOffers[r.e.id].salary / r.e.ask : null),
      cell: (r) => (off.fa.userOffers[r.e.id] ? `${Math.round((off.fa.userOffers[r.e.id].salary / r.e.ask) * 100)}%` : '-'),
    },
    { key: 'state', label: '상태 · 우리 제시', text: true, fixed: true, value: statusOrder, cell: state },
  ];

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
        {full && <p className="muted small">보상 규정: A·B등급 FA를 데려가면 원 소속 구단이 보호 명단 밖 선수 1명 + 보상금, 또는 보상금만을 고릅니다 (다음 단계). C등급은 보상금만.</p>}
      </div>
      <DataTable id="off-fa" label="FA 시장" cols={cols} rows={rows} rowKey={(r) => r.e.id} full={full} searchText={byName}
        rowClass={(r) => (r.e.from === session.teamIdx ? 'me' : undefined)} empty="이번 오프시즌 FA가 없습니다." />
      <p className="muted small">종합·잠재는 한 시즌 기여를 20~80으로 바꾼 값입니다 (50 = 리그 평균 주전). FA 제시 연봉은 억 원 단위로 입력합니다 (소수 한 자리, 예: 3.5 = 3억 5,000만 원).</p>
    </section>
  );
}

function ForeignPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const full = useFull();
  const off = session.offseason!;
  const f = off.foreign!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const slots = foreignSlots(session.league, session.teamIdx, off);
  const lim = foreignLimits(off);
  const myTurn = f.order[f.pointer] === session.teamIdx;
  const pool = f.pool.map((id) => players.get(id)!).sort((a, b) => session.nextRuns(b.id) - session.nextRuns(a.id))
    .map((p) => ({ p, i: info(p), check: canSignForeign(session.league, off, session.teamIdx, p) }));
  const expiringMine = Object.keys(f.keep).map((id) => { const p = players.get(id)!; return { p, i: info(p) }; });
  const pickedBefore = f.order.slice(0, f.pointer).filter((t) => t !== session.teamIdx);
  const keepCols: Column<(typeof expiringMine)[number]>[] = [
    nameCol(),
    { key: 'kind', label: '구분', brief: true, value: (r) => (r.p.asia ? '아시아쿼터' : '일반') },
    ...baseCols().filter((c) => c.key !== 'pot'),
    { key: 'pay', label: '지난 연봉', brief: true, value: (r) => foreignContractTotal(r.p.contract), cell: (r) => dollarText(foreignContractTotal(r.p.contract)) },
    {
      key: 'keep', label: '결정', text: true, fixed: true, value: (r) => Number(f.keep[r.p.id]),
      cell: (r) => <label className="inline small"><input type="checkbox" checked={f.keep[r.p.id]} onChange={(e) => act(session.setForeignKeep(r.p.id, e.target.checked))} /> 재계약</label>,
    },
  ];
  const poolCols: Column<(typeof pool)[number]>[] = [
    nameCol(virtualTag),
    { key: 'kind', label: '구분', brief: true, value: (r) => (r.p.asia ? '아시아쿼터' : '일반') },
    ...baseCols(),
    { key: 'ask', label: '요구액', brief: true, title: '연봉 + 계약금', value: (r) => foreignContractTotal(r.p.contract), cell: (r) => dollarText(foreignContractTotal(r.p.contract)) },
    { key: 'fee', label: '이적료', brief: true, value: (r) => r.p.transferFee ?? null, cell: (r) => (r.p.transferFee ? dollarText(r.p.transferFee) : '-') },
    {
      key: 'act', label: '', text: true, fixed: true, value: (r) => Number(r.check.ok),
      cell: (r) => (
        <>
          <button type="button" className="small-btn" disabled={!myTurn || !r.check.ok} title={r.check.ok ? '' : r.check.message}
            onClick={() => act(session.signForeign(r.p.id), `${r.p.name}와 계약했습니다.`)}>계약</button>
          {/* 막힌 까닭을 옆에 적는다 (2026-10-22 사용자: 비활성 버튼만 보여 왜 막혔는지 몰랐다) */}
          {myTurn && !r.check.ok && <span className="muted small"> {r.check.message}</span>}
        </>
      ),
    },
  ];

  return (
    <section className="stack">
      <div className="panel">
        <h2>외국인 선수</h2>
        <p className="muted small">
          보유 한도: {lim.asia ? `아시아쿼터를 빼고 ${lim.regular}명 + 아시아쿼터 ${lim.asia}명` : `${lim.regular}명`}. 신규(KBO 1년차) 계약은 연봉 + 계약금 {dollarText(foreignCap(session.league, 'foreignNewCap', off.year + 1))}, 아시아쿼터 신규는 {dollarText(foreignCap(session.league, 'asiaNewCap', off.year + 1))}까지(재계약은 개인 제한 없음),{' '}
          {lim.asia ? '아시아쿼터를 뺀 ' : ''}{lim.regular}명 총액은 {dollarText(foreignCap(session.league, 'foreignTotalCap', off.year + 1))}에 재계약 외국인마다 같은 구단 재계약 연차 × 10만 달러를 더한 값까지입니다. 직전 시즌 성적 역순으로 고릅니다.
        </p>
        <p className="small">
          우리 외국인: {slots.regular}/{lim.regular}명 (총액 {dollarText(slots.regularPay)} / 상한 {dollarText(slots.cap)}{slots.resignRoom > 0 ? `, 재계약 몫 +${dollarText(slots.resignRoom)}` : ''}){lim.asia ? ` · 아시아쿼터 ${slots.asia}/${lim.asia}명` : ''}
          {pickedBefore.length > 0 && <span className="muted"> · 우리보다 먼저 고른 구단: {pickedBefore.map((t) => session.league.teams[t].name).join(', ')}</span>}
        </p>
        {!myTurn && <p className="muted small">다음 단계로 넘기면 남은 구단이 고릅니다.</p>}
      </div>

      {expiringMine.length > 0 && (
        <div>
          <h2>재계약 대상 <span className="muted small">계약이 끝난 우리 외국인</span></h2>
          <DataTable id="off-foreign-keep" label="재계약 대상" cols={keepCols} rows={expiringMine} rowKey={(r) => r.p.id} full={full} />
          <p className="muted small">재계약 연봉은 성적에 따라 정해지고, 3명 총액 상한을 넘으면 남은 몫까지만 줍니다. 단계를 넘기기 전까지는 재계약으로 남긴 선수를 지난 연봉으로 총액에 셉니다 (아시아쿼터는 총액에 넣지 않습니다).</p>
        </div>
      )}

      <div>
        <h2>후보 <span className="muted small">{pool.length}명 (실존 선수는 다른 구단에서 재계약하지 않은 선수, 나머지는 가상 선수)</span></h2>
        <div className="pick-table">
          <DataTable id="off-foreign-pool" label="외국인 후보" cols={poolCols} rows={pool} rowKey={(r) => r.p.id} full={full} searchText={byName} />
        </div>
      </div>
    </section>
  );
}

function DraftPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const full = useFull();
  const off = session.offseason!;
  const d = off.draft!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const total = draftTotal(off);
  const done = d.pick >= total || d.pool.length === 0;
  const onClock = !done && draftTeamAt(off, d.pick) === session.teamIdx;
  const pool = d.pool.map((id) => players.get(id)!).sort((a, b) => (b.scoutPotential ?? 0) - (a.scoutPotential ?? 0) || a.id.localeCompare(b.id))
    .map((p) => ({ p, i: info(p) }));
  const mine = d.picks.filter((p) => p.team === session.teamIdx);
  const cols: Column<(typeof pool)[number]>[] = [
    nameCol((r) => <> <WatchStar id={r.p.id} name={r.p.name} small bare /></>),
    ...baseCols('잠재(평가)').slice(0, 2),
    { key: 'school', label: '학력', brief: true, value: (r) => (r.p.school === 'UNIV' ? '대졸' : '고졸') },
    ...baseCols('잠재(평가)').slice(2),
    { key: 'act', label: '', fixed: true, value: () => null, cell: (r) => <button type="button" className="small-btn" disabled={!onClock} onClick={() => act(session.draft(r.p.id))}>지명</button> },
  ];

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
          <div className="pick-table">
            <DataTable id="off-draft-pool" label="지명 가능 선수" cols={cols} rows={pool} rowKey={(r) => r.p.id} full={full} searchText={byName} />
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
                  return <tr key={pk.id}><td>{pickShort(pk.round)}</td><td className="l">{p.name}</td><td>{i.role}</td><td>{p.school === 'UNIV' ? '대졸' : '고졸'}</td><td>잠재 <PotCell v={i.pot} /></td></tr>;
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
  // 보이는 잠재(스카우트 짐작) 순. 실제 잠재로 늘어놓으면 순서로 정답이 드러난다
  const potKey = (p: LeaguePlayer) => potentialSortValue(info(p).pot) ?? -1;
  const sorted = [...rows].sort((a, b) => potKey(b.p) - potKey(a.p) || a.p.id.localeCompare(b.p.id)).slice(0, 25);
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
                    <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td><PotCell v={i.pot} /></td>
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
  const full = useFull();
  const off = session.offseason!;
  const s = off.salary!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const ids = Object.keys(s.offers).sort((a, b) => s.demands[b] - s.demands[a]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const total = ids.reduce((sum, id) => sum + s.offers[id], 0);
  const rows = ids.map((id) => { const p = players.get(id)!; return { p, i: info(p), id }; });
  const cols: Column<(typeof rows)[number]>[] = [
    nameCol(),
    ...baseCols().filter((c) => c.key !== 'pot'),
    { key: 'service', label: '1군 연차', title: 'FA까지 세는 1군 등록 연차', value: (r) => r.p.service ?? null, cell: (r) => `${r.p.service ?? 0}년` },
    payCol(won, '지난 연봉'),
    { key: 'demand', label: '요구액', brief: true, value: (r) => s.demands[r.id], cell: (r) => won(s.demands[r.id]) },
    {
      key: 'offer', label: '제시액 (억 원)', text: true, fixed: true, value: (r) => s.offers[r.id],
      cell: ({ p, id }) => {
        // 제시액은 억 원 단위로 보여 주고 입력한다 (0.01억 = 100만 원). 기본값은 지금 제시액을 0.01억 단위로 올림.
        // 값을 고쳤을 때만 제시액을 바꾼다 (보여 주려고 올린 값 때문에 제시액이 바뀌지 않게)
        const shown = (Math.ceil((s.offers[id] * px) / 100) / 100).toFixed(2);
        const v = edit[id] ?? shown;
        const low = s.offers[id] < s.demands[id];
        return (
          <span className="inline">
            <input type="number" min={(minSalary(session.offseason!.year + 1, session.league) * px) / 10000} step={0.01} value={v} aria-label={`${p.name} 제시액(억 원)`} style={{ width: '6em' }}
              onChange={(e) => setEdit({ ...edit, [id]: e.target.value })}
              onBlur={() => { if (edit[id] !== undefined && edit[id] !== shown) act(session.setSalaryOffer(id, Math.round((Number(v) * 10000) / px))); }} />억 원
            {low && <span className="status temp">조정 예상</span>}
          </span>
        );
      },
    },
  ];

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
      <DataTable id="off-salary" label="연봉 협상" cols={cols} rows={rows} rowKey={(r) => r.id} full={full} searchText={byName}
        empty="협상할 선수가 없습니다." />
    </section>
  );
}

function ReleasePanel({ act }: { act: Act }) {
  const { session } = useGame();
  const won = useWon();
  const full = useFull();
  const info = useInfo();
  const names = session.league.teams.map((t) => t.name);
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
  const mineRows = mine.map((p, order) => ({ p, i: info(p), order }));
  const mineCols: Column<(typeof mineRows)[number]>[] = [
    nameCol(({ p }) => (
      <>
        {p.foreign && <span className="tag">외</span>}{!p.real && <span className="tag">가상</span>}{p.contract.kind === 'rookie' && <span className="tag">신인</span>}
        {over > 0 && plan.order.indexOf(p) >= 0 && plan.order.indexOf(p) < over && <span className="tag" title="정원까지 자동 방출하면 나갑니다">방출 대상</span>}
      </>
    )),
    { key: 'order', label: '순서', title: '자동 방출 순서 (앞일수록 먼저 나감)', value: (r) => r.order, cell: (r) => (r.order < plan.order.length ? r.order + 1 : '-') },
    ...baseCols(), payCol(won, '계약'),
    { key: 'until', label: '계약 끝', value: (r) => r.p.contract.until, cell: (r) => `${r.p.contract.until}년` },
    {
      key: 'act', label: '', text: true, fixed: true, value: () => null,
      cell: ({ p }) => (
        <>
          {canDev(p) && <button type="button" className="small-btn" title="방출하지 않고 육성선수로 돌립니다 (정원에서 빠지고, 시즌 중 5월 1일부터 정식 등록)" onClick={() => act(session.toDev(p.id))}>육성 전환</button>}{' '}
          <button type="button" className="small-btn danger" onClick={() => act(session.release(p.id))}>방출</button>
        </>
      ),
    },
  ];
  const devRows = devPool.slice(0, 40).map((p) => ({ p, i: info(p) }));
  const devCols: Column<(typeof devRows)[number]>[] = [
    nameCol(virtualTag), ...baseCols('잠재(평가)'),
    { key: 'act', label: '', fixed: true, value: () => null, cell: (r) => <button type="button" className="small-btn" disabled={devs.length >= ruleOf(session.league, 'devLimit')} onClick={() => act(session.signDev(r.p.id))}>육성 영입</button> },
  ];
  const claimRows = claimable.map((p) => ({ p, i: info(p), from: session.offseason!.released!.find((r) => r.id === p.id)!.from }));
  const claimCols: Column<(typeof claimRows)[number]>[] = [
    nameCol(virtualTag), teamCol(names, (r) => r.from, '방출 구단'), ...baseCols(),
    { key: 'act', label: '', fixed: true, value: () => null, cell: (r) => <button type="button" className="small-btn" onClick={() => act(session.claim(r.p.id))}>영입</button> },
  ];
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
      <div className="pick-table">
        <DataTable id="off-release" label="우리 선수 (자동 방출 순)" cols={mineCols} rows={mineRows} rowKey={(r) => r.p.id} full={full} searchText={byName} />
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
                    <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>잠재 <PotCell v={i.pot} /></td>
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
          <div className="pick-table">
            <DataTable id="off-dev-pool" label="육성선수 후보" cols={devCols} rows={devRows} rowKey={(r) => r.p.id} full={full} searchText={byName} />
          </div>
          <p className="muted small">단계를 마감하면 AI 구단이 남은 선수 가운데 잠재력이 높은 선수를 육성선수로 데려갑니다.</p>
        </div>
      )}
      <div className="panel">
        <h2>방출 선수 영입 <span className="muted small">{claimable.length}명</span></h2>
        <p className="muted small">
          다른 구단이 이번에 방출한 선수를 최저 연봉({won(minSalary(session.offseason!.year + 1, session.league))}) 1년 계약으로 데려옵니다. 데려오면 정원이 늘어나니 다음 단계 전에 그만큼 방출해야 합니다.
          단계를 마감하면 AI 구단이 남은 방출 선수 중 쓸 만한 선수를 데려갑니다 (구단당 {Off.CLAIM_PER_TEAM}명까지).
        </p>
      </div>
      {claimable.length > 0 && (
        <div className="pick-table">
          <DataTable id="off-claim" label="방출 선수 영입" cols={claimCols} rows={claimRows} rowKey={(r) => r.p.id} full={full} searchText={byName} />
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
    <section className="panel" id="cap-rules">
      <h2>{year} 샐러리캡 <StatusBadge status="research" /></h2>
      <p className="muted small">
        캡 대상 연봉 {won(pay)} / 상한 {won(cap)}{floor ? ` · 하한 ${won(floor)}` : ''}.
        초과 제재: 1회 30%, 2회 연속 50%, 3회 연속부터 100%와 1라운드 지명권 9단계 하락 (한 해라도 지키면 1회부터 다시 셈).{floor ? ' 하한 미달은 미달액의 1회 30%, 2회 연속 50%, 3회 연속부터 100%를 유소년 발전기금으로 냅니다.' : ''}
      </p>
      {floor !== null && pay < floor && (
        <p className="error-text small">하한보다 {won(floor - pay)} 적습니다. 이대로 개막하면 유소년 발전기금을 냅니다.</p>
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
