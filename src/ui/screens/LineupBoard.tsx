// 전력 > 기용 보드 (2026-10-22 UI 대개편 2차, 지시서 3장).
// 야수는 자리 칸(C 1B 2B 3B SS LF CF RF DH)과 주전·대기, 투수는 SP·CP·RP 역할 칸. 칸을 누르면 후보가
// 출전 가능 상태·지금 수비 등급·최근 기록과 함께 열리고, 고른 변경은 묶음으로 모아 전후를 검토한 뒤 한 번에 적용한다.
// 엔트리 이동(1군·2군)도 같은 묶음에 들어간다. 규칙 검사는 세션(checkBoard·applyBoard)이 하고 조작 기록은 기존 'entry'·'plan' 그대로다.
// 추천은 화면에 보이는 능력 등급·상태만으로 고르고, 표시만 할 뿐 자동으로 적용하지 않는다.
import { ConfirmButton } from '../ConfirmButton';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { defenseAt, defenseGrade, LINEUP_SLOTS, MIN_PLAN_ROTATION, type DepthPlan, type SimPlayer, type Slot } from '../../engine';
import { shortDate } from '../../game/calendar';
import { PITCHER_ROLE_LABEL, type EntryCheck, type GameSession, type PitcherRole } from '../../game/session';
import { ForeignMark, Grade, POS_KO, posName, useGame } from '../context';
import { recentLines } from '../recent';
import { lastOutings, outingText, type Outing } from '../../game/boxscore';
import { futuresText } from './Roster';
import { CondTag, CONDITION_HELP, GuessGrade, useCondition, useSeen } from '../parts';
import { guessMid } from '../../league/scout';

type Tab = 'hit' | 'pit' | 'entry';
type PenRole = 'SU' | 'LR' | 'RP' | 'MOP';
type Target =
  | { kind: 'slot'; slot: Slot }
  /** 로테이션 k번째 (k가 길이와 같으면 추가) */
  | { kind: 'sp'; k: number }
  | { kind: 'cl' }
  /** 불펜 역할. who: 바꿀 선수 (null이면 추가) */
  | { kind: 'pen'; role: PenRole; who: number | null };

interface Draft {
  /** 이 묶음을 만든 날 (날이 바뀌면 새로 만든다) */
  key: string;
  entry: Set<number>;
  plan: DepthPlan;
  /** 기용표를 직접 건드렸나 (AI 감독 기용 중에 엔트리만 옮기면 기용은 그대로 AI에게 둔다) */
  touched: boolean;
  /** 투수 역할을 하나라도 바꿨나: 그때 지금 보이는 필승조를 옮겨 적는다 (session.setPitcherRole과 같다) */
  penInit: boolean;
}

/** 야구장 모양 배치 순서 (자리는 game.css의 .slot-○○ 격자 칸) */
const FIELD: Slot[] = ['LF', 'CF', 'RF', 'SS', '2B', '3B', '1B', 'C', 'DH'];
const PEN_ROLES: PenRole[] = ['SU', 'LR', 'RP', 'MOP'];

/** 출전 상태 한 줄과 컨디션 낱말 (컨디션은 결장·육성이 아닐 때만) */
type Status = { text: string; out: boolean; block?: string; cond?: string | null };

function newDraft(s: GameSession, key: string): Draft {
  return { key, entry: new Set(s.registered().map((p) => p.idx)), plan: structuredClone(s.effectivePlan()), touched: false, penInit: false };
}

function copy(d: Draft): Draft {
  return { ...d, entry: new Set(d.entry), plan: structuredClone(d.plan) };
}

/** 묶음 안에서 1군에 없는 선수를 기용표에서 뺀다 (화면 표시용. 세션도 적용 때 같은 일을 한다) */
function prune(d: Draft, players: SimPlayer[]): void {
  const pl = d.plan;
  const ok = (i: number) => d.entry.has(i);
  for (const s of LINEUP_SLOTS) if (pl.starters[s] !== undefined && !ok(pl.starters[s]!)) delete pl.starters[s];
  pl.rotation = pl.rotation.filter(ok);
  if (pl.closer !== null && !ok(pl.closer)) pl.closer = null;
  if (pl.pen) for (const k of Object.keys(pl.pen)) if (!ok(Number(k)) || !players[Number(k)]?.isPitcher) delete pl.pen[Number(k)];
}

