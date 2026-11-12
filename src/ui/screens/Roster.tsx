// 선수단: 1군·2군 명단과 엔트리 이동. 라인업·로테이션은 AI 감독이 1군 안에서 정한다.
// 2026-10-12 개편: 1군/2군을 탭으로 나눠 한 번에 한 표만, 줄을 누르면 오른쪽에 선수 요약(좁은 화면은 바로 상세 창).
// 2026-10-22 UI 대개편 2차: 기용(자리·보직·타순)과 엔트리 이동은 전력 > 기용 보드(LineupBoard.tsx)에서 묶음으로 검토해 적용한다.
// 이 화면은 보기와 육성선수 정식 등록만 한다.
import { serviceName } from '../../league/careers';
import { useMemo, useState, type ReactNode } from 'react';
import { DataTable, GradeBar, GuessGrade, useSeen } from '../parts';
import { orderedRows, type Column as TableColumn } from '../table';
import { guessMid } from '../../league/scout';
import { seasonWar } from '../../league/awards';
import { defenseAt, defenseGrade, FIELD_POS, fieldPosOf, type SimPlayer } from '../../engine';
import { shortDate } from '../../game/calendar';
import { worldParkFactor } from '../../game/parkView';
import { PITCHER_ROLE_LABEL, type EntryCheck } from '../../game/session';
import {
  babip, bbPct, bbPerK, fip, int0, iso, kPct, leagueBase, lobPct, pct1, per9, pitBabip, pitBbPct, pitKPct, sbPct, woba, wraa, wrcPlus,
} from '../../game/saber';
import { avg, era, fixed2, ipText, obp, ops, rate3, slg, whip } from '../../game/stats';
import { ForeignMark, HAND, linkOrder, posName, useGame, useWon } from '../context';
import { dollarText } from '../../league/salary';
import type { FuturesLine } from '../../league/futures';
import { ruleOf } from '../../league/rules';

type Kind = 'hit' | 'pit';
/** 선수단 표의 페이지: 게임 능력치와 상태 / 클래식 기록 / 세이버 기록 */
type Page = 'ability' | 'classic' | 'saber';
const PAGES: [Page, string][] = [['ability', '능력·상태'], ['classic', '클래식 기록'], ['saber', '세이버 기록']];
const PAGE_KEY = 'kbo-gm/roster-page';

/** 마지막으로 본 페이지 (이 브라우저에만 기억하는 편의 기능. 저장소를 못 쓰면 첫 페이지) */
function savedPage(): Page {
  try {
    const v = localStorage.getItem(PAGE_KEY);
    return v === 'classic' || v === 'saber' ? v : 'ability';
  } catch {
    return 'ability';
  }
}

type Col = TableColumn<SimPlayer>;

