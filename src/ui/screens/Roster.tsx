// 선수단: 1군·2군 명단과 엔트리 이동. 라인업·로테이션은 AI 감독이 1군 안에서 정한다.
import { useMemo, useState } from 'react';
import { defenseAt, defenseGrade, fieldPosOf, LINEUP_SLOTS, type SimPlayer, type Slot } from '../../engine';
import { shortDate } from '../../game/calendar';
import { PITCHER_ROLE_LABEL, type EntryCheck, type PitcherRole } from '../../game/session';
import { era, fixed2, ipText, ops, rate3, avg } from '../../game/stats';
import { Grade, HAND, PlayerLink, posName, useGame } from '../context';

type Kind = 'hit' | 'pit';
type SortKey = 'value' | 'name' | 'age' | 'g1' | 'g2' | 'g3' | 'g4' | 'stat';


export function Roster() {
  const { session, grades, changed, version } = useGame();
  const [kind, setKind] = useState<Kind>('hit');
  const [sort, setSort] = useState<SortKey>('value');
  const [msg, setMsg] = useState<(EntryCheck & { who?: string }) | null>(null);
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
    return sortPlayers(rows, sort, kind, session, grades);
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
        <label className="inline small">
          정렬
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="value">능력 종합</option>
            <option value="name">이름</option>
            <option value="age">나이</option>
            {kind === 'hit' ? (
              <><option value="g1">컨택</option><option value="g2">파워</option><option value="g3">선구안</option><option value="g4">주력</option><option value="stat">OPS</option></>
            ) : (
              <><option value="g1">구위</option><option value="g2">제구</option><option value="g3">장타 억제</option><option value="g4">체력</option><option value="stat">평균자책</option></>
            )}
          </select>
        </label>
      </div>

      <ServingList />

      {[true, false].map((inFirst) => (
        <section key={String(inFirst)}>
          <h2>{inFirst ? '1군' : '2군'} <span className="muted small">{list(inFirst).length}명</span></h2>
          <div className="scroll">
            <table className="roster">
              <thead>
                {kind === 'hit' ? (
                  <tr>
                    <th className="l">이름</th><th className="l">역할</th><th>포지션</th><th>나이</th><th>타</th>
                    <th>컨택</th><th>파워</th><th>선구안</th><th>주력</th><th title="지금 자리(서브는 주 포지션)의 수비 등급">수비</th>
                    <th>경기</th><th>타율</th><th>홈런</th><th>OPS</th><th className="l">상태</th><th />
                  </tr>
                ) : (
                  <tr>
                    <th className="l">이름</th><th className="l">역할</th><th>나이</th><th>투</th>
                    <th>구위</th><th>제구</th><th>장타 억제</th><th title="선발로 나왔을 때 길게 던지는 정도">선발 체력</th><th title="구원 한 번 등판에 길게 던지는 정도 (롱릴리프)">구원 체력</th>
                    <th>경기</th><th>이닝</th><th>평균자책</th><th>승-패-세</th><th className="l">상태</th><th />
                  </tr>
                )}
              </thead>
              <tbody>
                {list(inFirst).map((p) => {
                  const roleText = inFirst || view.callUps.has(p.idx) ? (view.role.get(p.idx) ?? (session.isAbsent(p) ? '결장' : '-')) : '';
                  const btn = (
                    <button type="button" className="small-btn" onClick={() => move(p, !inFirst)} disabled={session.done}>
                      {inFirst ? '2군으로' : '1군으로'}
                    </button>
                  );
                  if (kind === 'hit') {
                    const g = grades.batters.get(p.id);
                    const b = session.season.bat[p.idx];
                    return (
                      <tr key={p.idx}>
                        <td className="l"><PlayerLink p={p} /></td><td className="l small">{roleCell(p, inFirst, roleText)}</td>
                        <td>{posName(p.pos)}</td><td>{p.age ?? '-'}</td><td>{p.bats ? HAND[p.bats] : '-'}</td>
                        <td><Grade v={g?.contact} /></td><td><Grade v={g?.power} /></td><td><Grade v={g?.eye} /></td><td><Grade v={g?.speed} /></td>
                        <td><Grade v={defGrade(p)} /></td>
                        <td>{b.g}</td><td>{rate3(avg(b))}</td><td>{b.hr}</td><td>{rate3(ops(b))}</td>
                        <td className="l">{statusOf(p)}</td><td>{btn}</td>
                      </tr>
                    );
                  }
                  const g = grades.pitchers.get(p.id);
                  const s = session.season.pit[p.idx];
                  return (
                    <tr key={p.idx}>
                      <td className="l"><PlayerLink p={p} /></td><td className="l small">{roleCell(p, inFirst, roleText)}</td>
                      <td>{p.age ?? '-'}</td><td>{p.throws ? HAND[p.throws] : '-'}</td>
                      <td><Grade v={g?.stuff} /></td><td><Grade v={g?.control} /></td><td><Grade v={g?.hrSuppression} /></td><td><Grade v={g?.stamina} /></td>
                      <td><Grade v={g?.reliefStamina} /></td>
                      <td>{s.g}</td><td>{ipText(s.outs)}</td><td>{fixed2(era(s))}</td><td>{s.w}-{s.l}-{s.sv}</td>
                      <td className="l">{statusOf(p)}</td><td>{btn}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function sortPlayers(rows: SimPlayer[], key: SortKey, kind: Kind, session: ReturnType<typeof useGame>['session'], grades: ReturnType<typeof useGame>['grades']): SimPlayer[] {
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
  const by: Record<SortKey, (a: SimPlayer, b: SimPlayer) => number> = {
    value: (a, b) => (kind === 'hit' ? b.value - a.value : a.value - b.value),
    name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    age: (a, b) => (a.age ?? 99) - (b.age ?? 99),
    g1: (a, b) => gradeOf(b, 'g1') - gradeOf(a, 'g1'),
    g2: (a, b) => gradeOf(b, 'g2') - gradeOf(a, 'g2'),
    g3: (a, b) => gradeOf(b, 'g3') - gradeOf(a, 'g3'),
    g4: (a, b) => gradeOf(b, 'g4') - gradeOf(a, 'g4'),
    stat: (a, b) => statOf(b) - statOf(a),
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
