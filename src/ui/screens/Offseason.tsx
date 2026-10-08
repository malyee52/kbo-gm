// 오프시즌: 단계별 진행 (FA → 외국인 → 드래프트 → 연봉 협상 → 정원 정리 → 개막).
import { useState } from 'react';
import { OfferPanel } from './Club';
import { DRAFT_ROUNDS, FA_ROUNDS, LOG_LABEL, MAX_FA_SIGNINGS, STAGE_LABEL, STAGES, canSignForeign, draftTeamAt, draftTotal, foreignSlots } from '../../league/offseason';
import {
  ASIA_NEW_CAP, capPayroll, dollarText, FOREIGN_NEW_CAP, FOREIGN_TOTAL_CAP, MIN_SALARY, ORG_LIMIT, salaryCap, wonText,
} from '../../league/salary';
import type { LeaguePlayer } from '../../league/types';
import { posName, TeamName, useGame } from '../context';
import { runsGrade } from '../grades';

/** 오프시즌 화면에서 쓰는 선수 한 줄 정보 */
function useInfo() {
  const { session } = useGame();
  const next = session.year + 1;
  return (p: LeaguePlayer) => ({
    age: p.birthYear ? next - p.birthYear : null,
    role: p.isPitcher ? (p.pit!.startShare >= 0.5 ? '선발' : '구원') : posName(p.pos),
    now: runsGrade(session.nextRuns(p.id)),
    pot: runsGrade(p.scoutPotential ?? p.potential),
  });
}