export function Roster() {
  const { session, changed, version, openPlayer, go } = useGame();
  const seen = useSeen();
  const [kind, setKind] = useState<Kind>('hit');
  const [inFirst, setInFirst] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  // 표 보기가 바뀌면 다시 그려 오른쪽 요약·'자세히' 순서를 맞춘다
  const [, setViewTick] = useState(0);
  const [msg, setMsg] = useState<(EntryCheck & { who?: string }) | null>(null);
  const [page, setPageState] = useState<Page>(savedPage);
  const setPage = (v: Page) => {
    setPageState(v);
    try { localStorage.setItem(PAGE_KEY, v); } catch { /* 기억하지 못해도 화면은 그대로 */ }
  };
  const year = session.world.year;
  const rules = session.entryRules();
  const extra = session.season.rosterExtraOn(session.day);

  // 다음 경기일 기준으로 엔진이 쓸 1군과 역할
  const view = useMemo(() => {
    const ts = session.activeTeam();
    const manual = session.manualEntry;
    const registered = new Set(session.registered().map((p) => p.idx));
    const callUps = new Set((ts.callUps ?? []).map((p) => p.idx));
    const role = new Map<number, string>();
    ts.rotation.forEach((p, i) => role.set(p.idx, `선발 ${i + 1}`));
    for (const p of ts.bullpen) role.set(p.idx, p === ts.closer ? '마무리' : PITCHER_ROLE_LABEL[session.pitcherRole(p)]);
    for (const p of ts.hitters) {
      const s = session.slotOf(p);
      role.set(p.idx, s ? `주전 ${posName(s)}` : '서브');
    }
    return { manual, registered, callUps, role };
  }, [session, version]); // version: 세션 내용이 바뀌면 다시 계산

  // 세이버 기록의 리그 기준값 (이번 시즌 리그 전체 시뮬레이션 기록)
  const lg = useMemo(() => leagueBase(session.season.bat, session.season.pit), [session, version]);
  // wRC+ 구장 보정: 선수 소속 구단의 시즌 구장 계수 (경기에 쓰는 구장 배율 그대로, game/parkView.ts)
  const pfOf = (p: SimPlayer) => worldParkFactor(session.world, p.teamIdx, lg.runsPerPa);
  // WAR (근사, league/awards.ts seasonWar)
  const war = useMemo(() => seasonWar(session.world, session.season), [session, version]);
  const warCol: Col = { key: 'war', label: 'WAR', title: '대체 선수보다 몇 승을 더 벌었나 (근사, 시상과 같은 계산)',
    value: (p) => war.get(p.idx) ?? null, cell: (p) => (war.has(p.idx) ? war.get(p.idx)!.toFixed(1) : '-') };
  const org = session.team.org;
  const first = org.filter((p) => view.registered.has(p.idx));
  const foreign = first.filter((p) => p.foreign).length;
  const nPit = first.filter((p) => p.isPitcher).length;

  /** 지금 자리(주전이면 그 자리, 아니면 주 포지션)의 수비 등급 */
  const defGrade = (p: SimPlayer) => {
    const s = session.slotOf(p);
    if (s === 'DH' || (!s && p.pos === 'DH')) return null;
    return defenseGrade(defenseAt(p, s ?? fieldPosOf(p.pos)));
  };

  const statusOf = (p: SimPlayer) => {
    const back = session.returnDay(p);
    if (back !== null) {
      const when = back >= session.season.schedule.length ? '시즌 아웃' : `${shortDate(year, back)} 복귀`;
      return <span className="status out">{session.absenceReason(p)} · {when}</span>;
    }
    if (view.callUps.has(p.idx)) return <span className="status temp">임시 승격</span>;
    return null;
  };

  const fut = useMemo(() => session.futures().lines, [session, version]);
  const list = (inFirst: boolean) => {
    const rows = org.filter((p) => (kind === 'pit') === p.isPitcher && view.registered.has(p.idx) === inFirst);
    // 기본 순서: 포지션 차례 (C 1B … DH) → 이름. 머리를 누르면 공통 표가 다시 늘어놓는다
    return rows.sort((a, b) => posRank(a) - posRank(b) || a.name.localeCompare(b.name, 'ko') || a.idx - b.idx);
  };

  const roleOf = (p: SimPlayer): string => (inFirst || view.callUps.has(p.idx) ? (view.role.get(p.idx) ?? (session.isAbsent(p) ? '결장' : '-')) : '');
  const rows = list(inFirst);
  const nOther = list(!inFirst).length;
  /** 줄 누르기: 넓은 화면은 오른쪽 요약, 좁은 화면은 바로 상세 창 */
  const pick = (p: SimPlayer, order?: number[]) => {
    if (window.matchMedia('(max-width: 1100px)').matches) openPlayer(p.idx, order);
    else setSel(p.idx);
  };
  // 2군은 보기를 따로 기억한다 (1군에서 고른 열 목록에 2군 전용 '퓨처스' 열이 없어 꺼진 채로 남지 않게)
  const tableId = `roster-${kind}-${page}${inFirst ? '' : '-2'}`;
  const cols: Col[] = [
    { key: 'name', label: '이름', fixed: true, text: true, value: (p) => p.name, cell: (p) => (
      <>
        <button type="button" className="link name-btn" data-pidx={p.idx} onClick={(e) => { e.stopPropagation(); pick(p, linkOrder(e.currentTarget)); }}>{p.name}</button>
        <ForeignMark p={p} />
        {p.dev && <span className="tag" title="육성선수: 정원 밖, 정식 등록 전에는 1군에 못 나간다">육성</span>}
      </>
    ) },
    { key: 'role', label: '역할', fixed: true, text: true, value: (p) => roleOf(p) || null, cell: (p) => <span className="small">{roleOf(p)}</span> },
    ...columnsFor(kind, page),
    ...(!inFirst ? [{ key: 'fut', label: '퓨처스', text: true, title: '퓨처스리그(2군) 성적. 능력과 2군 출전 몫으로 만든 값',
      value: (p: SimPlayer) => futuresSort(fut.get(p.idx), kind), cell: (p: SimPlayer) => <span className="small">{futuresText(fut.get(p.idx))}</span> }] : []),
    { key: 'act', label: '', fixed: true, value: () => null, cell: (p) => moveBtn(p) },
  ];
  // 표에 지금 보이는 순서 (저장된 거르기·정렬대로). 고른 선수가 지금 표에 없으면 보이는 첫 줄
  const shownOrder = orderedRows(tableId, rows, cols, (x) => x.name);
  const picked = rows.find((p) => p.idx === sel) ?? shownOrder[0] ?? rows[0];
  /** 육성선수 정식 등록 (1군·2군 이동은 기용 보드에서) */
  const moveBtn = (p: SimPlayer, big = false) => {
    const cls = big ? 'ghost' : 'small-btn';
    if (p.dev) {
      const why = session.convertBlock(p);
      return (
        <button type="button" className={cls} disabled={!!why} title={why ?? '정식 선수로 등록합니다 (2군에 남고, 1군은 따로 올립니다)'}
          onClick={(e) => { e.stopPropagation(); const r = session.convertDev(p); setMsg({ errors: r.ok ? [] : [r.message], warnings: [], who: r.ok ? r.message : undefined }); changed(); }}>
          정식 등록
        </button>
      );
    }
    return null;
  };

  return (
    <div className="stack tight">
      <section className="row-between wrap">
        <div className="muted small roster-sum">
          1군 <strong>{first.length}/{rules.rosterSize}</strong>명 (투수 {nPit}, 야수 {first.length - nPit}{rules.activeSize < rules.rosterSize ? `, 경기 출장 ${rules.activeSize}명` : ''}){extra > 0 ? ` · 엔트리 확대 +${extra}` : ''} · 외국인 {foreign}/{rules.foreignLimit}{rules.foreignActive < rules.foreignLimit ? ` (경기 출전 ${rules.foreignActive}명)` : ''} ·{' '}
          정식 {session.regularCount()}/{ruleOf(session.league, 'orgLimit')}{org.some((p) => p.dev) ? ` · 육성 ${org.filter((p) => p.dev).length}` : ''} ·{' '}
          {view.manual ? '엔트리 직접 관리' : '엔트리 AI 관리'}{view.manual ? (session.plan ? ' · 기용 직접' : ' · 기용 AI 감독') : ''}
        </div>
        <span className="inline">
          <button type="button" className="ghost" onClick={() => go('lineup')} disabled={!session.canManage}>기용 보드에서 바꾸기</button>
        </span>
      </section>

      {msg && (msg.errors.length > 0 || msg.warnings.length > 0 || msg.who) && (
        <div className={msg.errors.length ? 'note error-box' : 'note'} role="status">
          {msg.errors.map((e) => <p key={e}>{e}</p>)}
          {msg.who && <p>{msg.who}</p>}
          {msg.warnings.map((w) => <p key={w} className="small">{w}</p>)}
        </div>
      )}

      <ServingList />

      <div className="roster-split">
        <section className="card roster-main">
          <div className="toolbar">
            <div className="seg" role="tablist" aria-label="선수 구분">
              <button type="button" role="tab" aria-selected={kind === 'hit'} className={kind === 'hit' ? 'on' : ''} onClick={() => setKind('hit')}>야수</button>
              <button type="button" role="tab" aria-selected={kind === 'pit'} className={kind === 'pit' ? 'on' : ''} onClick={() => setKind('pit')}>투수</button>
            </div>
            <div className="seg" role="tablist" aria-label="1군·2군">
              <button type="button" role="tab" aria-selected={inFirst} className={inFirst ? 'on' : ''} onClick={() => setInFirst(true)}>1군 {inFirst ? rows.length : nOther}</button>
              <button type="button" role="tab" aria-selected={!inFirst} className={!inFirst ? 'on' : ''} onClick={() => setInFirst(false)}>2군 {inFirst ? nOther : rows.length}</button>
            </div>
            <div className="seg" role="tablist" aria-label="표 페이지">
              {PAGES.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={page === k} className={page === k ? 'on' : ''} onClick={() => setPage(k)}>{label}</button>
              ))}
            </div>
          </div>

          {page === 'saber' && (
            <p className="muted small">
              세이버 기록은 이번 시즌 리그 전체 시뮬레이션 기록이 기준입니다 (리그 wOBA {rate3(lg.woba)}, FIP 상수 {fixed2(lg.fipConst)}).
              wRC+는 100이 리그 평균이고 구장 보정이 없습니다. 피BABIP는 희생타 기록이 없어 근사값입니다.
            </p>
          )}

          <DataTable id={tableId} onViewChange={() => setViewTick((n) => n + 1)} cols={cols} rows={rows} rowKey={(p) => String(p.idx)} full tableClass="roster"
            searchText={(p) => p.name} rowClass={(p) => (picked?.idx === p.idx ? 'sel' : undefined)} onRow={(p, shown) => pick(p, shown.map((x) => x.idx))}
            label={`${kind === 'hit' ? '야수' : '투수'} ${inFirst ? '1군' : '2군'} 명단`} empty="이 구분에 선수가 없습니다." />
        </section>

        {picked && <RosterSide p={picked} inFirst={inFirst} status={statusOf(picked)} moveBtn={moveBtn(picked, true)} war={war.get(picked.idx)}
          order={shownOrder.map((x) => x.idx)} />}
      </div>

    </div>
  );

  /** 구분(야수·투수)과 페이지별 열 */
  function columnsFor(k: Kind, pg: Page): Col[] {
    const B = (p: SimPlayer) => session.season.bat[p.idx];
    const P = (p: SimPlayer) => session.season.pit[p.idx];
    type BL = ReturnType<typeof B>;
    type PL = ReturnType<typeof P>;
    /** 기록 열: 값(정렬)과 칸 글자. 기록이 없으면 '-'이고 정렬은 맨 뒤 */
    const bat = (key: string, label: string, num: (b: BL) => number, fmt?: (n: number) => ReactNode, title?: string, lower?: boolean): Col => ({
      key, label, title, lower,
      value: (p) => (B(p).pa ? num(B(p)) : null),
      cell: (p) => { if (!B(p).pa) return '-'; const n = num(B(p)); return fmt ? fmt(n) : n; },
    });
    const pit = (key: string, label: string, num: (x: PL) => number, fmt?: (n: number) => ReactNode, title?: string, lower?: boolean): Col => ({
      key, label, title, lower,
      value: (p) => (P(p).bf ? num(P(p)) : null),
      cell: (p) => { if (!P(p).bf) return '-'; const n = num(P(p)); return fmt ? fmt(n) : n; },
    });
    /** 능력 열: 스카우트 추측. 정렬은 추측 가운데값 (능력치 v2 17.6, 진짜 등급으로 줄 세우지 않는다) */
    const grade = (key: string, label: string, title?: string, tg?: (p: SimPlayer) => number | null): Col => ({
      key, label, title,
      value: (p) => { const v = seen.grade(p.id, key, tg?.(p)); return v ? guessMid(v) : null; },
      cell: (p) => <GuessGrade v={seen.grade(p.id, key, tg?.(p))} />,
    });
    const status: Col = { key: 'status', label: '상태', text: true, value: (p) => statusSort(p), cell: (p) => statusOf(p) };
    const age: Col = { key: 'age', label: '나이', lower: true, value: (p) => p.age ?? null, cell: (p) => p.age ?? '-' };
    const ip = (x: PL) => x.outs;
    if (k === 'hit') {
      if (pg === 'ability') {
        return [
          { key: 'pos', label: '포지션', lower: true, value: (p) => posRank(p), cell: (p) => posName(p.pos) }, age,
          { key: 'bats', label: '타', text: true, value: (p) => (p.bats ? HAND[p.bats] : null) },
          grade('contact', '컨택'), grade('power', '파워'), grade('eye', '선구안'), grade('speed', '주력'),
          grade('defense', '수비', '지금 자리(서브는 주 포지션)의 수비 등급', defGrade),
          status,
        ];
      }
      if (pg === 'classic') {
        return [
          bat('g', '경기', (b) => b.g), bat('pa', '타석', (b) => b.pa), bat('ab', '타수', (b) => b.ab), bat('h', '안타', (b) => b.h), bat('d', '2루타', (b) => b.d),
          bat('t', '3루타', (b) => b.t), bat('hr', '홈런', (b) => b.hr), bat('rbi', '타점', (b) => b.rbi), bat('r', '득점', (b) => b.r), bat('bb', '볼넷', (b) => b.bb),
          bat('so', '삼진', (b) => b.so, undefined, undefined, true), bat('sb', '도루', (b) => b.sb), bat('avg', '타율', avg, rate3), bat('obp', '출루율', obp, rate3),
          bat('slg', '장타율', slg, rate3), bat('ops', 'OPS', ops, rate3), warCol,
        ];
      }
      return [
        warCol, bat('pa', '타석', (b) => b.pa), bat('woba', 'wOBA', woba, rate3, '가중 출루율: 타석 결과별 득점 가치로 가중한 출루율'),
        { key: 'wrc', label: 'wRC+', title: '조정 득점 창출력: 100 = 리그 평균, 구장 보정 (칸에 마우스를 올리면 보정 전 → 후)',
          value: (p) => (B(p).pa ? wrcPlus(B(p), lg, pfOf(p)) : null),
          cell: (p) => {
            const b = B(p);
            if (!b.pa) return '-';
            const pf = pfOf(p);
            return <span title={pf !== 1 ? `구장 보정 전 ${int0(wrcPlus(b, lg))} → 후 ${int0(wrcPlus(b, lg, pf))}` : undefined}>{int0(wrcPlus(b, lg, pf))}</span>;
          } },
        bat('wraa', 'wRAA', (b) => wraa(b, lg), fixed1, '리그 평균 타자보다 더 낸 득점'),
        bat('iso', 'ISO', iso, rate3, '순수 장타력: 장타율 - 타율'), bat('babip', 'BABIP', babip, rate3, '인플레이 타구 타율'),
        bat('bbp', '볼넷%', bbPct, pct1), bat('kp', '삼진%', kPct, pct1, undefined, true), bat('bbk', 'BB/K', bbPerK, fixed2),
        { key: 'sbp', label: '도루%', title: '도루 성공률', value: (p) => (B(p).sb + B(p).cs ? sbPct(B(p)) : null), cell: (p) => (B(p).sb + B(p).cs ? pct1(sbPct(B(p))) : '-') },
      ];
    }
    if (pg === 'ability') {
      return [
        age, { key: 'throws', label: '투', text: true, title: '투구손. 언 = 언더·사이드', value: (p) => (p.throws ? `${HAND[p.throws]}${p.underhand ? '언' : ''}` : null) },
        grade('stuff', '구위'), grade('control', '제구'), grade('hrSuppression', '장타 억제'),
        grade('stamina', '선발 체력', '선발로 나왔을 때 길게 던지는 정도'),
        grade('reliefStamina', '구원 체력', '구원 한 번 등판에 길게 던지는 정도 (롱릴리프)'),
        status,
      ];
    }
    if (pg === 'classic') {
      return [
        pit('g', '경기', (x) => x.g), pit('gs', '선발', (x) => x.gs), pit('w', '승', (x) => x.w), pit('l', '패', (x) => x.l, undefined, undefined, true),
        pit('sv', '세이브', (x) => x.sv), pit('hld', '홀드', (x) => x.hld ?? 0),
        pit('qs', 'QS', (x) => x.qs ?? 0, undefined, '퀄리티 스타트: 선발로 6이닝 이상 던지고 3자책 이하'),
        pit('bsv', '블론', (x) => x.bsv ?? 0, undefined, '블론 세이브: 7회 이후 세이브 상황(1~3점 리드, 또는 동점 주자가 누상·타석·대기 타석)에 나와 동점·역전을 허용', true),
        pit('ip', '이닝', ip, ipText), pit('h', '피안타', (x) => x.h, undefined, undefined, true), pit('hr', '피홈런', (x) => x.hr, undefined, undefined, true),
        pit('bb', '볼넷', (x) => x.bb, undefined, undefined, true), pit('so', '탈삼진', (x) => x.so), pit('r', '실점', (x) => x.r, undefined, undefined, true),
        pit('er', '자책', (x) => x.er, undefined, undefined, true), pit('era', '평균자책', era, fixed2, undefined, true),
        pit('whip', 'WHIP', whip, fixed2, '이닝당 출루 허용: (피안타 + 볼넷) ÷ 이닝', true), warCol,
      ];
    }
    return [
      warCol, pit('ip', '이닝', ip, ipText), pit('fip', 'FIP', (x) => fip(x, lg), fixed2, '수비 무관 평균자책: 삼진·볼넷·사구·홈런만으로 본 평균자책', true),
      pit('erafip', 'ERA-FIP', (x) => era(x) - fip(x, lg), fixed2, '평균자책 - FIP. 크면 운·수비 덕을 덜 본 것'),
      pit('k9', 'K/9', (x) => per9(x.so, x), fixed2), pit('bb9', 'BB/9', (x) => per9(x.bb, x), fixed2, undefined, true), pit('hr9', 'HR/9', (x) => per9(x.hr, x), fixed2, undefined, true),
      pit('kp', 'K%', pitKPct, pct1), pit('bbp', 'BB%', pitBbPct, pct1, undefined, true), pit('kbb', 'K-BB%', (x) => pitKPct(x) - pitBbPct(x), pct1),
      pit('babip', '피BABIP', pitBabip, rate3, '인플레이 타구 피안타율 (근사값)', true), pit('lob', '잔루율', lobPct, pct1, 'LOB%: 내보낸 주자를 남긴 비율'),
    ];
  }

  /** 상태 열 정렬: 임시 승격 → 결장(복귀가 늦을수록 뒤) → 나머지 */
  function statusSort(p: SimPlayer): number | null {
    const back = session.returnDay(p);
    if (back !== null) return back;
    return view.callUps.has(p.idx) ? 0 : null;
  }
}

