// 선수 상세: 능력치(20~80), 이번 시즌 기록, 직전 시즌 실제 기록, 계약.
import { useEffect, useRef } from 'react';
import type { BatRow, PitRow } from '../../data/types';
import { absenceLabel, defenseAt, defenseGrade, FIELD_POS, isVirtual, playablePositions, type SimPlayer } from '../../engine';
import { shortDate } from '../../game/calendar';
import { avg, era, fixed2, ipText, obp, ops, rate3, slg, whip } from '../../game/stats';
import { dollarText, wonText } from '../../league/salary';
import { Grade, HAND, posName, TeamName, useGame } from '../context';
import { runsGrade } from '../grades';

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
  // 직전 3시즌 실제 기록 (시작 연도 기록은 미리 보여주지 않는다)
  const history = [year - 1, year - 2, year - 3]
    .map((y) => {
      const s = store.season(y);
      if (!s) return null;
      const row = p.isPitcher ? s.pit.find((r) => r.id === p.id) : s.bat.find((r) => r.id === p.id);
      return row ? { y, row } : null;
    })
    .filter((x): x is { y: number; row: BatRow | PitRow } => x !== null);

  const bg = grades.batters.get(p.id);
  const pg = grades.pitchers.get(p.id);

  const move = () => {
    session.move(p, !registered);
    changed();
  };

  return (
    <dialog ref={ref} className="player" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} aria-labelledby="player-name">
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2 id="player-name">{p.name}{p.foreign && <span className="tag">외국인</span>}</h2>
            <p className="muted">
              <TeamName idx={p.teamIdx} /> · {p.isPitcher ? `투수 (${p.throws ? HAND[p.throws] : '-'}투)` : `${posName(p.pos)} (${p.bats ? HAND[p.bats] : '-'}타)`}
              {' · '}{p.age !== null ? `${p.age}세` : '나이 미상'}
              {master?.entryYear ? ` · ${master.entryYear}년 입단` : ''}
            </p>
            <p className="small">
              {mine ? (registered ? '1군' : '2군') : '다른 구단'}
              {back !== null && (
                <span className="status out"> {session.absenceReason(p)} · {back >= session.season.schedule.length ? '이번 시즌 복귀 어려움' : `${shortDate(year, back)} 복귀 예정`}</span>
              )}
            </p>
          </div>
          <button type="button" className="ghost" onClick={() => ref.current?.close()} aria-label="닫기">닫기</button>
        </header>

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
          <h3>{year} 시즌 기록 (시뮬레이션)</h3>
          <div className="scroll">
            {p.isPitcher ? <PitTable rows={[{ label: String(year), l: session.season.pit[p.idx] }]} /> : <BatTable rows={[{ label: String(year), l: session.season.bat[p.idx] }]} />}
          </div>
        </section>

        <section>
          <h3>직전 시즌 실제 기록</h3>
          {history.length === 0 ? <p className="muted small">직전 3시즌에 1군 기록이 없습니다.</p> : (
            <div className="scroll">
              {p.isPitcher ? (
                <PitTable rows={history.map(({ y, row }) => ({ label: `${y} ${row.team}`, l: pitFromRow(row as PitRow) }))} />
              ) : (
                <BatTable rows={history.map(({ y, row }) => ({ label: `${y} ${row.team}`, l: batFromRow(row as BatRow) }))} />
              )}
            </div>
          )}
        </section>

        <ContractInfo id={p.id} />
        <CareerInfo p={p} />

        {mine && !session.done && (
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
  const lp = session.leaguePlayer(id);
  if (!lp) return null;
  const c = lp.contract;
  return (
    <section>
      <h3>계약과 잠재력</h3>
      <dl className="facts">
        <dt>계약</dt><dd>{KIND_LABEL[c.kind]} · {c.kind === 'foreign' ? dollarText(c.salary) : wonText(c.salary)} · {c.until}년까지</dd>
        <dt>잠재력</dt><dd><Grade v={runsGrade(lp.scoutPotential ?? lp.potential)} />{lp.scoutPotential !== undefined && <span className="muted small"> (스카우트 평가)</span>}</dd>
        {!lp.foreign && <><dt>FA</dt><dd>1군 연차 {lp.service}년{lp.faCount ? ` · FA 계약 ${lp.faCount}회` : ''}</dd></>}
      </dl>
      {session.phase === 'season' && <p className="muted small">시즌 중에는 개막 때 계약 기준입니다.</p>}
    </section>
  );
}

/** 포지션별 수비 등급 (20~80, 50 = 그 자리 평균 수비수) */
function DefenseInfo({ p }: { p: SimPlayer }) {
  const playable = playablePositions(p.bat?.def);
  return (
    <div className="defense">
      <h4 className="small">수비 <span className="muted">포지션별, 50이 그 자리 평균 · 맡길 만한 자리: {playable.length ? playable.map((q) => posName(q)).join(', ') : '없음 (지명타자)'}</span></h4>
      <div className="grades">
        {FIELD_POS.map((q) => <GradeBar key={q} label={posName(q)} v={defenseGrade(defenseAt(p, q))} />)}
      </div>
      <p className="muted small">수비 기록이 자료에 없어, 직전 시즌들에 맡은 포지션·주력·나이로 만든 추정값입니다.</p>
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

function GradeBar({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="gbar">
      <span>{label}</span>
      <span className="track" aria-hidden><i style={{ width: `${v === null ? 0 : ((v - 20) / 60) * 100}%` }} /></span>
      <Grade v={v} />
    </div>
  );
}

type BatLike = { g: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; rbi: number; r: number; bb: number; hbp: number; so: number; sb: number; sf: number };
type PitLike = { g: number; gs: number; w: number; l: number; sv: number; outs: number; h: number; hr: number; bb: number; so: number; er: number };

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
      <thead><tr><th className="l">시즌</th><th>경기</th><th>선발</th><th>승</th><th>패</th><th>세이브</th><th>이닝</th><th>평균자책</th><th>WHIP</th><th>피안타</th><th>피홈런</th><th>볼넷</th><th>탈삼진</th></tr></thead>
      <tbody>
        {rows.map(({ label, l }) => {
          const p = { ...l, bf: 0, hbp: 0, r: 0 };
          return (
            <tr key={label}>
              <td className="l">{label}</td><td>{l.g}</td><td>{l.gs}</td><td>{l.w}</td><td>{l.l}</td><td>{l.sv}</td><td>{ipText(l.outs)}</td>
              <td>{fixed2(era(p))}</td><td>{fixed2(whip(p))}</td><td>{l.h}</td><td>{l.hr}</td><td>{l.bb}</td><td>{l.so}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
