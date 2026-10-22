// 트레이드 작업대 (2026-10-23 UI 2단계 U2-5, 기획안 2.4): ①후보 ②비교 ③제안 ④협상 ⑤검토.
// 협상의 "보내기"는 평가만 하고, 상대가 받아들이면 "합의". 최종 검토에서 "확정"을 눌러야 성사된다 (7장 결정 4, ui/tradeDesk.ts).
// 엔진·AI 판단·조작 기록은 그대로다. 선수 내놓기(받은 제안)도 고르면 ⑤ 검토로 간다.
import { defenseAt, defenseGrade, FIELD_POS, isStarterSkill, type FieldPos } from '../../engine';
import { useMemo, useState, type ReactNode } from 'react';
import { TENDENCY_LABEL } from '../../ai/trade';
import type { SimPlayer } from '../../engine';
import { formatDate, shortDate } from '../../game/calendar';
import { type ShopOffer, type ShopWant } from '../../game/session';
import { avg, era, fixed2, ipText, obp, ops, rate3, whip } from '../../game/stats';
import { Grade, PlayerLink, Pos, TeamLink, TeamName, useGame, usePriceIndex, useWon } from '../context';
import { currentRuns } from '../../ai/value';
import { runsGrade } from '../grades';
import { teamColor } from '../teams';
import { parsePick, pickId, PICK_MAX_ROUND, PICK_YEARS_AHEAD } from '../../league/picks';
import { GM_STYLE_LABEL, GM_STYLE_NOTE, gmStyle } from '../../league/gm';
import { dollarText } from '../../league/salary';
import { TradeTalk } from './FantasyNegotiate';
import { ruleOf } from '../../league/rules';
import { ConfirmButton } from '../ConfirmButton';
import { DataTable, PotCell, potentialSortValue, usePotentialOf, VsLeague } from '../parts';
import type { Column } from '../table';
import { useShell } from '../shell';
import { useLeague } from './PlayerDetail';
import {
  addToCompare, addToDraft, agreementStatus, COMPARE_MAX, confirmAgreement, deskOf, draftKey, draftParts, draftText, editDraft, isEmptyDraft, ourStarter, overall,
  pruneDraft, REASON_TEXT, removeFromCompare, sendDraft, slotOf, SLOTS, STEPS, tradeBlockReason, tradeImpact, updateDesk, useDesk, VERDICT_SHORT, weakSlots,
  type DeskState, type Step, type TradeDraft,
} from '../tradeDesk';

type Kind = 'all' | 'hit' | 'pit';

/** 좁은 화면 (휴대폰): 비교 칸 두 명씩, 바뀌는 것 접힘 */
function useNarrow(): boolean {
  const [narrow] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches);
  return narrow;
}

export function Trade() {
  const { session } = useGame();
  const desk = useDesk(session);
  const year = session.world.year;
  const open = session.tradeOpen;
  const today = sentToday(session, desk);
  const canGo = (k: Step) => k === 'talk' ? today.length > 0 : k === 'review' ? !!desk.agreed || !!desk.done : true;
  const setStep = (step: Step) => updateDesk(session, () => ({ step, note: null }));

  return (
    <div className="stack">
      <p className="muted small">
        {open
          ? `마감: ${session.tradeDl.month}월 ${session.tradeDl.date}일 (${formatDate(year, session.tradeDeadlineDay)} 경기 전까지)`
          : session.done ? '시즌이 끝나 트레이드를 할 수 없습니다.' : '트레이드 마감이 지났습니다.'}
        {' · '}한쪽에서 {ruleOf(session.league, 'maxPerSide')}명까지. 받은 선수는 2군으로 들어옵니다. 외국인 선수는 트레이드할 수 없습니다.
      </p>

      <div className="seg" role="tablist" aria-label="트레이드 방식">
        <button type="button" role="tab" aria-selected={desk.mode === 'deal'} className={desk.mode === 'deal' ? 'on' : ''} onClick={() => updateDesk(session, () => ({ mode: 'deal' }))}>데려오기</button>
        <button type="button" role="tab" aria-selected={desk.mode === 'shop'} className={desk.mode === 'shop' ? 'on' : ''} onClick={() => updateDesk(session, () => ({ mode: 'shop' }))}>내놓기</button>
      </div>

      {desk.mode === 'shop' && <ShopPanel open={open} />}

      {desk.mode === 'deal' && (
        <>
          <ol className="trade-steps" aria-label="트레이드 단계">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button type="button" className={desk.step === s.key ? 'on' : ''} aria-current={desk.step === s.key ? 'step' : undefined} disabled={!canGo(s.key)}
                  title={!canGo(s.key) ? (s.key === 'talk' ? '오늘 보낸 안이 없습니다' : '합의한 안이 없습니다') : undefined} onClick={() => setStep(s.key)}>
                  <span className="n">{'①②③④⑤'[i]}</span>{s.label}
                  {s.key === 'compare' && desk.compare.length > 0 && <span className="muted"> {desk.compare.length}</span>}
                  {s.key === 'review' && desk.agreed && <span className="tag agree-tag">합의</span>}
                </button>
              </li>
            ))}
          </ol>
          {desk.step === 'cands' && <Candidates />}
          {desk.step === 'compare' && <Compare />}
          {desk.step === 'offer' && <Offer />}
          {desk.step === 'talk' && <Talk />}
          {desk.step === 'review' && <Review />}
        </>
      )}

      <History />
    </div>
  );
}

/** 오늘 보낸 안 */
function sentToday(s: ReturnType<typeof useGame>['session'], d: DeskState) {
  return d.sent.filter((r) => r.year === s.year && r.day === s.currentDay);
}

// ---- ① 후보 보드

interface Cand { p: SimPlayer; slot: string; ov: number; pot: ReturnType<ReturnType<typeof usePotentialOf>>; salary: number | null; until: number | null; status: string; block: string | null }

const AGE_OPTS = [0, 23, 25, 27, 30, 33];

