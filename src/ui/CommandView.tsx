// 직접 지휘 (경기 개입, 2026-10-12 사용자 요청: "대주자, 대타 혹은 작전지시, 투수 교체를 직접").
// 지휘하는 경기는 공 단위(A 해결기, 엔진 2 17단계)로 치른다. 지시는 타석 사이에 묻고, "공마다 지켜보기" 중 "멈춤"을 누르면 공 사이에도 묻는다 (기획안 결정 7).
// 타석 사이 공격은 두 단계: 주자 작전(투구 전, 도루할 수 있을 때: 대주자·도루·히트앤드런)과 타격 작전(도루가 끝난 뒤: 대타·대주자·강공·번트).
// 타석 사이 수비: 투수 교체·유지, 고의4구, 전진 수비, 피치아웃, 대수비. 공 사이: 공격은 대주자·도루·히트앤드런, 수비는 투수 교체·고의4구.
// 항목마다 '자동 (감독)'이면 AI 감독이, 고르면 고른 대로 한다 (engine CommandChoice).
// 고른 대로 오늘 경기를 복사본에서 미리 돌려 보여 주고(session.commandPreview), 끝까지 가면 확정해 실제로 진행한다.
import { useEffect, useRef, useState } from 'react';
import type { CommandChoice, CommandRequest, Play } from '../engine';
import { BUNT_SUCCESS } from '../engine';
import { formatDate } from '../game/calendar';
import { inningLabel, lineScoreUpTo, pitchList, pitchNote, playText } from '../game/highlights';
import type { CommandPreview, PreviewMode } from '../game/session';
import { fixed2, ops, rate3 } from '../game/stats';
import { Diamond } from './GameCast';
import { useGame } from './context';
import { CondTag, useCondition } from './parts';
import { teamVars } from './teams';

type Tactic = '' | 'swing' | 'bunt';
const TACTIC_LABEL: Record<Tactic, string> = { '': '자동 (감독)', swing: '강공', bunt: '희생번트' };
type Steal = '' | 'go' | 'hold' | 'hnr';
const STEAL_LABEL: Record<Steal, string> = { '': '자동 (감독)', go: '도루 시도', hold: '도루 안 함', hnr: '히트앤드런' };
/** 세 갈래 지시: 자동(감독) · 한다 · 안 한다 */
type Tri = '' | 'yes' | 'no';
const tri = (t: Tri): boolean | undefined => (t === '' ? undefined : t === 'yes');
/** 공마다 지켜보기 간격 (ms) */
const WATCH_MS = 650;