/** 기본 정렬: 포지션 차례 (C 1B … DH) → 이름 */
const posRank = (p: SimPlayer) => { const i = (FIELD_POS as readonly string[]).indexOf(p.pos ?? ''); return i < 0 ? 99 : i; };

const fixed1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');

/** 퓨처스 열 정렬: 야수 OPS, 투수 평균자책의 반대 (기록이 없으면 맨 뒤) */
function futuresSort(l: FuturesLine | undefined, kind: Kind): number | null {
  if (kind === 'hit') {
    const b = l?.bat;
    if (!b || !b.pa) return null;
    return (b.h + b.bb) / Math.max(1, b.pa) + (b.h + b.d + 2 * b.t + 3 * b.hr) / Math.max(1, b.ab);
  }
  const x = l?.pit;
  if (!x || !x.bf) return null;
  return -(x.er * 27) / Math.max(1, x.outs);
}

/** 선수단 오른쪽 요약 칸: 능력 막대, 올해 기록 한 줄, 계약 */
/** order: 표에 지금 보이는 순서 (선수 창 이전·다음) */
function RosterSide({ p, inFirst, status, moveBtn, war, order }: { p: SimPlayer; inFirst: boolean; status: ReactNode; moveBtn: ReactNode; war?: number; order: number[] }) {
  const { session, openPlayer } = useGame();
  const seen = useSeen();
  const won = useWon();
  const lp = session.leaguePlayer(p.id);
  const g = (k: string) => seen.grade(p.id, k);
  const pg = p.isPitcher && g('stuff');
  const bg = !p.isPitcher && g('contact');
  const b = session.season.bat[p.idx];
  const x = session.season.pit[p.idx];
  const line = p.isPitcher
    ? (x.bf ? `${x.g}경기 ${x.w}승 ${x.l}패${x.sv ? ` ${x.sv}세이브` : ''} · ${ipText(x.outs)}이닝 · 평균자책 ${fixed2(era(x))} · 탈삼진 ${x.so}` : '올해 1군 등판 없음')
    : (b.pa ? `타율 ${rate3(avg(b))} · OPS ${rate3(ops(b))} · ${b.hr}홈런 · ${b.rbi}타점${b.sb ? ` · ${b.sb}도루` : ''}` : '올해 1군 타석 없음');
  return (
    <aside className="card roster-side" aria-label={`${p.name} 요약`}>
      <header className="side-head">
        <span className="small">{p.isPitcher ? `투수 · ${p.throws ? HAND[p.throws] : '-'}투${p.underhand ? ' (언더·사이드)' : ''}` : `${posName(p.pos)} · ${p.bats ? HAND[p.bats] : '-'}타`} · {p.age !== null ? `${p.age}세` : '나이 미상'} · {inFirst ? '1군' : '2군'}</span>
        <strong>{p.name}<ForeignMark p={p} long /></strong>
      </header>
      <div className="side-body">
        {status && <p>{status}</p>}
        <div className="grades">
          {pg ? (
            <>
              <GradeBar label="구위" v={g('stuff')} /><GradeBar label="제구" v={g('control')} />
              <GradeBar label="장타 억제" v={g('hrSuppression')} /><GradeBar label="선발 체력" v={g('stamina')} />
            </>
          ) : bg ? (
            <>
              <GradeBar label="컨택" v={g('contact')} /><GradeBar label="파워" v={g('power')} />
              <GradeBar label="선구안" v={g('eye')} /><GradeBar label="주력" v={g('speed')} />
            </>
          ) : null}
        </div>
        <p className="small">{session.world.year} {line}{war !== undefined ? ` · WAR ${war.toFixed(1)}` : ''}</p>
        {lp && (
          <p className="small muted">
            {lp.contract.kind === 'foreign' ? dollarText(lp.contract.salary) : won(lp.contract.salary)} · {lp.contract.until}년까지{session.scoutPhrase(p.id) ? ` · ${session.scoutPhrase(p.id)}` : ''}
          </p>
        )}
        <p className="inline">
          <button type="button" onClick={() => openPlayer(p.idx, order.length >= 2 ? order : undefined)}>자세히</button>
          {moveBtn}
        </p>
      </div>
    </aside>
  );
}

