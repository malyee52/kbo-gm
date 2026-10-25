// 선수 상세 (2026-10-23 UI 2단계 U2-2, 기획안 2.1): 데스크톱은 오른쪽에서 여는 넓은 판(뒤 목록이 보이고 눌러짐, 다른 선수를 누르면
// 판 내용만 바뀐다), 휴대폰은 전체 화면 (결정 3). 머리는 늘 보이고, 탭은 요약·능력·기록·계약·이력·투수 등판.
// 능력 탭 요약 모드는 능력치 숫자만, 관련 기록·변화·스카우트 메모는 상세 모드 (결정 2). 27세 이하 잠재는 범위 (결정 5, grades.ts).
// 능력치 v2 전이라 v1 등급(컨택·파워·선구안·주력·수비 / 구위·제구·장타 억제·체력)으로 같은 틀을 채운다.
// 기록: 게임에서 치른 시즌은 게임 기록, 게임 시작 전 시즌만 실제 기록 (시작 연도 실제 기록은 미리 보여주지 않는다).
// 2026-10-12 사용자: "실제 기록을 띄워주는 건 의미가 없다, 게임에서 있었던 기록을 표시해야 한다"
import { serviceName } from '../../league/careers';
import { ReleaseButton } from './Market';
import { postseasonLines, psFromRecord, psLineText } from '../../league/postseason';
import { futuresText } from './Roster';
import { futuresFromRecord, type FuturesLine } from '../../league/futures';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BatRow, PitRow } from '../../data/types';
import {
  absenceLabel, defenseAt, defenseGrade, emptyBatLine, emptyPitLine, FIELD_POS, isVirtual, lineTeam, playablePositions, type BatLine, type FieldPos, type PitLine, type SimPlayer,
} from '../../engine';
import { shortDate } from '../../game/calendar';
import { avg, era, fixed2, ipText, obp, ops, qualifiedOuts, qualifiedPa, rate3, slg, whip } from '../../game/stats';
import { dollarText } from '../../league/salary';
import { ForeignMark, HAND, POS_KO, posName, TeamLink, useGame, useWon } from '../context';
import { gradeAt } from '../../league/twoway';
import { teamVars } from '../teams';
import { seasonWar } from '../../league/awards';
import { allStarHistory } from '../../league/allstar';
import { babip, bbPct, fip, iso, kPct, leagueBase, pct1, pitBabip, pitBbPct, pitKPct, realLeagueBase, woba, wrcPlus, type LeagueBase } from '../../game/saber';
import { realSeasonParkFactor, seasonParkFactor, worldParkFactor } from '../../game/parkView';
import { DensityToggle, useShell } from '../shell';
import { leagueRank } from '../compare';
import { CondTag, DataTable, GradeBar, GuessGrade, ScoutNote, useCondition, useSeen, VsLeague } from '../parts';
import { guessMid, type GuessView } from '../../league/scout';
import type { Column } from '../table';
import { recentLines } from '../recent';
import type { GameSession } from '../../game/session';
import { addToCompare, addToDraft, COMPARE_MAX, deskOf, tradeBlockReason, updateDesk, useDesk } from '../tradeDesk';
import { WatchStar } from './Watch';

type Tab = 'sum' | 'abil' | 'rec' | 'deal' | 'pit';
const TABS: { key: Tab; label: string }[] = [
  { key: 'sum', label: '요약' }, { key: 'abil', label: '능력' }, { key: 'rec', label: '기록' }, { key: 'deal', label: '계약·이력' }, { key: 'pit', label: '투수 등판' },
];
const TAB_KEY = 'kbo-gm.player-tab';

function loadTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.key === v) ? (v as Tab) : 'sum';
  } catch {
    return 'sum';
  }
}

/** 리그 대비 표시를 붙이는 최소 표본 (이보다 적으면 표시하지 않는다, 임시값) */
const RANK_MIN_PA = 30;
const RANK_MIN_OUTS = 30;
/** 기록 표에서 흐리게 보이는 표본 (지난 시즌 포함, 임시값) */
const THIN_PA = 100;
const THIN_OUTS = 90;