function Candidates() {
  const { session, version, openPlayer } = useGame();
  const desk = useDesk(session);
  const won = useWon();
  const { density } = useShell();
  const full = density === 'full';
  const potOf = usePotentialOf();
  const year = session.world.year;
  const [team, setTeam] = useState(-1);
  const [slot, setSlot] = useState('all');
  const [age, setAge] = useState(0);
  const [until, setUntil] = useState(0);
  const [weak, setWeak] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const weakList = useMemo(() => weakSlots(session), [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = session.world.teams.filter((t) => t.idx !== session.teamIdx);
  const tendency = useMemo(() => new Map(others.map((t) => [t.idx, session.tendency(t.idx)])), [session, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const all: Cand[] = useMemo(() => others.flatMap((t) => t.org).map((p) => {
    const lp = session.leaguePlayer(p.id);
    const back = session.returnDay(p);
    return {
      p, slot: slotOf(p), ov: overall(session, p), pot: lp ? potOf(lp, p.age) : null,
      salary: lp ? lp.contract.salary : null, until: lp ? lp.contract.until : null,
      status: p.dev ? '육성' : back !== null ? `결장 · ${back >= session.season.schedule.length ? '시즌 아웃' : `${shortDate(year, back)} 복귀`}` : '출전 가능',
      block: tradeBlockReason(session, p),
    };
  }), [session, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = all.filter((c) => (team < 0 || c.p.teamIdx === team)
    && (slot === 'all' || c.slot === slot)
    && (!age || (c.p.age ?? 99) <= age)
    && (!until || (until === 1 ? (c.until ?? 0) <= year : until === 2 ? (c.until ?? 0) <= year + 1 : (c.until ?? 0) >= year + 2))
    && (!weak || weakList.includes(c.slot)));

  const act = (c: Cand) => {
    const inCmp = desk.compare.includes(c.p.idx);
    const inDraft = desk.draft.team === c.p.teamIdx && desk.draft.get.includes(c.p.idx);
    return (
      <span className="cand-act">
        <button type="button" className="ghost small-btn" disabled={inCmp} aria-label={`${c.p.name} 비교에 넣기`}
          onClick={() => { const e = addToCompare(session, c.p.idx); setNote(e ?? `${c.p.name}: 비교 칸 ${deskOf(session).compare.length}/${COMPARE_MAX}`); }}>
          {inCmp ? '비교 중' : '+비교'}
        </button>
        <button type="button" className="ghost small-btn" disabled={!!c.block || inDraft} title={c.block ?? undefined} aria-label={`${c.p.name} 제안에 넣기`}
          onClick={() => { const e = addToDraft(session, c.p); setNote(e ?? `${c.p.name}: 받을 선수에 넣었습니다 (③ 제안)`); }}>
          {inDraft ? '제안 중' : '+제안'}
        </button>
      </span>
    );
  };

  const cols: Column<Cand>[] = [
    { key: 'name', label: '이름', fixed: true, text: true, value: (c) => c.p.name, cell: (c) => <PlayerLink p={c.p} /> },
    { key: 'team', label: '팀', brief: true, text: true, value: (c) => session.world.teams[c.p.teamIdx].name,
      cell: (c) => <><TeamLink idx={c.p.teamIdx} /> <span className="tag" title="상대 구단 성향">{TENDENCY_LABEL[tendency.get(c.p.teamIdx)!]}</span></> },
    { key: 'slot', label: '자리', brief: true, value: (c) => SLOTS.indexOf(c.slot as typeof SLOTS[number]), cell: (c) => (c.p.isPitcher ? c.slot : <Pos pos={c.slot} />) },
    { key: 'age', label: '나이', brief: true, lower: true, value: (c) => c.p.age },
    { key: 'ov', label: '종합', brief: true, value: (c) => c.ov, cell: (c) => <Grade v={c.ov} /> },
    { key: 'pot', label: '잠재', brief: true, title: '27세 이하 범위(스카우트 짐작), 28~30세 숫자, 31세 이상 숨김', value: (c) => potentialSortValue(c.pot), cell: (c) => <PotCell v={c.pot} /> },
    { key: 'sal', label: '연봉', brief: true, value: (c) => c.salary, cell: (c) => (c.salary === null ? '-' : c.p.foreign ? dollarText(c.salary) : won(c.salary)) },
    { key: 'until', label: '계약', brief: true, title: '계약 마지막 해', value: (c) => c.until },
    { key: 'st', label: '상태', brief: true, text: true, value: (c) => c.block ?? c.status, cell: (c) => (c.block ? <span className="muted small" title={c.block}>{c.p.foreign ? '외국인 · 불가' : '트레이드 불가'}</span> : <span className="small">{c.status}</span>) },
    { key: 'act', label: '', fixed: true, value: () => null, cell: act },
  ];

  return (
    <section className="stack tight">
      <div className="cand-filters small">
        <label>상대 <select value={team} onChange={(e) => setTeam(Number(e.target.value))}>
          <option value={-1}>전 구단</option>
          {others.map((t) => <option key={t.idx} value={t.idx}>{t.name} ({TENDENCY_LABEL[tendency.get(t.idx)!]})</option>)}
        </select></label>
        <label>자리 <select value={slot} onChange={(e) => setSlot(e.target.value)}>
          <option value="all">전체</option>
          {SLOTS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select></label>
        <label>나이 <select value={age} onChange={(e) => setAge(Number(e.target.value))}>
          {AGE_OPTS.map((a) => <option key={a} value={a}>{a ? `${a}세 이하` : '전체'}</option>)}
        </select></label>
        <label>계약 <select value={until} onChange={(e) => setUntil(Number(e.target.value))}>
          <option value={0}>전체</option>
          <option value={1}>{year}년까지</option>
          <option value={2}>{year + 1}년까지</option>
          <option value={3}>{year + 2}년 이후</option>
        </select></label>
        <label title={`우리 자리 등급이 낮은 셋: ${weakList.join(' · ')}`}><input type="checkbox" checked={weak} onChange={(e) => setWeak(e.target.checked)} /> 우리 약한 자리만 ({weakList.join(' · ')})</label>
      </div>
      <DataTable id="trade-cands" cols={cols} rows={rows} rowKey={(c) => String(c.p.idx)} full={full} searchText={(c) => c.p.name}
        rowClass={(c) => (c.block ? 'blocked' : desk.compare.includes(c.p.idx) ? 'in-cmp' : undefined)} label="트레이드 후보" empty="조건에 맞는 선수가 없습니다." />
      <div className="cmp-slots">
        <span className="small muted">비교 칸</span>
        {Array.from({ length: COMPARE_MAX }, (_, i) => desk.compare[i]).map((idx, i) => (idx === undefined
          ? <span key={i} className="cmp-slot empty">빈칸</span>
          : <span key={i} className="cmp-slot">
            <button type="button" className="link" onClick={() => openPlayer(idx)}>{session.world.players[idx].name}</button>
            <button type="button" className="link" aria-label={`${session.world.players[idx].name} 비교 칸에서 빼기`} onClick={() => removeFromCompare(session, idx)}>×</button>
          </span>))}
        <button type="button" disabled={!desk.compare.length} onClick={() => updateDesk(session, () => ({ step: 'compare' }))}>비교하기 ▶</button>
      </div>
      {note && <p className="muted small" role="status">{note}</p>}
      <p className="muted small">종합·잠재는 보이는 능력 기준입니다. 우승 도전 구단은 당장 쓸 선수를, 리빌딩 구단은 젊은 선수를 높게 칩니다.</p>
    </section>
  );
}

// ---- ② 비교 (최대 3명 + 우리 같은 자리 주전)

interface CmpRow { label: string; v: (p: SimPlayer) => { node: ReactNode; n?: number | null }; lower?: boolean; full?: boolean }

function Compare() {
  const { session, grades } = useGame();
  const desk = useDesk(session);
  const won = useWon();
  const lg = useLeague();
  const potOf = usePotentialOf();
  const { density } = useShell();
  const full = density === 'full';
  const narrow = useNarrow();
  const ps = desk.compare.map((i) => session.world.players[i]);
  if (!ps.length) {
    return <p className="muted">비교 칸이 비어 있습니다. ① 후보 보드나 선수 상세의 "비교에 넣기"로 셋까지 넣으세요.</p>;
  }
  const slot = slotOf(ps[0]);
  const starter = ourStarter(session, slot);
  const showStarter = starter && !ps.includes(starter) ? starter : null;
  const cols = narrow || !showStarter ? ps : [...ps, showStarter];
  const anyBat = cols.some((p) => !p.isPitcher);
  const anyPit = cols.some((p) => p.isPitcher);
  const bg = (p: SimPlayer) => grades.batters.get(p.id);
  const pg = (p: SimPlayer) => grades.pitchers.get(p.id);
  const g = (n: number | null | undefined) => ({ node: <Grade v={n} />, n: n ?? null });
  const none = { node: <span className="muted">—</span>, n: null };
  const s = session.season;
  const rows: CmpRow[] = ([
    { label: '종합', v: (p) => g(overall(session, p)) },
    { label: '잠재', v: (p) => { const lp = session.leaguePlayer(p.id); const v = lp ? potOf(lp, p.age) : null; return { node: <PotCell v={v} />, n: potentialSortValue(v) }; } },
    ...(anyBat ? [
      { label: '컨택', v: (p: SimPlayer) => (p.isPitcher ? none : g(bg(p)?.contact)) },
      { label: '파워', v: (p: SimPlayer) => (p.isPitcher ? none : g(bg(p)?.power)) },
      { label: '선구안', v: (p: SimPlayer) => (p.isPitcher ? none : g(bg(p)?.eye)) },
      { label: '주력', v: (p: SimPlayer) => (p.isPitcher ? none : g(bg(p)?.speed)), full: true },
    ] : []),
    ...(anyPit ? [
      { label: '구위', v: (p: SimPlayer) => (p.isPitcher ? g(pg(p)?.stuff) : none) },
      { label: '제구', v: (p: SimPlayer) => (p.isPitcher ? g(pg(p)?.control) : none) },
      { label: '장타 억제', v: (p: SimPlayer) => (p.isPitcher ? g(pg(p)?.hrSuppression) : none) },
      { label: '선발 체력', v: (p: SimPlayer) => (p.isPitcher ? g(pg(p)?.stamina) : none), full: true },
      { label: '구원 체력', v: (p: SimPlayer) => (p.isPitcher ? g(pg(p)?.reliefStamina) : none), full: true },
    ] : []),
    { label: `${session.world.year} 기록`, v: (p) => {
      if (p.isPitcher) {
        const q = s.pit[p.idx];
        if (!q.outs) return none;
        return { node: <>{fixed2(era(q))} <span className="muted small">평균자책</span>{q.outs >= 30 && <> <VsLeague rank={lg.pit(era(q), era, false)} full={full} /></>}</>, n: anyBat ? null : -era(q) };
      }
      const b = s.bat[p.idx];
      if (!b.pa) return none;
      return { node: <>{rate3(ops(b))} <span className="muted small">OPS</span>{b.pa >= 30 && <> <VsLeague rank={lg.bat(ops(b), ops)} full={full} /></>}</>, n: anyPit ? null : ops(b) };
    } },
    { label: '세부 기록', full: true, v: (p) => {
      if (p.isPitcher) { const q = s.pit[p.idx]; return q.outs ? { node: <span className="small">{ipText(q.outs)}이닝 · WHIP {fixed2(whip(q))} · {q.so}삼진</span> } : none; }
      const b = s.bat[p.idx];
      return b.pa ? { node: <span className="small">{b.pa}타석 · {rate3(avg(b))} / {rate3(obp(b))} · {b.hr}홈런</span> } : none;
    } },
    ...(anyBat ? [{ label: '수비 (그 자리)', v: (p: SimPlayer) => {
      if (p.isPitcher) return none;
      const pos = (p === showStarter ? slot : p.pos) as FieldPos;
      if (!FIELD_POS.includes(pos)) return { node: <span className="muted small">{p.pos ?? 'DH'}</span>, n: null };
      const d = defenseGrade(defenseAt(p, pos));
      return { node: <>{pos} <Grade v={d} /></>, n: d };
    } }] : []),
    { label: '계약', v: (p) => { const c = session.leaguePlayer(p.id)?.contract; return c ? { node: <span className="small">{c.kind === 'foreign' ? dollarText(c.salary) : won(c.salary)} · {c.until}년까지</span> } : none; } },
    { label: '상태', v: (p) => {
      const back = session.returnDay(p);
      const reg = p.teamIdx === session.teamIdx ? (session.registered().some((x) => x.idx === p.idx) ? '1군' : '2군') : null;
      return { node: <span className="small">{[reg, back !== null ? `결장 · ${back >= s.schedule.length ? '시즌 아웃' : `${shortDate(session.world.year, back)} 복귀`}` : '출전 가능'].filter(Boolean).join(' · ')}</span> };
    } },
  ] as CmpRow[]).filter((r) => full || !r.full);

  const head = (p: SimPlayer) => (
    <th key={p.idx} className="l">
      <PlayerLink p={p} />
      <div className="muted small">{p.teamIdx >= 0 ? session.world.teams[p.teamIdx].name : '자유계약'} · {p.isPitcher ? slotOf(p) : p.pos ?? '-'} · {p.age ?? '-'}세</div>
      {p === showStarter && <div className="tag">우리 {slot} 주전</div>}
    </th>
  );

  return (
    <section className="stack tight">
      {narrow && showStarter && (
        <p className="small cmp-starter">우리 {slot} 주전: <PlayerLink p={showStarter} /> 종합 <Grade v={overall(session, showStarter)} /></p>
      )}
      <div className="scroll cmp-scroll">
        <table className="cmp">
          <thead><tr><th className="l" />{cols.map(head)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const vals = cols.map((p) => r.v(p));
              const nums = vals.map((x) => x.n).filter((n): n is number => n !== null && n !== undefined && Number.isFinite(n));
              const best = nums.length >= 2 && new Set(nums).size > 1 ? Math.max(...nums) : null;
              return (
                <tr key={r.label}>
                  <th className="l small">{r.label}</th>
                  {vals.map((x, i) => <td key={cols[i].idx} className={`l${best !== null && x.n === best ? ' best' : ''}`}>{x.node}</td>)}
                </tr>
              );
            })}
            <tr>
              <th />
              {cols.map((p) => {
                const block = p.teamIdx === session.teamIdx ? null : tradeBlockReason(session, p);
                return (
                  <td key={p.idx} className="l">
                    {p !== showStarter && p.teamIdx !== session.teamIdx && (
                      <button type="button" className="small-btn" disabled={!!block} title={block ?? undefined}
                        onClick={() => { const e = addToDraft(session, p); updateDesk(session, () => (e ? { note: e } : { step: 'offer' })); }}>제안에 넣기</button>
                    )}
                    {p !== showStarter && <button type="button" className="ghost small-btn" onClick={() => removeFromCompare(session, p.idx)}>빼기 ×</button>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      {desk.note && <p className="note" role="status">{desk.note}</p>}
      <p className="muted small">굵은 글자가 그 줄에서 가장 좋은 값입니다. {showStarter ? `오른쪽 끝은 우리 ${slot} 주전 (첫 칸 선수의 자리 기준)입니다.` : ''} {full ? '' : '상세 모드에서 능력 전부와 세부 기록을 봅니다.'}</p>
    </section>
  );
}

// ---- ③ 제안 구성

function Offer() {
  const { session, version } = useGame();
  const desk = useDesk(session);
  const px = usePriceIndex();
  const won = useWon();
  const narrow = useNarrow();
  const open = session.tradeOpen;
  const draft = pruneDraft(session, desk.draft);
  const other = draft.team;
  const others = session.world.teams.filter((t) => t.idx !== session.teamIdx);
  const [busy, setBusy] = useState(false);
  const [cashText, setCashText] = useState(() => (draft.cash ? String(Math.round((draft.cash * px) / 1000) / 10) : '0'));
  const max = ruleOf(session.league, 'maxPerSide');
  const info = useMemo(
    () => new Map(others.map((t) => {
      const sit = session.situation(t.idx);
      const early = session.season.teams[t.idx].g < 20;
      return [t.idx, { tendency: session.tendency(t.idx), rank: `${early ? '전력 ' : ''}${sit.rank}위` }];
    })),
    [session, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { give, get } = draftParts(session, draft);

  const toggle = (side: 'give' | 'get', p: SimPlayer) => {
    const list = draft[side];
    if (list.includes(p.idx)) { editDraft(session, (d) => ({ ...d, [side]: d[side].filter((i) => i !== p.idx) })); return; }
    if (list.length >= max) { updateDesk(session, () => ({ note: `한쪽에서 ${max}명까지 고를 수 있습니다.` })); return; }
    editDraft(session, (d) => ({ ...d, [side]: [...d[side], p.idx] }));
  };
  const pickTeam = (t: number) => editDraft(session, (d) => ({ ...d, team: t, get: [], rp: [] }));
  const setCash = (text: string) => {
    setCashText(text);
    const man = Math.round((Number(text) || 0) * 10000 / px);
    editDraft(session, (d) => ({ ...d, cash: man }));
  };

  const ask = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    const pkg = session.askPackage(other, get);
    setBusy(false);
    const nm = session.world.teams[other].name;
    if (!pkg) { updateDesk(session, () => ({ note: `${nm}: "지금 우리 선수단과 맞바꿀 만한 조합이 없습니다."` })); return; }
    editDraft(session, (d) => ({ ...d, give: pkg.map((p) => p.idx) }), `${nm}: "${pkg.map((p) => p.name).join(', ')}을(를) 주시면 생각해 보겠습니다." (내줄 칸에 넣었습니다. 아직 보내지 않았습니다)`);
  };

  const send = () => {
    const { ev, agreement } = sendDraft(session, draft);
    updateDesk(session, (d) => {
      const n = sentToday(session, d).filter((r) => r.team === other).length + 1;
      const row = { n, team: other, year: session.year, day: session.currentDay, key: draftKey(draft), verdict: ev.verdict, message: ev.message, text: draftText(session, draft, won) };
      return { draft, sent: [...d.sent, row], agreed: agreement, step: 'talk', note: null, done: null };
    });
  };

  const side = (title: ReactNode, ps: SimPlayer[], sideKey: 'give' | 'get', picks: string[]) => (
    <div>
      <h3>{title}</h3>
      {ps.length ? (
        <ul className="plain deal-list">
          {ps.map((p) => <li key={p.idx}><DealLine p={p} /> <button type="button" className="link" aria-label={`${p.name} 빼기`} onClick={() => toggle(sideKey, p)}>×</button></li>)}
        </ul>
      ) : <p className="muted small">아래 표에서 고르세요.</p>}
      {picks.length > 0 && <p className="small">지명권: {picks.map((id) => session.pickLabel(parsePick(id))).join(', ')}</p>}
    </div>
  );

  return (
    <div className="stack">
      <div className="team-grid compact" role="radiogroup" aria-label="상대 구단">
        {others.map((t) => (
          <button key={t.idx} type="button" role="radio" aria-checked={other === t.idx}
            className={`team-card${other === t.idx ? ' on' : ''}`} style={{ ['--c' as string]: teamColor(t.franchise, t.name) }} onClick={() => pickTeam(t.idx)}>
            <TeamName idx={t.idx} />
            <span className="muted small">{info.get(t.idx)!.rank} · {TENDENCY_LABEL[info.get(t.idx)!.tendency]}</span>
            <span className="muted small" title={GM_STYLE_NOTE[gmStyle(session.league, t.idx)]}>단장: {GM_STYLE_LABEL[gmStyle(session.league, t.idx)]}</span>
          </button>
        ))}
      </div>

      <section className="trade-bar panel">
        <div className="trade-sides">
          {side(<>우리가 내줄 것 <span className="muted small">{session.team.name} · {give.length}/{max}명</span></>, give, 'give', draft.gp)}
          <div aria-hidden className="trade-arrow">⇄</div>
          {side(<>받을 것 <span className="muted small">{session.world.teams[other].name} ({TENDENCY_LABEL[info.get(other)!.tendency]}) · {get.length}/{max}명</span></>, get, 'get', draft.rp)}
        </div>
        <p className="small">
          <label>
            현금{' '}
            <input type="number" step={0.5} value={cashText} onChange={(e) => setCash(e.target.value)} style={{ width: '6em' }} aria-label="트레이드 현금 (억 원)" />
            억 원
          </label>{' '}
          <span className="muted">
            {draft.cash > 0 ? `우리가 ${won(draft.cash)}을 줍니다` : draft.cash < 0 ? `상대에게서 ${won(-draft.cash)}을 받습니다` : '현금 없음 (받으려면 −)'} · 지금 자금 {won(session.cashNow())}.
            AI는 현금을 선수 가치보다 조금 박하게 쳐줍니다.
          </span>
        </p>
        {!isEmptyDraft(draft) && (
          <details className="impact" open={!narrow}>
            <summary className="small">바뀌는 것</summary>
            <Impact draft={draft} />
          </details>
        )}
        {desk.note && <p className="note" role="status">{desk.note}</p>}
        <div className="actions sticky-actions">
          <button type="button" className="ghost" onClick={() => void ask()} disabled={!open || busy || get.length === 0} title="받을 선수를 고른 뒤 상대가 원하는 조건을 묻습니다 (바로 보내지 않음)">
            {busy ? '상대가 검토 중' : '상대가 원하는 조건 묻기'}
          </button>
          <button type="button" onClick={send} disabled={!open || isEmptyDraft(draft)}>④ 협상으로 보내기 ▶</button>
          <button type="button" className="ghost" onClick={() => { setCashText('0'); editDraft(session, (d) => ({ ...d, give: [], get: [], cash: 0, gp: [], rp: [] })); }}>비우기</button>
        </div>
      </section>

      {session.pickTradeOpen && (
        <section className="panel">
          <h2>신인 지명권</h2>
          <p className="muted small">
            다음 {PICK_YEARS_AHEAD}번의 드래프트, {PICK_MAX_ROUND}라운드까지. 한 트레이드에 {ruleOf(session.league, 'maxPicksPerTrade')}장까지 (2019년 8월 KBO 규약).
            순번은 그 해 원래 구단의 순위로 정해집니다. 넘겨받은 지명권으로 뽑은 선수는 입단 첫해 트레이드할 수 없습니다.
          </p>
          <div className="two">
            <PickBoxes title={`${session.team.name} 지명권`} team={session.teamIdx} selected={draft.gp} other={draft.rp} disabled={!open}
              onChange={(gp) => editDraft(session, (d) => ({ ...d, gp }))} />
            <PickBoxes title={`${session.world.teams[other].name} 지명권`} team={other} selected={draft.rp} other={draft.gp} disabled={!open}
              onChange={(rp) => editDraft(session, (d) => ({ ...d, rp }))} />
          </div>
        </section>
      )}

      <div className="two">
        <PickList title={`${session.team.name} 선수`} org={session.team.org} selected={draft.give} onToggle={(p) => toggle('give', p)} disabled={!open} showEntry />
        <PickList title={`${session.world.teams[other].name} 선수`} org={session.world.teams[other].org} selected={draft.get} onToggle={(p) => toggle('get', p)} disabled={!open} />
      </div>
      <TradeTalkBox draft={draft} />
    </div>
  );
}

/** 판타지 협상 (설득): 제안판 그대로 */
function TradeTalkBox({ draft }: { draft: TradeDraft }) {
  const { session } = useGame();
  if (!session.tradeOpen) return null;
  const x = draftParts(session, draft);
  return <TradeTalk team={draft.team} give={x.give} get={x.get} cash={draft.cash} picks={x.picks} pickLabel={(k) => session.pickLabel(k)} />;
}

/** 선수 한 줄: 이름 · 자리 · 나이 · 종합/잠재 · 연봉·계약 */
function DealLine({ p }: { p: SimPlayer }) {
  const { session } = useGame();
  const won = useWon();
  const potOf = usePotentialOf();
  const lp = session.leaguePlayer(p.id);
  const c = lp?.contract;
  return (
    <>
      <PlayerLink p={p} />{' '}
      <span className="muted small">{p.isPitcher ? slotOf(p) : p.pos ?? '-'} · {p.age ?? '-'}세</span>{' '}
      <Grade v={overall(session, p)} />/<PotCell v={lp ? potOf(lp, p.age) : null} />{' '}
      {c && <span className="muted small">{c.kind === 'foreign' ? dollarText(c.salary) : won(c.salary)} · {c.until}년까지</span>}
    </>
  );
}

/** 바뀌는 것: 전 → 후 (기획안 2.4.4, 메모리 "전 → 후") */
function Impact({ draft }: { draft: TradeDraft }) {
  const { session, version } = useGame();
  const won = useWon();
  const { density } = useShell();
  const full = density === 'full';
  const im = useMemo(() => tradeImpact(session, draft), [session, version, draftKey(draft)]); // eslint-disable-line react-hooks/exhaustive-deps
  const ba = (a: number | null, b: number | null, fmt: (n: number) => ReactNode = (n) => n) => (
    <span className={a !== b ? 'chg' : undefined}>{a === null ? '—' : fmt(a)} → {b === null ? '—' : fmt(b)}</span>
  );
  const other = session.world.teams[draft.team]?.name ?? '상대';
  return (
    <div className="impact-body small">
      <p>
        1군 {ba(im.active[0], im.active[1])}<span className="muted">/{im.activeLimit}</span>
        {' · '}정식 선수 {ba(im.org[0], im.org[1])}<span className="muted">/{im.orgLimit}</span>
        {im.cap && <>{' · '}캡 대상 연봉 {ba(im.cap.before, im.cap.after, won)} <span className="muted">(상한 {won(im.cap.limit)}, 남는 몫 {won(im.cap.limit - im.cap.after)})</span></>}
        {im.cash && <>{' · '}자금 {ba(im.cash[0], im.cash[1], won)}</>}
      </p>
      {im.depth.length > 0 && (
        <p>우리 자리 등급 {im.depth.map((r, i) => <span key={r.slot}>{i ? ' · ' : ''}{r.slot} {ba(r.before, r.after)}</span>)}
          <span className="muted"> (야수는 그 자리 최고 종합, SP·RP는 상위 5명 평균)</span></p>
      )}
      {full && (
        <p className="muted">
          우리 야수 {ba(im.mine.hit[0], im.mine.hit[1])} · 투수 {ba(im.mine.pit[0], im.mine.pit[1])} · 포수 {ba(im.mine.c[0], im.mine.c[1])}
          {' / '}{other} 야수 {ba(im.other.hit[0], im.other.hit[1])} · 투수 {ba(im.other.pit[0], im.other.pit[1])} · 포수 {ba(im.other.c[0], im.other.c[1])}
        </p>
      )}
      {im.warn.map((w) => <p key={w} className="warn-line">⚠ {w}</p>)}
      {im.cap && <p className="muted">캡 대상은 외국인·신인 계약을 뺀 지금 소속 연봉 상위 {ruleOf(session.league, 'capTopN')}명 합입니다 (캡 판정은 개막 때).</p>}
    </div>
  );
}

// ---- ④ 협상

function Talk() {
  const { session } = useGame();
  const desk = useDesk(session);
  const [busy, setBusy] = useState(false);
  const team = desk.draft.team;
  const name = session.world.teams[team].name;
  const rows = sentToday(session, desk).filter((r) => r.team === team);
  const last = rows.at(-1);
  const agreed = desk.agreed && desk.agreed.key === draftKey(desk.draft) ? desk.agreed : null;
  const askAgain = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    const get = draftParts(session, desk.draft).get;
    const pkg = get.length ? session.askPackage(team, get) : null;
    setBusy(false);
    if (!pkg) { updateDesk(session, () => ({ note: `${name}: "지금 우리 선수단과 맞바꿀 만한 조합이 없습니다."` })); return; }
    editDraft(session, (d) => ({ ...d, give: pkg.map((p) => p.idx) }), `${name}: "${pkg.map((p) => p.name).join(', ')}을(를) 주시면 생각해 보겠습니다." (내줄 칸에 넣었습니다. 아직 보내지 않았습니다)`);
    updateDesk(session, () => ({ step: 'offer' }));
  };
  if (!last) return <p className="muted">{name}에 오늘 보낸 안이 없습니다. ③ 제안에서 보내세요.</p>;
  return (
    <section className="panel stack tight talk">
      <h2><TeamName idx={team} /> 단장 <span className="muted small">{TENDENCY_LABEL[session.tendency(team)]}</span></h2>
      <p className="small"><b>보낸 안 #{last.n}</b>: {last.text}</p>
      <p className="talk-reply">답: "{last.message}"</p>
      {last.verdict !== 'accept' && <p className="small">거절 이유: <b>{REASON_TEXT[last.verdict]}</b></p>}
      {last.verdict === 'accept' && agreed && <p className="note"><span className="tag agree-tag">합의</span> 상대가 받아들였습니다. 아직 성사되지 않았습니다: ⑤ 최종 검토에서 확정해야 합니다.</p>}
      {last.verdict === 'accept' && !agreed && <p className="muted small">합의 뒤 제안판을 고쳐 이 합의는 풀렸습니다. 고친 안을 다시 보내세요.</p>}
      {desk.note && <p className="note" role="status">{desk.note}</p>}
      <div className="actions">
        {agreed && <button type="button" onClick={() => updateDesk(session, () => ({ step: 'review', note: null }))}>⑤ 최종 검토로 ▶</button>}
        {last.verdict !== 'accept' && <button type="button" className="ghost" disabled={busy || !session.tradeOpen} onClick={() => void askAgain()}>{busy ? '상대가 검토 중' : '상대 요구안 보기'}</button>}
        <button type="button" className="ghost" onClick={() => updateDesk(session, () => ({ step: 'offer', note: null }))}>③으로 돌아가 고치기</button>
      </div>
      {rows.length > 1 && (
        <details open>
          <summary className="small">이 상대에게 오늘 보낸 안 {rows.length}개</summary>
          <ul className="plain small sent-list">
            {rows.map((r) => <li key={r.n}><b>#{r.n}</b> {VERDICT_SHORT[r.verdict]} <span className="muted">— {r.text}</span></li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

// ---- ⑤ 최종 검토

function Review() {
  const { session, changed, go, version } = useGame();
  const desk = useDesk(session);
  const won = useWon();
  const a = desk.agreed;
  const status = useMemo(() => (a ? agreementStatus(session, a, desk.draft) : null), [session, version, a, desk.draft]); // eslint-disable-line react-hooks/exhaustive-deps
  if (desk.done) {
    return (
      <section className="panel stack tight">
        <p className="note" role="status">{desk.done}</p>
        <div className="actions">
          <button type="button" onClick={() => go('lineup')}>기용 보드에서 자리 정하기</button>
          <button type="button" className="ghost" onClick={() => updateDesk(session, () => ({ step: 'cands', done: null }))}>새 트레이드</button>
        </div>
      </section>
    );
  }
  if (!a) return <p className="muted">합의한 안이 없습니다. ④ 협상에서 상대가 받아들이면 여기서 확정합니다.</p>;
  const { give, get, picks } = draftParts(session, a.draft);
  const name = session.world.teams[a.draft.team].name;
  const confirm = () => {
    const ev = confirmAgreement(session, a);
    if (ev.verdict === 'accept') {
      const text = draftText(session, a.draft, won);
      changed();
      updateDesk(session, (d) => ({
        agreed: null, draft: { ...a.draft, give: [], get: [], cash: 0, gp: [], rp: [] },
        compare: d.compare.filter((i) => session.world.players[i].teamIdx !== session.teamIdx || !a.draft.get.includes(i)),
        done: `${name}와 트레이드가 성사됐습니다 (${text}). 받은 선수는 2군에 있습니다.`,
      }));
    } else {
      updateDesk(session, () => ({ agreed: null, step: 'talk', note: `상대가 생각을 바꿨습니다: "${ev.message}" (${REASON_TEXT[ev.verdict as Exclude<typeof ev.verdict, 'accept'>]})` }));
    }
  };
  const list = (ps: SimPlayer[], ks: typeof picks.give, cash: number) => (
    <ul className="plain deal-list">
      {ps.map((p) => <li key={p.idx}><DealLine p={p} /></li>)}
      {ks.map((k) => <li key={pickId(k)}>지명권 <b>{session.pickLabel(k)}</b></li>)}
      {cash > 0 && <li>현금 <b>{won(cash)}</b></li>}
      {!ps.length && !ks.length && cash <= 0 && <li className="muted">없음</li>}
    </ul>
  );
  return (
    <section className="panel stack tight">
      <h2><TeamName idx={a.draft.team} />와 합의한 안</h2>
      <div className="trade-sides">
        <div><h3>내줌</h3>{list(give, picks.give, a.draft.cash)}</div>
        <div aria-hidden className="trade-arrow">⇄</div>
        <div><h3>받음</h3>{list(get, picks.get, -a.draft.cash)}</div>
      </div>
      <Impact draft={a.draft} />
      {status === 'later' && <p className="muted small">합의 뒤 날짜가 바뀌어 다시 확인했습니다: 상대는 그대로 받아들입니다.</p>}
      {status === 'changed' && <p className="note error-box">상대가 생각을 바꿨습니다 (그사이 상황이 달라졌습니다). ④ 협상에서 다시 보내세요.</p>}
      {status === 'edited' && <p className="note error-box">합의 뒤 제안판을 고쳤습니다. 고친 안은 ④ 협상으로 다시 보내야 합니다.</p>}
      <p className="small"><b>받은 선수는 2군에 등록됩니다. 되돌릴 수 없습니다.</b></p>
      <div className="actions">
        <button type="button" className="ghost" onClick={() => updateDesk(session, () => ({ agreed: null, step: 'offer' }))}>취소</button>
        {status === 'changed' || status === 'edited'
          ? <button type="button" onClick={() => updateDesk(session, () => ({ agreed: null, step: status === 'edited' ? 'offer' : 'talk' }))}>{status === 'edited' ? '③ 제안으로' : '④ 협상으로'}</button>
          : <ConfirmButton label="트레이드 확정" confirmLabel="한 번 더 누르면 확정 (되돌릴 수 없음)" className="" onConfirm={confirm} disabled={!session.tradeOpen} />}
      </div>
    </section>
  );
}

// ---- 리그 트레이드·트레이드 기록

function History() {
  const { session } = useGame();
  const year = session.world.year;
  const players = session.world.players;
  const league = (session.league.aiTrades ?? []).filter((t) => t.year === year);
  const nm = (id: string) => players.find((p) => p.id === id)?.name ?? id;
  return (
    <>
      {league.length > 0 && (
        <section>
          <h2>리그 트레이드 <span className="muted small">AI 구단끼리 {league.length}건</span></h2>
          <ul className="plain small">
            {[...league].reverse().map((t, k) => (
              <li key={k}>
                <span className="muted">{shortDate(year, t.day)}</span> <TeamName idx={t.buyer} /> ← {t.got.map(nm).join(', ')} · <TeamName idx={t.seller} /> ← {t.gave.map(nm).join(', ')}
                {t.picks?.length ? `, ${t.picks.map((id) => session.pickLabel(parsePick(id))).join(', ')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2>트레이드 기록</h2>
        {session.trades.length === 0 ? <p className="muted">아직 성사된 트레이드가 없습니다.</p> : (
          <div className="scroll">
            <table>
              <thead><tr><th className="l">날짜</th><th className="l">상대</th><th className="l">내준 것</th><th className="l">받은 것</th></tr></thead>
              <tbody>
                {[...session.trades].reverse().map((t, k) => (
                  <tr key={k}>
                    <td className="l">{shortDate(year, t.day)}</td><td className="l"><TeamName idx={t.team} /></td>
                    <td className="l">{[...t.give.map((i) => players[i].name), ...(t.pg ?? []).map((id) => session.pickLabel(parsePick(id)))].join(', ') || '-'}</td>
                    <td className="l">{[...t.get.map((i) => players[i].name), ...(t.pr ?? []).map((id) => session.pickLabel(parsePick(id)))].join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * 선수 내놓기: 우리 선수를 1~3명 고르면 구단마다 받아들일 수 있는 조건 가운데 우리에게 가장 좋은 1~2명 조합을 제안한다 (session.shopOffers).
 * 제안을 고르면 다시 평가해 합의로 만들고 ⑤ 최종 검토로 간다 (확정해야 성사)
 */
function ShopPanel({ open }: { open: boolean }) {
  const { session } = useGame();
  const won = useWon();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [offers, setOffers] = useState<ShopOffer[] | null>(null);
  // 얹을 현금 (억 원, 그 해 물가로 보이는 금액). 2026-10-12 사용자: 선수 내놓기에 현금을 더할 수 있게
  const [cashText, setCashText] = useState('0');
  const px = usePriceIndex();
  const cashMan = Math.max(0, Math.round((Number(cashText) || 0) * 10000 / px));
  // 받고 싶은 것: 상관없음 / 선수 / 지명권
  const [want, setWant] = useState<ShopWant>('any');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const ctx = session.values;
  const mine = session.team.org.filter((p) => !p.foreign && !session.leaguePlayer(p.id)?.dev)
    .sort((a, b) => currentRuns(b, ctx) - currentRuns(a, ctx) || a.idx - b.idx);
  const pick = (p: SimPlayer) => {
    const next = new Set(sel);
    if (next.has(p.idx)) next.delete(p.idx);
    else if (next.size < ruleOf(session.league, 'maxPerSide')) next.add(p.idx);
    else { setMsg({ text: `한 번에 ${ruleOf(session.league, 'maxPerSide')}명까지 내놓을 수 있습니다.` }); return; }
    setSel(next);
    setOffers(null);
    setMsg(null);
  };
  const ask = async () => {
    setBusy(true);
    setMsg({ text: '다른 구단 단장들에게 알리는 중입니다' });
    await new Promise((r) => setTimeout(r, 30));
    const list = session.shopOffers([...sel].map((i) => session.world.players[i]), cashMan, want);
    setBusy(false);
    setOffers(list);
    setMsg(list.length ? null : { text: '지금은 이 조건에 관심을 보이는 구단이 없습니다.' });
  };
  const take = (o: ShopOffer) => {
    const draft: TradeDraft = { team: o.team, give: [...sel], get: o.get.map((p) => p.idx), cash: cashMan, gp: [], rp: o.picks.map(pickId) };
    const { ev, agreement } = sendDraft(session, draft);
    if (agreement) {
      setSel(new Set());
      setOffers(null);
      setCashText('0');
      updateDesk(session, () => ({ mode: 'deal', step: 'review', draft, agreed: agreement, done: null, note: null }));
    } else {
      setMsg({ text: `${session.world.teams[o.team].name}: "${ev.message}" (그사이 조건이 바뀌었습니다)` });
    }
  };
  const grade = (p: SimPlayer) => <Grade v={runsGrade(currentRuns(p, ctx), session.year)} />;
  const salary = (p: SimPlayer) => { const lp = session.leaguePlayer(p.id); return lp ? won(lp.contract.salary) : '-'; };
  const line = (p: SimPlayer) => {
    const b = session.season.bat[p.idx];
    const x = session.season.pit[p.idx];
    return p.isPitcher ? (x.bf ? `${ipText(x.outs)}이닝 ${fixed2(era(x))}` : '-') : (b.pa ? `${rate3(avg(b))} OPS ${rate3(ops(b))}` : '-');
  };

  return (
    <div className="shop">
      <section className="panel">
        <div className="row-between wrap">
          <h2>내놓을 선수 <span className="muted small">{sel.size}/{ruleOf(session.league, 'maxPerSide')}명 · 외국인·육성선수 제외</span></h2>
          <span className="inline">
            <label className="inline small">현금 얹기
              <input type="number" min={0} step={0.5} value={cashText} onChange={(e) => { setCashText(e.target.value); setOffers(null); }} style={{ width: 80 }} aria-label="얹을 현금(억 원)" /> 억 원
            </label>
            <button type="button" onClick={() => void ask()} disabled={!open || busy || (sel.size === 0 && cashMan <= 0)}>{busy ? '알리는 중' : '다른 구단에 알리기'}</button>
          </span>
        </div>
        <div className="row-between wrap">
          <div className="seg" role="tablist" aria-label="받고 싶은 것">
            {([['any', '상관없음'], ['players', '선수'], ['picks', '지명권']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={want === k} className={want === k ? 'on' : ''} onClick={() => { setWant(k); setOffers(null); }} disabled={k === 'picks' && !session.pickTradeOpen}>받기: {label}</button>
            ))}
          </div>
          <span className="muted small">선수 없이 현금만 걸면 현금으로 사 옵니다. 지금 자금 {won(session.cashNow())}.</span>
        </div>
        <div className="scroll flat shop-list">
          <table>
            <thead><tr><th /><th className="l">이름</th><th>자리</th><th>나이</th><th>현재</th><th className="l">올해</th><th>연봉</th></tr></thead>
            <tbody>
              {mine.map((p) => (
                <tr key={p.idx} className={`pick${sel.has(p.idx) ? ' sel' : ''}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) pick(p); }}>
                  <td><input type="checkbox" checked={sel.has(p.idx)} onChange={() => pick(p)} aria-label={`${p.name} 내놓기`} /></td>
                  <td className="l"><PlayerLink p={p} /></td><td>{p.isPitcher ? (isStarterSkill(p.pit) ? 'SP' : 'RP') : <Pos pos={p.pos} />}</td>
                  <td>{p.age ?? '-'}</td><td>{grade(p)}</td><td className="l small">{line(p)}</td><td>{salary(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack tight">
        {msg && <p className={msg.ok ? 'note' : 'muted'} role="status">{msg.text}</p>}
        {offers?.map((o) => (
          <div key={o.team} className="card offer-card">
            <div className="row-between wrap">
              <h2><TeamName idx={o.team} /> <span className="muted small">{TENDENCY_LABEL[session.tendency(o.team)]}</span></h2>
              <button type="button" onClick={() => take(o)} disabled={!open}>이 제안으로 검토 ▶</button>
            </div>
            <ul className="plain">
              {o.get.map((p) => (
                <li key={p.idx}><PlayerLink p={p} /> <span className="muted small">{p.isPitcher ? slotOf(p) : p.pos ?? '-'} · {p.age ?? '-'}세 · 연봉 {salary(p)}</span> {grade(p)} <span className="small muted">{line(p)}</span></li>
              ))}
              {o.picks.map((k) => <li key={pickId(k)}>지명권 <strong>{session.pickLabel(k)}</strong></li>)}
            </ul>
          </div>
        ))}
        {offers === null && !msg && <p className="muted small">선수를 고르고 "다른 구단에 알리기"를 누르면, 구단마다 내줄 수 있는 선수를 제안합니다. 우리에게 가치가 큰 제안부터 보입니다. 고른 제안은 ⑤ 최종 검토에서 확정해야 성사됩니다.</p>}
      </section>
    </div>
  );
}

function PickList({ title, org, selected, onToggle, disabled, showEntry = false }: {
  title: string; org: SimPlayer[]; selected: number[]; onToggle: (p: SimPlayer) => void; disabled: boolean; showEntry?: boolean;
}) {
  const { session, grades } = useGame();
  const [kind, setKind] = useState<Kind>('all');
  const registered = new Set(session.registered().map((p) => p.idx));
  const rows = org
    .filter((p) => kind === 'all' || (kind === 'pit') === p.isPitcher)
    .sort((a, b) => Number(a.isPitcher) - Number(b.isPitcher) || (a.isPitcher ? a.value - b.value : b.value - a.value) || a.idx - b.idx);
  return (
    <section>
      <div className="row-between">
        <h2>{title} <span className="muted small">{rows.length}명</span></h2>
        <div className="seg small" role="tablist">
          {(['all', 'hit', 'pit'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'all' ? '전체' : k === 'hit' ? '야수' : '투수'}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll pick">
        <table>
          <thead><tr><th /><th className="l">이름</th><th>자리</th><th>나이</th><th title="야수: 컨택·파워·선구안·주력 / 투수: 구위·제구·장타 억제·체력">능력</th><th>기록</th>{showEntry && <th>군</th>}</tr></thead>
          <tbody>
            {rows.map((p) => {
              const on = selected.includes(p.idx);
              let stat: string;
              let gs: (number | null | undefined)[];
              if (p.isPitcher) {
                const s = session.season.pit[p.idx];
                stat = s.outs ? `${ipText(s.outs)}이닝 ${fixed2(era(s))}` : '-';
                const g = grades.pitchers.get(p.id);
                gs = [g?.stuff, g?.control, g?.hrSuppression, g?.stamina];
              } else {
                const b = session.season.bat[p.idx];
                stat = b.pa ? `${rate3(avg(b))} ${b.hr}홈런 OPS ${rate3(ops(b))}` : '-';
                const g = grades.batters.get(p.id);
                gs = [g?.contact, g?.power, g?.eye, g?.speed];
              }
              return (
                <tr key={p.idx} className={on ? 'me' : ''}>
                  <td><input type="checkbox" checked={on} onChange={() => onToggle(p)} disabled={disabled || p.foreign} title={p.foreign ? '외국인 선수는 트레이드할 수 없습니다' : undefined} aria-label={`${p.name} 선택`} /></td>
                  <td className="l"><PlayerLink p={p} /></td>
                  <td>{p.isPitcher ? (isStarterSkill(p.pit) ? 'SP' : 'RP') : <Pos pos={p.pos} />}</td>
                  <td>{p.age ?? '-'}</td>
                  <td className="grades-inline">{gs.map((v, i) => <Grade key={i} v={v} />)}</td>
                  <td className="small">{stat}</td>
                  {showEntry && <td className="small">{registered.has(p.idx) ? '1군' : '2군'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 그 구단이 가진 지명권 고르기 (양쪽 합 maxPicksPerTrade장까지) */
function PickBoxes({ title, team, selected, other, onChange, disabled }: {
  title: string; team: number; selected: string[]; other: string[]; onChange: (next: string[]) => void; disabled: boolean;
}) {
  const { session } = useGame();
  const picks = session.ownedPicks(team);
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (selected.length + other.length < ruleOf(session.league, 'maxPicksPerTrade')) onChange([...selected, id]);
  };
  return (
    <div>
      <h3>{title} <span className="muted small">{picks.length}장</span></h3>
      <ul className="plain picks">
        {picks.map((p) => {
          const id = pickId(p);
          return (
            <li key={id}>
              <label className="small">
                <input type="checkbox" checked={selected.includes(id)} disabled={disabled} onChange={() => toggle(id)} /> {session.pickLabel(p)}
                {p.from !== team && <span className="tag">받은 지명권</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