export function LineupBoard() {
  const { session, changed, version, openPlayer } = useGame();
  const seen = useSeen();
  const [tab, setTab] = useState<Tab>('hit');
  const [target, setTarget] = useState<Target | null>(null);
  const [msg, setMsg] = useState<(EntryCheck & { who?: string }) | null>(null);
  const key = `${session.year}:${session.currentDay}:${session.phase}`;
  const [draft, setDraft] = useState<Draft>(() => newDraft(session, key));
  // 날이 바뀌면(다음 경기 진행 등) 묶음을 새로 만든다
  const d = draft.key === key ? draft : newDraft(session, key);
  useEffect(() => { if (draft.key !== key) setDraft(d); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const players = session.world.players;
  const org = session.team.org;
  const rules = session.entryRules();
  const extra = session.season.rosterExtraOn(session.day);
  const editable = session.canManage;
  const condOf = useCondition();
  const recent = useMemo(() => recentLines(session), [session, version]);
  // 투수 지난 등판 (투구 수·휴식일·연투, 2026-10-23 U2-3). 우리 구단 박스스코어로
  const outings = useMemo(() => lastOutings(session.season, session.teamIdx, session.season.day), [session, version]);
  const outNote = (i: number | null) => { const o = i === null ? undefined : outings.get(i); return o ? outingText(o, session.world.year) : undefined; };
  const fut = useMemo(() => session.futures().lines, [session, version]);
  const curReg = useMemo(() => new Set(session.registered().map((p) => p.idx)), [session, version]);
  const curPlan = useMemo(() => session.effectivePlan(), [session, version]);
  /** 지금 보이는 투수 역할 (적용된 상태) */
  const shown = useMemo(() => new Map(org.filter((p) => p.isPitcher && curReg.has(p.idx)).map((p) => [p.idx, session.pitcherRole(p)])), [session, version, curReg]);

  const roleOf = (p: SimPlayer, dr: Draft = d): PitcherRole => {
    const pl = dr.plan;
    if (pl.closer === p.idx) return 'CL';
    if (pl.rotation.includes(p.idx)) return 'SP';
    const r = pl.pen?.[p.idx];
    if (r) return r;
    if (dr.penInit || (pl.pen && Object.keys(pl.pen).length)) return 'RP';
    return shown.get(p.idx) === 'SU' ? 'SU' : 'RP';
  };

  const edit = (f: (x: Draft) => void) => {
    const x = copy(d);
    f(x);
    setDraft(x);
    setMsg(null);
  };

  // ---- 바꾸기 (묶음에만 넣는다)

  const putHitter = (p: SimPlayer, s: Slot) => edit((x) => {
    const st = x.plan.starters;
    const from = LINEUP_SLOTS.find((t) => st[t] === p.idx);
    const q = st[s];
    if (from) delete st[from];
    st[s] = p.idx;
    if (from && q !== undefined && q !== p.idx) st[from] = q;
    x.entry.add(p.idx);
    x.touched = true;
  });
  const clearSlot = (s: Slot) => edit((x) => { delete x.plan.starters[s]; x.touched = true; });

  /** 투수 역할 바꾸기: 처음 바꿀 때 지금 보이는 필승조를 옮겨 적는다 */
  const penStart = (x: Draft) => {
    if (x.penInit) return;
    if (!x.plan.pen || !Object.keys(x.plan.pen).length) {
      x.plan.pen = {};
      for (const [i, r] of shown) if (r === 'SU' && !x.plan.rotation.includes(i) && x.plan.closer !== i) x.plan.pen[i] = 'SU';
    }
    x.penInit = true;
  };
  const unrole = (x: Draft, i: number) => {
    x.plan.rotation = x.plan.rotation.filter((j) => j !== i);
    if (x.plan.closer === i) x.plan.closer = null;
    if (x.plan.pen) delete x.plan.pen[i];
  };
  const putPitcher = (p: SimPlayer, t: Target) => edit((x) => {
    penStart(x);
    x.entry.add(p.idx);
    x.touched = true;
    if (t.kind === 'sp') {
      const rot = x.plan.rotation;
      const q = rot[t.k];
      const was = rot.indexOf(p.idx);
      if (x.plan.closer === p.idx) x.plan.closer = null;
      if (x.plan.pen) delete x.plan.pen[p.idx];
      if (q === undefined) {
        if (was >= 0) rot.splice(was, 1);
        rot.push(p.idx);
      } else if (was >= 0) {
        // 로테이션 안에서 순서 맞바꾸기
        rot[was] = q;
        rot[t.k] = p.idx;
      } else rot[t.k] = p.idx; // 원래 선발은 추격조로
    } else if (t.kind === 'cl') {
      unrole(x, p.idx);
      x.plan.closer = p.idx;
    } else if (t.kind === 'pen') {
      if (t.who !== null && t.who !== p.idx) unrole(x, t.who);
      unrole(x, p.idx);
      if (t.role !== 'RP') (x.plan.pen ??= {})[p.idx] = t.role;
    }
    if (x.plan.pen && !Object.keys(x.plan.pen).length) delete x.plan.pen;
  });
  /** 자리 비우기: 그 투수는 추격조(역할 없는 구원)로 */
  const clearPitcher = (t: Target) => edit((x) => {
    penStart(x);
    x.touched = true;
    const i = t.kind === 'sp' ? x.plan.rotation[t.k] : t.kind === 'cl' ? x.plan.closer : t.kind === 'pen' ? t.who : null;
    if (i !== null && i !== undefined) unrole(x, i);
    if (x.plan.pen && !Object.keys(x.plan.pen).length) delete x.plan.pen;
  });

  const shownOrder = d.plan.order ?? session.battingOrderSlots().order;
  const moveOrder = (k: number, dir: -1 | 1) => edit((x) => {
    const o = [...shownOrder];
    const j = k + dir;
    if (j < 0 || j >= o.length) return;
    [o[k], o[j]] = [o[j], o[k]];
    x.plan.order = o;
    x.touched = true;
  });
  const aiOrder = () => edit((x) => { delete x.plan.order; x.touched = true; });

  const toggleEntry = (p: SimPlayer) => edit((x) => {
    if (x.entry.has(p.idx)) x.entry.delete(p.idx);
    else x.entry.add(p.idx);
    prune(x, players);
  });

  // ---- 바뀐 것 (지금 → 묶음)

  const diff = useMemo(() => {
    const up = org.filter((p) => d.entry.has(p.idx) && !curReg.has(p.idx));
    const down = org.filter((p) => !d.entry.has(p.idx) && curReg.has(p.idx));
    const slots = LINEUP_SLOTS.filter((s) => curPlan.starters[s] !== d.plan.starters[s]).map((s) => ({ s, from: curPlan.starters[s], to: d.plan.starters[s] }));
    const roles = org.filter((p) => p.isPitcher && curReg.has(p.idx) && d.entry.has(p.idx))
      .map((p) => ({ p, from: shown.get(p.idx)!, to: roleOf(p) })).filter((r) => r.from !== r.to);
    const newRoles = up.filter((p) => p.isPitcher).map((p) => ({ p, to: roleOf(p) })).filter((r) => r.to !== 'RP');
    const curRot = curPlan.rotation.filter((i) => d.plan.rotation.includes(i));
    const rotOrder = d.plan.rotation.filter((i) => curPlan.rotation.includes(i)).some((i, k) => curRot[k] !== i);
    const curOrder = session.plan?.order;
    const order = JSON.stringify(curOrder ?? null) !== JSON.stringify(d.plan.order ?? null);
    const planDiff = slots.length + roles.length + newRoles.length + Number(rotOrder) + Number(order) > 0;
    const plan = planDiff && (d.touched || !!session.plan);
    return { up, down, slots, roles, newRoles, rotOrder, order, plan, any: up.length + down.length > 0 || plan };
  }, [d, curReg, curPlan, shown, session, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useMemo(() => {
    const c: { entry?: number[]; plan?: DepthPlan } = {};
    if (diff.up.length || diff.down.length) c.entry = [...d.entry];
    if (diff.plan) {
      const pl = structuredClone(d.plan);
      if (pl.pen && !Object.keys(pl.pen).length) delete pl.pen;
      c.plan = pl;
    }
    return c;
  }, [d, diff]);
  const check = useMemo(() => (diff.any ? session.checkBoard(change) : null), [change, diff, session, version]);

  const apply = () => {
    const r = session.applyBoard(change);
    if (r.errors.length) { setMsg(r); return; }
    const n = diff.up.length + diff.down.length + diff.slots.length + diff.roles.length + diff.newRoles.length + Number(diff.rotOrder) + Number(diff.order);
    setMsg({ ...r, who: `변경 ${n}건을 적용했습니다.` });
    setTarget(null);
    changed();
    setDraft(newDraft(session, key));
  };
  const reset = () => { setDraft(newDraft(session, key)); setTarget(null); setMsg(null); };

  // ---- 모드 (AI에게 맡기기는 바로 적용한다: 묶음이 아니라 관리 방식 전환)
  const manual = !!session.manualEntry;
  const mode = (r: EntryCheck, who: string) => {
    setMsg({ ...r, who: r.errors.length ? undefined : who });
    changed();
    setDraft(newDraft(session, key));
    setTarget(null);
  };

  // ---- 표시 도우미

  const nameOf = (i: number | undefined | null) => (i === undefined || i === null ? '비어 있음' : players[i]?.name ?? String(i));
  const statusOf = (p: SimPlayer): Status => {
    if (p.dev) return { text: '육성선수', out: true, block: '정식 등록한 뒤에 1군에 올릴 수 있습니다 (선수 명단)' };
    const back = session.returnDay(p);
    if (back !== null) {
      const when = back >= session.season.schedule.length ? '시즌 아웃' : `${shortDate(session.year, back)} 복귀`;
      return { text: `${session.absenceReason(p) ?? '결장'} · ${when}`, out: true };
    }
    if (!curReg.has(p.idx)) {
      const rd = session.reregisterDay(p);
      if (rd !== null) return { text: `${shortDate(session.year, rd)}부터 등록 가능`, out: true, block: `말소 뒤 10일 규정: ${shortDate(session.year, rd)}부터 등록할 수 있습니다`, cond: condOf(p) };
    }
    return { text: '출전 가능', out: false, cond: condOf(p) };
  };
  // 갈래 등급은 우리 스카우트 팀의 추측 가운데값 (능력치 v2 17.6)
  const gm = (p: SimPlayer, k: string): number | null => { const v = seen.grade(p.id, k); return v ? guessMid(v) : null; };
  const bg = (p: SimPlayer) => (p.isPitcher || gm(p, 'contact') === null ? undefined
    : { contact: gm(p, 'contact')!, power: gm(p, 'power')!, eye: gm(p, 'eye')!, speed: gm(p, 'speed')! });
  const pg = (p: SimPlayer) => (!p.isPitcher || gm(p, 'stuff') === null ? undefined
    : { stuff: gm(p, 'stuff')!, control: gm(p, 'control')!, hrSuppression: gm(p, 'hrSuppression')!, stamina: gm(p, 'stamina'), reliefStamina: gm(p, 'reliefStamina') });
  const defView = (p: SimPlayer, s: Slot) => (s === 'DH' ? null : seen.grade(p.id, 'defense', defenseGrade(defenseAt(p, s))));
  const defAt = (p: SimPlayer, s: Slot) => { const v = defView(p, s); return v ? guessMid(v) : null; };

  /** 추천 점수: 보이는 능력 등급(스카우트 추측)만 쓴다 */
  const score = (p: SimPlayer, t: Target): number => {
    if (t.kind === 'slot') {
      const g = bg(p);
      if (!g) return 0;
      const bat = (g.contact + g.power + g.eye) / 3;
      const def = defAt(p, t.slot);
      return bat + (def === null ? 0 : def - 50);
    }
    const g = pg(p);
    if (!g) return 0;
    const base = (g.stuff + g.control + g.hrSuppression) / 3;
    if (t.kind === 'sp') return base + 0.5 * ((g.stamina ?? 50) - 50);
    if (t.kind === 'pen' && t.role === 'LR') return base + 0.5 * ((g.reliefStamina ?? 50) - 50);
    if (t.kind === 'cl' || (t.kind === 'pen' && t.role === 'SU')) return base + 0.3 * (g.stuff - 50);
    return base;
  };
  const whyText = (p: SimPlayer, t: Target): string => {
    if (t.kind === 'slot') {
      const g = bg(p);
      const def = defAt(p, t.slot);
      return [def === null ? null : `${t.slot} 수비 ${def}`, g && `컨택 ${g.contact}`, g && `파워 ${g.power}`, g && `선구안 ${g.eye}`].filter(Boolean).join(' · ');
    }
    const g = pg(p);
    if (!g) return '';
    const extra = t.kind === 'sp' ? `선발 체력 ${g.stamina ?? '-'}` : t.kind === 'pen' && t.role === 'LR' ? `구원 체력 ${g.reliefStamina ?? '-'}` : null;
    return [`구위 ${g.stuff}`, `제구 ${g.control}`, `장타 억제 ${g.hrSuppression}`, extra].filter(Boolean).join(' · ');
  };
  const nowText = (p: SimPlayer): string => {
    if (!d.entry.has(p.idx)) return '2군';
    if (p.isPitcher) return PITCHER_ROLE_LABEL[roleOf(p)];
    const s = LINEUP_SLOTS.find((t) => d.plan.starters[t] === p.idx);
    return s ? `주전 ${s}` : '대기';
  };

  const targetLabel = (t: Target): string => {
    if (t.kind === 'slot') return `${t.slot} (${POS_KO[t.slot]})`;
    if (t.kind === 'sp') return t.k < d.plan.rotation.length ? `SP 선발 ${t.k + 1}번` : 'SP 선발 추가';
    if (t.kind === 'cl') return 'CP 마무리';
    return `RP ${PITCHER_ROLE_LABEL[t.role]}${t.who === null ? ' 추가' : ''}`;
  };
  const occupant = (t: Target): number | null => {
    if (t.kind === 'slot') return d.plan.starters[t.slot] ?? null;
    if (t.kind === 'sp') return d.plan.rotation[t.k] ?? null;
    if (t.kind === 'cl') return d.plan.closer;
    return t.who;
  };
  const sameTarget = (a: Target | null, b: Target) => !!a && JSON.stringify(a) === JSON.stringify(b);
  const open = (t: Target) => setTarget(sameTarget(target, t) ? null : t);

  // 끌어다 놓기 (선택 기능): 대기·주전 칩을 자리 칸에 놓으면 그 자리에 세운다
  const onDrag = (e: DragEvent, i: number) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; };
  const onDrop = (e: DragEvent, s: Slot) => {
    e.preventDefault();
    const i = Number(e.dataTransfer.getData('text/plain'));
    const p = players[i];
    if (editable && p && !p.isPitcher && p.teamIdx === session.teamIdx && !statusOf(p).block) putHitter(p, s);
  };

  const hitters1 = org.filter((p) => !p.isPitcher && d.entry.has(p.idx));
  const bench = hitters1.filter((p) => !LINEUP_SLOTS.some((s) => d.plan.starters[s] === p.idx));
  const pitchers1 = org.filter((p) => p.isPitcher && d.entry.has(p.idx));
  const changedSlot = (s: Slot) => diff.slots.some((x) => x.s === s);

  const nFirst = d.entry.size;
  const nPit = org.filter((p) => p.isPitcher && d.entry.has(p.idx)).length;
  const nForeign = org.filter((p) => p.foreign && d.entry.has(p.idx)).length;

  return (
    <div className="stack tight lineup-board">
      <section className="row-between wrap">
        <div className="muted small roster-sum">
          1군 <strong className={nFirst > rules.rosterSize ? 'neg' : undefined}>{nFirst}/{rules.rosterSize}</strong>명 (투수 {nPit}, 야수 {nFirst - nPit}{rules.activeSize < rules.rosterSize ? `, 경기 출장 ${rules.activeSize}명` : ''}){extra > 0 ? ` · 엔트리 확대 +${extra}` : ''} · 외국인 {nForeign}/{rules.foreignLimit} ·{' '}
          {manual ? '엔트리 직접 관리' : '엔트리 AI 관리'} · {session.plan ? '기용 직접' : '기용 AI 감독'}
          <details className="help">
            <summary>도움말</summary>
            자리 칸을 누르면 후보가 열립니다. 후보를 고르면 바로 바뀌지 않고 오른쪽 <strong>변경 검토</strong>에 모입니다.
            전후를 확인하고 <strong>적용</strong>을 눌러야 바뀝니다. 대기 선수 칩을 자리 칸에 끌어다 놓아도 됩니다.
            직접 정한 주전은 AI가 쉬게 하지 않고, 결장할 때만 AI 감독이 대기 선수로 채웁니다. 경기 중 교체는 AI 감독이 합니다.
            추천은 화면에 보이는 능력 등급과 출전 상태만으로 고른 것이며, 고르기 전에는 아무것도 바뀌지 않습니다.
            선수 이름 옆 좋음·보통·나쁨은 컨디션입니다. {CONDITION_HELP}
            {rules.activeSize < rules.rosterSize && <> 1군 {rules.rosterSize}명 가운데 한 경기에는 {rules.activeSize}명까지 나옵니다. 그날 던지지 않는 선발 투수는 세지 않고, 그래도 넘치면 가장 약한 구원 투수·벤치 야수가 그 경기에 빠집니다.</>}
          </details>
        </div>
        <span className="inline">
          {editable && session.plan && (
            // 확인 한 번 뒤 적용 (UI 2차 결정 2): 직접 정한 배치가 사라진다
            <ConfirmButton className="ghost" label="AI에게 기용 맡기기" confirmLabel="직접 정한 배치가 사라집니다. 다시 눌러 맡기기"
              onConfirm={() => mode(session.setPlan(null), '기용을 AI 감독에게 맡겼습니다.')} />
          )}
          {manual ? (
            <ConfirmButton className="ghost" disabled={!editable} label="AI에게 엔트리 맡기기" confirmLabel="AI 감독이 1군을 다시 짭니다. 다시 눌러 맡기기"
              onConfirm={() => mode(session.setEntry(null), '1군 엔트리를 AI에게 맡겼습니다. 선수를 옮기면 다시 직접 관리로 바뀝니다.')} />
          ) : (
            <button type="button" className="ghost" disabled={!editable} onClick={() => mode(session.setEntry(session.registered().map((p) => p.idx)), '지금 1군 명단으로 직접 관리를 시작합니다.')}>엔트리 직접 관리하기</button>
          )}
        </span>
      </section>

      {!editable && <p className="note small">{session.done ? '시즌이 끝나 기용을 바꿀 수 없습니다 (가을야구에서 탈락했거나 진출하지 못함). 보기만 할 수 있습니다.' : '지금은 바꿀 수 없습니다.'}</p>}
      {msg && (msg.errors.length > 0 || msg.warnings.length > 0 || msg.who) && (
        <div className={msg.errors.length ? 'note error-box' : 'note'} role="status">
          {msg.errors.map((e) => <p key={e}>{e}</p>)}
          {msg.who && <p>{msg.who}</p>}
          {msg.warnings.map((w) => <p key={w} className="small">{w}</p>)}
        </div>
      )}

      <div className="seg" role="tablist" aria-label="기용 보드">
        {([['hit', '야수'], ['pit', '투수'], ['entry', '엔트리 (1군·2군)']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setTarget(null); }}>{label}</button>
        ))}
        {diff.any && <button type="button" className="link board-jump" onClick={() => document.getElementById('board-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>변경 검토 ↓</button>}
      </div>

      <div className="board-split">
        <div className="stack tight">
          {tab === 'hit' && (
            <>
              <section className="card board-field" aria-label="야수 자리">
                <div className="card-top"><h2>야수 자리</h2><span className="small muted">칸을 누르면 후보 · 숫자는 그 자리 수비 등급</span></div>
                <div className="field-grid">
                  {FIELD.map((s) => {
                        const i = d.plan.starters[s];
                        const p = i === undefined ? null : players[i];
                        const st = p ? statusOf(p) : null;
                        const t: Target = { kind: 'slot', slot: s };
                        return (
                          <button key={s} type="button" className={`slot-card slot-${s}${sameTarget(target, t) ? ' on' : ''}${changedSlot(s) ? ' changed' : ''}`}
                            aria-pressed={sameTarget(target, t)} disabled={!editable && !p} title={POS_KO[s]}
                            onClick={() => open(t)} onDragOver={(e) => editable && e.preventDefault()} onDrop={(e) => onDrop(e, s)}
                            draggable={editable && !!p} onDragStart={(e) => p && onDrag(e, p.idx)}>
                            <span className="slot-pos">{s}</span>
                            <strong title={p?.name}>{p ? p.name : '비어 있음'}</strong>
                            <span className="slot-sub">
                              {p ? (s === 'DH' ? '지명타자' : <>수비 <Grade v={defAt(p, s)} /></>) : 'AI 감독이 채움'}
                              {st?.out && <span className="status out">{st.text}</span>}
                              <CondTag text={st?.cond} />
                            </span>
                          </button>
                        );
                  })}
                </div>
              </section>

              <section className="card" aria-label="대기 야수">
                <div className="card-top"><h2>대기 (1군 야수 {bench.length}명)</h2><span className="small muted">자리 칸에 끌어다 놓을 수 있습니다</span></div>
                {bench.length ? (
                  <ul className="plain bench">
                    {bench.map((p) => {
                      const st = statusOf(p);
                      return (
                        <li key={p.idx} draggable={editable} onDragStart={(e) => onDrag(e, p.idx)}>
                          <button type="button" className="link name-btn" onClick={() => openPlayer(p.idx)}>{p.name}</button>
                          <span className="muted small">{posName(p.pos)}</span>
                          {st.out && <span className="status out">{st.text}</span>}
                          <CondTag text={st.cond} />
                          {editable && <button type="button" className="small-btn" onClick={() => toggleEntry(p)} title="묶음에 넣습니다 (적용 전에는 바뀌지 않음)">2군으로</button>}
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="small muted">대기 야수가 없습니다.</p>}
              </section>

              <section className="card" aria-label="타순">
                <div className="card-top">
                  <h2>타순</h2>
                  <span className="small muted">{d.plan.order ? '직접 정함' : 'AI 감독 (바꾸면 직접 정한 타순)'}</span>
                  {editable && d.plan.order && <button type="button" className="ghost small-btn card-more" onClick={aiOrder}>AI에게 타순 맡기기</button>}
                </div>
                <ol className="plain bat-order">
                  {shownOrder.map((s, k) => (
                    <li key={s}>
                      <span className="order-no">{k + 1}</span>
                      <span className="slot-pos">{s}</span>
                      <span className="grow" title={nameOf(d.plan.starters[s])}>{nameOf(d.plan.starters[s])}</span>
                      <button type="button" className="small-btn" aria-label={`${k + 1}번 ${s} 위로`} disabled={!editable || k === 0} onClick={() => moveOrder(k, -1)}>↑</button>
                      <button type="button" className="small-btn" aria-label={`${k + 1}번 ${s} 아래로`} disabled={!editable || k === shownOrder.length - 1} onClick={() => moveOrder(k, 1)}>↓</button>
                    </li>
                  ))}
                </ol>
                <p className="muted small">타순은 자리 기준입니다. 그 자리 주전이 빠지면 대신 나온 선수가 같은 타순에 섭니다.</p>
              </section>
            </>
          )}

          {tab === 'pit' && (
            <section className="card board-pit" aria-label="투수 역할">
              <div className="role-block">
                <h3>SP 선발 로테이션 <span className="muted small">{d.plan.rotation.length}명{d.plan.rotation.length < MIN_PLAN_ROTATION ? ` · ${MIN_PLAN_ROTATION}명보다 적으면 AI 감독이 채움` : ''}</span></h3>
                <div className="role-row">
                  {[...d.plan.rotation, null].map((i, k) => (
                    <PitchButton key={i ?? 'add'} label={i === null ? '+ 선발 추가' : `${k + 1}`} p={i === null ? null : players[i]} on={sameTarget(target, { kind: 'sp', k })}
                      changed={i !== null && diff.roles.some((r) => r.p.idx === i)} status={i === null ? null : statusOf(players[i])} note={outNote(i)}
                      disabled={!editable && i === null} onClick={() => open({ kind: 'sp', k })} />
                  ))}
                </div>
              </div>
              <div className="role-block">
                <h3>CP 마무리</h3>
                <div className="role-row">
                  <PitchButton label="CP" p={d.plan.closer === null ? null : players[d.plan.closer]} on={sameTarget(target, { kind: 'cl' })}
                    changed={d.plan.closer !== curPlan.closer} status={d.plan.closer === null ? null : statusOf(players[d.plan.closer])} note={outNote(d.plan.closer)}
                    empty="마무리 없음 (AI 감독이 정함)" disabled={!editable && d.plan.closer === null} onClick={() => open({ kind: 'cl' })} />
                </div>
              </div>
              <div className="role-block">
                <h3>RP 불펜</h3>
                {PEN_ROLES.map((role) => {
                  const list = pitchers1.filter((p) => roleOf(p) === role);
                  return (
                    <div key={role} className="pen-group">
                      <span className="pen-label">{PITCHER_ROLE_LABEL[role]}{role === 'RP' && <small className="muted"> (역할 미정 구원)</small>}</span>
                      <div className="role-row">
                        {list.map((p) => (
                          <PitchButton key={p.idx} p={p} on={sameTarget(target, { kind: 'pen', role, who: p.idx })} changed={diff.roles.some((r) => r.p.idx === p.idx) || diff.newRoles.some((r) => r.p.idx === p.idx)}
                            status={statusOf(p)} note={outNote(p.idx)} onClick={() => open({ kind: 'pen', role, who: p.idx })} />
                        ))}
                        {editable && <PitchButton label="+ 추가" p={null} empty="" on={sameTarget(target, { kind: 'pen', role, who: null })} onClick={() => open({ kind: 'pen', role, who: null })} />}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="muted small">자리를 비우거나 다른 역할로 옮긴 투수는 추격조(역할 미정 구원)가 됩니다. 마무리를 새로 정하면 기존 마무리는 추격조로 갑니다.</p>
            </section>
          )}

          {tab === 'entry' && <EntryLists d={d} curReg={curReg} toggle={toggleEntry} statusOf={statusOf} nowText={nowText} recent={recent} fut={fut} editable={editable} />}
        </div>

        <div className="stack tight board-side">
          {target && (
            <Candidates key={JSON.stringify(target)} target={target} label={targetLabel(target)} occupant={occupant(target)} d={d}
              statusOf={statusOf} nowText={nowText} score={score} whyText={whyText} recent={recent} outings={outings} defAt={defAt} editable={editable}
              onPick={(p) => { if (target.kind === 'slot') putHitter(p, target.slot); else putPitcher(p, target); setTarget(null); }}
              onClear={() => { if (target.kind === 'slot') clearSlot(target.slot); else clearPitcher(target); setTarget(null); }}
              onClose={() => setTarget(null)} />
          )}

          <section className="card review" id="board-review" aria-label="변경 검토">
            <div className="card-top"><h2>변경 검토</h2>{diff.any && <span className="small muted">적용 전에는 바뀌지 않습니다</span>}</div>
            {!diff.any ? (
              <p className="small muted">바꾼 것이 없습니다. 자리 칸을 누르거나 엔트리에서 선수를 옮기면 여기에 모입니다.</p>
            ) : (
              <>
                <ul className="plain review-list">
                  {!manual && <li><span className="tag">관리</span> 엔트리를 직접 관리하게 됩니다</li>}
                  {diff.plan && !session.plan && <li><span className="tag">기용</span> AI 감독 배치에서 시작해 기용을 직접 정하게 됩니다</li>}
                  {diff.up.map((p) => <li key={`u${p.idx}`}><span className="tag">1군 등록</span> {p.name} <span className="muted small">{p.isPitcher ? '투수' : posName(p.pos)}</span></li>)}
                  {diff.down.map((p) => <li key={`d${p.idx}`}><span className="tag">1군 말소</span> {p.name} <span className="muted small">10일 동안 다시 등록 못 함</span></li>)}
                  {diff.plan && diff.slots.map((x) => <li key={x.s}><span className="tag">{x.s}</span> {nameOf(x.from)} → <strong>{x.to === undefined ? '비움 (AI 감독이 채움)' : nameOf(x.to)}</strong></li>)}
                  {diff.plan && diff.roles.map((r) => <li key={`r${r.p.idx}`}><span className="tag">투수</span> {r.p.name}: {PITCHER_ROLE_LABEL[r.from]} → <strong>{PITCHER_ROLE_LABEL[r.to]}</strong></li>)}
                  {diff.plan && diff.newRoles.map((r) => <li key={`n${r.p.idx}`}><span className="tag">투수</span> {r.p.name}: 2군 → <strong>{PITCHER_ROLE_LABEL[r.to]}</strong></li>)}
                  {diff.plan && diff.rotOrder && <li><span className="tag">선발 순서</span> {d.plan.rotation.map((i) => players[i].name).join(' → ')}</li>}
                  {diff.plan && diff.order && <li><span className="tag">타순</span> {d.plan.order ? d.plan.order.map((s, k) => `${k + 1}.${s}`).join(' ') : 'AI 감독에게 맡김'}</li>}
                  {!diff.plan && (diff.up.length > 0 || diff.down.length > 0) && !session.plan && <li className="muted small">기용은 AI 감독이 새 1군으로 다시 짭니다.</li>}
                </ul>
                {check && (check.errors.length > 0 || check.warnings.length > 0) && (
                  <div className={check.errors.length ? 'note error-box small' : 'note small'} role="status">
                    {check.errors.map((e) => <p key={e}>{e}</p>)}
                    {check.warnings.map((w) => <p key={w}>{w}</p>)}
                  </div>
                )}
                <p className="inline">
                  <button type="button" className="go" disabled={!editable || !!check?.errors.length} onClick={apply}>적용</button>
                  <button type="button" className="ghost" onClick={reset}>되돌리기</button>
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function PitchButton({ p, label, on, changed, status, note, empty = '비어 있음', disabled, onClick }: {
  p: SimPlayer | null; label?: string; on: boolean; changed?: boolean; status?: Status | null;
  /** 지난 등판 "6/08 104구 · 휴식 4일" */
  note?: string; empty?: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className={`slot-card pitch${on ? ' on' : ''}${changed ? ' changed' : ''}${p ? '' : ' add'}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {label && <span className="slot-pos">{label}</span>}
      {p ? <strong title={p.name}>{p.name}</strong> : empty && <span className="muted small">{empty}</span>}
      {status?.out && <span className="status out">{status.text}</span>}
      <CondTag text={status?.cond} />
      {p && note && <span className="slot-note" title="지난 등판 · 그 뒤 쉰 날">{note}</span>}
    </button>
  );
}

/** 후보 비교: 출전 가능 상태 · 지금 수비 등급(야수) · 능력 등급 · 최근 10경기. 2군 선수를 고르면 1군 등록도 묶음에 들어간다 */
function Candidates({ target, label, occupant, d, statusOf, nowText, score, whyText, recent, outings, defAt, editable, onPick, onClear, onClose }: {
  target: Target; label: string; occupant: number | null; d: Draft;
  statusOf: (p: SimPlayer) => Status; nowText: (p: SimPlayer) => string;
  score: (p: SimPlayer, t: Target) => number; whyText: (p: SimPlayer, t: Target) => string; recent: Map<number, string>; outings: Map<number, Outing>;
  defAt: (p: SimPlayer, s: Slot) => number | null; editable: boolean;
  onPick: (p: SimPlayer) => void; onClear: () => void; onClose: () => void;
}) {
  const { session, openPlayer } = useGame();
  const seen = useSeen();
  const ref = useRef<HTMLElement>(null);
  const pit = target.kind !== 'slot';
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 좁은 화면은 후보가 보드 아래에 붙으므로 그쪽으로 내려 준다 (넓은 화면은 곁 칸이 따라다닌다)
    if (window.matchMedia('(max-width: 1100px)').matches) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.querySelector<HTMLButtonElement>('button.pick-btn:not(:disabled), button')?.focus({ preventScroll: true });
  }, []);
  const rows = session.team.org.filter((p) => p.isPitcher === pit && p.idx !== occupant).map((p) => ({ p, st: statusOf(p), sc: score(p, target), first: d.entry.has(p.idx) }));
  rows.sort((a, b) => Number(b.first) - Number(a.first) || Number(a.st.out) - Number(b.st.out) || b.sc - a.sc || a.p.idx - b.p.idx);
  const cur = occupant === null ? null : session.world.players[occupant];
  // 추천: 다른 자리를 비우지 않는 후보(대기·2군·역할 미정) 중 보이는 능력 점수가 지금 선수보다 높은 사람
  const free = (p: SimPlayer) => ['2군', pit ? PITCHER_ROLE_LABEL.RP : '대기'].includes(nowText(p));
  const curScore = cur && !statusOf(cur).out ? score(cur, target) : -Infinity;
  const best = rows.filter((r) => !r.st.out && !r.st.block && free(r.p) && r.sc > curScore).sort((a, b) => b.sc - a.sc)[0];
  const groups: [string, typeof rows][] = [['1군', rows.filter((r) => r.first)], ['2군 (고르면 1군 등록도 묶음에 들어갑니다)', rows.filter((r) => !r.first)]];
  return (
    <section ref={ref} className="card candidates" aria-label={`${label} 후보`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="card-top">
        <h2>{label} 후보</h2>
        <button type="button" className="ghost small-btn card-more" onClick={onClose} aria-label="후보 닫기">닫기</button>
      </div>
      <p className="small">
        지금: <strong>{cur ? cur.name : '비어 있음'}</strong>
        {cur && target.kind === 'slot' && target.slot !== 'DH' && <> · 수비 <Grade v={defAt(cur, target.slot)} /></>}
        {cur && <> · {statusOf(cur).text}{recent.get(cur.idx) ? ` · ${recent.get(cur.idx)}` : ''}</>}
        {cur && statusOf(cur).cond && <> <CondTag text={statusOf(cur).cond} label /></>}
        {cur && pit && outings.has(cur.idx) && <> · 지난 등판 {outingText(outings.get(cur.idx)!, session.world.year)}</>}
      </p>
      <p className="small muted">
        {best
          ? <>추천 <strong>{best.p.name}</strong> — 보이는 능력 기준 ({whyText(best.p, target)}). 고르기 전에는 바뀌지 않습니다.</>
          : '다른 자리를 비우지 않는 후보 중에는 지금보다 보이는 능력이 나은 선수가 없습니다.'}
      </p>
      {editable && cur && (
        <button type="button" className="ghost small-btn" onClick={onClear}>
          {target.kind === 'slot' ? '자리 비우기 (AI 감독이 채움)' : '역할 빼기 (추격조로)'}
        </button>
      )}
      <div className="scroll flat">
        <table className="cand-table">
          <thead>
            <tr>
              <th /><th className="l">이름 · 최근 10경기</th><th className="l">지금 · 상태</th>
              {pit ? <><th>구위</th><th>제구</th><th title="장타 억제">장억</th><th title={target.kind === 'pen' && target.role === 'LR' ? '구원 체력' : '선발 체력'}>체력</th></>
                : <>{target.slot !== 'DH' && <th title={`${target.slot} 수비 등급 (지금)`}>수비</th>}<th>컨택</th><th>파워</th><th title="선구안">눈</th></>}
            </tr>
          </thead>
          {groups.map(([title, list]) => list.length > 0 && (
            <tbody key={title}>
              <tr className="group-row"><th className="l" colSpan={8}>{title}</th></tr>
              {list.map(({ p, st }) => {
                const gv = (k: string) => <GuessGrade v={seen.grade(p.id, k)} />;
                return (
                  <tr key={p.idx} className={best?.p.idx === p.idx ? 'rec' : undefined}>
                    <td>
                      <button type="button" className="small-btn pick-btn" disabled={!editable || !!st.block} title={st.block} aria-label={`${p.name} 고르기`} onClick={() => onPick(p)}>고르기</button>
                    </td>
                    <td className="l">
                      <button type="button" className="link name-btn" onClick={() => openPlayer(p.idx)}>{p.name}</button>
                      {!pit && <span className="muted small"> {posName(p.pos)}</span>}
                      <ForeignMark p={p} />
                      {best?.p.idx === p.idx && <span className="tag rec-tag" title={whyText(p, target)}>추천</span>}
                      <span className="cand-recent muted">{d.entry.has(p.idx) ? (recent.get(p.idx) ?? '최근 10경기 출전 없음') : '2군'}</span>
                      {pit && outings.has(p.idx) && <span className="cand-recent muted">지난 등판 {outingText(outings.get(p.idx)!, session.world.year)}</span>}
                    </td>
                    <td className="l small">{nowText(p)}{st.out && <><br /><span className="status out">{st.text}</span></>}{st.cond && <><br /><CondTag text={st.cond} /></>}</td>
                    {pit ? (
                      <><td>{gv('stuff')}</td><td>{gv('control')}</td><td>{gv('hrSuppression')}</td>
                        <td>{gv(target.kind === 'pen' && target.role === 'LR' ? 'reliefStamina' : 'stamina')}</td></>
                    ) : (
                      <>{target.slot !== 'DH' && <td><GuessGrade v={seen.grade(p.id, 'defense', defenseGrade(defenseAt(p, target.slot)))} /></td>}<td>{gv('contact')}</td><td>{gv('power')}</td><td>{gv('eye')}</td></>
                    )}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

/** 엔트리: 1군·2군 명단. 옮기기는 묶음에 모았다가 검토 뒤 적용한다 */
function EntryLists({ d, curReg, toggle, statusOf, nowText, recent, fut, editable }: {
  d: Draft; curReg: Set<number>; toggle: (p: SimPlayer) => void; statusOf: (p: SimPlayer) => Status;
  nowText: (p: SimPlayer) => string; recent: Map<number, string>; fut: ReturnType<GameSession['futures']>['lines']; editable: boolean;
}) {
  const { session, openPlayer } = useGame();
  const [kind, setKind] = useState<'all' | 'hit' | 'pit'>('all');
  const org = session.team.org.filter((p) => kind === 'all' || (kind === 'pit') === p.isPitcher);
  const sortKey = (p: SimPlayer) => (p.isPitcher ? 1 : 0);
  const col = (first: boolean) => org.filter((p) => d.entry.has(p.idx) === first).sort((a, b) => sortKey(a) - sortKey(b) || a.name.localeCompare(b.name, 'ko') || a.idx - b.idx);
  return (
    <section className="card" aria-label="엔트리">
      <div className="card-top">
        <h2>엔트리</h2>
        <div className="seg small" role="tablist" aria-label="선수 구분">
          {([['all', '전체'], ['hit', '야수'], ['pit', '투수']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
      </div>
      <p className="small muted">옮길 선수를 누르면 변경 묶음에 들어갑니다. 1군에서 말소하면 10일 동안 다시 등록할 수 없습니다. 육성선수 정식 등록은 선수 명단에서 합니다.</p>
      <div className="entry-cols">
        {[true, false].map((first) => {
          const list = col(first);
          return (
            <div key={String(first)}>
              <h3>{first ? '1군' : '2군'} <span className="muted small">{list.length}명</span></h3>
              <ul className="plain entry-list">
                {list.map((p) => {
                  const st = statusOf(p);
                  const moved = curReg.has(p.idx) !== first;
                  return (
                    <li key={p.idx} className={moved ? 'changed' : undefined}>
                      <span className="entry-name">
                        <button type="button" className="link name-btn" onClick={() => openPlayer(p.idx)}>{p.name}</button>
                        <ForeignMark p={p} />
                        {p.dev && <span className="tag">육성</span>}
                        <span className="muted small"> {p.isPitcher ? '투수' : posName(p.pos)} · {nowText(p)}</span>
                        <br />
                        <span className="small">{st.out ? <span className="status out">{st.text}</span> : null} <CondTag text={st.cond} /> <span className="muted">{first ? (recent.get(p.idx) ?? '') : futuresText(fut.get(p.idx))}</span></span>
                      </span>
                      <button type="button" className="small-btn" disabled={!editable || (!first && !!st.block)} title={!first ? st.block : undefined} onClick={() => toggle(p)}>
                        {moved ? '되돌리기' : first ? '2군으로' : '1군으로'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
