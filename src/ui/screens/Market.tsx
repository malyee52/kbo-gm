// 선수 시장 (시즌 중 방출·영입, league/market.ts): 외국인 교체 후보와 자유계약 선수 영입, 우리 선수 웨이버 공시, 리그의 이동 기록.
import { useState } from 'react';
import { isStarterSkill, type SimPlayer } from '../../engine';
import { shortDate } from '../../game/calendar';
import { avg, era, fixed2, ipText, ops, rate3 } from '../../game/stats';
import { foreignRule, teamForeignRule } from '../../league/eras';
import { availableDay, foreignHeld, foreignSwapsUsed, INJURY_SWAP_FROM, INJURY_SWAP_MONTH_USD, movesOf, rehabSalary, releaseCost } from '../../league/market';
import { dollarText } from '../../league/salary';
import { ConfirmButton } from '../ConfirmButton';
import { PlayerLink, posName, TeamName, useGame, useWon } from '../context';
import { GuessCell, useSeen } from '../parts';
import { ruleDate, ruleOf } from '../../league/rules';

type Kind = 'foreign' | 'free';

export function Market() {
  const { session, changed, store } = useGame();
  const won = useWon();
  const [kind, setKind] = useState<Kind>('foreign');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const year = session.world.year;
  const lp = new Map(session.league.players.map((p) => [p.id, p]));
  const market = session.marketPlayers();
  const rule = foreignRule(store.meta, year, session.league);
  // 창단 특례 구단은 1명 더 (signBlock과 같은 한도)
  const limit = teamForeignRule(rule, session.league, session.teamIdx, year);
  const held = foreignHeld(session.world, session.teamIdx, lp, session.league);
  const used = foreignSwapsUsed(session.marketCtx, session.teamIdx);
  const deadline = session.marketDeadlineDay;
  const open = session.phase === 'season' && !session.done && session.day <= deadline;
  const regular = session.regularCount();
  // 부상 대체 외국인 (2024~): 재활 명단에 올릴 수 있는 우리 외국인과 지금 재활 명단
  const hurt = session.rehabCandidates();
  const [hurtId, setHurtId] = useState<string | null>(null);
  const injured = hurt.find((p) => p.id === hurtId) ?? hurt[0] ?? null;
  const rehabs = session.rehabs();
  const byId = new Map(session.world.players.map((p) => [p.id, p]));

  // 정렬은 능력 추측 가운데값 평균 (진짜 기여 순은 보이지 않는다, 능력치 v2 17.6)
  const seen = useSeen();
  const guessOf = new Map(market.map((p) => [p.idx, seen.set(p.id)]));
  const runs = (p: SimPlayer) => guessOf.get(p.idx)?.sort ?? 0;
  /** 실제 시즌 중 교체 외국인은 실제로 들어온 무렵부터 시장에 나온다 */
  const from = (p: SimPlayer) => availableDay(lp.get(p.id), session.season.schedule.length);
  const list = market
    .filter((p) => (kind === 'foreign' ? lp.get(p.id)?.market === year : p.formerTeam !== undefined))
    .sort((a, b) => Number(from(a) > session.day) - Number(from(b) > session.day) || runs(b) - runs(a) || a.id.localeCompare(b.id));
  const line = (p: SimPlayer) => {
    const b = session.season.bat[p.idx];
    const x = session.season.pit[p.idx];
    return p.isPitcher ? (x.bf ? `${ipText(x.outs)}이닝 ${fixed2(era(x))}` : '-') : (b.pa ? `${rate3(avg(b))} OPS ${rate3(ops(b))}` : '-');
  };
  const role = (p: SimPlayer) => (p.isPitcher ? (isStarterSkill(p.pit) ? '선발' : '구원') : posName(p.pos));
  const salary = (p: SimPlayer) => {
    const l = lp.get(p.id);
    if (!l) return '-';
    return p.foreign ? dollarText(l.contract.salary) : `${won(3000)} (최저)`;
  };
  const sign = (p: SimPlayer) => {
    const r = session.signInSeason(p);
    setMsg({ text: r.message, ok: r.ok });
    if (r.ok) changed();
  };
  const signRehab = (p: SimPlayer) => {
    if (!injured) return;
    const r = session.signRehab(p, injured);
    setMsg({ text: r.message, ok: r.ok });
    if (r.ok) changed();
  };
  const endRehab = (id: string, keep: boolean) => {
    const r = session.endRehab(id, keep);
    setMsg({ text: r.message, ok: r.ok });
    if (r.ok) changed();
  };
  const left = (p: SimPlayer) => Math.max(0, session.season.states.absentUntil[p.idx] - session.day);

  const moves = movesOf(session.league, year).slice().reverse();
  const nameOf = (id: string) => session.world.players.find((p) => p.id === id)?.name ?? lp.get(id)?.name ?? id;

  return (
    <div className="stack">
      <section className="panel">
        <h2>선수 시장</h2>
        <p className="muted small">
          시즌 중 방출·영입은 {ruleDate(session.league, 'marketDeadline').month}월 {ruleDate(session.league, 'marketDeadline').date}일({shortDate(year, deadline)})까지입니다.
          {open ? '' : ' 지금은 마감됐습니다.'}
        </p>
        <ul className="plain small">
          <li>정식 선수 {regular}/{ruleOf(session.league, 'orgLimit')}명 · 외국인 {held.regular}/{limit.regular}명{limit.asia ? ` · 아시아쿼터 ${held.asia}/${limit.asia}명` : ''} · 외국인 교체 {used}/{ruleOf(session.league, 'foreignSwaps')}번</li>
          {(held.regular > limit.regular || held.asia > limit.asia) && (
            <li className="note">외국인을 보유 한도보다 많이 데리고 있습니다. 새 외국인을 데려오려면 한도 아래로 내려갈 때까지 먼저 방출해야 합니다 (1군 등록은 한도까지만).</li>
          )}
          <li>새 외국인 후보는 관찰 명단(영입 &gt; 스카우트 &gt; 해외)에 오른 선수만 이 목록에 나옵니다.</li>
          <li>방출(웨이버 공시): 선수 창의 "웨이버 공시"로 합니다. 하위 구단부터 데려갈 수 있고, 데려간 구단이 계약을 넘겨받습니다. 아무도 데려가지 않으면 자유계약 선수가 되고 남은 보장 연봉을 그때 냅니다(외국인은 연봉의 60%).</li>
          <li>새 외국인은 보유 한도가 빈 자리에만, 한 시즌 {ruleOf(session.league, 'foreignSwaps')}번까지 데려올 수 있습니다. 연봉은 남은 달만큼 나갑니다.</li>
          <li>자유계약 선수는 최저 연봉으로 이번 시즌까지 계약합니다. 같은 시즌에 방출한 선수는 다시 데려올 수 없습니다.</li>
          {year >= INJURY_SWAP_FROM && (
            <li>부상 대체 외국인: 6주 넘게 빠지는 외국인을 재활 명단에 올리고(보유 한도에서 빠짐) 교체 횟수를 쓰지 않고 데려옵니다. 연봉은 한 달 {dollarText(INJURY_SWAP_MONTH_USD)}까지. 원래 선수가 나으면 복귀(대체 선수 방출)와 대체 선수 남기기(원래 선수 방출, 교체 1회) 가운데 고릅니다.</li>
          )}
        </ul>
      </section>

      {rehabs.length > 0 && (
        <section className="panel">
          <h2>재활 명단</h2>
          <ul className="plain small">
            {rehabs.map((r) => {
              const p = byId.get(r.injured)!;
              const sub = byId.get(r.sub)!;
              const back = session.rehabEndBlock(r, false);
              const keep = session.rehabEndBlock(r, true);
              return (
                <li key={r.injured}>
                  <PlayerLink p={p} /> ({left(p) > 0 ? `복귀까지 ${left(p)}일` : '다 나음 · 오늘 경기 전까지 고르세요'}) · 부상 대체 <PlayerLink p={sub} /> ({shortDate(year, Math.min(r.day, session.season.schedule.length - 1))}부터)
                  <div className="row wrap">
                    <button type="button" onClick={() => endRehab(r.injured, false)} disabled={!!back} title={back ?? `${p.name} 복귀, ${sub.name} 방출`}>{p.name} 복귀</button>
                    <ConfirmButton label={`${sub.name} 남기기`} confirmLabel={`정말 ${p.name} 방출 (교체 1회)`} disabled={!!keep}
                      onConfirm={() => endRehab(r.injured, true)} />
                    {(back || keep) && <span className="muted">{[back, keep].filter(Boolean).join(' ')}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="panel">
        <div className="row-between wrap">
          <div className="seg" role="tablist" aria-label="시장 구분">
            <button type="button" role="tab" aria-selected={kind === 'foreign'} className={kind === 'foreign' ? 'on' : ''} onClick={() => setKind('foreign')}>외국인 후보</button>
            <button type="button" role="tab" aria-selected={kind === 'free'} className={kind === 'free' ? 'on' : ''} onClick={() => setKind('free')}>자유계약 선수</button>
          </div>
          {msg && <span className={msg.ok ? 'note small' : 'muted small'} role="status">{msg.text}</span>}
        </div>
        {kind === 'foreign' && hurt.length > 0 && (
          <p className="small">
            부상 대체로 데려오기: 재활 명단에 올릴 선수{' '}
            <select value={injured?.id ?? ''} onChange={(e) => setHurtId(e.target.value)}>
              {hurt.map((p) => <option key={p.id} value={p.id}>{p.name} (결장 {left(p)}일)</option>)}
            </select>
          </p>
        )}
        {list.length === 0 ? (
          <p className="muted small">{kind === 'foreign'
            ? (rule.total ? '지금 영입할 수 있는 외국인 후보가 없습니다. 새 외국인 후보는 관찰 명단에 오른 선수만 보입니다: 영입 > 스카우트 > 해외에서 스카우트 팀을 보내 찾으세요 (파견이 없어도 에이전트가 몇 주마다 한 명을 추천합니다).' : `${year}년에는 외국인 선수 제도가 없습니다.`)
            : '지금 자유계약 선수가 없습니다.'}</p>
        ) : (
          <div className="scroll flat">
            <table>
              <thead><tr><th className="l">이름</th><th>자리</th><th>나이</th><th>능력 추측</th><th className="l">올해</th><th className="l">{kind === 'free' ? '전 소속' : '구분'}</th><th>연봉</th><th /></tr></thead>
              <tbody>
                {list.map((p) => {
                  const why = session.signBlock(p);
                  const rehabWhy = kind === 'foreign' && injured ? session.rehabSignBlock(p, injured) : null;
                  const l = lp.get(p.id);
                  return (
                    <tr key={p.idx}>
                      <td className="l"><PlayerLink p={p} /></td>
                      <td>{role(p)}</td>
                      <td>{p.age ?? '-'}</td>
                      <td><GuessCell g={guessOf.get(p.idx)} /></td>
                      <td className="l small">{line(p)}</td>
                      <td className="l small">{kind === 'free' && p.formerTeam !== undefined ? <TeamName idx={p.formerTeam} /> : lp.get(p.id)?.asia ? '아시아쿼터' : '외국인'}{from(p) > session.day && <span className="muted"> · {shortDate(year, from(p))}부터</span>}</td>
                      <td className="small">{salary(p)}{injured && kind === 'foreign' && l && rehabSalary(l, year, session.season.schedule.length) < l.contract.salary && <div className="muted">부상 대체 {dollarText(rehabSalary(l, year, session.season.schedule.length))}</div>}</td>
                      <td className="l">
                        <button type="button" onClick={() => sign(p)} disabled={!!why} title={why ?? '영입합니다 (2군에 들어갑니다)'}>영입</button>
                        {why && <div className="muted small">{why}</div>}
                        {injured && kind === 'foreign' && (
                          <>
                            <button type="button" onClick={() => signRehab(p)} disabled={!!rehabWhy} title={rehabWhy ?? `${injured.name}을(를) 재활 명단에 올리고 부상 대체로 영입합니다`}>부상 대체 영입</button>
                            {rehabWhy && <div className="muted small">{rehabWhy}</div>}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>이번 시즌 이동</h2>
        {moves.length === 0 ? <p className="muted small">아직 없습니다.</p> : (
          <ul className="plain small">
            {moves.map((m, i) => (
              <li key={i}>
                <span className="muted">{shortDate(year, Math.min(m.day, session.season.schedule.length - 1))}</span>{' '}
                {m.kind === 'sign' && <><TeamName idx={m.to} /> {nameOf(m.id)} 영입</>}
                {m.kind === 'rehab' && <><TeamName idx={m.to} /> {nameOf(m.rehab!)} 재활 명단, {nameOf(m.id)} 부상 대체 영입</>}
                {m.kind === 'keep' && <><TeamName idx={m.to} /> 부상 대체 {nameOf(m.id)} 남김 (교체 1회)</>}
                {m.kind === 'release' && <><TeamName idx={m.from} /> {nameOf(m.id)} 방출 (자유계약)</>}
                {m.kind === 'claim' && <><TeamName idx={m.to} />, <TeamName idx={m.from} />에서 방출한 {nameOf(m.id)}을(를) 웨이버로 데려감</>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 선수 창의 웨이버 공시 버튼 (우리 선수, 시즌 중) */
export function ReleaseButton({ p, onDone }: { p: SimPlayer; onDone: (message: string) => void }) {
  const { session, changed } = useGame();
  const won = useWon();
  if (session.phase !== 'season' || p.teamIdx !== session.teamIdx) return null;
  const why = session.releaseBlock(p);
  const l = session.leaguePlayer(p.id);
  const cost = l ? releaseCost(l, session.world.year, session.season.schedule.length, session.season.day) : 0;
  if (why) return <span className="muted small" title={why}>웨이버 공시 불가: {why}</span>;
  return (
    <ConfirmButton label="웨이버 공시(방출)" confirmLabel={`정말 방출 (남은 보장 연봉 ${won(cost)})`}
      onConfirm={() => { const r = session.releaseInSeason(p); changed(); onDone(r.message); }} />
  );
}
