// 선수단: 1군·2군 명단과 엔트리 이동. 라인업·로테이션은 AI 감독이 1군 안에서 정한다.
// 2026-10-12 개편: 1군/2군을 탭으로 나눠 한 번에 한 표만, 줄을 누르면 오른쪽에 선수 요약(좁은 화면은 바로 상세 창).
import { serviceName } from '../../league/careers';
import { useMemo, useState, type ReactNode } from 'react';
import { GradeBar } from './PlayerDetail';
import { seasonWar } from '../../league/awards';
import { runsGrade } from '../grades';
import { defenseAt, defenseGrade, fieldPosOf, LINEUP_SLOTS, type SimPlayer, type Slot } from '../../engine';
import { shortDate } from '../../game/calendar';
import { PITCHER_ROLE_LABEL, type EntryCheck, type PitcherRole } from '../../game/session';
import {
  babip, bbPct, bbPerK, fip, int0, iso, kPct, leagueBase, lobPct, pct1, per9, pitBabip, pitBbPct, pitKPct, sbPct, woba, wraa, wrcPlus,
  type LeagueBase,
} from '../../game/saber';
import { avg, era, fixed2, ipText, obp, ops, rate3, slg, whip } from '../../game/stats';
import { Grade, HAND, posName, useGame, useWon } from '../context';
import { dollarText } from '../../league/salary';
import type { FuturesLine } from '../../league/futures';
import { ruleOf } from '../../league/rules';

type Kind = 'hit' | 'pit';
type SortKey = 'value' | 'name' | 'age' | 'g1' | 'g2' | 'g3' | 'g4' | 'stat' | 'saber';
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

interface Column {
  h: string;
  title?: string;
  /** 왼쪽 정렬 */
  l?: boolean;
  v: (p: SimPlayer) => ReactNode;
}


