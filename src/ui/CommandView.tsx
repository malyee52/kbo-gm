// 직접 지휘 (경기 개입, 2026-10-12 사용자 요청: "대주자, 대타 혹은 작전지시, 투수 교체를 직접").
// 우리 타석마다 멈춰 고른다. 공격은 두 단계: 주자 작전(투구 전, 1루 주자가 있고 2루가 비었을 때: 대주자·도루)과
// 타격 작전(도루가 끝난 뒤: 대타·대주자·강공·번트). 수비: 투수 교체·유지, 고의4구.
// 고른 대로 오늘 경기를 복사본에서 미리 돌려 보여 주고(session.commandPreview), 끝까지 가면 확정해 실제로 진행한다.
import { useEffect, useRef, useState } from 'react';
import type { CommandChoice, CommandRequest, Play } from '../engine';
import { BUNT_SUCCESS } from '../engine';
import { formatDate } from '../game/calendar';
import { inningLabel, lineScoreUpTo, playText } from '../game/highlights';
import type { CommandPreview } from '../game/session';
import { fixed2, ops, rate3 } from '../game/stats';
import { Diamond } from './GameCast';
import { useGame } from './context';
import { teamVars } from './teams';

type Tactic = '' | 'swing' | 'bunt';
const TACTIC_LABEL: Record<Tactic, string> = { '': '자동 (감독)', swing: '강공', bunt: '희생번트' };
type Steal = '' | 'go' | 'hold';
const STEAL_LABEL: Record<Steal, string> = { '': '자동 (감독)', go: '도루 시도', hold: '도루 안 함' };