/** 군 복무 중인 우리 선수 (경기에 나오지 않고 정원에서도 빠진다) */
function ServingList() {
  const { session } = useGame();
  const list = session.servingPlayers();
  if (!list.length) return null;
  return (
    <p className="note small">
      군 복무 중 {list.length}명 (정원 제외): {list.map((p) => `${p.name}(${p.isPitcher ? '투수' : posName(p.pos)}, ${serviceName(p.military)}, ${p.military?.returnYear}년 ${p.military?.returnDay === 0 ? '개막 전' : '시즌 중'} 복귀)`).join(', ')}
    </p>
  );
}

/** 퓨처스 기록 한 줄 */
export function futuresText(l: FuturesLine | undefined): string {
  if (!l) return '-';
  if (l.bat && l.bat.pa > 0) {
    const b = l.bat;
    const obp = (b.h + b.bb) / Math.max(1, b.pa);
    const slg = (b.h + b.d + 2 * b.t + 3 * b.hr) / Math.max(1, b.ab);
    return `${b.pa}타석 ${rate3(b.h / Math.max(1, b.ab))} ${b.hr}홈런 OPS ${rate3(obp + slg)}`;
  }
  if (l.pit && l.pit.bf > 0) {
    const x = l.pit;
    return `${l.pit.gs ? `${x.gs}선발 ` : `${x.g}경기 `}${ipText(x.outs)}이닝 평균자책 ${fixed2((x.er * 27) / Math.max(1, x.outs))} ${x.so}삼진`;
  }
  return '-';
}
