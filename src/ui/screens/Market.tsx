// 선수 시장 (시즌 중 방출·영입, league/market.ts): 외국인 교체 후보와 자유계약 선수 영입, 우리 선수 웨이버 공시, 리그의 이동 기록.
import { useState } from 'react';
import { isStarterSkill, type SimPlayer } from '../../engine';
import { currentRuns } from '../../ai/value';
import { shortDate } from '../../game/calendar';
import { avg, era, fixed2, ipText, ops, rate3 } from '../../game/stats';
import { foreignRule } from '../../league/eras';
import { availableDay, FOREIGN_SWAPS, foreignHeld, foreignSwapsUsed, MARKET_DEADLINE, movesOf, releaseCost } from '../../league/market';
import { dollarText, ORG_LIMIT } from '../../league/salary';
import { ConfirmButton } from '../ConfirmButton';
import { Grade, PlayerLink, posName, TeamName, useGame, useWon } from '../context';
import { runsGrade } from '../grades';

type Kind = 'foreign' | 'free';

export function Market() {
  const { session, changed, store } = useGame();
  const won = useWon();
  const [kind, setKind] = useState<Kind>('foreign');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const year = session.world.year;
  const ctx = session.values;
  const lp = new Map(session.league.players.map((p) => [p.id, p]));
  const market = session.marketPlayers();
  const rule = foreignRule(store.meta, year);
  const held = foreignHeld(session.world, session.teamIdx, lp);
  const used = foreignSwapsUsed(session.marketCtx, session.teamIdx);
  const deadline = session.marketDeadlineDay;
  const open = session.phase === 'season' && !session.done && session.day <= deadline;
  const regular = session.regularCount();

  const runs = (p: SimPlayer) => currentRuns(p, ctx);
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

  const moves = movesOf(session.league, year).slice().reverse();
  const nameOf = (id: string) => session.world.players.find((p) => p.id === id)?.name ?? lp.get(id)?.name ?? id;

  return (
    <div className="stack">
      <section className="panel">
        <h2>선수 시장</h2>
        <p className="muted small">
          시즌 중 방출·영입은 {MARKET_DEADLINE.month}월 {MARKET_DEADLINE.date}일({shortDate(year, deadline)})까지입니다.
          {open ? '' : ' 지금은 마감됐습니다.'}
        </p>
        <ul className="plain small">
          <li>정식 선수 {regular}/{ORG_LIMIT}명 · 외국인 {held.regular}/{rule.regular}명{rule.asia ? ` · 아시아쿼터 ${held.asia}/${rule.asia}명` : ''} · 외국인 교체 {used}/{FOREIGN_SWAPS}번</li>
          <li>방출(웨이버 공시): 선수 창의 "웨이버 공시"로 합니다. 하위 구단부터 데려갈 수 있고, 데려간 구단이 계약을 넘겨받습니다. 아무도 데려가지 않으면 자유계약 선수가 되고 남은 보장 연봉을 그때 냅니다(외국인은 연봉의 60%).</li>
          <li>새 외국인은 보유 한도가 빈 자리에만, 한 시즌 {FOREIGN_SWAPS}번까지 데려올 수 있습니다. 연봉은 남은 달만큼 나갑니다.</li>
          <li>자유계약 선수는 최저 연봉으로 이번 시즌까지 계약합니다. 같은 시즌에 방출한 선수는 다시 데려올 수 없습니다.</li>
        </ul>
      </section>

      <section className="panel">
        <div className="row-between wrap">
          <div className="seg" role="tablist" aria-label="시장 구분">
            <button type="button" role="tab" aria-selected={kind === 'foreign'} className={kind === 'foreign' ? 'on' : ''} onClick={() => setKind('foreign')}>외국인 후보</button>
            <button type="button" role="tab" aria-selected={kind === 'free'} className={kind === 'free' ? 'on' : ''} onClick={() => setKind('free')}>자유계약 선수</button>
          </div>
          {msg && <span className={msg.ok ? 'note small' : 'muted small'} role="status">{msg.text}</span>}
        </div>
        {list.length === 0 ? (
          <p className="muted small">{kind === 'foreign' ? (rule.total ? '시장에 남은 외국인 후보가 없습니다.' : `${year}년에는 외국인 선수 제도가 없습니다.`) : '지금 자유계약 선수가 없습니다.'}</p>
        ) : (
          <div className="scroll flat">
            <table>
              <thead><tr><th className="l">이름</th><th>자리</th><th>나이</th><th>현재</th><th className="l">올해</th><th className="l">{kind === 'free' ? '전 소속' : '구분'}</th><th>연봉</th><th /></tr></thead>
              <tbody>
                {list.map((p) => {
                  const why = session.signBlock(p);
                  return (
                    <tr key={p.idx}>
                      <td className="l"><PlayerLink p={p} /></td>
                      <td>{role(p)}</td>
                      <td>{p.age ?? '-'}</td>
                      <td><Grade v={runsGrade(runs(p), year)} /></td>
                      <td className="l small">{line(p)}</td>
                      <td className="l small">{kind === 'free' && p.formerTeam !== undefined ? <TeamName idx={p.formerTeam} /> : lp.get(p.id)?.asia ? '아시아쿼터' : '외국인'}{from(p) > session.day && <span className="muted"> · {shortDate(year, from(p))}부터</span>}</td>
                      <td className="small">{salary(p)}</td>
                      <td><button type="button" onClick={() => sign(p)} disabled={!!why} title={why ?? '영입합니다 (2군에 들어갑니다)'}>영입</button></td>
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
