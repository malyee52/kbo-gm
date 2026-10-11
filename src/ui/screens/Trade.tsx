// 트레이드: 상대 구단 선택, 주고받을 선수 고르기, 제안과 AI 답, 요구안 묻기, 트레이드 기록.
import { useMemo, useState } from 'react';
import { MAX_PER_SIDE, TENDENCY_LABEL, type TradeEvaluation } from '../../ai/trade';
import type { SimPlayer } from '../../engine';
import { formatDate, shortDate } from '../../game/calendar';
import { TRADE_DEADLINE } from '../../game/session';
import { avg, era, fixed2, ipText, ops, rate3 } from '../../game/stats';
import { Grade, PlayerLink, posName, TeamName, useGame, usePriceIndex, useWon } from '../context';
import { teamColor } from '../teams';
import { MAX_PICKS_PER_TRADE, parsePick, pickId, PICK_MAX_ROUND, PICK_YEARS_AHEAD } from '../../league/picks';
import { GM_STYLE_LABEL, GM_STYLE_NOTE, gmStyle } from '../../league/gm';

type Kind = 'all' | 'hit' | 'pit';

export function Trade() {
  const { session, changed, version } = useGame();
  const others = session.world.teams.filter((t) => t.idx !== session.teamIdx);
  const [other, setOther] = useState<number>(others[0].idx);
  const [give, setGive] = useState<Set<number>>(new Set());
  const [get, setGet] = useState<Set<number>>(new Set());
  const [reply, setReply] = useState<{ ev?: TradeEvaluation; text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // 지명권 (pickId): 내줄 것, 받을 것
  const [gp, setGp] = useState<Set<string>>(new Set());
  const [rp, setRp] = useState<Set<string>>(new Set());
  // 현금 (억 원, 그 해 물가로 보이는 금액). 우리가 주면 +, 받으면 −
  const [cashText, setCashText] = useState('0');
  const px = usePriceIndex();
  const won = useWon();
  const cashMan = Math.round((Number(cashText) || 0) * 10000 / px);
  const year = session.world.year;

  // 성향과 순위 (20경기 전에는 전력 순위)
  const info = useMemo(
    () => new Map(others.map((t) => {
      const sit = session.situation(t.idx);
      const early = session.season.teams[t.idx].g < 20;
      return [t.idx, { tendency: session.tendency(t.idx), rank: `${early ? '전력 ' : ''}${sit.rank}위` }];
    })),
    [session, version], // version: 경기를 치르거나 트레이드하면 성향이 바뀔 수 있다
  );

  const players = session.world.players;
  const giveList = [...give].map((i) => players[i]);
  const getList = [...get].map((i) => players[i]);

  const pickTeam = (t: number) => {
    setOther(t);
    setGet(new Set());
    setRp(new Set());
    setReply(null);
  };

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, p: SimPlayer) => {
    const next = new Set(set);
    if (next.has(p.idx)) next.delete(p.idx);
    else if (next.size < MAX_PER_SIDE) next.add(p.idx);
    else {
      setReply({ text: `한쪽에서 ${MAX_PER_SIDE}명까지 고를 수 있습니다.` });
      return;
    }
    setter(next);
    setReply(null);
  };

  const propose = () => {
    const ev = session.proposeTrade(other, giveList, getList, cashMan, { give: [...gp].map(parsePick), get: [...rp].map(parsePick) });
    if (ev.verdict === 'accept') {
      setReply({ ev, text: `${session.world.teams[other].name}: "${ev.message}" 트레이드가 성사됐습니다. 받은 선수는 2군에 있습니다.`, ok: true });
      setGive(new Set());
      setGet(new Set());
      setGp(new Set());
      setRp(new Set());
      setCashText('0');
      changed();
    } else {
      setReply({ ev, text: `${session.world.teams[other].name}: "${ev.message}"` });
    }
  };

  const ask = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    const pkg = session.askPackage(other, getList);
    setBusy(false);
    if (!pkg) {
      setReply({ text: `${session.world.teams[other].name}: "지금 우리 선수단과 맞바꿀 만한 조합이 없습니다."` });
      return;
    }
    setGive(new Set(pkg.map((p) => p.idx)));
    setReply({ text: `${session.world.teams[other].name}: "${pkg.map((p) => p.name).join(', ')}을(를) 주시면 생각해 보겠습니다." (내줄 선수 칸에 넣었습니다)` });
  };

  const open = session.tradeOpen;

  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <p className="muted small">
            {open
              ? `마감: ${TRADE_DEADLINE.month}월 ${TRADE_DEADLINE.date}일 (${formatDate(year, session.tradeDeadlineDay)} 경기 전까지)`
              : session.done ? '시즌이 끝나 트레이드를 할 수 없습니다.' : '트레이드 마감이 지났습니다.'}
            {' · '}한쪽에서 {MAX_PER_SIDE}명까지. 받은 선수는 2군으로 들어옵니다.
          </p>
        </div>
      </section>

      <div className="team-grid compact" role="radiogroup" aria-label="상대 구단">
        {others.map((t) => (
          <button key={t.idx} type="button" role="radio" aria-checked={other === t.idx}
            className={`team-card${other === t.idx ? ' on' : ''}`} style={{ ['--c' as string]: teamColor(t.franchise, t.name) }} onClick={() => pickTeam(t.idx)}>
            <TeamName idx={t.idx} />
            <span className="muted small">{info.get(t.idx)!.rank} · {TENDENCY_LABEL[info.get(t.idx)!.tendency]}</span>
            <span className="muted small" title={GM_STYLE_NOTE[gmStyle(session.league, t.idx)]}>단장: {GM_STYLE_LABEL[gmStyle(session.league, t.idx)]}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        우승 도전 구단은 당장 쓸 선수를, 리빌딩 구단은 젊은 선수를 높게 칩니다. AI 구단은 트레이드 뒤 자기 전력이 좋아질 때만 받아들입니다.
        단장 성향: 윈나우형은 순위가 조금 밀려도 우승을 노리고, 육성형은 상위권이 아니면 리빌딩, 짠돌이형은 연봉 부담을 크게 봅니다. 구단 카드에 마우스를 올리면 설명이 보입니다.
      </p>

      <section className="trade-bar panel">
        <div className="trade-sides">
          <div>
            <h3>내줄 선수 <span className="muted small">{session.team.name}</span></h3>
            {giveList.length ? <ul className="plain">{giveList.map((p) => <li key={p.idx}><PlayerLink p={p} /> <span className="muted small">{p.isPitcher ? '투수' : posName(p.pos)} · {p.age ?? '-'}세</span></li>)}</ul> : <p className="muted small">아래 왼쪽에서 고르세요.</p>}
            {gp.size > 0 && <p className="small">지명권: {[...gp].map((id) => session.pickLabel(parsePick(id))).join(', ')}</p>}
          </div>
          <div aria-hidden className="trade-arrow">⇄</div>
          <div>
            <h3>받을 선수 <span className="muted small">{session.world.teams[other].name}</span></h3>
            {getList.length ? <ul className="plain">{getList.map((p) => <li key={p.idx}><PlayerLink p={p} /> <span className="muted small">{p.isPitcher ? '투수' : posName(p.pos)} · {p.age ?? '-'}세</span></li>)}</ul> : <p className="muted small">아래 오른쪽에서 고르세요.</p>}
            {rp.size > 0 && <p className="small">지명권: {[...rp].map((id) => session.pickLabel(parsePick(id))).join(', ')}</p>}
          </div>
        </div>
        <p className="small">
          <label>
            현금{' '}
            <input type="number" step={0.5} value={cashText} onChange={(e) => setCashText(e.target.value)} style={{ width: '6em' }} aria-label="트레이드 현금 (억 원)" />
            억 원
          </label>{' '}
          <span className="muted">
            {cashMan > 0 ? `우리가 ${won(cashMan)}을 줍니다` : cashMan < 0 ? `상대에게서 ${won(-cashMan)}을 받습니다` : '현금 없음'} · 지금 자금 {won(session.cashNow())}.
            선수를 현금만으로 사고팔 수도 있습니다 (한쪽 선수 칸을 비우고 현금을 넣으세요). AI는 현금을 선수 가치보다 조금 박하게 쳐줍니다.
          </span>
        </p>
        {reply && <p className={reply.ok ? 'note' : reply.ev && reply.ev.verdict !== 'accept' ? 'note error-box' : 'note'} role="status">{reply.text}</p>}
        <div className="actions">
          <button type="button" onClick={propose} disabled={!open || busy || (giveList.length === 0 && getList.length === 0)}>제안하기</button>
          <button type="button" className="ghost" onClick={() => void ask()} disabled={!open || busy || getList.length === 0} title="받을 선수를 고른 뒤 상대가 원하는 조건을 묻습니다">
            {busy ? '상대가 검토 중' : '상대 요구안 묻기'}
          </button>
          <button type="button" className="ghost" onClick={() => { setGive(new Set()); setGet(new Set()); setGp(new Set()); setRp(new Set()); setCashText('0'); setReply(null); }}>비우기</button>
        </div>
      </section>

      {session.pickTradeOpen && (
        <section className="panel">
          <h2>신인 지명권</h2>
          <p className="muted small">
            다음 {PICK_YEARS_AHEAD}번의 드래프트, {PICK_MAX_ROUND}라운드까지. 한 트레이드에 {MAX_PICKS_PER_TRADE}장까지, 선수와 함께만 (2019년 8월 KBO 규약).
            순번은 그 해 원래 구단의 순위로 정해집니다. 넘겨받은 지명권으로 뽑은 선수는 입단 첫해 트레이드할 수 없습니다.
            리빌딩 구단일수록, 하위권 구단의 지명권일수록 높게 칩니다.
          </p>
          <div className="two">
            <PickBoxes title={`${session.team.name} 지명권`} team={session.teamIdx} selected={gp} other={rp} setSelected={setGp} disabled={!open} onChange={() => setReply(null)} />
            <PickBoxes title={`${session.world.teams[other].name} 지명권`} team={other} selected={rp} other={gp} setSelected={setRp} disabled={!open} onChange={() => setReply(null)} />
          </div>
        </section>
      )}

      <div className="two">
        <PickList title={`${session.team.name} 선수`} org={session.team.org} selected={give} onToggle={(p) => toggle(give, setGive, p)} disabled={!open} showEntry />
        <PickList title={`${session.world.teams[other].name} 선수`} org={session.world.teams[other].org} selected={get} onToggle={(p) => toggle(get, setGet, p)} disabled={!open} />
      </div>

      {(() => {
        const league = (session.league.aiTrades ?? []).filter((t) => t.year === year);
        if (!league.length) return null;
        const nm = (id: string) => players.find((p) => p.id === id)?.name ?? id;
        return (
          <section>
            <h2>리그 트레이드 <span className="muted small">AI 구단끼리 {league.length}건</span></h2>
            <ul className="plain small">
              {[...league].reverse().map((t, k) => (
                <li key={k}>
                  <span className="muted">{shortDate(year, t.day)}</span> <TeamName idx={t.buyer} /> ← {t.got.map(nm).join(', ')} · <TeamName idx={t.seller} /> ← {t.gave.map(nm).join(', ')}
                  {t.picks?.length ? `, ${t.picks.map((id) => session.pickLabel(parsePick(id))).join(', ')}` : ''}
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      <section>
        <h2>트레이드 기록</h2>
        {session.trades.length === 0 ? <p className="muted">아직 성사된 트레이드가 없습니다.</p> : (
          <div className="scroll">
            <table>
              <thead><tr><th className="l">날짜</th><th className="l">상대</th><th className="l">내준 것</th><th className="l">받은 것</th></tr></thead>
              <tbody>
                {[...session.trades].reverse().map((t, k) => (
                  <tr key={k}>
                    <td className="l">{shortDate(year, t.day)}</td><td className="l"><TeamName idx={t.team} /></td>
                    <td className="l">{[...t.give.map((i) => players[i].name), ...(t.pg ?? []).map((id) => session.pickLabel(parsePick(id)))].join(', ') || '-'}</td>
                    <td className="l">{[...t.get.map((i) => players[i].name), ...(t.pr ?? []).map((id) => session.pickLabel(parsePick(id)))].join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PickList({ title, org, selected, onToggle, disabled, showEntry = false }: {
  title: string; org: SimPlayer[]; selected: Set<number>; onToggle: (p: SimPlayer) => void; disabled: boolean; showEntry?: boolean;
}) {
  const { session, grades } = useGame();
  const [kind, setKind] = useState<Kind>('all');
  const registered = new Set(session.registered().map((p) => p.idx));
  const rows = org
    .filter((p) => kind === 'all' || (kind === 'pit') === p.isPitcher)
    .sort((a, b) => Number(a.isPitcher) - Number(b.isPitcher) || (a.isPitcher ? a.value - b.value : b.value - a.value) || a.idx - b.idx);
  return (
    <section>
      <div className="row-between">
        <h2>{title} <span className="muted small">{rows.length}명</span></h2>
        <div className="seg small" role="tablist">
          {(['all', 'hit', 'pit'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'all' ? '전체' : k === 'hit' ? '야수' : '투수'}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll pick">
        <table>
          <thead><tr><th /><th className="l">이름</th><th>자리</th><th>나이</th><th title="야수: 컨택·파워·선구안·주력 / 투수: 구위·제구·장타 억제·체력">능력</th><th>기록</th>{showEntry && <th>군</th>}</tr></thead>
          <tbody>
            {rows.map((p) => {
              const on = selected.has(p.idx);
              let stat: string;
              let gs: (number | null | undefined)[];
              if (p.isPitcher) {
                const s = session.season.pit[p.idx];
                stat = s.outs ? `${ipText(s.outs)}이닝 ${fixed2(era(s))}` : '-';
                const g = grades.pitchers.get(p.id);
                gs = [g?.stuff, g?.control, g?.hrSuppression, g?.stamina];
              } else {
                const b = session.season.bat[p.idx];
                stat = b.pa ? `${rate3(avg(b))} ${b.hr}홈런 OPS ${rate3(ops(b))}` : '-';
                const g = grades.batters.get(p.id);
                gs = [g?.contact, g?.power, g?.eye, g?.speed];
              }
              return (
                <tr key={p.idx} className={on ? 'me' : ''}>
                  <td><input type="checkbox" checked={on} onChange={() => onToggle(p)} disabled={disabled || p.foreign} title={p.foreign ? '외국인 선수는 트레이드할 수 없습니다' : undefined} aria-label={`${p.name} 선택`} /></td>
                  <td className="l"><PlayerLink p={p} /></td>
                  <td>{p.isPitcher ? (p.pit!.startShare >= 0.5 ? '선발' : '구원') : posName(p.pos)}</td>
                  <td>{p.age ?? '-'}</td>
                  <td className="grades-inline">{gs.map((v, i) => <Grade key={i} v={v} />)}</td>
                  <td className="small">{stat}</td>
                  {showEntry && <td className="small">{registered.has(p.idx) ? '1군' : '2군'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 그 구단이 가진 지명권 고르기 (양쪽 합 MAX_PICKS_PER_TRADE장까지) */
function PickBoxes({ title, team, selected, other, setSelected, disabled, onChange }: {
  title: string; team: number; selected: Set<string>; other: Set<string>; setSelected: (s: Set<string>) => void; disabled: boolean; onChange: () => void;
}) {
  const { session } = useGame();
  const picks = session.ownedPicks(team);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size + other.size < MAX_PICKS_PER_TRADE) next.add(id);
    else return;
    setSelected(next);
    onChange();
  };
  return (
    <div>
      <h3>{title} <span className="muted small">{picks.length}장</span></h3>
      <ul className="plain picks">
        {picks.map((p) => {
          const id = pickId(p);
          return (
            <li key={id}>
              <label className="small">
                <input type="checkbox" checked={selected.has(id)} disabled={disabled} onChange={() => toggle(id)} /> {session.pickLabel(p)}
                {p.from !== team && <span className="tag">받은 지명권</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
