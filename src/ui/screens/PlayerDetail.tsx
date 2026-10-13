// 선수 상세: 능력치(20~80), 이번 시즌 기록, 직전 시즌 기록(게임에서 치른 시즌은 게임 기록, 그 전은 실제 기록), 계약.
import { lineTeam } from '../../engine';
import { ReleaseButton } from './Market';
import { postseasonLines, psFromRecord, psLineText } from '../../league/postseason';
import { futuresText } from './Roster';
import { futuresFromRecord, type FuturesLine } from '../../league/futures';
import { useEffect, useRef, useState } from 'react';
import type { BatRow, PitRow } from '../../data/types';
import { absenceLabel, defenseAt, defenseGrade, emptyBatLine, emptyPitLine, FIELD_POS, isVirtual, playablePositions, type SimPlayer } from '../../engine';
import { shortDate } from '../../game/calendar';
import { avg, era, fixed2, ipText, obp, ops, rate3, slg, whip } from '../../game/stats';
import { dollarText } from '../../league/salary';
import { Grade, gradeClass, HAND, posName, TeamName, useGame, useWon } from '../context';
import { runsGrade } from '../grades';
import { teamVars } from '../teams';
import { seasonWar } from '../../league/awards';

export function PlayerDetail({ idx, onClose }: { idx: number; onClose: () => void }) {
  const { session, grades, store, changed } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const p = session.world.players[idx];
  const year = session.world.year;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const mine = p.teamIdx === session.teamIdx;
  const registered = session.registered().some((x) => x.idx === p.idx);
  const back = session.returnDay(p);
  const master = store.players.get(p.id);
  // 직전 3시즌 기록: 게임에서 치른 시즌은 게임 기록, 게임 시작 전 시즌만 실제 기록 (시작 연도 실제 기록은 미리 보여주지 않는다).
  // 2026-10-12 사용자: "실제 기록을 띄워주는 건 의미가 없다, 게임에서 있었던 기록을 표시해야 한다"
  const lp = session.leaguePlayer(p.id);
  const start = session.league.startYear;
  const decode = <T extends object>(empty: T, arr: number[]): T => Object.fromEntries(Object.keys(empty).map((k, i) => [k, arr[i] ?? 0])) as T;
  const history: { label: string; bat?: BatLike; pit?: PitLike }[] = [year - 1, year - 2, year - 3].flatMap((y) => {
    if (y >= start) {
      return (lp?.history ?? []).filter((h) => h.year === y && (p.isPitcher ? h.pit : h.bat)).map((h) => ({
        label: `${y} ${h.team}`,
        ...(p.isPitcher ? { pit: decode(emptyPitLine(), h.pit!) } : { bat: decode(emptyBatLine(), h.bat!) }),
      }));
    }
    const s = store.season(y);
    const row = s && (p.isPitcher ? s.pit.find((r) => r.id === p.id) : s.bat.find((r) => r.id === p.id));
    if (!row) return [];
    const label = `${y} ${row.team} (게임 전 실제)`;
    return [p.isPitcher ? { label, pit: pitFromRow(row as PitRow) } : { label, bat: batFromRow(row as BatRow) }];
  });

  const bg = grades.batters.get(p.id);
  const pg = grades.pitchers.get(p.id);

  const move = () => {
    session.move(p, !registered);
    changed();
  };

  return (
    <dialog ref={ref} className="player tv" style={lineTeam(p) >= 0 ? teamVars(session.teamInfo(lineTeam(p)).franchise, session.teamInfo(lineTeam(p)).name) : undefined}
      onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} aria-labelledby="player-name">
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2 id="player-name">{p.name}{p.foreign && <span className="tag">외국인</span>}</h2>
            <p className="muted">
              <TeamName idx={p.teamIdx} />{p.teamIdx < 0 && p.formerTeam !== undefined && <span className="muted"> (전 {session.teamInfo(p.formerTeam).name}, 방출)</span>} · {p.isPitcher ? `투수 (${p.throws ? HAND[p.throws] : '-'}투)` : `${posName(p.pos)} (${p.bats ? HAND[p.bats] : '-'}타)`}
              {' · '}{p.age !== null ? `${p.ageEstimated ? '약 ' : ''}${p.age}세` : '나이 미상'}
              {master?.entryYear ? ` · ${master.entryYear}년 입단` : ''}
            </p>
            <p className="small">
              {mine ? (registered ? '1군' : '2군') : p.teamIdx < 0 ? '시장 (영입은 선수단 → 선수 시장)' : '다른 구단'}
              {back !== null && (
                <span className="status out"> {session.absenceReason(p)} · {back >= session.season.schedule.length ? '이번 시즌 복귀 어려움' : `${shortDate(year, back)} 복귀 예정`}</span>
              )}
            </p>
          </div>
          <button type="button" className="ghost" onClick={() => ref.current?.close()} aria-label="닫기">닫기</button>
        </header>
        {mine && session.phase === 'season' && !session.done && <p className="small"><ReleaseButton p={p} onDone={() => ref.current?.close()} /></p>}

        <section>
          <h3>능력치 <span className="muted small">20~80, 50이 리그 주전 평균</span></h3>
          <div className="grades">
            {p.isPitcher && pg ? (
              <>
                <GradeBar label="구위" v={pg.stuff} /><GradeBar label="제구" v={pg.control} />
                <GradeBar label="장타 억제" v={pg.hrSuppression} /><GradeBar label="선발 체력" v={pg.stamina} />
                <GradeBar label="구원 체력" v={pg.reliefStamina} />
              </>
            ) : bg ? (
              <>
                <GradeBar label="컨택" v={bg.contact} /><GradeBar label="파워" v={bg.power} />
                <GradeBar label="선구안" v={bg.eye} /><GradeBar label="주력" v={bg.speed} />
              </>
            ) : null}
          </div>
          {!p.isPitcher && <DefenseInfo p={p} />}
          {p.debutEstimate && <p className="note small">직전 기록이 없어 {year}년 기록을 크게 보정해 능력을 추정한 선수입니다 (잠재력 모델 도입 전 임시 처리).</p>}
        </section>

        <section>
          <h3>{year} 시즌 기록 (시뮬레이션){(() => { const w = session.phase === 'season' ? seasonWar(session.world, session.season).get(p.idx) : undefined; return w !== undefined ? <span className="muted small"> · WAR {w.toFixed(1)}</span> : null; })()}</h3>
          <div className="scroll">
            {p.isPitcher ? <PitTable rows={[{ label: String(year), l: session.season.pit[p.idx] }]} /> : <BatTable rows={[{ label: String(year), l: session.season.bat[p.idx] }]} />}
          </div>
          {session.phase === 'season' && p.teamIdx >= 0 && (() => {
            const f = futuresText(session.futures().lines.get(p.idx));
            return f !== '-' ? <p className="small">퓨처스리그(2군): {f}</p> : null;
          })()}
        </section>

        {(() => {
          // 퓨처스리그(2군) 시즌별 기록 (2026-10-12부터 결산 때 남긴다)
          const fut = [...(lp?.history ?? [])].filter((h) => h.fbat || h.fpit).reverse();
          if (!fut.length) return null;
          return (
            <section>
              <h3>퓨처스리그 기록 <span className="muted small">2군에서 뛴 시즌</span></h3>
              <ul className="plain small">
                {fut.map((h) => <li key={`${h.year}-${h.team}`}>{h.year} {h.team}: {futuresText(futuresFromRecord(h.fbat, h.fpit) as FuturesLine)}</li>)}
              </ul>
            </section>
          );
        })()}

        {(() => {
          // 가을야구 기록 (2026-10-12부터 결산 때 남긴다). 진행 중인 가을야구는 박스스코어로
          const rows = [...(lp?.history ?? [])].filter((h) => h.pbat || h.ppit).reverse()
            .map((h) => ({ key: `${h.year}`, label: `${h.year} ${h.team}`, l: psFromRecord(p.idx, h.pbat, h.ppit) }));
          const live = session.postseason ? postseasonLines(session.postseason.series.flatMap((x) => x.games)).get(p.idx) : undefined;
          if (live && session.phase === 'season') rows.unshift({ key: 'now', label: `${year} 진행 중`, l: live });
          if (!rows.length) return null;
          return (
            <section>
              <h3>가을야구 기록</h3>
              <ul className="plain small">{rows.map((r) => <li key={r.key}>{r.label}: {psLineText(r.l, p.isPitcher)}</li>)}</ul>
            </section>
          );
        })()}

        <section>
          <h3>직전 시즌 기록 <span className="muted small">게임에서 치른 시즌은 이 게임의 기록</span></h3>
          {history.length === 0 ? <p className="muted small">직전 3시즌에 1군 기록이 없습니다.</p> : (
            <div className="scroll">
              {p.isPitcher ? (
                <PitTable rows={history.map((h) => ({ label: h.label, l: h.pit! }))} />
              ) : (
                <BatTable rows={history.map((h) => ({ label: h.label, l: h.bat! }))} />
              )}
            </div>
          )}
        </section>

        <ContractInfo id={p.id} />
        <CareerInfo p={p} />

        {mine && session.canManage && (
          <div className="actions">
            <button type="button" onClick={move}>{registered ? '2군으로 내리기' : '1군에 등록하기'}</button>
          </div>
        )}
      </div>
    </dialog>
  );
}