export function CommandView({ start, onDone, onCancel }: { start: CommandPreview; onDone: () => void; onCancel: () => void }) {
  const { session } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
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
  // 대수비: '' 자동(감독), 'none' 그대로, 숫자 = 나갈 선수 (defIn = 들어갈 선수)
  const [defOut, setDefOut] = useState('');
  const [defIn, setDefIn] = useState('');
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  // 물음이 바뀌면 고르던 것을 비운다
  useEffect(() => {
    setTactic(''); setSteal(''); setPh(''); setPrNone(false); setPr(['', '', '']); setPitcher(''); setWalk('');
    setInfield(''); setPitchout(''); setDefOut(''); setDefIn('');
  }, [pv.req?.n]);
  // 공마다 지켜보기: 공 사이 물음은 빈 선택(자동)으로 이어 가고, 타석 사이 물음이 오거나 경기가 끝나면 멈춘다
  useEffect(() => {
    if (!watching) return;
    if (!pv.req || pv.req.step !== 'pitch') { setWatching(false); return; }
    const t = setTimeout(() => setPv(session.commandPreview([...pv.choices, {}], 'pitch', pv.dh)), WATCH_MS);
    return () => clearTimeout(t);
  }, [watching, pv, session]);

  const s = session.season;
  const W = session.world;
  const name = (i: number) => W.players[i]?.name ?? '?';
  // 오늘 컨디션 낱말 (복사본이 아닌 실제 시즌의 오늘 값. 숫자 없음)
  const condOf = useCondition();
  const cond = (i: number) => (W.players[i] ? condOf(W.players[i]) : null);
  const condOpt = (i: number) => { const c = cond(i); return c ? ` · 컨디션 ${c.split(' · ')[0]}` : ''; };
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
      if (!pitch) {
        if (infield) c.infield = infield;
        if (tri(pitchout) !== undefined) c.pitchout = tri(pitchout);
        if (defOut === 'none') c.def = null;
        else if (defOut && defIn) c.def = { out: Number(defOut), in: Number(defIn) };
      }
    }
    return c;
  };
  // 미리보기는 하루 경기만 돌려 10ms 안팎이라 바로 계산한다
  const go = (mode: PreviewMode) => setPv(session.commandPreview([...pv.choices, choice()], mode, pv.dh));
  const watch = () => {
    // 지금 물음의 선택을 넣고 다음 공으로 간 뒤, 공 사이 물음마다 이어 간다
    setPv(session.commandPreview([...pv.choices, choice()], 'pitch', pv.dh));
    setWatching(true);
  };
  const commit = () => {
    setBusy(true);
    session.commitCommand(pv.choices, pv.dh);
    onDone();
  };
  const cancel = () => { setWatching(false); ref.current?.close(); onCancel(); };

  const usedBench = new Set([ph, ...pr].filter((x) => x && x !== 'none'));
  const benchOpts = (except: string) => req!.bench.filter((i) => !usedBench.has(String(i)) || String(i) === except);
  const canBunt = !!req && req.outs < 2 && req.bases.some((b) => b >= 0);
  const recent = plays.slice(-8).reverse();
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
  const pitches = req?.seq ? pitchList(req.seq) : [];
  // 공 사이 지시 칸은 멈춰 있을 때만 (지켜보는 중에는 감춘다)
  const showPanel = !!req && !watching;
  const stepLabel = !req ? '' : req.step === 'pitch' ? `${req.side === 'bat' ? '우리 공격' : '우리 수비'} · 공 사이`
    : req.step === 'run' ? '우리 공격 · 주자 작전 (투구 전)' : req.step === 'bat' ? '우리 공격 · 타격 작전' : '우리 수비';

  const stealSet = (opts: Steal[]) => (
    <fieldset>
      <legend>도루 <span className="muted small">{stealWhat} · {name(stealRunner)} 시즌 도루 {s.bat[stealRunner]?.sb ?? 0} 실패 {s.bat[stealRunner]?.cs ?? 0}</span></legend>
      {opts.map((t) => (
        <label key={t} className={`check${t === 'hnr' && !canHnr ? ' muted' : ''}`}>
          <input type="radio" name="steal" checked={steal === t} disabled={t === 'hnr' && !canHnr} onChange={() => setSteal(t)} /> {STEAL_LABEL[t]}
        </label>
      ))}
      <p className="muted small">히트앤드런은 1루 주자·2루 빔·2아웃 전 (타자는 다음 공에 반드시 휘두릅니다).</p>
    </fieldset>
  );
  const runnerSet = () => req!.bases.some((b) => b >= 0) && (
    <fieldset>
      <legend>대주자</legend>
      <label className="check"><input type="radio" name="pr-mode" checked={!prNone && pr.every((x) => !x)} onChange={() => { setPrNone(false); setPr(['', '', '']); }} /> 자동 (감독)</label>
      <label className="check"><input type="radio" name="pr-mode" checked={prNone && pr.every((x) => !x)} onChange={() => { setPrNone(true); setPr(['', '', '']); }} /> 그대로 (대주자 없음)</label>
      {req!.bases.map((b, k) => b >= 0 && (
        <label key={k} className="pr-row">
          <span>{k + 1}루 {name(b)} 대신</span>
          <select value={pr[k]} onChange={(e) => setPr((x) => { const y = ['', '', ''] as [string, string, string]; y[k] = e.target.value; return x[k] === e.target.value ? x : y; })} disabled={!req!.bench.length}>
            <option value="">—</option>
            {benchOpts(pr[k]).map((i) => <option key={i} value={i}>{name(i)} — 도루 {s.bat[i].sb}{condOpt(i)}</option>)}
          </select>
        </label>
      ))}
    </fieldset>
  );
  const triSet = (legend: string, nameAttr: string, v: Tri, set: (t: Tri) => void, yes: string, no: string, note?: string) => (
    <fieldset>
      <legend>{legend}</legend>
      {(['', 'yes', 'no'] as Tri[]).map((t) => (
        <label key={t} className="check"><input type="radio" name={nameAttr} checked={v === t} onChange={() => set(t)} /> {t === '' ? '자동 (감독)' : t === 'yes' ? yes : no}</label>
      ))}
      {note && <p className="muted small">{note}</p>}
    </fieldset>
  );

  return (
    <dialog ref={ref} className="player cast command tv" onClose={() => { setWatching(false); onCancel(); }} style={teamVars(session.team.franchise, session.team.name)}>
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2>직접 지휘 · {teamName(pv.away)} <span className="muted">@</span> {teamName(pv.home)}</h2>
            <p className="muted small">{date}{dhLabel} · 지휘하는 경기는 공 단위로 치릅니다. 고른 대로 미리 돌려 보여 주고, 끝까지 가서 "경기 확정"을 눌러야 실제로 진행됩니다.</p>
          </div>
          <span className="inline">
            {req && <button type="button" className="ghost" disabled={busy} title="남은 판단을 감독에게 맡기고 바로 확정합니다"
              onClick={() => { setWatching(false); setBusy(true); session.commitCommand(session.commandPreview(pv.choices, 'auto', pv.dh).choices, pv.dh); onDone(); }}>나머지 자동으로 확정</button>}
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
                <p><strong>{inningLabel(req)} · {req.outs}아웃</strong> <span className="muted small">{stepLabel}</span></p>
                <p className="outs" aria-hidden>{[0, 1, 2].map((i) => <i key={i} className={i < req.outs ? 'on' : ''} />)}</p>
                <p className="pitch-count"><strong>{count[0]}-{count[1]}</strong> <span className="muted small">볼-스트라이크 · 투구 수 {req.pitcherPitches}</span></p>
                <p>타자 <strong>{name(req.batter)}</strong> <span className="muted small">{batLine(req.batter)}</span> <CondTag text={cond(req.batter)} label /></p>
                <p className="small muted">다음 타자 {name(req.onDeck)}</p>
                <p>투수 <strong>{name(req.pitcher)}</strong> <span className="muted small">{pitLine(req.pitcher)} · 오늘 타자 {req.pitcherBf}명 {req.pitcherRuns}실점</span> <CondTag text={cond(req.pitcher)} label /></p>
                {req.bases.some((b) => b >= 0) && <p className="small">주자: {req.bases.map((b, k) => (b >= 0 ? `${k + 1}루 ${name(b)}` : '')).filter(Boolean).join(', ')}</p>}
                {pitches.length > 0 && <p className="small pitch-seq">이번 타석: {pitches.join(' · ')}</p>}
              </div>
            </div>

            {showPanel && (
              <section className="command-panel">
                {req.step === 'pitch' ? (
                  req.side === 'bat' ? (
                    <>
                      {canSteal && stealSet(['', 'go', 'hnr'])}
                      {runnerSet()}
                      {!canSteal && !req.bases.some((b) => b >= 0) && <p className="muted small">공 사이 공격 지시는 주자가 있을 때만 (도루·히트앤드런·대주자). 그대로 두면 감독이 맡습니다.</p>}
                    </>
                  ) : (
                    <>
                      <fieldset>
                        <legend>투수 <span className="muted small">공 사이 교체는 지금 카운트부터 새 투수가 던집니다</span></legend>
                        <select value={pitcher} onChange={(e) => setPitcher(e.target.value)}>
                          <option value="">{name(req.pitcher)} 그대로</option>
                          {req.bullpen.map((i) => <option key={i} value={i}>교체: {name(i)} — {pitLine(i)}{condOpt(i)}</option>)}
                        </select>
                      </fieldset>
                      <label className="check"><input type="checkbox" checked={walk === 'yes'} onChange={(e) => setWalk(e.target.checked ? 'yes' : '')} /> 고의4구로 {name(req.batter)} 내보내기</label>
                    </>
                  )
                ) : req.side === 'bat' ? (
                  <>
                    {req.step === 'run' ? (
                      <>
                        {stealSet(['', 'go', 'hold', 'hnr'])}
                        <p className="muted small">도루 결과를 본 뒤 같은 타석의 타격 작전(대타·강공·번트)을 따로 고릅니다.</p>
                      </>
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
                          <select value={ph} onChange={(e) => setPh(e.target.value)}>
                            <option value="">자동 (감독)</option>
                            <option value="none">그대로 (대타 없음)</option>
                            {benchOpts(ph).map((i) => <option key={i} value={i}>{name(i)} — {batLine(i)}{condOpt(i)}</option>)}
                          </select>
                        </fieldset>
                      </>
                    )}
                    {runnerSet()}
                  </>
                ) : (
                  <>
                    <fieldset>
                      <legend>투수</legend>
                      <select value={pitcher} onChange={(e) => setPitcher(e.target.value)}>
                        <option value="">자동 (감독이 판단)</option>
                        <option value="keep">{name(req.pitcher)} 계속</option>
                        {req.bullpen.map((i) => <option key={i} value={i}>교체: {name(i)} — {pitLine(i)}{condOpt(i)}</option>)}
                      </select>
                    </fieldset>
                    {triSet('고의4구', 'walk', walk, setWalk, `고의4구로 ${name(req.batter)} 내보내기`, '승부')}
                    {canInfield && (
                      <fieldset>
                        <legend>전진 수비 <span className="muted small">3루 주자 · 2아웃 전</span></legend>
                        {(['', 'in', 'back'] as const).map((t) => (
                          <label key={t} className="check"><input type="radio" name="infield" checked={infield === t} onChange={() => setInfield(t)} /> {t === '' ? '자동 (감독)' : t === 'in' ? '전진 수비' : '정상 수비'}</label>
                        ))}
                      </fieldset>
                    )}
                    {canPitchout && triSet('피치아웃', 'pitchout', pitchout, setPitchout, '피치아웃', '안 함', '1루 주자의 도루에 대비해 공 하나를 뺍니다 (투구 수 +1).')}
                    {req.fieldBench && (
                      <fieldset>
                        <legend>대수비</legend>
                        <select value={defOut} onChange={(e) => { setDefOut(e.target.value); setDefIn(''); }}>
                          <option value="">자동 (감독)</option>
                          <option value="none">그대로 (대수비 없음)</option>
                          {req.lineup.map((i, k) => req.fieldSlots?.[k] !== 'DH' && <option key={i} value={i}>{req.fieldSlots?.[k] ?? ''} {name(i)} 대신</option>)}
                        </select>
                        {defOut && defOut !== 'none' && (
                          <select value={defIn} onChange={(e) => setDefIn(e.target.value)} disabled={!req.fieldBench.length}>
                            <option value="">들어갈 선수 고르기</option>
                            {req.fieldBench.map((i) => <option key={i} value={i}>{W.players[i]?.pos ?? ''} {name(i)}{condOpt(i)}</option>)}
                          </select>
                        )}
                        {!req.fieldBench.length && <p className="muted small">쓸 수 있는 벤치 야수가 없습니다.</p>}
                      </fieldset>
                    )}
                  </>
                )}
                {req.side === 'bat' && !req.bench.length && req.bases.some((b) => b >= 0) && <p className="muted small">쓸 수 있는 벤치 야수가 없습니다.</p>}
              </section>
            )}

            <div className="actions cast-controls">
              {watching ? (
                <button type="button" onClick={() => setWatching(false)}>멈춤</button>
              ) : (
                <>
                  <button type="button" onClick={() => go('pitch')} disabled={busy}>다음 공</button>
                  <button type="button" className="ghost" onClick={watch} disabled={busy} title="공 하나씩 이어 보여 주고, 다음 타석 지시 때 멈춥니다. 중간에 멈추면 공 사이 지시를 고를 수 있습니다">공마다 지켜보기</button>
                  <button type="button" onClick={() => go('next')} disabled={busy}>다음 타석</button>
                  <button type="button" className="ghost" onClick={() => go('inning')} disabled={busy}>이번 반 이닝 자동</button>
                  <button type="button" className="ghost" onClick={() => go('crisis')} disabled={busy} title="7회 이후 2점 차 안에서 득점권 주자가 있을 때만 묻습니다">위기 때만 묻기</button>
                  <button type="button" className="ghost" onClick={() => go('auto')} disabled={busy}>경기 끝까지 자동</button>
                </>
              )}
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
              {recent.map((p, k) => {
                const note = pitchNote(p);
                return (
                  <li key={k} className={`${p.runs > 0 ? 'scored' : ''} kind-${p.kind}`}>
                    <span className="muted">{inningLabel(p)}</span> {playText(p, name)}{p.runs > 0 && <span className="muted"> · {p.away}:{p.home}</span>}
                    {note && <span className="muted"> · {note}</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </dialog>
  );
}