export function CommandView({ start, onDone, onCancel }: { start: CommandPreview; onDone: () => void; onCancel: () => void }) {
  const { session } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const [pv, setPv] = useState(start);
  const [tactic, setTactic] = useState<Tactic>('');
  const [steal, setSteal] = useState<Steal>('');
  const [ph, setPh] = useState('');
  const [pr, setPr] = useState<[string, string, string]>(['', '', '']);
  const [pitcher, setPitcher] = useState('');
  const [walk, setWalk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // 물음이 바뀌면 고르던 것을 비운다
  useEffect(() => { setTactic(''); setSteal(''); setPh(''); setPr(['', '', '']); setPitcher(''); setWalk(false); }, [pv.req?.n]);

  const s = session.season;
  const W = session.world;
  const name = (i: number) => W.players[i]?.name ?? '?';
  const teamName = (t: number) => session.teamInfo(t).name;
  const me = session.teamIdx;
  const req: CommandRequest | null = pv.req;
  const plays: Play[] = pv.plays;
  const ls = lineScoreUpTo(plays, plays.length);
  const innings = Math.max(9, ls.away.length, ls.home.length);
  const score = req ? { away: req.away, home: req.home } : pv.final ?? { away: 0, home: 0 };

  const batLine = (i: number) => {
    const b = s.bat[i];
    const p = W.players[i];
    return `${p?.bats === 'L' ? '좌타' : p?.bats === 'S' ? '양타' : '우타'} · 타율 ${rate3(b.ab ? b.h / b.ab : 0)} OPS ${rate3(ops(b))} ${b.hr}홈런`;
  };
  const pitLine = (i: number) => {
    const q = s.pit[i];
    const p = W.players[i];
    return `${p?.throws === 'L' ? '좌완' : '우완'} · 평균자책 ${q.outs ? fixed2((q.er * 27) / q.outs) : '-'} ${q.g}경기`;
  };

  const choice = (): CommandChoice => {
    const c: CommandChoice = {};
    if (!req) return c;
    if (req.step === 'run') {
      if (steal) c.steal = steal;
    } else if (req.side === 'bat') {
      if (tactic) c.tactic = tactic;
      if (ph) c.ph = Number(ph);
    }
    if (req.side === 'bat') {
      const b = pr.findIndex((x) => x);
      if (b >= 0) c.pr = { base: b as 0 | 1 | 2, idx: Number(pr[b]) };
    } else {
      if (pitcher === 'keep') c.keep = true;
      else if (pitcher) c.pitcher = Number(pitcher);
      if (walk) c.walk = true;
    }
    return c;
  };
  // 미리보기는 하루 경기만 돌려 10ms 안팎이라 바로 계산한다
  const go = (mode: 'next' | 'inning' | 'crisis' | 'auto') => setPv(session.commandPreview([...pv.choices, choice()], mode, pv.dh));
  const commit = () => {
    setBusy(true);
    session.commitCommand(pv.choices, pv.dh);
    onDone();
  };
  const cancel = () => { ref.current?.close(); onCancel(); };

  const usedBench = new Set([ph, ...pr].filter(Boolean));
  const benchOpts = (except: string) => req!.bench.filter((i) => !usedBench.has(String(i)) || String(i) === except);
  const canBunt = !!req && req.outs < 2 && req.bases.some((b) => b >= 0);
  const recent = plays.slice(-8).reverse();
  const date = formatDate(W.year, s.day);
  // 더블헤더 날은 몇 차전인지 (지휘하지 않은 차전은 감독이 맡는다)
  const dhLabel = pv.dh ? ' · 더블헤더 2차전' : session.ourGamesToday().length > 1 ? ' · 더블헤더 1차전' : '';

  return (
    <dialog ref={ref} className="player cast command tv" onClose={onCancel} style={teamVars(session.team.franchise, session.team.name)}>
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2>직접 지휘 · {teamName(pv.away)} <span className="muted">@</span> {teamName(pv.home)}</h2>
            <p className="muted small">{date}{dhLabel} · 고른 대로 미리 돌려 보여 줍니다. 끝까지 가서 "경기 확정"을 눌러야 실제로 진행됩니다.</p>
          </div>
          <span className="inline">
            {req && <button type="button" className="ghost" disabled={busy} title="남은 판단을 감독에게 맡기고 바로 확정합니다"
              onClick={() => { setBusy(true); session.commitCommand(session.commandPreview(pv.choices, 'auto', pv.dh).choices, pv.dh); onDone(); }}>나머지 자동으로 확정</button>}
            <button type="button" className="ghost" onClick={cancel} disabled={busy}>그만두기</button>
          </span>
        </header>

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

        {req ? (
          <>
            <div className="cast-field">
              <Diamond play={{ ...(plays.at(-1) ?? {}), bases: req.bases, outs: req.outs } as Play} />
              <div className="cast-now">
                <p><strong>{inningLabel(req)} · {req.outs}아웃</strong> <span className="muted small">{req.step === 'run' ? '우리 공격 · 주자 작전 (투구 전)' : req.step === 'bat' ? '우리 공격 · 타격 작전' : '우리 수비'}</span></p>
                <p className="outs" aria-hidden>{[0, 1, 2].map((i) => <i key={i} className={i < req.outs ? 'on' : ''} />)}</p>
                <p>타자 <strong>{name(req.batter)}</strong> <span className="muted small">{batLine(req.batter)}</span></p>
                <p className="small muted">다음 타자 {name(req.onDeck)}</p>
                <p>투수 <strong>{name(req.pitcher)}</strong> <span className="muted small">{pitLine(req.pitcher)} · 오늘 타자 {req.pitcherBf}명 {req.pitcherRuns}실점</span></p>
                {req.bases.some((b) => b >= 0) && <p className="small">주자: {req.bases.map((b, k) => (b >= 0 ? `${k + 1}루 ${name(b)}` : '')).filter(Boolean).join(', ')}</p>}
              </div>
            </div>

            <section className="command-panel">
              {req.side === 'bat' ? (
                <>
                  {req.step === 'run' ? (
                    <fieldset>
                      <legend>도루 <span className="muted small">1루 {name(req.bases[0])} · 시즌 도루 {s.bat[req.bases[0]]?.sb ?? 0} 실패 {s.bat[req.bases[0]]?.cs ?? 0}</span></legend>
                      {(['', 'go', 'hold'] as Steal[]).map((t) => (
                        <label key={t} className="check"><input type="radio" name="steal" checked={steal === t} onChange={() => setSteal(t)} /> {STEAL_LABEL[t]}</label>
                      ))}
                      <p className="muted small">도루 결과를 본 뒤 같은 타석의 타격 작전(대타·강공·번트)을 따로 고릅니다.</p>
                    </fieldset>
                  ) : (
                    <>
                      <fieldset>
                        <legend>타격 작전</legend>
                        {(['', 'swing', 'bunt'] as Tactic[]).map((t) => (
                          <label key={t} className={`check${t === 'bunt' && !canBunt ? ' muted' : ''}`}>
                            <input type="radio" name="tactic" checked={tactic === t} disabled={t === 'bunt' && !canBunt} onChange={() => setTactic(t)} /> {TACTIC_LABEL[t]}
                          </label>
                        ))}
                        <p className="muted small">번트는 2아웃 전 주자가 있을 때 (성공 {Math.round(BUNT_SUCCESS * 100)}%).</p>
                      </fieldset>
                      <fieldset>
                        <legend>대타 <span className="muted small">{name(req.batter)} 대신</span></legend>
                        <select value={ph} onChange={(e) => setPh(e.target.value)} disabled={!req.bench.length}>
                          <option value="">그대로</option>
                          {benchOpts(ph).map((i) => <option key={i} value={i}>{name(i)} — {batLine(i)}</option>)}
                        </select>
                      </fieldset>
                    </>
                  )}
                  {req.bases.some((b) => b >= 0) && (
                    <fieldset>
                      <legend>대주자</legend>
                      {req.bases.map((b, k) => b >= 0 && (
                        <label key={k} className="pr-row">
                          <span>{k + 1}루 {name(b)} 대신</span>
                          <select value={pr[k]} onChange={(e) => setPr((x) => { const y = ['', '', ''] as [string, string, string]; y[k] = e.target.value; return x[k] === e.target.value ? x : y; })} disabled={!req.bench.length}>
                            <option value="">그대로</option>
                            {benchOpts(pr[k]).map((i) => <option key={i} value={i}>{name(i)} — 도루 {s.bat[i].sb}</option>)}
                          </select>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {!req.bench.length && <p className="muted small">쓸 수 있는 벤치 야수가 없습니다.</p>}
                </>
              ) : (
                <>
                  <fieldset>
                    <legend>투수</legend>
                    <select value={pitcher} onChange={(e) => setPitcher(e.target.value)}>
                      <option value="">자동 (감독이 판단)</option>
                      <option value="keep">{name(req.pitcher)} 계속</option>
                      {req.bullpen.map((i) => <option key={i} value={i}>교체: {name(i)} — {pitLine(i)}</option>)}
                    </select>
                  </fieldset>
                  <label className="check"><input type="checkbox" checked={walk} onChange={(e) => setWalk(e.target.checked)} /> 고의4구로 {name(req.batter)} 내보내기</label>
                </>
              )}
            </section>

            <div className="actions cast-controls">
              <button type="button" onClick={() => go('next')} disabled={busy}>이대로 진행 (다음 타석)</button>
              <button type="button" className="ghost" onClick={() => go('inning')} disabled={busy}>이번 반 이닝 자동</button>
              <button type="button" className="ghost" onClick={() => go('crisis')} disabled={busy} title="7회 이후 2점 차 안에서 득점권 주자가 있을 때만 묻습니다">위기 때만 묻기</button>
              <button type="button" className="ghost" onClick={() => go('auto')} disabled={busy}>경기 끝까지 자동</button>
            </div>
          </>
        ) : (
          <div className="note">
            {pv.rain && <p className="small">비로 경기가 중단됐습니다 ({pv.rain.inning}회 {pv.rain.kind === 'cold' ? '강우 콜드' : '노게임'}).{pv.rain.kind === 'nogame' ? ' 정식 경기(5회)가 되기 전이라 기록은 남지 않고 다른 날 다시 치릅니다.' : ''}</p>}
            <p><strong>{pv.rain?.kind === 'nogame' ? '노게임' : '경기 끝'}: {teamName(pv.away)} {score.away} : {score.home} {teamName(pv.home)}</strong></p>
            <p className="small muted">확정하면 이 결과로 오늘 경기가 진행됩니다. 그만두면 오늘은 그대로 남습니다.</p>
            <div className="actions"><button type="button" onClick={commit} disabled={busy}>경기 확정</button></div>
          </div>
        )}

        <section>
          <h3>최근 장면</h3>
          {recent.length === 0 ? <p className="muted small">경기 시작 전</p> : (
            <ol className="cast-feed small" reversed>
              {recent.map((p, k) => <li key={k} className={`${p.runs > 0 ? 'scored' : ''} kind-${p.kind}`}><span className="muted">{inningLabel(p)}</span> {playText(p, name)}{p.runs > 0 && <span className="muted"> · {p.away}:{p.home}</span>}</li>)}
            </ol>
          )}
        </section>
      </div>
    </dialog>
  );
}
