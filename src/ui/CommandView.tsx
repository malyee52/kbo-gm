// 수동 경기 화면 (직접 지휘, UI 2단계 U2-10, docs/UI개편_2단계_기획안.md 2.2.2). 2026-10-12 사용자 요청 "대주자, 대타 혹은 작전지시, 투수 교체를 직접"에서 시작.
// 지휘하는 경기는 공 단위(A 해결기, 엔진 2 17단계)로 치른다. 타석 사이에는 늘 묻고, 공 사이에는 "멈춤"을 눌렀을 때만 묻는다 (기획안 결정 7).
// 위: 점수판(점수·이닝·아웃·주자·B·S·O·투구 수·체력 짐작·타자). 왼쪽: 공 단위 중계. 오른쪽: 작전 판. 아래: 멈춤·다음 공·다음 타석·속도.
// 타석 사이 공격은 두 단계: 주자 작전(투구 전, 도루할 수 있을 때: 대주자·도루·히트앤드런)과 타격 작전(도루가 끝난 뒤: 대타·대주자·강공·번트).
// 타석 사이 수비: 투수 교체·유지, 고의4구, 전진 수비, 피치아웃, 대수비. 공 사이: 공격은 대주자·도루·히트앤드런, 수비는 투수 교체·고의4구.
// 항목마다 '자동'이면 AI 감독이, 고르면 고른 대로 한다 (engine CommandChoice). 고른 작전은 중계에 "작전: …" 줄로 남는다.
// 진행은 세션의 진행 중인 지휘 경기(session.commandStep, 엔진 2 18단계)로 한 물음씩 나아가고 자동 저장에 남는다.
// 한 번 진행한 공은 되돌리지 않는다 (결정 4): 진행 전에만 그만둘 수 있고, 그 뒤에는 "잠시 닫기"(경기는 남고 홈·결정함에서 이어서 지휘)나
// "자동으로 끝내기"(AI 감독이 공 단위로 계속 = 결정 5 기본 / 빠르게 끝내기 = 지금 물음부터 B로 계산)로 끝낸다.
import { Fragment, useEffect, useRef, useState } from 'react';
import type { CommandChoice, CommandRequest, Play } from '../engine';
import { BUNT_SUCCESS, DEFAULT_PARAMS, PITCH_TEXT, PITCH_ZONES, shownPitchLimit, ZONE_TEXT, type PitchZone } from '../engine';
import { lastOutings, outingText } from '../game/boxscore';
import { formatDate } from '../game/calendar';
import { inningLabel, isHit, lineScoreUpTo, pitchCounts, pitchNote, playText } from '../game/highlights';
import { isCrisis, type CommandPreview, type PreviewMode } from '../game/session';
import { fixed2, ops, rate3 } from '../game/stats';
import { Diamond } from './GameCast';
import { useGame } from './context';
import { CondTag, useCondition } from './parts';
import { useShell } from './shell';
import { teamVars } from './teams';

type Tactic = '' | 'swing' | 'bunt';
type Steal = '' | 'go' | 'hold' | 'hnr';
/** 세 갈래 지시: 자동(감독) · 한다 · 안 한다 */
type Tri = '' | 'yes' | 'no';
const tri = (t: Tri): boolean | undefined => (t === '' ? undefined : t === 'yes');

/** 공 사이 간격 (ms). '즉시'는 다음 타석을 한 번에 (기획안 2.2.2 속도: 느림·보통·빠름, 브라우저에 기억) */
type Speed = 'slow' | 'normal' | 'fast' | 'instant';
const SPEED_MS: Record<Speed, number> = { slow: 1100, normal: 650, fast: 280, instant: 0 };
const SPEED_LABEL: Record<Speed, string> = { slow: '느림', normal: '보통', fast: '빠름', instant: '즉시' };
const SPEED_KEY = 'kbo-gm.command-speed';
function loadSpeed(): Speed {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    return v && v in SPEED_MS ? (v as Speed) : 'normal';
  } catch {
    return 'normal';
  }
}
function saveSpeed(v: Speed) {
  try { localStorage.setItem(SPEED_KEY, v); } catch { /* 저장 못 해도 이번 창에서는 쓴다 */ }
}

/** 공을 이어서 굴리는 중: pa 다음 타석 물음까지, watch 멈춤·위기·경기 끝까지 */
type Run = null | 'pa' | 'watch';
/** 타수에 드는 타석 결과 (오늘 기록 "2타수 1안타") */
const AT_BAT = new Set(['SO', 'HR', '3B', '2B', '1B', 'E', 'GDP', 'GO', 'FO', 'BF']);
const PA_KINDS = new Set([...AT_BAT, 'BB', 'HBP', 'IBB', 'SF', 'SAC']);
const BASES_TEXT = ['', '1루', '2루', '1·2루', '3루', '1·3루', '2·3루', '만루'];
/** 주자 모양 "1·3루" (없으면 '주자 없음') */
/** 중계 한 공의 구종·코스 앞말 ("슬라이더 · 바깥쪽 낮게 "), 없으면 빈 낱말 (엔진 2 20단계) */
function pitchKind(pt: readonly string[] | undefined, pz: readonly string[] | undefined, j: number): string {
  const t = pt?.[j];
  if (!t) return '';
  const z = pz?.[j] as PitchZone | '' | undefined;
  return `${t}${z ? ` · ${ZONE_TEXT[z]}` : ''} `;
}