const KIND_LABEL: Record<string, string> = { reserve: '보류 선수 (해마다 협상)', rookie: '신인', fa: 'FA 계약', nonFA: '비FA 다년 계약', foreign: '외국인 (1년)' };

function ContractInfo({ id }: { id: string }) {
  const { session } = useGame();
  const won = useWon();
  const lp = session.leaguePlayer(id);
  if (!lp) return null;
  const c = lp.contract;
  return (
    <section>
      <h3>계약과 잠재력</h3>
      <dl className="facts">
        <dt>계약</dt><dd>{KIND_LABEL[c.kind]} · {c.kind === 'foreign' ? dollarText(c.salary) : won(c.salary)} · {c.until}년까지</dd>
        <dt>잠재력</dt><dd><Grade v={runsGrade(lp.scoutPotential ?? lp.potential, session.year)} />{lp.scoutPotential !== undefined && <span className="muted small"> (스카우트 평가)</span>}</dd>
        {!lp.foreign && <><dt>FA</dt><dd>1군 연차 {lp.service}년{lp.faCount ? ` · FA 계약 ${lp.faCount}회` : ''}</dd></>}
      </dl>
      {session.phase === 'season' && <p className="muted small">시즌 중에는 개막 때 계약 기준입니다.</p>}
    </section>
  );
}