export function Offseason() {
  const { session, changed, autosave, go } = useGame();
  const off = session.offseason;
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!off) {
    return (
      <div className="stack">
        <h1>오프시즌</h1>
        <p className="muted">정규시즌이 끝나면 오프시즌을 시작할 수 있습니다.</p>
      </div>
    );
  }

  const act = (r: { ok: boolean; message: string }, okText?: string) => {
    setMsg(r.ok ? (okText || r.message ? { text: okText ?? r.message } : null) : { text: r.message, error: true });
    changed();
    if (r.ok) void autosave();
  };

  const next = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    const r = session.nextStage();
    setBusy(false);
    act(r);
  };

  const open = async () => {
    setBusy(true);
    setMsg({ text: `${session.year + 1} 시즌을 준비하는 중입니다 (리그 환경 맞춤)` });
    await new Promise((r) => setTimeout(r, 30));
    const r = session.openNextSeason();
    setBusy(false);
    if (!r.ok) {
      setMsg({ text: r.message, error: true });
      return;
    }
    changed();
    await autosave();
    go('home');
  };

  const stageIdx = STAGES.indexOf(off.stage);
  const nextLabel = off.stage === 'fa'
    ? (off.fa.round < FA_ROUNDS ? `${off.fa.round}라운드 마감` : `${off.fa.round}라운드 마감 → 외국인 선수`)
    : `다음: ${STAGE_LABEL[STAGES[stageIdx + 1]] ?? ''}`;

  return (
    <div className="stack">
      <OfferPanel />
      <section className="row-between wrap">
        <div>
          <h1>{off.year} 오프시즌</h1>
          <p className="muted small">결산(성장 판정, 1군 연차, 부상 후유증, 은퇴, 병역)은 끝났습니다. 결산 소식은 아래 "오프시즌 소식"에 있습니다. 단계를 차례로 마치면 {off.year + 1} 시즌이 열립니다.</p>
        </div>
        {off.stage !== 'ready' && (
          <button type="button" onClick={() => void next()} disabled={busy}>{busy ? '처리 중' : nextLabel}</button>
        )}
      </section>

      <ol className="steps" aria-label="오프시즌 단계">
        {STAGES.map((s, i) => (
          <li key={s} className={i < stageIdx ? 'done' : i === stageIdx ? 'now' : ''} aria-current={i === stageIdx ? 'step' : undefined}>
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ol>

      {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}

      {off.stage === 'fa' && <FaPanel act={act} />}
      {off.stage === 'foreign' && <ForeignPanel act={act} />}
      {off.stage === 'draft' && <DraftPanel act={act} />}
      {off.stage === 'salary' && <SalaryPanel act={act} />}
      {off.stage === 'release' && <ReleasePanel act={act} />}
      {off.stage === 'ready' && (
        <section className="panel">
          <h2>{off.year + 1} 시즌 개막 준비 완료</h2>
          <p className="muted">선수단 구성이 끝났습니다. 개막하면 1군 엔트리는 AI가 짠 명단으로 시작하고, 선수단 화면에서 바꿀 수 있습니다.</p>
          <div className="actions"><button type="button" onClick={() => void open()} disabled={busy}>{busy ? '준비 중' : `${off.year + 1} 시즌 개막`}</button></div>
        </section>
      )}

      <OffLog />
    </div>
  );
}

type Act = (r: { ok: boolean; message: string }, okText?: string) => void;

function CapLine() {
  const { session } = useGame();
  const cap = salaryCap(session.year + 1);
  const pay = capPayroll(session.league.players, session.teamIdx);
  const size = session.league.players.filter((p) => p.team === session.teamIdx).length;
  return (
    <p className="muted small">
      {session.year + 1} 샐러리캡 대상 연봉(외국인·신인 제외 상위 40명) {wonText(pay)}{cap ? ` / 상한 ${wonText(cap)}` : ''} · 소속 선수 {size}/{ORG_LIMIT}명
    </p>
  );
}

function FaPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  const info = useInfo();
  const [draft, setDraft] = useState<Record<string, { salary: string; years: string }>>({});
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const entries = off.fa.entries;
  const mineLeaving = entries.filter((e) => e.from === session.teamIdx && e.status === 'open');

  return (
    <section className="stack">
      <div className="panel">
        <h2>FA 시장 <span className="muted small">{off.fa.round}/{FA_ROUNDS}라운드</span></h2>
        <p className="muted small">
          라운드를 마감하면 AI 구단도 제시하고, 선수는 가장 좋은 조건을 고릅니다 (원 소속 구단은 조금 더 쳐줍니다). 라운드가 지날수록 선수가 눈높이를 낮춥니다.
          외부 FA는 한 오프시즌에 {MAX_FA_SIGNINGS}명까지, 다른 구단 선수를 데려오면 원 소속 구단에 보상금(A 300%, B 200%, C 150%)을 냅니다.
        </p>
        <CapLine />
        {mineLeaving.length > 0 && (
          <p className="note small">우리 구단 FA {mineLeaving.length}명이 시장에 나와 있습니다. 붙잡으려면 제시하세요. 마지막 라운드까지 계약하지 못하면 떠납니다.</p>
        )}
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th className="l">선수</th><th className="l">원 소속</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>등급</th>
              <th>전년 연봉</th><th>요구 (연)</th><th>기간</th><th className="l">상태 · 우리 제시</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const p = players.get(e.id)!;
              const i = info(p);
              const mine = off.fa.userOffers[e.id];
              // 제시 연봉은 억 원 단위로 입력한다 (소수 한 자리). 내부 계산은 만 원 단위.
              // 기본값은 요구액을 0.1억 단위로 올림 (내림하면 요구액보다 모자라 1라운드에서 거절된다)
              const d = draft[e.id] ?? { salary: (Math.ceil(e.ask / 1000) / 10).toFixed(1), years: String(e.years) };
              return (
                <tr key={e.id} className={e.from === session.teamIdx ? 'me' : ''}>
                  <td className="l">{p.name}</td><td className="l"><TeamName idx={e.from} /></td><td>{i.role}</td><td>{i.age ?? '-'}</td>
                  <td>{i.now}</td><td>{i.pot}</td><td>{e.grade}</td><td>{wonText(e.prevSalary)}</td><td>{wonText(e.ask)}</td><td>{e.years}년</td>
                  <td className="l">
                    {e.status === 'signed' ? (
                      <span>{e.team === e.from ? '잔류' : '이적'} · <TeamName idx={e.team!} /> {e.signedYears}년 연 {wonText(e.salary!)}</span>
                    ) : e.status === 'left' ? (
                      <span className="muted">미계약 (리그 이탈)</span>
                    ) : mine ? (
                      <span className="inline">제시함: {mine.years}년 연 {wonText(mine.salary)}
                        <button type="button" className="small-btn" onClick={() => act(session.withdrawFa(e.id), '제시를 거뒀습니다.')}>거두기</button>
                      </span>
                    ) : (
                      <span className="inline">
                        <input type="number" min={MIN_SALARY / 10000} step={0.1} value={d.salary} aria-label={`${p.name} 제시 연봉(억 원)`}
                          onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, salary: ev.target.value } })} style={{ width: '6em' }} />억 원
                        <select value={d.years} aria-label="계약 기간" onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, years: ev.target.value } })}>
                          {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>{y}년</option>)}
                        </select>
                        <button type="button" className="small-btn" onClick={() => act(session.offerFa(e.id, Math.round(Number(d.salary) * 10000), Number(d.years)))}>제시</button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">현재·잠재는 한 시즌 기여를 20~80으로 바꾼 값입니다 (50 = 리그 평균 주전). FA 제시 연봉은 억 원 단위로 입력합니다 (소수 한 자리, 예: 3.5 = 3억 5,000만 원).</p>
    </section>
  );
}

function ForeignPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  const f = off.foreign!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const slots = foreignSlots(session.league, session.teamIdx, off);
  const myTurn = f.order[f.pointer] === session.teamIdx;
  const pool = f.pool.map((id) => players.get(id)!).sort((a, b) => session.nextRuns(b.id) - session.nextRuns(a.id));
  const expiringMine = Object.keys(f.keep).map((id) => players.get(id)!);
  const pickedBefore = f.order.slice(0, f.pointer).filter((t) => t !== session.teamIdx);

  return (
    <section className="stack">
      <div className="panel">
        <h2>외국인 선수</h2>
        <p className="muted small">
          보유 한도: 아시아쿼터를 빼고 {3}명 + 아시아쿼터 1명. 신규 계약은 {dollarText(FOREIGN_NEW_CAP)}, 아시아쿼터 신규는 {dollarText(ASIA_NEW_CAP)}까지,
          아시아쿼터를 뺀 3명 총액은 {dollarText(FOREIGN_TOTAL_CAP)}까지입니다. 직전 시즌 성적 역순으로 고릅니다.
        </p>
        <p className="small">
          우리 외국인: {slots.regular}/3명 (총액 {dollarText(slots.regularPay)}) · 아시아쿼터 {slots.asia}/1명
          {pickedBefore.length > 0 && <span className="muted"> · 우리보다 먼저 고른 구단: {pickedBefore.map((t) => session.league.teams[t].name).join(', ')}</span>}
        </p>
        {!myTurn && <p className="muted small">다음 단계로 넘기면 남은 구단이 고릅니다.</p>}
      </div>

      {expiringMine.length > 0 && (
        <div>
          <h2>재계약 대상 <span className="muted small">계약이 끝난 우리 외국인</span></h2>
          <div className="scroll">
            <table>
              <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>지난 연봉</th><th className="l">결정</th></tr></thead>
              <tbody>
                {expiringMine.map((p) => {
                  const i = info(p);
                  const keep = f.keep[p.id];
                  return (
                    <tr key={p.id}>
                      <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{dollarText(p.contract.salary)}</td>
                      <td className="l">
                        <label className="inline small">
                          <input type="checkbox" checked={keep} onChange={(e) => act(session.setForeignKeep(p.id, e.target.checked))} /> 재계약
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">재계약 연봉은 성적에 따라 정해지고, 3명 총액 상한을 넘으면 남은 몫까지만 줍니다.</p>
        </div>
      )}

      <div>
        <h2>후보 <span className="muted small">{pool.length}명 (실존 선수는 다른 구단에서 재계약하지 않은 선수, 나머지는 가상 선수)</span></h2>
        <div className="scroll pick">
          <table>
            <thead><tr><th className="l">선수</th><th>구분</th><th>자리</th><th>나이</th><th>현재</th><th>요구액</th><th /></tr></thead>
            <tbody>
              {pool.map((p) => {
                const i = info(p);
                const check = canSignForeign(session.league, off, session.teamIdx, p);
                return (
                  <tr key={p.id}>
                    <td className="l">{p.name}{!p.real && <span className="tag" title="가상 선수">가상</span>}</td>
                    <td>{p.asia ? '아시아쿼터' : '일반'}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{dollarText(p.contract.salary)}</td>
                    <td>
                      <button type="button" className="small-btn" disabled={!myTurn || !check.ok} title={check.ok ? '' : check.message}
                        onClick={() => act(session.signForeign(p.id), `${p.name}와 계약했습니다.`)}>계약</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function DraftPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  const d = off.draft!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const total = draftTotal(off);
  const done = d.pick >= total || d.pool.length === 0;
  const onClock = !done && draftTeamAt(off, d.pick) === session.teamIdx;
  const n = d.order.length;
  const pool = d.pool.map((id) => players.get(id)!).sort((a, b) => (b.scoutPotential ?? 0) - (a.scoutPotential ?? 0) || a.id.localeCompare(b.id));
  const mine = d.picks.filter((p) => p.team === session.teamIdx);

  return (
    <section className="stack">
      <div className="panel">
        <h2>신인 드래프트 <span className="muted small">{DRAFT_ROUNDS}라운드 전면 드래프트, 직전 시즌 성적 역순</span></h2>
        <p className="small">
          {done ? '드래프트가 끝났습니다.' : onClock
            ? <strong>우리 차례입니다: {Math.floor(d.pick / n) + 1}라운드 {(d.pick % n) + 1}순위</strong>
            : `지명 진행 중 (${d.pick + 1}/${total})`}
        </p>
        <p className="muted small">
          잠재는 스카우트 평가라 실제와 다를 수 있습니다. 모든 구단이 같은 평가를 봅니다.{' '}
          {[...d.pool, ...d.picks.map((x) => x.id)].some((id) => players.get(id)?.real)
            ? `후보는 ${off.year + 1}년 입단 실제 신인 지명 선수입니다 (출처: baseballchart.kr, 나무위키 신인 드래프트 문서 정리, CC BY-NC-SA 2.0 KR). 지명은 게임 속 순위로 다시 하므로 실제 구단과 다를 수 있고, 아직 프로 기록이 없어 능력은 실제 지명 순번으로 가늠한 추정값입니다.`
            : '지명 선수는 모두 가상 선수입니다.'}
        </p>
        <div className="actions">
          <button type="button" className="ghost" disabled={done} onClick={() => act(session.autoDraft(), '남은 지명을 자동으로 했습니다.')}>남은 지명 자동</button>
        </div>
      </div>
      <div className="two">
        <div>
          <h2>지명 가능 선수 <span className="muted small">{pool.length}명</span></h2>
          <div className="scroll pick">
            <table>
              <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>학력</th><th>현재</th><th>잠재(평가)</th><th /></tr></thead>
              <tbody>
                {pool.map((p) => {
                  const i = info(p);
                  return (
                    <tr key={p.id}>
                      <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{p.school === 'UNIV' ? '대졸' : '고졸'}</td><td>{i.now}</td><td>{i.pot}</td>
                      <td><button type="button" className="small-btn" disabled={!onClock} onClick={() => act(session.draft(p.id))}>지명</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>우리 지명 <span className="muted small">{mine.length}/{DRAFT_ROUNDS}</span></h2>
          <div className="scroll">
            <table>
              <tbody>
                {mine.map((pk) => {
                  const p = players.get(pk.id)!;
                  const i = info(p);
                  return <tr key={pk.id}><td>{pk.round}R</td><td className="l">{p.name}</td><td>{i.role}</td><td>{p.school === 'UNIV' ? '대졸' : '고졸'}</td><td>잠재 {i.pot}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <h2>최근 지명</h2>
          <ul className="plain small">
            {d.picks.slice(-8).reverse().map((pk) => (
              <li key={pk.id}>{pk.round}R <TeamName idx={pk.team} /> {players.get(pk.id)!.name}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function SalaryPanel({ act }: { act: Act }) {
  const { session } = useGame();
  const off = session.offseason!;
  const s = off.salary!;
  const info = useInfo();
  const players = new Map(session.league.players.map((p) => [p.id, p]));
  const ids = Object.keys(s.offers).sort((a, b) => s.demands[b] - s.demands[a]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const total = ids.reduce((sum, id) => sum + s.offers[id], 0);

  return (
    <section className="stack">
      <div className="panel">
        <h2>연봉 협상 <span className="muted small">계약이 끝난 국내 선수 {ids.length}명</span></h2>
        <p className="muted small">
          선수 요구액은 기여와 연차로 정해집니다. 요구액 이상을 제시하면 그대로 계약하고, 모자라면 조정을 거쳐 제시액과 요구액의 가운데로 정합니다.
          다음 단계로 넘길 때 확정합니다.
        </p>
        <p className="small">제시 합계 {wonText(total)}</p>
        <CapLine />
      </div>
      <div className="scroll">
        <table>
          <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>지난 연봉</th><th>요구액</th><th className="l">제시액 (억 원)</th></tr></thead>
          <tbody>
            {ids.map((id) => {
              const p = players.get(id)!;
              const i = info(p);
              // 제시액은 억 원 단위로 보여 주고 입력한다 (0.01억 = 100만 원). 기본값은 지금 제시액을 0.01억 단위로 올림.
              // 값을 고쳤을 때만 제시액을 바꾼다 (보여 주려고 올린 값 때문에 제시액이 바뀌지 않게)
              const shown = (Math.ceil(s.offers[id] / 100) / 100).toFixed(2);
              const v = edit[id] ?? shown;
              const low = s.offers[id] < s.demands[id];
              return (
                <tr key={id}>
                  <td className="l">{p.name}</td><td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td>
                  <td>{wonText(p.contract.salary)}</td><td>{wonText(s.demands[id])}</td>
                  <td className="l">
                    <span className="inline">
                      <input type="number" min={MIN_SALARY / 10000} step={0.01} value={v} aria-label={`${p.name} 제시액(억 원)`} style={{ width: '6em' }}
                        onChange={(e) => setEdit({ ...edit, [id]: e.target.value })}
                        onBlur={() => { if (edit[id] !== undefined && edit[id] !== shown) act(session.setSalaryOffer(id, Math.round(Number(v) * 10000))); }} />억 원
                      {low && <span className="status temp">조정 예상</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReleasePanel({ act }: { act: Act }) {
  const { session } = useGame();
  const info = useInfo();
  const mine = session.league.players.filter((p) => p.team === session.teamIdx)
    .sort((a, b) => session.nextRuns(a.id) - session.nextRuns(b.id) || a.id.localeCompare(b.id));
  const over = mine.length - ORG_LIMIT;
  return (
    <section className="stack">
      <div className="panel">
        <h2>정원 정리 <span className="muted small">소속 선수 {mine.length}/{ORG_LIMIT}명</span></h2>
        <p className="muted small">방출한 선수는 리그를 떠나며 되돌릴 수 없습니다. 기여가 낮은 순으로 늘어놓았습니다.</p>
        {over > 0 ? <p className="note small">{over}명을 더 방출해야 다음 단계로 갈 수 있습니다.</p> : <p className="small">정원 안입니다.</p>}
        <div className="actions">
          <button type="button" className="ghost" disabled={over <= 0} onClick={() => act(session.autoRelease(), '정원에 맞게 방출했습니다.')}>정원까지 자동 방출</button>
        </div>
      </div>
      <div className="scroll pick">
        <table>
          <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th>현재</th><th>잠재</th><th>계약</th><th /></tr></thead>
          <tbody>
            {mine.map((p) => {
              const i = info(p);
              return (
                <tr key={p.id}>
                  <td className="l">{p.name}{p.foreign && <span className="tag">외</span>}{!p.real && <span className="tag">가상</span>}</td>
                  <td>{i.role}</td><td>{i.age ?? '-'}</td><td>{i.now}</td><td>{i.pot}</td>
                  <td className="small">{p.foreign ? dollarText(p.contract.salary) : wonText(p.contract.salary)}</td>
                  <td><button type="button" className="small-btn danger" onClick={() => act(session.release(p.id))}>방출</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OffLog() {
  const { session } = useGame();
  const off = session.offseason!;
  const [all, setAll] = useState(false);
  const rows = off.log.filter((l) => all || l.mine || l.text.includes('→')).slice().reverse();
  return (
    <section>
      <div className="row-between">
        <h2>오프시즌 소식</h2>
        <label className="inline small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 전체 보기</label>
      </div>
      {rows.length === 0 ? <p className="muted">아직 소식이 없습니다.</p> : (
        <ul className="news">
          {rows.map((l, k) => (
            <li key={k} className={l.mine ? 'news-season' : ''}><span className="muted small">{LOG_LABEL[l.stage]}</span><span>{l.text}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}