export function PlayerDetail({ idx, onClose }: { idx: number; onClose: () => void }) {
  const { session, store, go } = useGame();
  const { density } = useShell();
  const full = density === 'full';
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const p = session.world.players[idx];
  const year = session.world.year;
  const [tab, setTabState] = useState<Tab>(loadTab);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* 기억하지 못해도 화면은 그대로 */ } };

  // 휴대폰은 전체 화면 모달, 넓은 화면은 모달이 아닌 판 (뒤 목록을 눌러 다른 선수로 바꿀 수 있다)
  const [narrow] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (narrow) d.showModal();
      else d.show();
    }
    const back = opener.current;
    // 판을 닫으면 연 단추로 초점을 되돌린다
    return () => { if (back instanceof HTMLElement && back.isConnected) back.focus(); };
  }, [narrow]);
  useEffect(() => {
    if (narrow) return;
    // 모달이 아닌 판은 Esc를 스스로 받는다 (다른 모달 창이 열려 있으면 그쪽이 먼저)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if ([...document.querySelectorAll('dialog[open]')].some((d) => d !== ref.current && d.matches(':modal'))) return;
      ref.current?.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [narrow]);

  const team = lineTeam(p);
  const pitchLog = useMemo(() => pitchingLog(session, p), [session, p, session.season.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const throws = p.isPitcher || session.season.pit[p.idx].bf > 0;
  const pitOpen = throws && team === session.teamIdx;
  const shownTab: Tab = tab === 'pit' && !throws ? 'sum' : tab;
  const close = () => ref.current?.close();

  return (
    <dialog ref={ref} className={`player tv${narrow ? '' : ' side'}`} style={team >= 0 ? teamVars(session.teamInfo(team).franchise, session.teamInfo(team).name) : undefined}
      onClose={onClose} onClick={(e) => { if (narrow && e.target === ref.current) close(); }} aria-labelledby="player-name">
      <div className="dialog-body">
        <header className="pd-head">
          <Head p={p} narrow={narrow} onClose={close} />
          <div className="pd-more"><HeadMore p={p} onClose={close} go={go} /></div>
          <div className="pd-tabs" role="tablist" aria-label="선수 상세">
            {TABS.filter((t) => t.key !== 'pit' || throws).map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={shownTab === t.key}
                title={t.key === 'pit' && !pitOpen ? '우리 구단 경기 기록만 있습니다' : undefined}
                onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
            {/* 요약/상세: 판 안에서도 바꾼다 (틀의 단추는 좁은 화면에서 숨는다) */}
            <span className="pd-density"><DensityToggle /></span>
          </div>
        </header>
        <div role="tabpanel" key={`${p.idx}:${shownTab}`}>
          {shownTab === 'sum' && <SummaryTab p={p} full={full} narrow={narrow} onClose={close} />}
          {shownTab === 'abil' && <AbilityTab p={p} full={full} />}
          {shownTab === 'rec' && <RecordTab p={p} full={full} store={store} />}
          {shownTab === 'deal' && <><ContractInfo id={p.id} /><CareerInfo p={p} /></>}
          {shownTab === 'pit' && (pitOpen ? <PitchingTab rows={pitchLog} full={full} /> : <p className="muted small">우리 구단 경기 기록만 있습니다 (다른 구단 경기는 박스스코어를 남기지 않는다).</p>)}
        </div>
        {year !== session.year && <p className="muted small">오프시즌: 기록은 {year} 시즌 기준입니다.</p>}
      </div>
    </dialog>
  );
}

// ---- 머리 (탭과 상관없이 늘 보임)

function Head({ p, narrow, onClose }: { p: SimPlayer; narrow: boolean; onClose: () => void }) {
  const { session, store } = useGame();
  const year = session.world.year;
  const mine = p.teamIdx === session.teamIdx;
  const registered = session.registered().some((x) => x.idx === p.idx);
  const back = session.returnDay(p);
  const master = store.players.get(p.id);
  const lp = session.leaguePlayer(p.id);
  const cond = useCondition()(p);
  const pos = p.isPitcher ? `P${p.underhand ? ' · 언더·사이드' : ''}` : [posName(p.pos), ...playablePositions(p.bat).filter((q) => q !== p.pos).slice(0, 2)].join(' · ');
  const hand = `${p.throws ? HAND[p.throws] : '-'}투${p.bats ? HAND[p.bats] : '-'}타`;
  return (
    <>
      <div className="row-between">
        <div>
          <h2 id="player-name">{p.name}<ForeignMark p={p} long /></h2>
          <p className="pd-line small">
            <TeamLink idx={p.teamIdx} />{p.teamIdx < 0 && p.formerTeam !== undefined && <span className="muted">(전 {session.teamInfo(p.formerTeam).name}, 방출)</span>}
            <span title={p.isPitcher ? '투수' : POS_KO[p.pos ?? ''] ?? undefined}>{pos}</span>
            <span>{p.age !== null ? `${p.ageEstimated ? '약 ' : ''}${p.age}세` : '나이 미상'}</span>
            <span>{hand}</span>
            {!narrow && master?.entryYear ? <span className="muted">{master.entryYear}년 입단</span> : null}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose} aria-label="닫기">{narrow ? '← 닫기' : '닫기 ×'}</button>
      </div>
      <p className="pd-line small">
        <span>{mine ? (p.dev ? '육성선수' : registered ? '1군' : '2군') : p.teamIdx < 0 ? '시장 (영입은 선수단 → 선수 시장)' : '다른 구단'}</span>
        {back !== null && (
          <span className="status out">{session.absenceReason(p)} · {back >= session.season.schedule.length ? '이번 시즌 복귀 어려움' : `${shortDate(year, back)} 복귀 예정`}</span>
        )}
        {back === null && <CondTag text={cond} label />}
        {lp?.military?.state === 'homeOnly' && <span className="tag">방위병 복무 (홈경기만)</span>}
      </p>
    </>
  );
}

/** 스카우트 보고·계약 한 줄과 단추. 넓은 화면은 머리에, 휴대폰은 요약 탭 맨 위에 (종합·잠재는 보이지 않는다, 능력치 v2 17.6) */
function HeadMore({ p, onClose, go }: { p: SimPlayer; onClose: () => void; go: ReturnType<typeof useGame>['go'] }) {
  const { session, changed } = useGame();
  const won = useWon();
  const lp = session.leaguePlayer(p.id);
  const mine = p.teamIdx === session.teamIdx;
  const registered = session.registered().some((x) => x.idx === p.idx);
  const note = session.scoutPhrase(p.id);
  const c = lp?.contract;
  const tradeBlock = tradeBlockReason(session, p);
  const move = () => { session.move(p, !registered); changed(); };
  // 트레이드 작업대와 같은 비교 칸·제안판 (ui/tradeDesk.ts)
  const desk = useDesk(session);
  const [deskNote, setDeskNote] = useState<string | null>(null);
  useEffect(() => setDeskNote(null), [p.idx]);
  const inCompare = desk.compare.includes(p.idx);
  const toCompare = () => setDeskNote(addToCompare(session, p.idx) ?? `비교 칸에 넣었습니다 (${deskOf(session).compare.length}/${COMPARE_MAX}).`);
  const toDraft = () => {
    const err = addToDraft(session, p);
    if (err) { setDeskNote(err); return; }
    updateDesk(session, () => ({ mode: 'deal', step: 'offer' }));
    go('trade');
    onClose();
  };
  return (
    <>
      <p className="pd-line small">
        {note && <span title="앞으로 클 여지에 대한 우리 스카우트 팀의 평 (틀릴 수 있다)">스카우트 보고: <b>{note}</b></span>}
        {c && <span>연봉 {c.kind === 'foreign' ? dollarText(c.salary) : won(c.salary)} · {c.until}년까지</span>}
      </p>
      <div className="pd-line">
        {!mine && <WatchStar id={p.id} name={p.name} small />}
        {mine && <button type="button" className="ghost small-btn" onClick={() => { go('lineup'); onClose(); }}>기용 보드에서 보기</button>}
        {mine && session.canManage && <button type="button" className="ghost small-btn" onClick={move}>{registered ? '2군으로 내리기' : '1군에 등록하기'}</button>}
        {mine && session.phase === 'season' && !session.done && <ReleaseButton p={p} onDone={onClose} />}
        {!mine && p.teamIdx >= 0 && (
          <button type="button" className="ghost small-btn" disabled={!!tradeBlock} title={tradeBlock ?? undefined} onClick={toDraft}>트레이드에 넣기</button>
        )}
        {p.teamIdx >= 0 && (
          inCompare
            ? <button type="button" className="ghost small-btn" onClick={() => { updateDesk(session, () => ({ mode: 'deal', step: 'compare' })); go('trade'); onClose(); }}>비교 보기 ({desk.compare.length}/{COMPARE_MAX})</button>
            : <button type="button" className="ghost small-btn" onClick={toCompare}>비교에 넣기</button>
        )}
        {!mine && tradeBlock && p.teamIdx >= 0 && <span className="muted small">{tradeBlock}</span>}
      </div>
      {deskNote && <p className="muted small" role="status">{deskNote}</p>}
    </>
  );
}

// ---- 리그 대비 (그 해 리그, 규정 이상 선수)

/** 그 해 리그 대비 (규정 이상 선수). 트레이드 비교 칸도 같은 기준을 쓴다 (screens/Trade.tsx) */
export function useLeague() {
  const { session, version } = useGame();
  return useMemo(() => {
    const s = session.season;
    const bats: BatLine[] = [];
    const pits: PitLine[] = [];
    for (const q of session.world.players) {
      const t = s.teams[lineTeam(q)];
      if (!t) continue;
      if (s.bat[q.idx].pa > 0 && s.bat[q.idx].pa >= qualifiedPa(t.g)) bats.push(s.bat[q.idx]);
      if (s.pit[q.idx].outs > 0 && s.pit[q.idx].outs >= qualifiedOuts(t.g)) pits.push(s.pit[q.idx]);
    }
    return {
      bat: (v: number, pick: (l: BatLine) => number, hb = true) => leagueRank(v, bats.map(pick), hb),
      pit: (v: number, pick: (l: PitLine) => number, hb = true) => leagueRank(v, pits.map(pick), hb),
      base: leagueBase(s.bat, s.pit),
      total: { bat: sumLines(s.bat), pit: sumLines(s.pit) },
    };
  }, [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** 리그 합계 줄 (리그 평균 비율 기록용) */
function sumLines<L extends BatLine | PitLine>(lines: L[]): L {
  const t = { ...lines[0] } as Record<string, number>;
  for (const k of Object.keys(t)) t[k] = 0;
  for (const l of lines) for (const k of Object.keys(t)) t[k] += (l as unknown as Record<string, number>)[k];
  return t as unknown as L;
}

/** 기록 한 칸: 이름 + 값 + 리그 대비 */
function Rec({ label, v, rank, full }: { label: string; v: ReactNode; rank?: number | null; full: boolean }) {
  return <li><b>{label}</b>{v}{rank !== undefined && <VsLeague rank={rank} full={full} />}</li>;
}

// ---- 탭 1: 요약

function SummaryTab({ p, full, narrow, onClose }: { p: SimPlayer; full: boolean; narrow: boolean; onClose: () => void }) {
  const { session, go, version } = useGame();
  const seen = useSeen();
  const lg = useLeague();
  const s = session.season;
  const g = (k: string) => seen.grade(p.id, k);
  const recent = useMemo(() => (p.teamIdx === session.teamIdx ? recentLines(session, 10).get(p.idx) : undefined), [session, version, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const war = session.phase === 'season' ? seasonWar(session.world, s).get(p.idx) : undefined;
  // 갈래 등급은 우리 스카우트 팀의 추측 (능력치 v2 17.7): 범위 막대, 가장 나은·아쉬운 능력도 가운데값으로
  const core: { label: string; v: GuessView | null }[] = p.isPitcher && g('stuff')
    ? [{ label: '구위', v: g('stuff') }, { label: '제구', v: g('control') }, { label: '장타 억제', v: g('hrSuppression') }, { label: '선발 체력', v: g('stamina') }, { label: '구원 체력', v: g('reliefStamina') }]
    : g('contact') ? [{ label: '컨택', v: g('contact') }, { label: '파워', v: g('power') }, { label: '선구안', v: g('eye') }, { label: '주력', v: g('speed') }] : [];
  const mainPos = FIELD_POS.find((q) => q === p.pos);
  if (!p.isPitcher && mainPos) core.push({ label: `${posName(mainPos)} 수비`, v: seen.grade(p.id, 'defense', defenseGrade(defenseAt(p, mainPos))) });
  const ranked = core.filter((c): c is { label: string; v: GuessView } => c.v !== null).map((c) => ({ label: c.label, m: guessMid(c.v) }));
  const best = [...ranked].sort((a, b) => b.m - a.m)[0];
  const worst = [...ranked].sort((a, b) => a.m - b.m)[0];
  const b = s.bat[p.idx];
  const q = s.pit[p.idx];
  const pitView = p.isPitcher || (q.bf > 0 && b.pa === 0);
  return (
    <>
      {narrow && <section className="pd-more-m"><HeadMore p={p} onClose={onClose} go={go} /></section>}
      {best && worst && best.m !== worst.m && <p className="small">가장 나은 능력은 <b>{best.label}</b>, 가장 아쉬운 능력은 <b>{worst.label}</b>입니다.</p>}
      <div className="pd-split">
        <section>
          <h3>핵심 능력 <span className="muted small">20~80, 50이 리그 주전 평균 (2승 선수) · 스카우트 추측</span></h3>
          <div className="grades">{core.map((c) => <GradeBar key={c.label} label={c.label} v={c.v} />)}</div>
        </section>
        <section>
          <h3>{session.world.year} 기록 <span className="muted small">1군{war !== undefined ? ` · WAR ${war.toFixed(1)}` : ''}</span></h3>
          {pitView ? (
            q.bf === 0 ? <p className="muted small">아직 등판하지 않았습니다.</p> : (
              <ul className="pd-recs">
                <Rec label="경기" v={`${q.g} (선발 ${q.gs})`} full={full} />
                <Rec label="평균자책" v={fixed2(era(q))} rank={q.outs >= RANK_MIN_OUTS ? lg.pit(era(q), era, false) : undefined} full={full} />
                <Rec label="이닝" v={ipText(q.outs)} full={full} />
                <Rec label="탈삼진" v={q.so} rank={q.outs >= RANK_MIN_OUTS ? lg.pit(pitKPct(q), pitKPct) : undefined} full={full} />
                <Rec label="WHIP" v={fixed2(whip(q))} rank={q.outs >= RANK_MIN_OUTS ? lg.pit(whip(q), whip, false) : undefined} full={full} />
                <Rec label="승패" v={`${q.w}승 ${q.l}패${q.sv ? ` ${q.sv}세` : ''}${q.hld ? ` ${q.hld}홀드` : ''}`} full={full} />
                {full && <Rec label="FIP" v={fixed2(fip(q, lg.base))} full={full} />}
              </ul>
            )
          ) : b.pa === 0 ? <p className="muted small">아직 타석에 서지 않았습니다.</p> : (
            <ul className="pd-recs">
              <Rec label="경기" v={`${b.g} · ${b.pa}타석`} full={full} />
              <Rec label="타율" v={rate3(avg(b))} rank={b.pa >= RANK_MIN_PA ? lg.bat(avg(b), avg) : undefined} full={full} />
              <Rec label="출루율" v={rate3(obp(b))} rank={b.pa >= RANK_MIN_PA ? lg.bat(obp(b), obp) : undefined} full={full} />
              <Rec label="홈런" v={b.hr} rank={b.pa >= RANK_MIN_PA ? lg.bat(b.hr / b.pa, (l) => l.hr / l.pa) : undefined} full={full} />
              <Rec label="OPS" v={rate3(ops(b))} rank={b.pa >= RANK_MIN_PA ? lg.bat(ops(b), ops) : undefined} full={full} />
              {full && <Rec label="wRC+" v={Math.round(wrcPlus(b, lg.base, worldParkFactor(session.world, p.teamIdx, lg.base.runsPerPa)))} full={full} />}
            </ul>
          )}
          {recent && <p className="small">최근 10경기: {recent}</p>}
          {(b.pa > 0 || q.bf > 0) && (
            <p className="muted small">
              {full ? '상위 N% = 그 해 규정 이상 선수 가운데 자리' : '▲▼ = 그 해 규정 이상 선수 가운데 위·아래 40%'}
              {(pitView ? q.outs < RANK_MIN_OUTS : b.pa < RANK_MIN_PA) ? ' (표본이 적어 아직 표시하지 않음)' : ''}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

// ---- 탭 2: 능력

function AbilityTab({ p, full }: { p: SimPlayer; full: boolean }) {
  const { session } = useGame();
  const seen = useSeen();
  const lg = useLeague();
  const year = session.world.year;
  const g = (k: string) => seen.grade(p.id, k);
  const note = session.scoutPhrase(p.id);
  const b = session.season.bat[p.idx];
  const q = session.season.pit[p.idx];
  const bOk = b.pa >= RANK_MIN_PA;
  const pOk = q.outs >= RANK_MIN_OUTS;
  // 관련 결과 기록 (상세에서만): 그 능력과 가장 가까운 기록 + 리그 대비
  const rec = (ok: boolean, text: string, rank: number | null): ReactNode => (ok ? <>{text} <VsLeague rank={rank} full /></> : '기록 표본 적음');
  const hr9 = (l: PitLine) => (l.outs ? (l.hr * 27) / l.outs : NaN);
  return (
    <section>
      <h3>능력치 <span className="muted small">20~80, 50이 리그 주전 평균 (2승 선수)</span></h3>
      {full && (
        <p className="pd-line small">
          {note && <span>스카우트 보고: {note}</span>}
          <span className="muted">능력은 우리 스카우트 팀의 추측 범위입니다. 기록이 쌓일수록, 우리 구단에서 오래 뛸수록, 스카우트 투자를 늘릴수록 좁아집니다.</span>
        </p>
      )}
      {p.isPitcher && g('stuff') ? (
        <>
          <div className="pd-group">
            <h4>공</h4>
            <div className="grades">
              <GradeBar label="구위" v={g('stuff')} note={full ? rec(pOk, `K% ${pct1(pitKPct(q))}`, lg.pit(pitKPct(q), pitKPct)) : undefined} />
              <GradeBar label="제구" v={g('control')} note={full ? rec(pOk, `BB% ${pct1(pitBbPct(q))}`, lg.pit(pitBbPct(q), pitBbPct, false)) : undefined} />
              <GradeBar label="장타 억제" v={g('hrSuppression')} note={full ? rec(pOk, `9이닝당 피홈런 ${fixed2(hr9(q))}`, lg.pit(hr9(q), hr9, false)) : undefined} />
            </div>
          </div>
          <div className="pd-group">
            <h4>체력</h4>
            <div className="grades">
              <GradeBar label="선발 체력" v={g('stamina')} note={full ? (q.gs ? `선발 ${q.gs}경기` : '선발 기록 없음') : undefined} />
              <GradeBar label="구원 체력" v={g('reliefStamina')} note={full ? (q.g - q.gs > 0 ? `구원 ${q.g - q.gs}경기` : '구원 기록 없음') : undefined} />
            </div>
          </div>
        </>
      ) : g('contact') ? (
        <>
          <div className="pd-group">
            <h4>타석에서</h4>
            <div className="grades">
              <GradeBar label="선구안" v={g('eye')} note={full ? rec(bOk, `BB% ${pct1(bbPct(b))}`, lg.bat(bbPct(b), bbPct)) : undefined} />
            </div>
          </div>
          <div className="pd-group">
            <h4>타구</h4>
            <div className="grades">
              <GradeBar label="컨택" v={g('contact')} note={full ? rec(bOk, `K% ${pct1(kPct(b))} · BABIP ${rate3(babip(b))}`, lg.bat(kPct(b), kPct, false)) : undefined} />
              <GradeBar label="파워" v={g('power')} note={full ? rec(bOk, `ISO ${rate3(iso(b))}`, lg.bat(iso(b), iso)) : undefined} />
            </div>
          </div>
          <div className="pd-group">
            <h4>주루</h4>
            <div className="grades">
              <GradeBar label="주력" v={g('speed')} note={full ? (b.pa > 0 ? `도루 ${b.sb} · 3루타 ${b.t}` : '기록 없음') : undefined} />
            </div>
          </div>
        </>
      ) : <p className="muted small">능력 자료가 없습니다.</p>}
      {!p.isPitcher && <DefenseInfo p={p} full={full} />}
      <TwoWayInfo p={p} full={full} />
      {p.debutEstimate && <p className="note small">직전 기록이 없어 {year}년 기록을 크게 보정해 능력을 추정한 선수입니다 (잠재력 모델 도입 전 임시 처리).</p>}
      {full && <ScoutNote notes={[]} full />}
    </section>
  );
}


// ---- 탭 3: 기록

type BatLike = { g: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; rbi: number; r: number; bb: number; hbp: number; so: number; sb: number; sf: number };
type PitLike = { g: number; gs: number; w: number; l: number; sv: number; outs: number; h: number; hr: number; bb: number; so: number; er: number; hld?: number; qs?: number; bsv?: number; bf?: number; hbp?: number; np?: number };
// pf = 그 시즌 소속 구단의 시즌 구장 계수 (구장효과 기획안 P2, game/parkView.ts). 타격 줄만 쓴다
type RecRow<L> = { key: string; label: string; real: boolean; l: L; lg: LeagueBase | null; pf?: number };

function batFromRow(r: BatRow): BatLike {
  return { g: r.g, pa: r.pa, ab: r.ab, h: r.h, d: r.d, t: r.t, hr: r.hr, rbi: r.rbi, r: r.r, bb: r.bb ?? 0, hbp: r.hbp ?? 0, so: r.so ?? 0, sb: r.sb ?? 0, sf: r.sf ?? 0 };
}

function pitFromRow(r: PitRow): PitLike {
  return { g: r.g, gs: r.gs ?? 0, w: r.w, l: r.l, sv: r.sv, outs: r.outs, h: r.h, hr: r.hr, bb: r.bb, so: r.so, er: r.er, hld: r.hld ?? undefined, bf: r.tbf, hbp: r.hbp ?? 0 };
}

const bx = (l: BatLike) => ({ ...l, cs: 0, gdp: 0, sac: 0 });
const px = (l: PitLike) => ({ ...l, bf: l.bf ?? 0, hbp: l.hbp ?? 0, r: 0, hld: l.hld ?? 0, qs: l.qs ?? 0, bsv: l.bsv ?? 0, np: 0 });

// ---- 세이버 지표 (2026-10-22, 기획안 2.8): 실제 기록도 게임 기록도 같은 식(game/saber.ts)으로 직접 계산한다. 리그 상수는 그 해 리그 기록
const SABER_TIP = {
  wrc: 'wRC+: 득점 생산력. 100이 그 해 리그 평균, 120이면 평균보다 20% 더 낸다 (구장 보정: 타자 구장에서 낸 기록은 깎고 투수 구장은 올린다. 칸에 마우스를 올리면 보정 전 → 후)',
  woba: 'wOBA: 볼넷·안타 종류마다 득점 가치를 매긴 출루율 꼴 지표',
  iso: 'ISO: 순장타율 (장타율 - 타율)',
  babip: 'BABIP: 인플레이 타구 타율 (홈런·삼진 제외). 크게 높거나 낮으면 운이 섞였을 수 있다',
  bb: 'BB%: 타석당 볼넷',
  k: 'K%: 타석당 삼진',
  fip: 'FIP: 수비와 운을 뺀 평균자책. 삼진·볼넷·사구·홈런만으로 계산 (그 해 리그 평균자책에 맞춘 상수)',
  eraFip: 'ERA-FIP: 크면 수비·운 덕을 덜 본 것 (다음 해 평균자책이 나아지기 쉽다)',
  pk: 'K%: 상대 타자당 삼진',
  pb: 'BB%: 상대 타자당 볼넷',
  pbabip: '피BABIP: 인플레이 타구 피안타율 (희생타 기록이 없어 근사값)',
} as const;

const fin = (x: number) => (Number.isFinite(x) ? x : null);
const seasonCell = (r: RecRow<unknown>) => <>{r.label}{r.real && <span className="tag" title="게임 시작 전 실제 기록">실제</span>}</>;

const BAT_COLS: Column<RecRow<BatLike>>[] = [
  { key: 'season', label: '시즌', value: (r) => r.key, fixed: true, text: true, cell: seasonCell },
  { key: 'g', label: '경기', value: (r) => r.l.g, group: '기본', brief: true },
  { key: 'pa', label: '타석', value: (r) => r.l.pa, group: '기본', brief: true },
  { key: 'avg', label: '타율', value: (r) => fin(avg(bx(r.l))), cell: (r) => rate3(avg(bx(r.l))), group: '기본', brief: true },
  { key: 'obp', label: '출루율', value: (r) => fin(obp(bx(r.l))), cell: (r) => rate3(obp(bx(r.l))), group: '기본', brief: true },
  { key: 'slg', label: '장타율', value: (r) => fin(slg(bx(r.l))), cell: (r) => rate3(slg(bx(r.l))), group: '기본' },
  { key: 'ops', label: 'OPS', value: (r) => fin(ops(bx(r.l))), cell: (r) => rate3(ops(bx(r.l))), group: '기본', brief: true },
  { key: 'h', label: '안타', value: (r) => r.l.h, group: '기본' },
  { key: 'hr', label: '홈런', value: (r) => r.l.hr, group: '기본', brief: true },
  { key: 'rbi', label: '타점', value: (r) => r.l.rbi, group: '기본', brief: true },
  { key: 'r', label: '득점', value: (r) => r.l.r, group: '기본' },
  { key: 'bb', label: '볼넷', value: (r) => r.l.bb, group: '기본' },
  { key: 'so', label: '삼진', value: (r) => r.l.so, group: '기본', lower: true },
  { key: 'sb', label: '도루', value: (r) => r.l.sb, group: '기본' },
  {
    key: 'wrc', label: 'wRC+', title: SABER_TIP.wrc, group: '세이버',
    value: (r) => (r.lg ? fin(Math.round(wrcPlus(bx(r.l), r.lg, r.pf ?? 1))) : null),
    cell: (r) => {
      const w = r.lg ? wrcPlus(bx(r.l), r.lg, r.pf ?? 1) : NaN;
      if (!Number.isFinite(w)) return '-';
      const pf = r.pf ?? 1;
      return <span title={pf !== 1 ? `구장 보정 전 ${Math.round(wrcPlus(bx(r.l), r.lg!))} → 후 ${Math.round(w)} (시즌 구장 계수 ${pf.toFixed(3)})` : undefined}>{Math.round(w)}</span>;
    },
  },
  { key: 'woba', label: 'wOBA', title: SABER_TIP.woba, value: (r) => fin(woba(bx(r.l))), cell: (r) => rate3(woba(bx(r.l))), group: '세이버' },
  { key: 'iso', label: 'ISO', title: SABER_TIP.iso, value: (r) => fin(iso(bx(r.l))), cell: (r) => rate3(iso(bx(r.l))), group: '세이버' },
  { key: 'babip', label: 'BABIP', title: SABER_TIP.babip, value: (r) => fin(babip(bx(r.l))), cell: (r) => rate3(babip(bx(r.l))), group: '세이버' },
  { key: 'bbp', label: 'BB%', title: SABER_TIP.bb, value: (r) => fin(bbPct(bx(r.l))), cell: (r) => pct1(bbPct(bx(r.l))), group: '세이버' },
  { key: 'kp', label: 'K%', title: SABER_TIP.k, value: (r) => fin(kPct(bx(r.l))), cell: (r) => pct1(kPct(bx(r.l))), group: '세이버', lower: true },
];

const pfip = (r: RecRow<PitLike>) => (r.lg ? fin(fip(px(r.l), r.lg)) : null);
const PIT_COLS: Column<RecRow<PitLike>>[] = [
  { key: 'season', label: '시즌', value: (r) => r.key, fixed: true, text: true, cell: seasonCell },
  { key: 'g', label: '경기', value: (r) => r.l.g, group: '기본', brief: true },
  { key: 'gs', label: '선발', value: (r) => r.l.gs, group: '기본' },
  { key: 'w', label: '승', value: (r) => r.l.w, group: '기본', brief: true },
  { key: 'l', label: '패', value: (r) => r.l.l, group: '기본', brief: true, lower: true },
  { key: 'sv', label: '세이브', value: (r) => r.l.sv, group: '기본', brief: true },
  { key: 'hld', label: '홀드', value: (r) => r.l.hld ?? null, group: '기본' },
  { key: 'qs', label: 'QS', title: '퀄리티 스타트: 선발로 6이닝 이상 던지고 3자책 이하', value: (r) => r.l.qs ?? null, group: '기본' },
  { key: 'bsv', label: '블론', title: '블론 세이브: 1~3점 리드에 나와 동점·역전을 허용', value: (r) => r.l.bsv ?? null, group: '기본', lower: true },
  { key: 'ip', label: '이닝', value: (r) => r.l.outs, cell: (r) => ipText(r.l.outs), group: '기본', brief: true },
  { key: 'era', label: '평균자책', value: (r) => fin(era(px(r.l))), cell: (r) => fixed2(era(px(r.l))), group: '기본', brief: true, lower: true },
  { key: 'whip', label: 'WHIP', value: (r) => fin(whip(px(r.l))), cell: (r) => fixed2(whip(px(r.l))), group: '기본', lower: true },
  { key: 'h', label: '피안타', value: (r) => r.l.h, group: '기본', lower: true },
  { key: 'hr', label: '피홈런', value: (r) => r.l.hr, group: '기본', lower: true },
  { key: 'bb', label: '볼넷', value: (r) => r.l.bb, group: '기본', lower: true },
  { key: 'so', label: '탈삼진', value: (r) => r.l.so, group: '기본', brief: true },
  { key: 'fip', label: 'FIP', title: SABER_TIP.fip, value: pfip, cell: (r) => { const f = pfip(r); return f === null ? '-' : fixed2(f); }, group: '세이버', lower: true },
  {
    key: 'erafip', label: 'ERA-FIP', title: SABER_TIP.eraFip, group: '세이버',
    value: (r) => { const f = pfip(r); return f === null ? null : era(px(r.l)) - f; },
    cell: (r) => { const f = pfip(r); return f === null ? '-' : fixed2(era(px(r.l)) - f); },
  },
  { key: 'pk', label: 'K%', title: SABER_TIP.pk, value: (r) => (r.l.bf ? pitKPct(px(r.l)) : null), cell: (r) => (r.l.bf ? pct1(pitKPct(px(r.l))) : '-'), group: '세이버' },
  { key: 'pb', label: 'BB%', title: SABER_TIP.pb, value: (r) => (r.l.bf ? pitBbPct(px(r.l)) : null), cell: (r) => (r.l.bf ? pct1(pitBbPct(px(r.l))) : '-'), group: '세이버', lower: true },
  { key: 'pbabip', label: '피BABIP', title: SABER_TIP.pbabip, value: (r) => (r.l.bf ? pitBabip(px(r.l)) : null), cell: (r) => (r.l.bf ? rate3(pitBabip(px(r.l))) : '-'), group: '세이버', lower: true },
  // 투구 수 묶음 (2026-10-23 U2-3): 게임 안 시즌만 (실제 기록·투구 수를 세기 전 저장은 —). 경기당은 선발·구원이 섞인 값
  { key: 'np', label: '투구 수', value: (r) => r.l.np || null, cell: (r) => (r.l.np ? String(r.l.np) : '—'), group: '투구 수' },
  { key: 'npg', label: '경기당', title: '경기당 투구 수 (선발·구원 등판을 함께 센다)', value: (r) => (r.l.np && r.l.g ? r.l.np / r.l.g : null), cell: (r) => (r.l.np && r.l.g ? (r.l.np / r.l.g).toFixed(1) : '—'), group: '투구 수', lower: true },
  { key: 'npip', label: '이닝당', title: '이닝당 투구 수 (적을수록 공을 아낀다)', value: (r) => (r.l.np && r.l.outs ? (r.l.np * 3) / r.l.outs : null), cell: (r) => (r.l.np && r.l.outs ? ((r.l.np * 3) / r.l.outs).toFixed(1) : '—'), group: '투구 수', lower: true },
  { key: 'npbf', label: '타자당', title: '상대 타자당 투구 수', value: (r) => (r.l.np && r.l.bf ? r.l.np / r.l.bf : null), cell: (r) => (r.l.np && r.l.bf ? (r.l.np / r.l.bf).toFixed(2) : '—'), group: '투구 수', lower: true },
];

function RecordTab({ p, full, store }: { p: SimPlayer; full: boolean; store: ReturnType<typeof useGame>['store'] }) {
  const { session } = useGame();
  const lg = useLeague();
  const [part, setPart] = useState<'one' | 'fut' | 'ps'>('one');
  const year = session.world.year;
  const lp = session.leaguePlayer(p.id);
  const start = session.league.startYear;
  const decode = <T extends object>(empty: T, arr: number[]): T => Object.fromEntries(Object.keys(empty).map((k, i) => [k, arr[i] ?? 0])) as T;
  // 투타 겸업 (2026-10-13): 타격·투구 기록을 둘 다 모은다 (본업 쪽 표가 먼저, 반대쪽은 기록이 있을 때만)
  // 세이버 지표의 리그 기준값 (2026-10-22): 게임 안 시즌은 결산 때 남긴 값(예전 저장은 없음 → 표시 안 함), 실제 시즌은 자료집 리그 합계
  const bats: RecRow<BatLike>[] = [];
  const pits: RecRow<PitLike>[] = [];
  const s = session.season;
  const live = session.phase === 'season';
  if (live && s.bat[p.idx].pa > 0) bats.push({ key: `${year}:now`, label: `${year} 이번 시즌`, real: false, l: s.bat[p.idx], lg: lg.base, pf: worldParkFactor(session.world, p.teamIdx, lg.base.runsPerPa) });
  if (live && s.pit[p.idx].bf > 0) pits.push({ key: `${year}:now`, label: `${year} 이번 시즌`, real: false, l: s.pit[p.idx], lg: lg.base });
  // 게임에서 치른 시즌 전부 (최근 먼저. 결산이 끝난 시즌은 history에 있다)
  for (const h of [...(lp?.history ?? [])].reverse()) {
    if (live && h.year >= year) continue;
    const sab = session.league.seasonSaber?.[String(h.year)] ?? null;
    if (h.bat) {
      const l = decode(emptyBatLine(), h.bat);
      const pf = sab ? seasonParkFactor(store, session.league, h.team, h.year, { rates: session.world.league, rpa: sab.runsPerPa }) : 1;
      if (l.pa > 0) bats.push({ key: `${h.year}:${h.team}`, label: `${h.year} ${h.team}`, real: false, l, lg: sab, pf });
    }
    if (h.pit) {
      const l = decode(emptyPitLine(), h.pit);
      if (l.bf > 0 || l.outs > 0) pits.push({ key: `${h.year}:${h.team}`, label: `${h.year} ${h.team}`, real: false, l, lg: sab });
    }
  }
  // 게임 시작 전 직전 3시즌의 실제 기록 (브라우저가 그 범위만 불러온다)
  for (const y of [start - 1, start - 2, start - 3]) {
    const ss = store.season(y);
    const pr = ss?.pit.find((r) => r.id === p.id);
    const br = ss?.bat.find((r) => r.id === p.id);
    if (br && br.pa > 0) bats.push({ key: `${y}:real`, label: `${y} ${br.team}`, real: true, l: batFromRow(br as BatRow), lg: realLeagueBase(ss!.league), pf: realSeasonParkFactor(store, ss!, br.team) });
    if (pr && pr.outs > 0) pits.push({ key: `${y}:real`, label: `${y} ${pr.team}`, real: true, l: pitFromRow(pr as PitRow), lg: realLeagueBase(ss!.league) });
  }
  const lb = lg.total.bat;
  const lpit = lg.total.pit;
  const batFoot = live && lb.pa > 0 ? [{ label: `${year} 리그 평균`, cells: { avg: rate3(avg(lb)), obp: rate3(obp(lb)), slg: rate3(slg(lb)), ops: rate3(ops(lb)), woba: rate3(woba(lb)), iso: rate3(iso(lb)), babip: rate3(babip(lb)), bbp: pct1(bbPct(lb)), kp: pct1(kPct(lb)), wrc: '100' } }] : undefined;
  const pitFoot = live && lpit.outs > 0 ? [{ label: `${year} 리그 평균`, cells: { era: fixed2(era(lpit)), whip: fixed2(whip(lpit)), fip: fixed2(era(lpit)), pk: pct1(pitKPct(lpit)), pb: pct1(pitBbPct(lpit)), pbabip: rate3(pitBabip(lpit)),
    ...(lpit.np > 0 ? { npg: (lpit.np / Math.max(1, lpit.g)).toFixed(1), npip: ((lpit.np * 3) / lpit.outs).toFixed(1), npbf: (lpit.np / Math.max(1, lpit.bf)).toFixed(2) } : {}) } }] : undefined;
  const batTable = bats.length > 0 && (
    <DataTable id="player-bat" label="타격 기록" cols={BAT_COLS} rows={bats} rowKey={(r) => r.key} full={full} thin={(r) => r.l.pa < THIN_PA} foot={batFoot} />
  );
  const pitTable = pits.length > 0 && (
    <DataTable id="player-pit" label="투구 기록" cols={PIT_COLS} rows={pits} rowKey={(r) => r.key} full={full} thin={(r) => r.l.outs < THIN_OUTS} foot={pitFoot} />
  );
  return (
    <section>
      <div className="seg small" role="tablist" aria-label="기록 구분">
        {([['one', '1군'], ['fut', '퓨처스'], ['ps', '가을야구']] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={part === k} className={part === k ? 'on' : ''} onClick={() => setPart(k)}>{t}</button>
        ))}
      </div>
      {part === 'one' && (
        <>
          {!bats.length && !pits.length && <p className="muted small">1군 기록이 없습니다.</p>}
          {p.isPitcher
            ? <>{pitTable}{bats.length > 0 && <h4 className="small">타격</h4>}{batTable}</>
            : <>{batTable}{pits.length > 0 && <h4 className="small">투구</h4>}{pitTable}</>}
          <p className="muted small">
            게임에서 치른 시즌은 이 게임의 기록, "실제"는 게임 시작 전 실제 기록입니다
            {full ? ' · 세이버 지표는 기록으로 직접 계산 (리그 기준은 그 해 리그 기록) · 흐린 줄은 표본이 적은 시즌 (타석 100·이닝 30 미만)' : ' · 세이버 지표와 열 고르기는 상세에서'}.
          </p>
        </>
      )}
      {part === 'fut' && <FuturesPart p={p} />}
      {part === 'ps' && <PostseasonPart p={p} />}
    </section>
  );
}

function FuturesPart({ p }: { p: SimPlayer }) {
  const { session } = useGame();
  const lp = session.leaguePlayer(p.id);
  const now = session.phase === 'season' && p.teamIdx >= 0 ? futuresText(session.futures().lines.get(p.idx)) : '-';
  // 퓨처스리그(2군) 시즌별 기록 (2026-10-12부터 결산 때 남긴다)
  const fut = [...(lp?.history ?? [])].filter((h) => h.fbat || h.fpit).reverse();
  if (now === '-' && !fut.length) return <p className="muted small">퓨처스리그(2군) 기록이 없습니다.</p>;
  return (
    <ul className="plain small">
      {now !== '-' && <li>{session.world.year} 이번 시즌: {now}</li>}
      {fut.map((h) => <li key={`${h.year}-${h.team}`}>{h.year} {h.team}: {futuresText(futuresFromRecord(h.fbat, h.fpit) as FuturesLine)}</li>)}
    </ul>
  );
}

function PostseasonPart({ p }: { p: SimPlayer }) {
  const { session } = useGame();
  const lp = session.leaguePlayer(p.id);
  // 가을야구 기록 (2026-10-12부터 결산 때 남긴다). 진행 중인 가을야구는 박스스코어로
  const rows = [...(lp?.history ?? [])].filter((h) => h.pbat || h.ppit).reverse()
    .map((h) => ({ key: `${h.year}`, label: `${h.year} ${h.team}`, l: psFromRecord(p.idx, h.pbat, h.ppit) }));
  const live = session.postseason ? postseasonLines(session.postseason.series.flatMap((x) => x.games)).get(p.idx) : undefined;
  if (live && session.phase === 'season') rows.unshift({ key: 'now', label: `${session.world.year} 진행 중`, l: live });
  if (!rows.length) return <p className="muted small">가을야구 기록이 없습니다.</p>;
  return <ul className="plain small">{rows.map((r) => <li key={r.key}>{r.label}: {psLineText(r.l, p.isPitcher)}</li>)}</ul>;
}

// ---- 탭 5: 투수 등판 (우리 구단 경기 박스스코어)

type PitchRow = { key: string; date: string; day: number; opp: string; home: boolean; start: boolean; res: string; outs: number; np: number; h: number; r: number; er: number; bb: number; so: number };

function pitchingLog(session: GameSession, p: SimPlayer): PitchRow[] {
  const s = session.season;
  const team = lineTeam(p);
  const out: PitchRow[] = [];
  s.log.forEach((g, i) => {
    if (g.home !== team && g.away !== team) return;
    const box = s.boxes.get(i);
    if (!box) return;
    const side = g.home === team ? box.home : box.away;
    const k = side.pitchers.findIndex((x) => x.idx === p.idx);
    if (k < 0) return;
    const x = side.pitchers[k];
    const res = g.win === p.idx ? '승' : g.loss === p.idx ? '패' : g.save === p.idx ? '세이브' : '—';
    out.push({
      key: String(i), date: shortDate(session.world.year, g.day), day: g.day, opp: session.teamInfo(g.home === team ? g.away : g.home).name, home: g.home === team,
      start: k === 0, res, outs: x.outs, np: x.np, h: x.h, r: x.r, er: x.er, bb: x.bb, so: x.so,
    });
  });
  return out.reverse();
}

const PITCH_COLS: Column<PitchRow>[] = [
  { key: 'day', label: '날짜', value: (r) => r.day, fixed: true, text: true, cell: (r) => r.date },
  { key: 'opp', label: '상대', value: (r) => r.opp, text: true, brief: true, cell: (r) => `${r.home ? 'vs' : '@'} ${r.opp}` },
  { key: 'role', label: '역할', value: (r) => (r.start ? '선발' : '구원'), text: true, brief: true },
  { key: 'res', label: '결과', value: (r) => r.res, text: true, brief: true },
  { key: 'ip', label: '이닝', value: (r) => r.outs, cell: (r) => ipText(r.outs), brief: true },
  { key: 'np', label: '투구 수', value: (r) => r.np || null, brief: true },
  { key: 'h', label: '피안타', value: (r) => r.h, lower: true },
  { key: 'r', label: '실점', value: (r) => r.r, lower: true, brief: true },
  { key: 'er', label: '자책', value: (r) => r.er, lower: true },
  { key: 'bb', label: '볼넷', value: (r) => r.bb, lower: true },
  { key: 'so', label: '삼진', value: (r) => r.so },
];

function PitchingTab({ rows, full }: { rows: PitchRow[]; full: boolean }) {
  const { session } = useGame();
  if (!rows.length) return <p className="muted small">이번 시즌 등판 기록이 없습니다.</p>;
  const last = rows[0];
  const rest = session.currentDay - last.day - 1;
  return (
    <section>
      <p className="small">마지막 등판 {last.date}{session.phase === 'season' && !session.done && rest >= 0 ? ` · 그 뒤 ${rest}일` : ''} · 이번 시즌 {rows.length}경기</p>
      <RecentPitchBars rows={rows.slice(0, 7).reverse()} />
      <DataTable id="player-pitch-log" label="등판 기록" cols={PITCH_COLS} rows={rows} rowKey={(r) => r.key} full={full} />
      <p className="muted small">우리 구단 경기 박스스코어로 만든 표입니다. 투구 수를 세지 않은 경기는 —.</p>
    </section>
  );
}

/** 최근 7등판 투구 수 막대 (오래된 것부터). 막대 높이는 그 중 최대 또는 110구 기준 (임시값) */
function RecentPitchBars({ rows }: { rows: PitchRow[] }) {
  const counted = rows.filter((r) => r.np > 0);
  if (!counted.length) return null;
  const top = Math.max(110, ...counted.map((r) => r.np));
  return (
    <figure className="np-bars" aria-label={`최근 ${rows.length}등판 투구 수: ${rows.map((r) => `${r.date} ${r.np || '—'}구`).join(', ')}`}>
      {rows.map((r) => (
        <div key={r.key} className={`np-bar${r.start ? ' sp' : ''}`} title={`${r.date} ${r.start ? '선발' : '구원'} ${r.np || '—'}구`}>
          <span className="np-v small">{r.np || '—'}</span>
          <i style={{ height: `${(r.np / top) * 100}%` }} aria-hidden />
          <span className="np-d small muted">{r.date}</span>
        </div>
      ))}
      <figcaption className="muted small">최근 {rows.length}등판 투구 수 (진한 막대 = 선발)</figcaption>
    </figure>
  );
}

// ---- 탭 4: 계약·이력

const KIND_LABEL: Record<string, string> = { reserve: '보류 선수 (해마다 협상)', rookie: '신인', fa: 'FA 계약', nonFA: '비FA 다년 계약', foreign: '외국인 (1년)' };

function ContractInfo({ id }: { id: string }) {
  const { session, store } = useGame();
  const won = useWon();
  const lp = session.leaguePlayer(id);
  const note = session.scoutPhrase(id);
  const master = store.players.get(id);
  if (!lp) return null;
  const c = lp.contract;
  const allStar = allStarHistory(session.league, id);
  const clubs = [...new Set(lp.history.map((h) => `${h.year} ${h.team}`))];
  return (
    <section>
      <h3>계약과 스카우트 보고</h3>
      <dl className="facts">
        <dt>계약</dt><dd>{KIND_LABEL[c.kind]} · {c.kind === 'foreign' ? `${dollarText(c.salary)}${c.bonus ? ` + 계약금 ${dollarText(c.bonus)}` : ''}` : won(c.salary)} · {c.until}년까지</dd>
        <dt>스카우트 보고</dt>
        <dd>
          {note ?? <span className="muted">— (32세부터는 평을 내지 않는다)</span>}
          {note && <span className="muted small"> (앞으로 클 여지에 대한 평. 틀릴 수 있다)</span>}
        </dd>
        {!lp.foreign && <><dt>FA</dt><dd>1군 연차 {lp.service}년{lp.faCount ? ` · FA 계약 ${lp.faCount}회` : ''}</dd></>}
        {allStar.years.length > 0 && <><dt>올스타</dt><dd>{allStar.years.length}회 ({allStar.years.join(', ')}){allStar.mvp.length ? ` · MVP ${allStar.mvp.join(', ')}` : ''}{allStar.derby.length ? ` · 홈런 더비 우승 ${allStar.derby.join(', ')}` : ''}</dd></>}
        <dt>입단</dt><dd>{master?.entryYear ?? lp.entryYear}년</dd>
        {clubs.length > 0 && <><dt>게임 안 소속</dt><dd>{clubs.join(' · ')}</dd></>}
      </dl>
      {session.phase === 'season' && <p className="muted small">시즌 중에는 개막 때 계약 기준입니다.</p>}
    </section>
  );
}

/**
 * 투타 겸업 (league/twoway.ts, 2026-10-13): 모든 선수의 반대쪽 능력(투수의 타격, 타자의 투구)과 잠재력.
 * 우리 구단 선수는 이도류로 쓸지 정한다 (투수 겸업은 지명타자로도, 등판 다음 날은 타석에서 쉰다)
 */
function TwoWayInfo({ p, full }: { p: SimPlayer; full: boolean }) {
  const { session, changed, autosave } = useGame();
  const [msg, setMsg] = useState<string | null>(null);
  const lp = session.leaguePlayer(p.id);
  if (!lp?.alt) return null;
  const year = session.phase === 'season' ? session.world.year : session.year + 1;
  const side = p.isPitcher ? '타격' : '투구';
  const mine = lp.team === session.teamIdx;
  const toggle = () => {
    const r = session.setTwoWay(p.id, !lp.twoWay);
    setMsg(r.message);
    if (r.ok) { changed(); void autosave(); }
  };
  return (
    <div className="defense">
      <h4 className="small">
        {side} 능력 <span className="muted">(본업 반대쪽) · 지금 <GuessGrade v={session.guessAltGrade(p.id, gradeAt(lp.alt.runs, year))} /> <span title="기록이 거의 없어 추측 범위가 넓다">(추측)</span>{lp.twoWay ? ' · 이도류로 뛰는 중' : ''}</span>
        {mine && <button type="button" className="link small" onClick={toggle}>{lp.twoWay ? '본업만 맡기기' : '이도류로 쓰기'}</button>}
      </h4>
      {full && <p className="muted small">모든 선수가 반대쪽 능력을 갖지만 대부분은 낮고 자라지 않습니다. 겸업 재능이 있는 몇 명만 크게 자랍니다. 이도류로 쓰면 {p.isPitcher ? '등판하지 않는 날 지명타자로 나가고(등판 날도 타석에 서고, 다음 날은 쉰다)' : '선발 투수 후보에도 들어가고, 던진 다음 날은 타석에서 쉰다'}.</p>}
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}

/** 포지션별 수비 등급 (20~80, 50 = 그 자리 평균 수비수). 직접 고치기 (2026-10-13 사용자 선택) */
function DefenseInfo({ p, full }: { p: SimPlayer; full: boolean }) {
  const { session, changed, autosave } = useGame();
  const [edit, setEdit] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const playable = playablePositions(p.bat);
  const seen = useSeen();
  const dv = (q: FieldPos) => seen.grade(p.id, 'defense', defenseGrade(defenseAt(p, q)));
  // 고치기 칸은 보이는 값(추측 가운데값)에서 시작한다 (진짜 값을 채워 넣지 않는다)
  const open = () => setEdit(Object.fromEntries(FIELD_POS.map((q) => { const v = dv(q); return [q, v ? guessMid(v) : 50]; })));
  const save = () => {
    if (!edit) return;
    // 등급 → 수비 런 (5런 = 10점)
    const def = Object.fromEntries(FIELD_POS.map((q) => [q, (edit[q] - 50) / 2]));
    const r = session.editDefense(p.id, def);
    setMsg(r.message);
    if (r.ok) { setEdit(null); changed(); void autosave(); }
  };
  return (
    <div className="defense">
      <h4 className="small">
        수비{full && session.phase === 'season' && (session.season.errors[p.idx] ?? 0) > 0 ? <span className="muted"> 이번 시즌 실책 {session.season.errors[p.idx]}개 ·</span> : null} <span className="muted">포지션별, 50이 그 자리 평균 · 맡길 만한 자리: {playable.length ? playable.map((q) => posName(q)).join(', ') : '없음 (DH)'}</span>
        {!edit && p.bat && <button type="button" className="link small" onClick={open}>고치기</button>}
      </h4>
      {edit ? (
        <div className="defense-edit">
          {FIELD_POS.map((q) => (
            <label key={q} className="small" title={POS_KO[q]}>
              {posName(q)}
              <input type="number" min={20} max={80} step={1} value={edit[q]} onChange={(e) => setEdit({ ...edit, [q]: Math.max(20, Math.min(80, Number(e.target.value) || 20)) })} />
            </label>
          ))}
          <span className="inline">
            <button type="button" className="small-btn" onClick={save}>저장</button>
            <button type="button" className="small-btn ghost" onClick={() => setEdit(null)}>취소</button>
          </span>
          <p className="muted small">20~80 (50 = 그 자리 평균, 40 아래면 맡기기 어렵다). 고친 값은 조작 기록에 남고 경기·선수 가치에 바로 들어갑니다.</p>
        </div>
      ) : (
        <div className="grades">
          {FIELD_POS.map((q) => <GradeBar key={q} label={posName(q)} title={POS_KO[q]} v={dv(q)} />)}
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
      {full && <p className="muted small">KBO가 수비 기록의 자동 수집을 막고 있어, 커리어에 맡은 포지션·주력·나이와 KBO 수비상(2023~) 순위로 만든 추정값입니다. 실제와 다르면 "고치기"로 바꾸세요. 실책률은 그 자리 수비 등급에 따라 달라집니다 (실책 출루 기준).</p>}
    </div>
  );
}

const MILITARY_LABEL: Record<string, string> = { pending: '미필', serving: '복무 중', homeOnly: '방위병 복무 중 (홈경기만)', done: '마침', exempt: '면제' };

/** 몸 상태와 병역: 이번 시즌 부상·이탈, 지난 시즌 부상 이력, 병역 */
function CareerInfo({ p }: { p: { idx: number; id: string; real?: boolean } }) {
  const { session } = useGame();
  const lp = session.leaguePlayer(p.id);
  const year = session.world.year;
  const len = session.season.schedule.length;
  const now = session.season.absences.filter((a) => a.idx === p.idx);
  const past = lp?.injuries ?? [];
  return (
    <section>
      <h3>{isVirtual(p) ? '몸 상태와 병역' : '결장과 병역'}</h3>
      <dl className="facts">
        {lp && !lp.foreign && (
          <>
            <dt>병역</dt>
            <dd>
              {MILITARY_LABEL[lp.military?.state ?? 'done']}
              {lp.military?.state === 'serving' && ` (${serviceName(lp.military)}, ${lp.military.returnYear}년 복귀)`}
              {lp.military?.basis === 'estimate' && <span className="muted small"> (추정)</span>}
              {lp.military?.state === 'pending' && lp.real && year === session.league.startYear && <span className="muted small"> (병역 자료가 없어 나이·기록 공백으로 가늠한 값)</span>}
            </dd>
          </>
        )}
        <dt>{year} 시즌</dt>
        <dd>
          {now.length === 0 ? (isVirtual(p) ? '부상·이탈 없음' : '결장 없음') : now.map((a, i) => (
            <span key={i}>{i > 0 && ', '}{shortDate(year, a.day)} {absenceLabel(a, p, a.until >= len)}{a.until >= len ? '' : ` ${a.until - a.day}일`}</span>
          ))}
        </dd>
        {past.length > 0 && (
          <>
            <dt>장기 결장 이력</dt>
            <dd>{past.map((x) => `${x.year} ${absenceLabel({ kind: x.kind, part: x.part }, p)} ${x.days}일${x.seasonOut ? '(시즌 아웃)' : ''}`).join(', ')}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