export function Roster() {
  const { session, grades, changed, version, openPlayer } = useGame();
  const [kind, setKind] = useState<Kind>('hit');
  const [inFirst, setInFirst] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>('value');
  const [msg, setMsg] = useState<(EntryCheck & { who?: string }) | null>(null);
  const [page, setPageState] = useState<Page>(savedPage);
  const setPage = (v: Page) => {
    setPageState(v);
    try { localStorage.setItem(PAGE_KEY, v); } catch { /* 기억하지 못해도 화면은 그대로 */ }
  };
  const year = session.world.year;
  const rules = session.world.rules;

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
  // WAR (근사, league/awards.ts seasonWar)
  const war = useMemo(() => seasonWar(session.world, session.season), [session, version]);
  const warCol: Column = { h: 'WAR', title: '대체 선수보다 몇 승을 더 벌었나 (근사, 시상과 같은 계산)', v: (p) => (war.has(p.idx) ? war.get(p.idx)!.toFixed(1) : '-') };
  const org = session.team.org;
  const first = org.filter((p) => view.registered.has(p.idx));
  const foreign = first.filter((p) => p.foreign).length;
  const nPit = first.filter((p) => p.isPitcher).length;

  const move = (p: SimPlayer, up: boolean) => {
    const res = session.move(p, up);
    setMsg({ ...res, who: res.errors.length ? undefined : `${p.name} ${up ? '1군 등록' : '2군으로 내림'}` });
    changed();
  };

  const toggleAuto = () => {
    if (view.manual) {
      session.setEntry(null);
      setMsg({ errors: [], warnings: [], who: '1군 엔트리를 AI에게 맡겼습니다. 선수를 옮기면 다시 직접 관리로 바뀝니다.' });
    } else {
      const res = session.setEntry(session.registered().map((p) => p.idx));
      setMsg({ ...res, who: '지금 1군 명단으로 직접 관리를 시작합니다.' });
    }
    changed();
  };

  /** 기용 드롭다운 결과 */
  const afterPlan = (res: EntryCheck, who: string) => {
    setMsg({ ...res, who: res.errors.length ? undefined : who });
    changed();
  };
  // 가을야구 중에도 탈락 전까지는 엔트리·기용표를 바꿀 수 있다
  const canPlan = !!view.manual && session.canManage;
  const roleCell = (p: SimPlayer, inFirst: boolean, roleText: string) => {
    if (!inFirst || !canPlan) return roleText;
    if (!p.isPitcher) {
      const cur = session.slotOf(p);
      return (
        <select value={cur ?? ''} aria-label={`${p.name} 자리`} onChange={(e) => {
          const v = (e.target.value || null) as Slot | null;
          afterPlan(session.setHitterSlot(p, v), `${p.name}: ${v ? `주전 ${posName(v)}` : '서브'}`);
        }}>
          <option value="">서브</option>
          {LINEUP_SLOTS.map((s) => (
            <option key={s} value={s}>{posName(s)}{s === 'DH' ? '' : ` (수비 ${defenseGrade(defenseAt(p, s))})`}</option>
          ))}
        </select>
      );
    }
    return (
      <select value={session.pitcherRole(p)} aria-label={`${p.name} 보직`} onChange={(e) => {
        const v = e.target.value as PitcherRole;
        afterPlan(session.setPitcherRole(p, v), `${p.name}: ${PITCHER_ROLE_LABEL[v]}`);
      }}>
        {(Object.keys(PITCHER_ROLE_LABEL) as PitcherRole[]).map((r) => <option key={r} value={r}>{PITCHER_ROLE_LABEL[r]}</option>)}
      </select>
    );
  };
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
    return sortPlayers(rows, sort, kind, session, grades, lg);
  };

  const rows = list(inFirst);
  const nOther = list(!inFirst).length;
  // 고른 선수가 지금 표에 없으면 첫 줄
  const picked = rows.find((p) => p.idx === sel) ?? rows[0];
  /** 줄 누르기: 넓은 화면은 오른쪽 요약, 좁은 화면은 바로 상세 창 */
  const pick = (p: SimPlayer) => {
    if (window.matchMedia('(max-width: 1100px)').matches) openPlayer(p.idx);
    else setSel(p.idx);
  };
  const cols = columnsFor(kind, page);
  const moveBtn = (p: SimPlayer, inF: boolean, big = false) => {
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
    const rd = !inF && view.manual ? session.reregisterDay(p) : null;
    return (
      <button type="button" className={cls} onClick={(e) => { e.stopPropagation(); move(p, !inF); }} disabled={!session.canManage || rd !== null}
        title={rd !== null ? `말소 뒤 10일 규정: ${shortDate(session.world.year, rd)}부터 등록 가능` : inF ? '1군에서 말소하면 10일 동안 다시 등록할 수 없습니다' : undefined}>
        {rd !== null ? `${shortDate(session.world.year, rd)}부터` : inF ? '2군으로' : '1군으로'}
      </button>
    );
  };

  return (
    <div className="stack tight">
      <section className="row-between wrap">
        <div className="muted small roster-sum">
          1군 <strong>{first.length}/{rules.rosterSize}</strong>명 (투수 {nPit}, 야수 {first.length - nPit}) · 외국인 {foreign}/{rules.foreignLimit} ·{' '}
          정식 {session.regularCount()}/{ruleOf(session.league, 'orgLimit')}{org.some((p) => p.dev) ? ` · 육성 ${org.filter((p) => p.dev).length}` : ''} ·{' '}
          {view.manual ? '엔트리 직접 관리' : '엔트리 AI 관리'}{view.manual ? (session.plan ? ' · 기용 직접' : ' · 기용 AI 감독') : ''}
          <details className="help">
            <summary>도움말</summary>
            {view.manual
              ? session.plan
                ? '기용: 직접 정함. 1군의 "역할" 드롭다운으로 야수 자리(서브 포함)와 투수 보직(선발·중계·마무리)을 바꿉니다. 직접 정한 주전은 AI가 쉬게 하지 않고, 결장할 때만 AI 감독이 서브로 채웁니다. 타순과 경기 중 교체는 AI 감독이 합니다.'
                : '기용: AI 감독. 1군의 "역할" 드롭다운을 바꾸면 지금 배치에서 시작해 직접 정하게 됩니다. 타순과 경기 중 교체는 AI 감독이 합니다.'
              : '엔트리를 AI가 관리하는 동안에는 기용도 AI 감독이 정합니다. 역할은 다음 경기 기준 예상입니다.'}
          </details>
        </div>
        <span className="inline">
          {canPlan && session.plan && (
            <button type="button" className="ghost" onClick={() => afterPlan(session.setPlan(null), '기용을 AI 감독에게 맡겼습니다.')}>AI에게 기용 맡기기</button>
          )}
          <button type="button" className="ghost" onClick={toggleAuto} disabled={!session.canManage}>
            {view.manual ? 'AI에게 엔트리 맡기기' : '엔트리 직접 관리하기'}
          </button>
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
            <label className="inline small">
              정렬
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="value">능력 종합</option>
                <option value="name">이름</option>
                <option value="age">나이</option>
                {kind === 'hit' ? (
                  <><option value="g1">컨택</option><option value="g2">파워</option><option value="g3">선구안</option><option value="g4">주력</option><option value="stat">OPS</option><option value="saber">wRC+</option></>
                ) : (
                  <><option value="g1">구위</option><option value="g2">제구</option><option value="g3">장타 억제</option><option value="g4">체력</option><option value="stat">평균자책</option><option value="saber">FIP</option></>
                )}
              </select>
            </label>
          </div>

          {page === 'saber' && (
            <p className="muted small">
              세이버 기록은 이번 시즌 리그 전체 시뮬레이션 기록이 기준입니다 (리그 wOBA {rate3(lg.woba)}, FIP 상수 {fixed2(lg.fipConst)}).
              wRC+는 100이 리그 평균이고 구장 보정이 없습니다. 피BABIP는 희생타 기록이 없어 근사값입니다.
            </p>
          )}

          <div className="scroll flat">
            <table className="roster">
              <thead>
                <tr>
                  <th className="l">이름</th><th className="l">역할</th>
                  {cols.map((c) => <th key={c.h} className={c.l ? 'l' : undefined} title={c.title}>{c.h}</th>)}
                  {!inFirst && <th className="l" title="퓨처스리그(2군) 성적. 능력과 2군 출전 몫으로 만든 값">퓨처스</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const roleText = inFirst || view.callUps.has(p.idx) ? (view.role.get(p.idx) ?? (session.isAbsent(p) ? '결장' : '-')) : '';
                  return (
                    <tr key={p.idx} className={`pick${picked?.idx === p.idx ? ' sel' : ''}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('select, button')) pick(p); }}>
                      <td className="l">
                        <button type="button" className="link name-btn" onClick={(e) => { e.stopPropagation(); pick(p); }}>{p.name}</button>
                        {p.foreign && <span className="tag">외</span>}
                        {p.dev && <span className="tag" title="육성선수: 정원 밖, 정식 등록 전에는 1군에 못 나간다">육성</span>}
                      </td>
                      <td className="l small">{page === 'ability' ? roleCell(p, inFirst, roleText) : roleText}</td>
                      {cols.map((c) => <td key={c.h} className={c.l ? 'l' : undefined}>{c.v(p)}</td>)}
                      {!inFirst && <td className="l small">{futuresText(fut.get(p.idx))}</td>}
                      <td>{moveBtn(p, inFirst)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {picked && <RosterSide p={picked} inFirst={inFirst} status={statusOf(picked)} moveBtn={moveBtn(picked, inFirst, true)} war={war.get(picked.idx)} />}
      </div>

      {kind === 'hit' && inFirst && view.manual && <BattingOrderPanel onResult={(r, who) => { setMsg({ ...r, who }); changed(); }} />}
    </div>
  );

  /** 구분(야수·투수)과 페이지별 열 */
  function columnsFor(k: Kind, pg: Page): Column[] {
    const B = (p: SimPlayer) => session.season.bat[p.idx];
    const P = (p: SimPlayer) => session.season.pit[p.idx];
    const bat = (h: string, v: (b: ReturnType<typeof B>) => ReactNode, title?: string): Column => ({ h, title, v: (p) => (B(p).pa ? v(B(p)) : '-') });
    const pit = (h: string, v: (x: ReturnType<typeof P>) => ReactNode, title?: string): Column => ({ h, title, v: (p) => (P(p).bf ? v(P(p)) : '-') });
    const status: Column = { h: '상태', l: true, v: (p) => statusOf(p) };
    if (k === 'hit') {
      if (pg === 'ability') {
        return [
          { h: '포지션', v: (p) => posName(p.pos) }, { h: '나이', v: (p) => p.age ?? '-' }, { h: '타', v: (p) => (p.bats ? HAND[p.bats] : '-') },
          { h: '컨택', v: (p) => <Grade v={grades.batters.get(p.id)?.contact} /> },
          { h: '파워', v: (p) => <Grade v={grades.batters.get(p.id)?.power} /> },
          { h: '선구안', v: (p) => <Grade v={grades.batters.get(p.id)?.eye} /> },
          { h: '주력', v: (p) => <Grade v={grades.batters.get(p.id)?.speed} /> },
          { h: '수비', title: '지금 자리(서브는 주 포지션)의 수비 등급', v: (p) => <Grade v={defGrade(p)} /> },
          status,
        ];
      }
      if (pg === 'classic') {
        return [
          bat('경기', (b) => b.g), bat('타석', (b) => b.pa), bat('타수', (b) => b.ab), bat('안타', (b) => b.h), bat('2루타', (b) => b.d),
          bat('3루타', (b) => b.t), bat('홈런', (b) => b.hr), bat('타점', (b) => b.rbi), bat('득점', (b) => b.r), bat('볼넷', (b) => b.bb),
          bat('삼진', (b) => b.so), bat('도루', (b) => b.sb), bat('타율', (b) => rate3(avg(b))), bat('출루율', (b) => rate3(obp(b))),
          bat('장타율', (b) => rate3(slg(b))), bat('OPS', (b) => rate3(ops(b))), warCol,
        ];
      }
      return [
        warCol, bat('타석', (b) => b.pa), bat('wOBA', (b) => rate3(woba(b)), '가중 출루율: 타석 결과별 득점 가치로 가중한 출루율'),
        bat('wRC+', (b) => int0(wrcPlus(b, lg)), '조정 득점 창출력: 100 = 리그 평균'),
        bat('wRAA', (b) => fixed1(wraa(b, lg)), '리그 평균 타자보다 더 낸 득점'),
        bat('ISO', (b) => rate3(iso(b)), '순수 장타력: 장타율 - 타율'), bat('BABIP', (b) => rate3(babip(b)), '인플레이 타구 타율'),
        bat('볼넷%', (b) => pct1(bbPct(b))), bat('삼진%', (b) => pct1(kPct(b))), bat('BB/K', (b) => fixed2(bbPerK(b))),
        bat('도루%', (b) => (b.sb + b.cs ? pct1(sbPct(b)) : '-'), '도루 성공률'),
      ];
    }
    if (pg === 'ability') {
      return [
        { h: '나이', v: (p) => p.age ?? '-' }, { h: '투', v: (p) => (p.throws ? HAND[p.throws] : '-') },
        { h: '구위', v: (p) => <Grade v={grades.pitchers.get(p.id)?.stuff} /> },
        { h: '제구', v: (p) => <Grade v={grades.pitchers.get(p.id)?.control} /> },
        { h: '장타 억제', v: (p) => <Grade v={grades.pitchers.get(p.id)?.hrSuppression} /> },
        { h: '선발 체력', title: '선발로 나왔을 때 길게 던지는 정도', v: (p) => <Grade v={grades.pitchers.get(p.id)?.stamina} /> },
        { h: '구원 체력', title: '구원 한 번 등판에 길게 던지는 정도 (롱릴리프)', v: (p) => <Grade v={grades.pitchers.get(p.id)?.reliefStamina} /> },
        status,
      ];
    }
    if (pg === 'classic') {
      return [
        pit('경기', (x) => x.g), pit('선발', (x) => x.gs), pit('승', (x) => x.w), pit('패', (x) => x.l), pit('세이브', (x) => x.sv), pit('홀드', (x) => x.hld ?? 0),
        pit('QS', (x) => x.qs ?? 0, '퀄리티 스타트: 선발로 6이닝 이상 던지고 3자책 이하'), pit('블론', (x) => x.bsv ?? 0, '블론 세이브: 1~3점 리드에 나와 동점·역전을 허용'),
        pit('이닝', (x) => ipText(x.outs)), pit('피안타', (x) => x.h), pit('피홈런', (x) => x.hr), pit('볼넷', (x) => x.bb),
        pit('탈삼진', (x) => x.so), pit('실점', (x) => x.r), pit('자책', (x) => x.er), pit('평균자책', (x) => fixed2(era(x))),
        pit('WHIP', (x) => fixed2(whip(x)), '이닝당 출루 허용: (피안타 + 볼넷) ÷ 이닝'), warCol,
      ];
    }
    return [
      warCol, pit('이닝', (x) => ipText(x.outs)), pit('FIP', (x) => fixed2(fip(x, lg)), '수비 무관 평균자책: 삼진·볼넷·사구·홈런만으로 본 평균자책'),
      pit('ERA-FIP', (x) => fixed2(era(x) - fip(x, lg)), '평균자책 - FIP. 크면 운·수비 덕을 덜 본 것'),
      pit('K/9', (x) => fixed2(per9(x.so, x))), pit('BB/9', (x) => fixed2(per9(x.bb, x))), pit('HR/9', (x) => fixed2(per9(x.hr, x))),
      pit('K%', (x) => pct1(pitKPct(x))), pit('BB%', (x) => pct1(pitBbPct(x))), pit('K-BB%', (x) => pct1(pitKPct(x) - pitBbPct(x))),
      pit('피BABIP', (x) => rate3(pitBabip(x)), '인플레이 타구 피안타율 (근사값)'), pit('잔루율', (x) => pct1(lobPct(x)), 'LOB%: 내보낸 주자를 남긴 비율'),
    ];
  }
}

const fixed1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');

function sortPlayers(rows: SimPlayer[], key: SortKey, kind: Kind, session: ReturnType<typeof useGame>['session'], grades: ReturnType<typeof useGame>['grades'],
                     lg: LeagueBase): SimPlayer[] {
  const gradeOf = (p: SimPlayer, k: 'g1' | 'g2' | 'g3' | 'g4'): number => {
    if (kind === 'hit') {
      const g = grades.batters.get(p.id);
      return g ? [g.contact, g.power, g.eye, g.speed][Number(k[1]) - 1] : 0;
    }
    const g = grades.pitchers.get(p.id);
    return g ? [g.stuff, g.control, g.hrSuppression, g.stamina ?? 0][Number(k[1]) - 1] : 0;
  };
  const statOf = (p: SimPlayer): number => {
    if (kind === 'hit') {
      const v = ops(session.season.bat[p.idx]);
      return Number.isFinite(v) ? v : -1;
    }
    const v = era(session.season.pit[p.idx]);
    return Number.isFinite(v) ? -v : -999;
  };
  /** wRC+ (야수) 또는 -FIP (투수). 기록이 없으면 맨 뒤 */
  const saberOf = (p: SimPlayer): number => {
    const v = kind === 'hit' ? wrcPlus(session.season.bat[p.idx], lg) : -fip(session.season.pit[p.idx], lg);
    return Number.isFinite(v) ? v : -9999;
  };
  const by: Record<SortKey, (a: SimPlayer, b: SimPlayer) => number> = {
    value: (a, b) => (kind === 'hit' ? b.value - a.value : a.value - b.value),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    age: (a, b) => (a.age ?? 99) - (b.age ?? 99),
    g1: (a, b) => gradeOf(b, 'g1') - gradeOf(a, 'g1'),
    g2: (a, b) => gradeOf(b, 'g2') - gradeOf(a, 'g2'),
    g3: (a, b) => gradeOf(b, 'g3') - gradeOf(a, 'g3'),
    g4: (a, b) => gradeOf(b, 'g4') - gradeOf(a, 'g4'),
    stat: (a, b) => statOf(b) - statOf(a),
    saber: (a, b) => saberOf(b) - saberOf(a),
  };
  return [...rows].sort((a, b) => by[key](a, b) || a.idx - b.idx);
}

/** 선수단 오른쪽 요약 칸: 능력 막대, 올해 기록 한 줄, 계약 */
function RosterSide({ p, inFirst, status, moveBtn, war }: { p: SimPlayer; inFirst: boolean; status: ReactNode; moveBtn: ReactNode; war?: number }) {
  const { session, grades, openPlayer } = useGame();
  const won = useWon();
  const lp = session.leaguePlayer(p.id);
  const bg = grades.batters.get(p.id);
  const pg = grades.pitchers.get(p.id);
  const b = session.season.bat[p.idx];
  const x = session.season.pit[p.idx];
  const line = p.isPitcher
    ? (x.bf ? `${x.g}경기 ${x.w}승 ${x.l}패${x.sv ? ` ${x.sv}세이브` : ''} · ${ipText(x.outs)}이닝 · 평균자책 ${fixed2(era(x))} · 탈삼진 ${x.so}` : '올해 1군 등판 없음')
    : (b.pa ? `타율 ${rate3(avg(b))} · OPS ${rate3(ops(b))} · ${b.hr}홈런 · ${b.rbi}타점${b.sb ? ` · ${b.sb}도루` : ''}` : '올해 1군 타석 없음');
  return (
    <aside className="card roster-side" aria-label={`${p.name} 요약`}>
      <header className="side-head">
        <span className="small">{p.isPitcher ? `투수 · ${p.throws ? HAND[p.throws] : '-'}투` : `${posName(p.pos)} · ${p.bats ? HAND[p.bats] : '-'}타`} · {p.age !== null ? `${p.age}세` : '나이 미상'} · {inFirst ? '1군' : '2군'}</span>
        <strong>{p.name}{p.foreign && <span className="tag">외국인</span>}</strong>
      </header>
      <div className="side-body">
        {status && <p>{status}</p>}
        <div className="grades">
          {p.isPitcher && pg ? (
            <>
              <GradeBar label="구위" v={pg.stuff} /><GradeBar label="제구" v={pg.control} />
              <GradeBar label="장타 억제" v={pg.hrSuppression} /><GradeBar label="선발 체력" v={pg.stamina} />
            </>
          ) : bg ? (
            <>
              <GradeBar label="컨택" v={bg.contact} /><GradeBar label="파워" v={bg.power} />
              <GradeBar label="선구안" v={bg.eye} /><GradeBar label="주력" v={bg.speed} />
            </>
          ) : null}
        </div>
        <p className="small">{session.world.year} {line}{war !== undefined ? ` · WAR ${war.toFixed(1)}` : ''}</p>
        {lp && (
          <p className="small muted">
            {lp.contract.kind === 'foreign' ? dollarText(lp.contract.salary) : won(lp.contract.salary)} · {lp.contract.until}년까지 · 잠재력 <Grade v={runsGrade(lp.scoutPotential ?? lp.potential, session.year)} />
          </p>
        )}
        <p className="inline">
          <button type="button" onClick={() => openPlayer(p.idx)}>자세히</button>
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

/** 타순 (자리 순서로 정한다: 그 자리에 나온 선수가 그 타순. 결장 때는 서브가 그 타순에 선다) */
function BattingOrderPanel({ onResult }: { onResult: (r: EntryCheck, who?: string) => void }) {
  const { session } = useGame();
  const { order, manual } = session.battingOrderSlots();
  const plan = session.effectivePlan();
  const name = (s: Slot) => {
    const i = plan.starters[s];
    return i === undefined ? '(AI가 채움)' : session.world.players[i].name;
  };
  /** k번 타순에 자리 s를 놓는다: 원래 s가 있던 타순과 맞바꾼다 (9번을 1번으로 한 번에) */
  const put = (k: number, s: Slot) => {
    const next = [...order];
    const j = next.indexOf(s);
    if (j < 0 || j === k) return;
    [next[k], next[j]] = [next[j], next[k]];
    const r = session.setBattingOrder(next);
    onResult(r, r.errors.length ? undefined : `${k + 1}번 타자: ${posName(s)} ${name(s)}`);
  };
  return (
    <section className="panel">
      <div className="row-between">
        <h2>타순 <span className="muted small">{manual ? '직접 정함' : 'AI 감독 (바꾸면 직접 정한 타순이 됩니다)'}</span></h2>
        {manual && <button type="button" className="ghost small-btn" onClick={() => { const r = session.setBattingOrder(null); onResult(r, r.errors.length ? undefined : '타순을 AI 감독에게 맡겼습니다.'); }}>AI에게 타순 맡기기</button>}
      </div>
      <ol className="order-list">
        {order.map((s, k) => (
          <li key={s}>
            <span className="muted small order-no">{k + 1}번</span>
            <select value={s} aria-label={`${k + 1}번 타자`} disabled={!session.canManage} onChange={(e) => put(k, e.target.value as Slot)}>
              {order.map((x) => <option key={x} value={x}>{posName(x)} · {name(x)}</option>)}
            </select>
          </li>
        ))}
      </ol>
      <p className="muted small">타순 칸에서 선수를 고르면 원래 그 선수가 있던 타순과 서로 바뀝니다. 타순은 자리 기준이라, 그 자리 주전이 빠지면 대신 나온 선수가 같은 타순에 섭니다.</p>
    </section>
  );
}