/** 포지션별 수비 등급 (20~80, 50 = 그 자리 평균 수비수). 직접 고치기 (2026-10-13 사용자 선택) */
function DefenseInfo({ p }: { p: SimPlayer }) {
  const { session, changed, autosave } = useGame();
  const [edit, setEdit] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const playable = playablePositions(p.bat?.def);
  const open = () => setEdit(Object.fromEntries(FIELD_POS.map((q) => [q, defenseGrade(defenseAt(p, q))])));
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
        수비{session.phase === 'season' && (session.season.errors[p.idx] ?? 0) > 0 ? <span className="muted"> 이번 시즌 실책 {session.season.errors[p.idx]}개 ·</span> : null} <span className="muted">포지션별, 50이 그 자리 평균 · 맡길 만한 자리: {playable.length ? playable.map((q) => posName(q)).join(', ') : '없음 (지명타자)'}</span>
        {!edit && p.bat && <button type="button" className="link small" onClick={open}>고치기</button>}
      </h4>
      {edit ? (
        <div className="defense-edit">
          {FIELD_POS.map((q) => (
            <label key={q} className="small">
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
          {FIELD_POS.map((q) => <GradeBar key={q} label={posName(q)} v={defenseGrade(defenseAt(p, q))} />)}
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
      <p className="muted small">KBO가 수비 기록의 자동 수집을 막고 있어, 커리어에 맡은 포지션·주력·나이와 KBO 수비상(2023~) 순위로 만든 추정값입니다. 실제와 다르면 "고치기"로 바꾸세요. 실책률은 그 자리 수비 등급에 따라 달라집니다 (실책 출루 기준).</p>
    </div>
  );
}

const MILITARY_LABEL: Record<string, string> = { pending: '미필', serving: '복무 중', done: '마침', exempt: '면제' };

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
            <dd>{past.map((x) => `${x.year} ${absenceLabel({ kind: x.kind }, p)} ${x.days}일${x.seasonOut ? '(시즌 아웃)' : ''}`).join(', ')}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

export function GradeBar({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="gbar">
      <span>{label}</span>
      <span className="track" aria-hidden><i className={gradeClass(v)} style={{ width: `${v === null ? 0 : ((v - 20) / 60) * 100}%` }} /></span>
      <Grade v={v} />
    </div>
  );
}

type BatLike = { g: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; rbi: number; r: number; bb: number; hbp: number; so: number; sb: number; sf: number };
type PitLike = { g: number; gs: number; w: number; l: number; sv: number; outs: number; h: number; hr: number; bb: number; so: number; er: number; hld?: number };

function batFromRow(r: BatRow): BatLike {
  return { g: r.g, pa: r.pa, ab: r.ab, h: r.h, d: r.d, t: r.t, hr: r.hr, rbi: r.rbi, r: r.r, bb: r.bb ?? 0, hbp: r.hbp ?? 0, so: r.so ?? 0, sb: r.sb ?? 0, sf: r.sf ?? 0 };
}

function pitFromRow(r: PitRow): PitLike {
  return { g: r.g, gs: r.gs ?? 0, w: r.w, l: r.l, sv: r.sv, outs: r.outs, h: r.h, hr: r.hr, bb: r.bb, so: r.so, er: r.er };
}

function BatTable({ rows }: { rows: { label: string; l: BatLike }[] }) {
  return (
    <table>
      <thead><tr><th className="l">시즌</th><th>경기</th><th>타석</th><th>타율</th><th>출루율</th><th>장타율</th><th>OPS</th><th>안타</th><th>홈런</th><th>타점</th><th>득점</th><th>볼넷</th><th>삼진</th><th>도루</th></tr></thead>
      <tbody>
        {rows.map(({ label, l }) => {
          const b = { ...l, cs: 0, gdp: 0, sac: 0 };
          return (
            <tr key={label}>
              <td className="l">{label}</td><td>{l.g}</td><td>{l.pa}</td><td>{rate3(avg(b))}</td><td>{rate3(obp(b))}</td><td>{rate3(slg(b))}</td><td>{rate3(ops(b))}</td>
              <td>{l.h}</td><td>{l.hr}</td><td>{l.rbi}</td><td>{l.r}</td><td>{l.bb}</td><td>{l.so}</td><td>{l.sb}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PitTable({ rows }: { rows: { label: string; l: PitLike }[] }) {
  return (
    <table>
      <thead><tr><th className="l">시즌</th><th>경기</th><th>선발</th><th>승</th><th>패</th><th>세이브</th><th>홀드</th><th>이닝</th><th>평균자책</th><th>WHIP</th><th>피안타</th><th>피홈런</th><th>볼넷</th><th>탈삼진</th></tr></thead>
      <tbody>
        {rows.map(({ label, l }) => {
          const p = { ...l, bf: 0, hbp: 0, r: 0, hld: l.hld ?? 0 };
          return (
            <tr key={label}>
              <td className="l">{label}</td><td>{l.g}</td><td>{l.gs}</td><td>{l.w}</td><td>{l.l}</td><td>{l.sv}</td><td>{l.hld ?? '-'}</td><td>{ipText(l.outs)}</td>
              <td>{fixed2(era(p))}</td><td>{fixed2(whip(p))}</td><td>{l.h}</td><td>{l.hr}</td><td>{l.bb}</td><td>{l.so}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
