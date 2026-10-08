// 선수단: 1군·2군 명단과 엔트리 이동. 라인업·로테이션은 AI 감독이 1군 안에서 정한다.
import { useMemo, useState, type ReactNode } from 'react';
import { defenseAt, defenseGrade, fieldPosOf, LINEUP_SLOTS, type SimPlayer, type Slot } from '../../engine';
import { shortDate } from '../../game/calendar';
import { PITCHER_ROLE_LABEL, type EntryCheck, type PitcherRole } from '../../game/session';
import {
  babip, bbPct, bbPerK, fip, int0, iso, kPct, leagueBase, lobPct, pct1, per9, pitBabip, pitBbPct, pitKPct, sbPct, woba, wraa, wrcPlus,
  type LeagueBase,
} from '../../game/saber';
import { avg, era, fixed2, ipText, obp, ops, rate3, slg, whip } from '../../game/stats';
import { Grade, HAND, PlayerLink, posName, useGame } from '../context';

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
  const { session, grades, changed, version } = useGame();
  const [kind, setKind] = useState<Kind>('hit');
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
    for (const p of ts.bullpen) role.set(p.idx, p === ts.closer ? '마무리' : '구원');
    for (const p of ts.hitters) {
      const s = session.slotOf(p);
      role.set(p.idx, s ? `주전 ${posName(s)}` : '서브');
    }
    return { manual, registered, callUps, role };
  }, [session, version]); // version: 세션 내용이 바뀌면 다시 계산

  // 세이버 기록의 리그 기준값 (이번 시즌 리그 전체 시뮬레이션 기록)
  const lg = useMemo(() => leagueBase(session.season.bat, session.season.pit), [session, version]);
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
  const canPlan = !!view.manual && !session.done;
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

  const list = (inFirst: boolean) => {
    const rows = org.filter((p) => (kind === 'pit') === p.isPitcher && view.registered.has(p.idx) === inFirst);
    return sortPlayers(rows, sort, kind, session, grades, lg);
  };

  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <h1>선수단</h1>
          <p className="muted small">
            1군 {first.length}/{rules.rosterSize}명 (투수 {nPit}, 야수 {first.length - nPit}) · 외국인 {foreign}/{rules.foreignLimit}명 ·{' '}
            {view.manual ? '엔트리 직접 관리' : '엔트리 AI가 관리'}
          </p>
        </div>
        <button type="button" className="ghost" onClick={toggleAuto} disabled={session.done}>
          {view.manual ? 'AI에게 엔트리 맡기기' : '엔트리 직접 관리하기'}
        </button>
      </section>
      <section className="row-between wrap">
        <p className="muted small">
          {view.manual
            ? session.plan
              ? '기용: 직접 정함. 1군의 "역할" 드롭다운으로 야수 자리(서브 포함)와 투수 보직(선발·중계·마무리)을 바꿉니다. 쉬거나 결장한 주전 자리는 AI 감독이 서브로 채우고, 타순과 경기 중 교체는 AI 감독이 합니다.'
              : '기용: AI 감독. 1군의 "역할" 드롭다운을 바꾸면 지금 배치에서 시작해 직접 정하게 됩니다. 타순과 경기 중 교체는 AI 감독이 합니다.'
            : '엔트리를 AI가 관리하는 동안에는 기용도 AI 감독이 정합니다. 역할은 다음 경기 기준 예상입니다.'}
        </p>
        {canPlan && session.plan && (
          <button type="button" className="ghost" onClick={() => afterPlan(session.setPlan(null), '기용을 AI 감독에게 맡겼습니다.')}>AI에게 기용 맡기기</button>
        )}
      </section>

      {msg && (msg.errors.length > 0 || msg.warnings.length > 0 || msg.who) && (
        <div className={msg.errors.length ? 'note error-box' : 'note'} role="status">
          {msg.errors.map((e) => <p key={e}>{e}</p>)}
          {msg.who && <p>{msg.who}</p>}
          {msg.warnings.map((w) => <p key={w} className="small">{w}</p>)}
        </div>
      )}

      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="선수 구분">
          <button type="button" role="tab" aria-selected={kind === 'hit'} className={kind === 'hit' ? 'on' : ''} onClick={() => setKind('hit')}>야수</button>
          <button type="button" role="tab" aria-selected={kind === 'pit'} className={kind === 'pit' ? 'on' : ''} onClick={() => setKind('pit')}>투수</button>
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

      <ServingList />

      {page === 'saber' && (
        <p className="muted small">
          세이버 기록은 이번 시즌 리그 전체 시뮬레이션 기록이 기준입니다 (리그 wOBA {rate3(lg.woba)}, FIP 상수 {fixed2(lg.fipConst)}).
          wRC+는 100이 리그 평균이고 구장 보정이 없습니다. 피BABIP는 희생타 기록이 없어 근사값입니다.
        </p>
      )}

      {[true, false].map((inFirst) => {
        const cols = columnsFor(kind, page);
        return (
          <section key={String(inFirst)}>
            <h2>{inFirst ? '1군' : '2군'} <span className="muted small">{list(inFirst).length}명</span></h2>
            <div className="scroll">
              <table className="roster">
                <thead>
                  <tr>
                    <th className="l">이름</th><th className="l">역할</th>
                    {cols.map((c) => <th key={c.h} className={c.l ? 'l' : undefined} title={c.title}>{c.h}</th>)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list(inFirst).map((p) => {
                    const roleText = inFirst || view.callUps.has(p.idx) ? (view.role.get(p.idx) ?? (session.isAbsent(p) ? '결장' : '-')) : '';
                    return (
                      <tr key={p.idx}>
                        <td className="l"><PlayerLink p={p} /></td>
                        <td className="l small">{page === 'ability' ? roleCell(p, inFirst, roleText) : roleText}</td>
                        {cols.map((c) => <td key={c.h} className={c.l ? 'l' : undefined}>{c.v(p)}</td>)}
                        <td>
                          <button type="button" className="small-btn" onClick={() => move(p, !inFirst)} disabled={session.done}>
                            {inFirst ? '2군으로' : '1군으로'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
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
          bat('장타율', (b) => rate3(slg(b))), bat('OPS', (b) => rate3(ops(b))),
        ];
      }
      return [
        bat('타석', (b) => b.pa), bat('wOBA', (b) => rate3(woba(b)), '가중 출루율: 타석 결과별 득점 가치로 가중한 출루율'),
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
        pit('경기', (x) => x.g), pit('선발', (x) => x.gs), pit('승', (x) => x.w), pit('패', (x) => x.l), pit('세이브', (x) => x.sv),
        pit('이닝', (x) => ipText(x.outs)), pit('피안타', (x) => x.h), pit('피홈런', (x) => x.hr), pit('볼넷', (x) => x.bb),
        pit('탈삼진', (x) => x.so), pit('실점', (x) => x.r), pit('자책', (x) => x.er), pit('평균자책', (x) => fixed2(era(x))),
        pit('WHIP', (x) => fixed2(whip(x)), '이닝당 출루 허용: (피안타 + 볼넷) ÷ 이닝'),
      ];
    }
    return [
      pit('이닝', (x) => ipText(x.outs)), pit('FIP', (x) => fixed2(fip(x, lg)), '수비 무관 평균자책: 삼진·볼넷·사구·홈런만으로 본 평균자책'),
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

/** 군 복무 중인 우리 선수 (경기에 나오지 않고 정원에서도 빠진다) */
function ServingList() {
  const { session } = useGame();
  const list = session.servingPlayers();
  if (!list.length) return null;
  return (
    <p className="note small">
      군 복무 중 {list.length}명 (정원 제외): {list.map((p) => `${p.name}(${p.isPitcher ? '투수' : posName(p.pos)}, ${p.military?.returnYear}년 시즌 중 복귀)`).join(', ')}
    </p>
  );
}