/** 구종 비율 (구종 칸 옆, 5% 밑은 "가끔") */
function shareText(share: number, all: readonly { share: number }[]): string {
  const pct = (share / all.reduce((s, a) => s + a.share, 0)) * 100;
  return pct < 5 ? '가끔' : `${Math.round(pct)}%`;
}

export function basesText(bases: readonly number[]): string {
  const k = (bases[0] >= 0 ? 1 : 0) + (bases[1] >= 0 ? 2 : 0) + (bases[2] >= 0 ? 4 : 0);
  return k ? BASES_TEXT[k] : '주자 없음';
}

export function CommandView({ start, onDone, onCancel }: { start: CommandPreview; onDone: () => void; onCancel: () => void }) {
  const { session, autosave } = useGame();
  const { density } = useShell();
  const ref = useRef<HTMLDialogElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [pv, setPv] = useState(start);
  const [tactic, setTactic] = useState<Tactic>('');
  const [steal, setSteal] = useState<Steal>('');
  // 대타: '' 자동(감독), 'none' 그대로(대타 없음), 숫자 = 선수
  const [ph, setPh] = useState('');
  // 대주자: prNone = 그대로(대주자 없음), pr = 고른 선수 (한 명, 고르면 그쪽이 우선)
  const [prNone, setPrNone] = useState(false);
  const [pr, setPr] = useState<[string, string, string]>(['', '', '']);
  const [pitcher, setPitcher] = useState('');
  const [walk, setWalk] = useState<Tri>('');
  const [infield, setInfield] = useState<'' | 'in' | 'back'>('');
  const [pitchout, setPitchout] = useState<Tri>('');
  // 구종·코스 지시 (공 사이 수비, 엔진 2 20-3단계): '' = AI 포수
  const [ptype, setPtype] = useState('');
  const [pzone, setPzone] = useState<'' | PitchZone>('');
  // 대수비: '' 자동(감독), 'none' 그대로, 숫자 = 나갈 선수 (defIn = 들어갈 선수)
  const [defOut, setDefOut] = useState('');
  const [defIn, setDefIn] = useState('');
  // 후보 판(▸)을 펼친 항목
  const [open, setOpen] = useState<'' | 'ph' | 'pr' | 'pitcher' | 'def'>('');
  const [run, setRun] = useState<Run>(null);
  const [speed, setSpeedState] = useState<Speed>(loadSpeed);
  const setSpeed = (v: Speed) => { setSpeedState(v); saveSpeed(v); };
  const [busy, setBusy] = useState(false);
  // 자동으로 끝내기: 고르는 칸을 열었나, 고른 방식(확인 한 줄)
  const [finishMenu, setFinishMenu] = useState(false);
  const [finishAsk, setFinishAsk] = useState<'A' | 'B' | null>(null);
  // 휴대폰: 작전 판은 아래에서 올라온다 ('작전' 단추)
  const [opsOpen, setOpsOpen] = useState(false);
  // 고른 작전 줄 (중계에 "작전: 도루"로 남긴다). at = 고를 때까지의 중계 줄 수. 화면 기록이라 창을 다시 열면 비어 있다
  const [notes, setNotes] = useState<{ at: number; text: string }[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // 물음이 바뀌면 고르던 것을 비운다
  useEffect(() => {
    setTactic(''); setSteal(''); setPh(''); setPrNone(false); setPr(['', '', '']); setPitcher(''); setWalk('');
    setInfield(''); setPitchout(''); setDefOut(''); setDefIn(''); setOpen(''); setPtype(''); setPzone('');
  }, [pv.req?.n]);
  // 공을 이어서 굴린다: 공 사이 물음은 빈 선택(자동)으로 넘기고, 다음 타석(pa)은 타석 사이 물음에서, 지켜보기(watch)는 위기·승부처 타석에서 멈춘다.
  // 타석이 끝나면 한 번 더 쉰다 (기획안 2.2.2 속도). 멈췄다가 아무것도 고르지 않고 이어 가도 결과가 같다 (엔진 2 3.4)
  const prevPlays = useRef(pv.plays.length);
  useEffect(() => {
    if (!run) return;
    const r = pv.req;
    if (!r || (r.step !== 'pitch' && (run === 'pa' || isCrisis(r)))) { setRun(null); return; }
    const ended = pv.plays.length > prevPlays.current;
    prevPlays.current = pv.plays.length;
    const ms = Math.max(SPEED_MS[speed], 120) * (ended ? 2 : 1);
    const t = setTimeout(() => setPv(session.commandStep({}, 'pitch')), ms);
    return () => clearTimeout(t);
  }, [run, pv, session, speed]);
  // 경기 중 저장: 멈춰 있을 때 진행 중인 지휘 경기를 자동 저장한다 (굴리는 동안은 멈춘 뒤에)
  useEffect(() => {
    if (run || busy) return;
    const t = setTimeout(() => void autosave(), 800);
    return () => clearTimeout(t);
  }, [pv, run, busy, autosave]);
  // 중계는 늘 맨 아래(지금 공)를 보여 준다
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pv, density]);

  const s = session.season;
  const W = session.world;
  const name = (i: number) => W.players[i]?.name ?? '?';
  // 오늘 컨디션 낱말 (숫자 없음)
  const condOf = useCondition();
  const cond = (i: number) => (W.players[i] ? condOf(W.players[i]) : null);
  const teamName = (t: number) => session.teamInfo(t).name;
  const me = session.teamIdx;
  const req: CommandRequest | null = pv.req;
  const plays: Play[] = pv.plays;
  const ls = lineScoreUpTo(plays, plays.length);
  const innings = Math.max(9, ls.away.length, ls.home.length);
  const score = req ? { away: req.away, home: req.home } : pv.final ?? { away: 0, home: 0 };
  const outings = lastOutings(s, me, s.day);

  const avg = (i: number) => { const b = s.bat[i]; return rate3(b.ab ? b.h / b.ab : 0); };
  /** 오늘 기록 "2타수 1안타" (이 경기 중계에서) */
  const today = (i: number) => {
    let ab = 0;
    let h = 0;
    let pa = 0;
    for (const p of plays) {
      if (p.bat !== i || !PA_KINDS.has(p.kind)) continue;
      pa++;
      if (AT_BAT.has(p.kind)) ab++;
      if (isHit(p.kind)) h++;
    }
    return pa ? `오늘 ${ab}타수 ${h}안타` : '오늘 첫 타석';
  };
  /** 선발인가: 이 경기에서 교체로 들어온 적이 없다 */
  const isStarterNow = (i: number) => !plays.some((p) => p.kind === 'PC' && p.pit === i);
  const limitText = (i: number) => {
    const sk = W.players[i]?.pit;
    return sk ? `체력 약 ${shownPitchLimit(sk, isStarterNow(i), DEFAULT_PARAMS.pitchesPerPaDefault)}구` : '';
  };

  const choice = (): CommandChoice => {
    const c: CommandChoice = {};
    if (!req) return c;
    const pitch = req.step === 'pitch';
    if (req.side === 'bat') {
      if (req.step === 'run' || pitch) {
        if (steal) c.steal = steal;
      } else {
        if (tactic) c.tactic = tactic;
        if (ph === 'none') c.ph = -1;
        else if (ph) c.ph = Number(ph);
      }
      const b = pr.findIndex((x) => x);
      if (b >= 0) c.pr = { base: b as 0 | 1 | 2, idx: Number(pr[b]) };
      else if (prNone) c.pr = null;
    } else {
      if (pitcher === 'keep') c.keep = true;
      else if (pitcher) c.pitcher = Number(pitcher);
      if (tri(walk) !== undefined) c.walk = tri(walk);
      if (pitch && (ptype || pzone)) c.pitch = { ...(ptype ? { type: ptype } : {}), ...(pzone ? { zone: pzone } : {}) };
      if (!pitch) {
        if (infield) c.infield = infield;
        if (tri(pitchout) !== undefined) c.pitchout = tri(pitchout);
        if (defOut === 'none') c.def = null;
        else if (defOut && defIn) c.def = { out: Number(defOut), in: Number(defIn) };
      }
    }
    return c;
  };
  /** 고른 작전을 중계 한 줄로 ("작전: 도루 · 대타 김OO") */
  const noteOf = (c: CommandChoice): string => {
    const t: string[] = [];
    if (c.steal) t.push(c.steal === 'go' ? '도루' : c.steal === 'hnr' ? '히트앤드런' : '도루 안 함');
    if (c.tactic) t.push(c.tactic === 'bunt' ? '희생번트' : '강공');
    if (c.ph !== undefined) t.push(c.ph < 0 ? '대타 없음' : `대타 ${name(c.ph)}`);
    if (c.pr !== undefined) t.push(c.pr ? `대주자 ${name(c.pr.idx)} (${c.pr.base + 1}루)` : '대주자 없음');
    if (c.pitcher !== undefined) t.push(`투수 교체 ${name(c.pitcher)}`);
    if (c.keep) t.push('투수 계속');
    if (c.walk !== undefined) t.push(c.walk ? '고의4구' : '승부');
    if (c.infield) t.push(c.infield === 'in' ? '전진 수비' : '정상 수비');
    if (c.pitchout !== undefined) t.push(c.pitchout ? '피치아웃' : '피치아웃 안 함');
    if (c.def !== undefined) t.push(c.def ? `대수비 ${name(c.def.in)} (${name(c.def.out)} 대신)` : '대수비 없음');
    if (c.pitch) t.push([c.pitch.type, c.pitch.zone && ZONE_TEXT[c.pitch.zone]].filter(Boolean).join(' ') + ' 지시');
    return t.join(' · ');
  };
  /** 지금 물음에 고른 것을 넣고 mode대로 (고른 작전은 중계 줄에 남긴다). 한 걸음은 그날 경기를 처음부터 다시 돌려 10ms 안팎이다 */
  const step = (mode: PreviewMode) => {
    const c = choice();
    const text = noteOf(c);
    if (text) setNotes((n) => [...n, { at: plays.length, text }]);
    prevPlays.current = plays.length;
    setPv(session.commandStep(c, mode));
  };
  const nextPa = () => {
    if (speed === 'instant') { step('next'); return; }
    step('pitch');
    setRun('pa');
  };
  const watch = () => { step('pitch'); setRun('watch'); };
  /** 확정: 'A' 남은 판단을 감독에게 (공 단위 그대로), 'B' 지금 물음부터 계산으로 빠르게 */
  const finish = (how: 'A' | 'B') => {
    setRun(null);
    setBusy(true);
    session.commandFinish(how);
    onDone();
  };
  // 아무것도 진행하지 않았을 때만 그만둘 수 있다 (위기에서 끼어든 경기는 이미 진행 중). 그 뒤 닫으면 경기는 남는다 (잠시 닫기)
  const p = session.pendingGame;
  const canCancel = !p || (p.at === 0 && p.from === undefined);
  const close = () => {
    if (canCancel) session.commandClose();
    setRun(null);
    ref.current?.close();
  };
  // 키보드: Space = 다음 타석 (굴리는 중이면 멈춤). 입력 칸에 있을 때는 그대로
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
      e.preventDefault();
      if (run) setRun(null);
      else if (req && !busy) nextPa();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const usedBench = new Set([ph, ...pr].filter((x) => x && x !== 'none'));
  const benchOpts = (except: string) => req!.bench.filter((i) => !usedBench.has(String(i)) || String(i) === except);
  const canBunt = !!req && req.outs < 2 && req.bases.some((b) => b >= 0);
  const date = formatDate(W.year, s.day);
  // 더블헤더 날은 몇 차전인지 (지휘하지 않은 차전은 감독이 맡는다)
  const dhLabel = pv.dh ? ' · 더블헤더 2차전' : session.ourGamesToday().length > 1 ? ' · 더블헤더 1차전' : '';

  // 도루할 수 있는 주자 (engine rules.ts orderedSteal: 1루 주자·2루 빔이면 2루 도루, 2루 주자·3루 빔이면 3루 도루, 1·2루면 이중 도루)
  const [r1, r2, r3] = req?.bases ?? [-1, -1, -1];
  const canSteal = (r1 >= 0 && r2 < 0) || (r2 >= 0 && r3 < 0);
  const stealRunner = r1 >= 0 && r2 < 0 ? r1 : r2;
  const stealWhat = r1 >= 0 && r2 < 0 ? '2루 도루' : r1 >= 0 ? '이중 도루' : '3루 도루';
  const canHnr = !!req && r1 >= 0 && r2 < 0 && req.outs < 2;
  const canInfield = !!req && r3 >= 0 && req.outs < 2;
  const canPitchout = r1 >= 0 && r2 < 0;
  const count = req?.count ?? [0, 0];
  const ourBat = req?.side === 'bat';
  const order = req && ourBat ? req.lineup.indexOf(req.batter) : -1;
  const slot = req && order >= 0 ? (req.fieldSlots?.[order] ?? W.players[req.batter]?.pos) : req ? W.players[req.batter]?.pos : '';
  // 작전 판은 멈춰 있을 때만 (굴리는 중에는 감춘다)
  const showPanel = !!req && !run;
  const stepLabel = !req ? '' : req.step === 'pitch' ? `${ourBat ? '공격' : '수비'} · 공 사이 (멈춤)`
    : req.step === 'run' ? '공격 · 주자 작전 (투구 전)' : req.step === 'bat' ? '공격 · 타격 작전' : '수비 · 타석 전';
  const dots = (n: number, of: number, cls: string) => Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? `on ${cls}` : ''} />);

  // ---- 작전 판 부품
  /** 버튼 고르기 (자동이 맨 앞) */
  const seg = <T extends string>(label: string, v: T, set: (t: T) => void, opts: [T, string, boolean?][], note?: string) => (
    <div className="ops-row">
      <span className="ops-label">{label}</span>
      <div className="seg small" role="group" aria-label={label}>
        {opts.map(([k, l, off]) => (
          <button key={k} type="button" className={v === k ? 'on' : ''} aria-pressed={v === k} disabled={!!off} onClick={() => set(k)}>{l}</button>
        ))}
      </div>
      {note && <p className="muted small ops-note">{note}</p>}
    </div>
  );
  /** 후보 판 (▸): 고르면 그 선수, 다시 누르면 접힌다 */
  const cands = (key: 'ph' | 'pr' | 'pitcher' | 'def', label: string, picked: string, list: { idx: number; cols: string[] }[], head: string[], pick: (i: number) => void) => (
    <div className="ops-row">
      <button type="button" className="ghost ops-open" aria-expanded={open === key} onClick={() => setOpen((o) => (o === key ? '' : key))}>
        {label} ▸ {picked && <b>{picked}</b>}
      </button>
      {open === key && (list.length ? (
        <div className="scroll">
          <table className="cand-table small">
            <thead><tr><th className="l">이름</th>{head.map((h) => <th key={h}>{h}</th>)}<th>컨디션</th></tr></thead>
            <tbody>
              {list.map(({ idx, cols }) => (
                <tr key={idx} className="pick" tabIndex={0} onClick={() => { pick(idx); setOpen(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { pick(idx); setOpen(''); } }}>
                  <td className="l">{name(idx)}</td>{cols.map((c, k) => <td key={k}>{c}</td>)}<td><CondTag text={cond(idx)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted small">쓸 수 있는 선수가 없습니다.</p>)}
    </div>
  );
  const batCols = (i: number) => ({ idx: i, cols: [W.players[i]?.pos ?? '', avg(i), rate3(ops(s.bat[i])), String(s.bat[i].sb)] });
  const pitCols = (i: number) => {
    const o = outings.get(i);
    return { idx: i, cols: [W.players[i]?.throws === 'L' ? '좌' : '우', s.pit[i].outs ? fixed2((s.pit[i].er * 27) / s.pit[i].outs) : '-', o ? outingText(o, W.year) : '—'] };
  };

  const stealSeg = (opts: Steal[]) => seg('도루', steal, setSteal,
    opts.map((t) => [t, t === '' ? '자동' : t === 'go' ? stealWhat : t === 'hold' ? '안 함' : '히트앤드런', t === 'hnr' && !canHnr] as [Steal, string, boolean]),
    `${name(stealRunner)} 시즌 도루 ${s.bat[stealRunner]?.sb ?? 0} 실패 ${s.bat[stealRunner]?.cs ?? 0}. 히트앤드런은 1루 주자·2루 빔·2아웃 전`);
  const runnerOps = () => req!.bases.some((b) => b >= 0) && (
    <>
      {seg('대주자', prNone ? 'none' : pr.some((x) => x) ? 'pick' : '', (t) => { setPrNone(t === 'none'); if (t !== 'pick') setPr(['', '', '']); else setOpen('pr'); },
        [['', '자동'], ['none', '그대로'], ['pick', '고르기', !req!.bench.length]])}
      {(open === 'pr' || pr.some((x) => x)) && req!.bases.map((b, k) => b >= 0 && (
        <Fragment key={k}>
          {cands('pr', `${k + 1}루 ${name(b)} 대신`, pr[k] ? name(Number(pr[k])) : '', benchOpts(pr[k]).map(batCols), ['자리', '타율', 'OPS', '도루'],
            (i) => { setPrNone(false); setPr(() => { const y = ['', '', ''] as [string, string, string]; y[k] = String(i); return y; }); })}
        </Fragment>
      ))}
    </>
  );

  const opsPanel = req && (
    <section className={`cmd-ops${opsOpen ? ' open' : ''}`} aria-label="작전">
      <h3>작전 <span className="muted small">{stepLabel}</span></h3>
      {!showPanel ? <p className="muted small">공을 굴리는 중입니다. 멈춤을 누르면 다음 공 전에 멈추고 작전을 고를 수 있습니다.</p> : req.step === 'pitch' ? (
        ourBat ? (
          <>
            {canSteal && stealSeg(['', 'go', 'hnr'])}
            {runnerOps()}
            {!canSteal && !req.bases.some((b) => b >= 0) && <p className="muted small">공 사이 공격 작전은 주자가 있을 때만 (도루·히트앤드런·대주자). 그대로 두면 감독이 맡습니다.</p>}
          </>
        ) : (
          <>
            {cands('pitcher', '투수 바꾸기', pitcher && pitcher !== 'keep' ? name(Number(pitcher)) : '', req.bullpen.map(pitCols), ['손', '평균자책', '지난 등판'], (i) => setPitcher(String(i)))}
            {pitcher && <p className="small">지금 카운트({count[0]}-{count[1]})부터 {name(Number(pitcher))}이(가) 던집니다. <button type="button" className="link" onClick={() => setPitcher('')}>취소</button></p>}
            {seg('고의4구', walk, setWalk, [['', '자동'], ['yes', `${name(req.batter)} 내보내기`]])}
            {req.arsenal && req.arsenal.length > 0 && !walk && (
              <>
                {seg('구종', ptype, setPtype, [['', 'AI 포수'], ...req.arsenal.map((a): [string, string] => [a.type, `${a.type} ${shareText(a.share, req.arsenal!)}`])])}
                {seg('코스', pzone, setPzone, [['', 'AI 포수'], ...PITCH_ZONES.map((z): [PitchZone, string] => [z, ZONE_TEXT[z]])],
                  '이 공 하나만 지시합니다. 같은 구종·코스만 계속 고르면 타자가 노려 칩니다.')}
              </>
            )}
          </>
        )
      ) : ourBat ? (
        <>
          {req.step === 'run' ? (
            <>
              {stealSeg(['', 'go', 'hold', 'hnr'])}
              <p className="muted small">도루 결과를 본 뒤 같은 타석의 타격 작전(대타·강공·번트)을 따로 고릅니다.</p>
            </>
          ) : (
            <>
              {seg('타격', tactic, setTactic, [['', '자동'], ['swing', '강공'], ['bunt', '희생번트', !canBunt]], `번트는 2아웃 전 주자가 있을 때 (성공 ${Math.round(BUNT_SUCCESS * 100)}%).`)}
              {seg('대타', ph === '' || ph === 'none' ? ph : 'pick', (t) => { if (t === 'pick') setOpen('ph'); else setPh(t); },
                [['', '자동'], ['none', '그대로'], ['pick', '고르기', !req.bench.length]])}
              {(open === 'ph' || (ph && ph !== 'none')) && cands('ph', `${name(req.batter)} 대신`, ph && ph !== 'none' ? name(Number(ph)) : '', benchOpts(ph).map(batCols), ['자리', '타율', 'OPS', '도루'], (i) => setPh(String(i)))}
            </>
          )}
          {runnerOps()}
        </>
      ) : (
        <>
          {seg('투수', pitcher === '' || pitcher === 'keep' ? pitcher : 'pick', (t) => { if (t === 'pick') setOpen('pitcher'); else setPitcher(t); },
            [['', '자동'], ['keep', `${name(req.pitcher)} 계속`], ['pick', '바꾸기', !req.bullpen.length]])}
          {(open === 'pitcher' || (pitcher && pitcher !== 'keep')) && cands('pitcher', '구원 투수', pitcher && pitcher !== 'keep' ? name(Number(pitcher)) : '', req.bullpen.map(pitCols), ['손', '평균자책', '지난 등판'], (i) => setPitcher(String(i)))}
          {seg('고의4구', walk, setWalk, [['', '자동'], ['yes', '내보내기'], ['no', '승부']])}
          {canInfield && seg('전진 수비', infield, setInfield, [['', '자동'], ['in', '전진'], ['back', '정상']], '3루 주자 · 2아웃 전')}
          {canPitchout && seg('피치아웃', pitchout, setPitchout, [['', '자동'], ['yes', '피치아웃'], ['no', '안 함']], '1루 주자의 도루에 대비해 공 하나를 뺍니다 (투구 수 +1).')}
          {req.fieldBench && (
            <>
              {seg('대수비', defOut === '' || defOut === 'none' ? defOut : 'pick', (t) => { if (t === 'pick') setDefOut(String(req.lineup.find((_, k) => req.fieldSlots?.[k] !== 'DH') ?? '')); else { setDefOut(t); setDefIn(''); } },
                [['', '자동'], ['none', '그대로'], ['pick', '고르기', !req.fieldBench.length]])}
              {defOut && defOut !== 'none' && (
                <div className="ops-row">
                  <select value={defOut} aria-label="나갈 선수" onChange={(e) => { setDefOut(e.target.value); setDefIn(''); }}>
                    {req.lineup.map((i, k) => req.fieldSlots?.[k] !== 'DH' && <option key={i} value={i}>{req.fieldSlots?.[k] ?? ''} {name(i)} 대신</option>)}
                  </select>
                  {cands('def', '들어갈 선수', defIn ? name(Number(defIn)) : '', req.fieldBench.map((i) => ({ idx: i, cols: [W.players[i]?.pos ?? '', avg(i)] })), ['자리', '타율'], (i) => setDefIn(String(i)))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );

  // ---- 공 단위 중계: 반 이닝마다 묶고, 타석은 공 줄(상세, 또는 지금 타석) + 굵은 결과 줄
  const detail = density === 'full';
  const feed: JSX.Element[] = [];
  let half = '';
  const noteAt = (k: number) => notes.filter((n) => n.at === k).forEach((n, j) => feed.push(<li key={`n${k}-${j}`} className="cmd-note">작전: {n.text}</li>));
  plays.forEach((pl, k) => {
    const h = inningLabel(pl);
    if (h !== half) { half = h; feed.push(<li key={`h${k}`} className="cmd-half">{h}</li>); }
    noteAt(k);
    if (pl.seq && detail) {
      pitchCounts(pl.seq).forEach((x, j) => feed.push(
        <li key={`${k}-${j}`} className="cmd-pitch"><span>{j + 1}구 {pitchKind(pl.pt, pl.pz, j)}{PITCH_TEXT[x.code]}</span><span className="num muted">B{x.after[0]} S{x.after[1]}</span></li>,
      ));
    }
    const note = pitchNote(pl);
    feed.push(
      <li key={k} className={`cmd-pa kind-${pl.kind}${pl.runs > 0 ? ' scored' : ''}`}>
        {playText(pl, name)}{pl.runs > 0 && <span className="muted"> · {pl.away}:{pl.home}</span>}{note && <span className="muted"> · {note}</span>}
      </li>,
    );
  });
  if (req) {
    const h = inningLabel(req);
    if (h !== half) feed.push(<li key="hnow" className="cmd-half">{h}</li>);
    noteAt(plays.length);
    if (req.seq) {
      pitchCounts(req.seq).forEach((x, j) => feed.push(
        <li key={`now-${j}`} className="cmd-pitch now"><span>{j + 1}구 {pitchKind(req.pt, req.pz, j)}{PITCH_TEXT[x.code]}</span><span className="num muted">B{x.after[0]} S{x.after[1]}</span></li>,
      ));
    }
    feed.push(<li key="who" className="cmd-now muted small">타석 {name(req.batter)} · 투수 {name(req.pitcher)}</li>);
  }

  const progressed = !canCancel;
  return (
    <dialog ref={ref} className="player cast command tv" aria-label="직접 지휘"
      onCancel={(e) => { if (busy || run) e.preventDefault(); else if (canCancel) session.commandClose(); }}
      onClose={() => { setRun(null); onCancel(); }} style={teamVars(session.team.franchise, session.team.name)}>
      <div className="dialog-body cmd-body">
        <header className="row-between">
          <div>
            <h2>직접 지휘 · {teamName(pv.away)} <span className="muted">@</span> {teamName(pv.home)}</h2>
            <p className="muted small">{date}{dhLabel} · 공 단위로 치릅니다. 던진 공은 되돌릴 수 없고, 경기는 물음마다 자동 저장됩니다.{pv.from !== undefined ? ' 위기·승부처에서 끼어든 경기입니다 (그 전까지는 감독이 치렀습니다).' : ''}</p>
          </div>
          <span className="inline cmd-head-actions">
            {req && (
              <span className="cmd-finish">
                <button type="button" className="ghost" aria-expanded={finishMenu} disabled={busy} onClick={() => { setFinishMenu((o) => !o); setFinishAsk(null); }}>자동으로 끝내기 ▾</button>
                {finishMenu && (
                  <div className="cmd-finish-pop" role="dialog" aria-label="자동으로 끝내기">
                    {finishAsk ? (
                      <>
                        <p className="small">{finishAsk === 'A' ? '남은 경기를 AI 감독이 지휘합니다 (공 단위 그대로).' : '지금 공부터 남은 경기를 바로 계산해 끝냅니다 (공 단위 중계가 없습니다).'}</p>
                        <div className="actions">
                          <button type="button" onClick={() => finish(finishAsk)} disabled={busy}>확인</button>
                          <button type="button" className="ghost" onClick={() => setFinishAsk(null)}>취소</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <button type="button" className="ghost" onClick={() => setFinishAsk('A')}>AI 감독이 공 단위로 계속 <span className="muted small">(기본)</span></button>
                        <button type="button" className="ghost" onClick={() => setFinishAsk('B')}>빠르게 끝내기</button>
                      </>
                    )}
                  </div>
                )}
              </span>
            )}
            <button type="button" className="ghost" onClick={close} disabled={busy || !!run}
              title={progressed ? '경기는 저장된 채 남습니다. 홈의 다음 경기 카드나 결정함에서 이어서 지휘합니다' : '이 경기를 지휘하지 않고 닫습니다'}>{progressed ? '잠시 닫기' : '그만두기'}</button>
          </span>
        </header>

        {/* 점수판 (위에 고정) */}
        <div className="cmd-board" aria-live="polite">
          <div className="cmd-score">
            <span className={`cmd-team${pv.away === me ? ' me' : ''}`}>{teamName(pv.away)}</span>
            <strong className="num">{score.away}</strong><span className="muted">:</span><strong className="num">{score.home}</strong>
            <span className={`cmd-team${pv.home === me ? ' me' : ''}`}>{teamName(pv.home)}</span>
            {req && <span className="cmd-inn">{req.inn}회 {req.top ? '초' : '말'} · {req.outs}아웃</span>}
          </div>
          {req && (
            <div className="cmd-state">
              <span className="cmd-diamond" title={req.bases.map((b, k) => (b >= 0 ? `${k + 1}루 ${name(b)} (도루 ${s.bat[b]?.sb ?? 0})` : '')).filter(Boolean).join(', ') || '주자 없음'}>
                <Diamond play={{ ...(plays.at(-1) ?? {}), bases: req.bases, outs: req.outs } as Play} />
              </span>
              <div className="cmd-bso" aria-label={`볼 ${count[0]} 스트라이크 ${count[1]} 아웃 ${req.outs}`}>
                <span><b>B</b>{dots(count[0], 3, 'ball')}</span>
                <span><b>S</b>{dots(count[1], 2, 'strike')}</span>
                <span><b>O</b>{dots(req.outs, 2, 'out')}</span>
              </div>
              <div className="cmd-who small">
                <p>투수 <strong>{name(req.pitcher)}</strong> <span className="num">투구 수 {req.pitcherPitches}</span> <span className="muted">({limitText(req.pitcher)})</span> <CondTag text={cond(req.pitcher)} /></p>
                <p>타자 <strong>{name(req.batter)}</strong> <span className="muted">{order >= 0 ? `${order + 1}번 ` : ''}{slot} · {today(req.batter)} · 올해 {avg(req.batter)}</span> <CondTag text={cond(req.batter)} /></p>
                {detail && <p className="muted">{basesText(req.bases)}{req.bases.some((b) => b >= 0) ? ` (${req.bases.map((b, k) => (b >= 0 ? `${k + 1}루 ${name(b)}` : '')).filter(Boolean).join(', ')})` : ''} · 다음 타자 {name(req.onDeck)}</p>}
              </div>
            </div>
          )}
        </div>

        {detail && (
          <div className="scroll">
            <table className="linescore cast-score">
              <thead><tr><th className="l">팀</th>{Array.from({ length: innings }, (_, i) => <th key={i} className={req && req.inn === i + 1 ? 'now' : ''}>{i + 1}</th>)}<th>R</th></tr></thead>
              <tbody>
                {(['away', 'home'] as const).map((side) => {
                  const t = side === 'away' ? pv.away : pv.home;
                  return (
                    <tr key={side} className={t === me ? 'me' : ''}>
                      <td className="l">{teamName(t)}</td>
                      {Array.from({ length: innings }, (_, i) => <td key={i} className={ls[side][i] > 0 ? 'scored' : ''}>{ls[side][i] ?? ''}</td>)}
                      <td><strong>{score[side]}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="cmd-grid">
          <section className="cmd-feed-wrap" aria-label="공 단위 중계">
            <h3>공 단위 중계 {!detail && <span className="muted small">요약: 지금 타석만 공 줄 (상세에서 모든 공)</span>}</h3>
            <div className="cmd-feed" ref={feedRef}>
              {feed.length ? <ol className="plain small">{feed}</ol> : <p className="muted small">경기 시작 전</p>}
            </div>
          </section>
          {req ? opsPanel : (
            <section className="cmd-ops open note">
              {pv.rain && <p className="small">비로 경기가 중단됐습니다 ({pv.rain.inning}회 {pv.rain.kind === 'cold' ? '강우 콜드' : '노게임'}).{pv.rain.kind === 'nogame' ? ' 정식 경기(5회)가 되기 전이라 기록은 남지 않고 다른 날 다시 치릅니다.' : ''}</p>}
              <p><strong>{pv.rain?.kind === 'nogame' ? '노게임' : '경기 끝'}: {teamName(pv.away)} {score.away} : {score.home} {teamName(pv.home)}</strong></p>
              <p className="small muted">확정하면 이 결과로 오늘 경기가 진행됩니다. 확정하지 않고 하루를 진행해도 이 결과가 됩니다.</p>
              <div className="actions"><button type="button" onClick={() => finish('A')} disabled={busy}>경기 확정</button></div>
            </section>
          )}
        </div>

        {req && (
          <div className="cmd-controls">
            {run ? (
              <button type="button" className="go" onClick={() => setRun(null)}>멈춤 ❚❚</button>
            ) : (
              <>
                <button type="button" className="ghost" onClick={() => step('pitch')} disabled={busy} title="공 하나만 던지고 멈춥니다">다음 공</button>
                <button type="button" className="go" onClick={nextPa} disabled={busy} title="지금 작전 그대로 다음 타석 물음까지 (Space)">다음 타석 ▶</button>
                <button type="button" className="ghost mobile-ops" aria-expanded={opsOpen} onClick={() => setOpsOpen((o) => !o)}>작전</button>
              </>
            )}
            <label className="cmd-speed small">속도
              <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
                {(Object.keys(SPEED_MS) as Speed[]).map((k) => <option key={k} value={k}>{SPEED_LABEL[k]}</option>)}
              </select>
            </label>
            {!run && (
              <span className="cmd-skip">
                <button type="button" className="ghost small-btn" onClick={watch} disabled={busy} title="공을 이어 보여 주고, 멈춤을 누르거나 위기·승부처 타석이 오거나 경기가 끝나면 멈춥니다">계속 지켜보기</button>
                <button type="button" className="ghost small-btn" onClick={() => step('inning')} disabled={busy}>이번 반 이닝 자동</button>
                <button type="button" className="ghost small-btn" onClick={() => step('crisis')} disabled={busy} title="7회 이후 2점 차 안에서 득점권 주자가 있을 때만 묻습니다">위기 때만 묻기</button>
              </span>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
