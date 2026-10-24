// 다른 구단 보기 (2026-10-23 UI 2단계 공통 기능, 기획안 4장 1·결정 7): 시즌 > 구단들.
// 팀 이름(순위·일정·트레이드 후보 보드·검색)을 누르면 이 화면이 그 구단으로 열린다. 우리 구단 화면과 같은 틀
// (개요 = 구단 현황, 선수 명단, 예상 기용 = 기용 보드)을 읽기 전용으로 보여 주고, 트레이드 작업대(비교·제안)로 이어진다.
// 계산은 ui/teamView.ts. AI 구단의 판단값(aiPotential)은 보이지 않는다 (잠재는 우리 선수와 같은 표시 규칙).
import { useMemo, useState } from 'react';
import { TENDENCY_LABEL } from '../../ai/trade';
import type { SimPlayer } from '../../engine';
import { gamesBehind, rate3, recentForm } from '../../game/stats';
import { shortDate } from '../../game/calendar';
import { GM_STYLE_LABEL, gmStyle } from '../../league/gm';
import { managerOf } from '../../league/managers';
import { dollarText } from '../../league/salary';
import { Grade, PlayerLink, Pos, TeamName, useGame, useWon } from '../context';
import { DataTable, PotCell, potentialSortValue, usePotentialOf } from '../parts';
import { useShell } from '../shell';
import type { Column } from '../table';
import { teamVars } from '../teams';
import { addToCompare, addToDraft, COMPARE_MAX, deskOf, editDraft, emptyDraft, slotGrade, SLOTS, updateDesk, useDesk } from '../tradeDesk';
import { teamDeals, teamDepth, teamMoney, teamRows, type TeamRow } from '../teamView';
import { WatchStar } from './Watch';

type Tab = 'over' | 'roster' | 'depth';
const TABS: [Tab, string][] = [['over', '개요'], ['roster', '선수 명단'], ['depth', '예상 기용']];
const LAST_KEY = 'kbo-gm.team-view';

/** 마지막으로 본 구단 (이 브라우저에만 기억하는 편의 기능) */
function lastTeam(): number | null {
  try {
    const v = Number(sessionStorage.getItem(LAST_KEY));
    return Number.isInteger(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

export function TeamView({ team: arg }: { team?: number }) {
  const { session, go } = useGame();
  const teams = session.world.teams;
  const fallback = teams.find((t) => t.idx !== session.teamIdx)?.idx ?? 0;
  const [picked, setPicked] = useState<number>(() => {
    const t = arg ?? lastTeam() ?? fallback;
    return teams[t] ? t : fallback;
  });
  const team = arg !== undefined && teams[arg] ? arg : picked;
  const pick = (t: number) => {
    setPicked(t);
    try { sessionStorage.setItem(LAST_KEY, String(t)); } catch { /* 기억하지 못해도 화면은 그대로 */ }
    if (arg !== undefined) go('team', t);
  };
  const [tab, setTab] = useState<Tab>('over');
  const off = session.phase === 'offseason';
  const ours = team === session.teamIdx;
  const info = session.teamInfo(team);

  return (
    <div className="stack">
      <nav className="team-pick" aria-label="구단 고르기">
        {teams.map((t) => (
          <button key={t.idx} type="button" className={t.idx === team ? 'on' : ''} aria-current={t.idx === team ? 'true' : undefined} onClick={() => pick(t.idx)}>
            <TeamName idx={t.idx} />
          </button>
        ))}
      </nav>

      <TeamHero team={team} />

      <div className="seg" role="tablist" aria-label={`${info.name} 보기`}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {ours && <p className="muted small">우리 구단도 같은 틀로 봅니다 (읽기 전용). 바꾸려면 전력 &gt; 선수 명단·기용 보드에서.</p>}
      {off && <p className="muted small">오프시즌: 명단은 지금 계약 기준, 종합은 다음 시즌 예상입니다. 예상 기용은 개막 뒤에 열립니다.</p>}

      {tab === 'over' && <Overview team={team} />}
      {tab === 'roster' && <RosterTable team={team} />}
      {tab === 'depth' && <Depth team={team} />}
    </div>
  );
}

/** 머리: 구단 색 띠, 순위·성적, 성향, 단장·감독, 트레이드로 */
function TeamHero({ team }: { team: number }) {
  const { session, go } = useGame();
  const info = session.teamInfo(team);
  const ours = team === session.teamIdx;
  const off = session.phase === 'offseason';
  const s = session.season;
  const order = s.standings();
  const rank = off ? (session.league.lastSeason?.standings ?? []).indexOf(team) + 1 : order.indexOf(team) + 1;
  const r = s.teams[team];
  const mgr = managerOf(session.league, team);
  const startTrade = () => {
    const d = deskOf(session).draft;
    if (d.team !== team) editDraft(session, () => emptyDraft(team), `상대를 ${info.name}(으)로 바꿨습니다.`);
    updateDesk(session, () => ({ mode: 'deal', step: 'offer' }));
    go('trade');
  };
  const tradeWhy = off ? '오프시즌에는 트레이드를 할 수 없습니다' : !session.tradeOpen ? (session.done ? '시즌이 끝났습니다' : '트레이드 마감이 지났습니다') : null;
  return (
    <section className="card team-hero tv" style={teamVars(info.franchise, info.name)}>
      <div className="row-between wrap">
        <div>
          <h1 className="team-hero-name"><i className="sb-band" aria-hidden />{info.name}</h1>
          <p className="pd-line small">
            {rank > 0 && <span><b>{rank}위</b>{off ? ' (지난 시즌)' : ''}</span>}
            {r && r.g > 0 && <span className="num">{r.w}승 {r.l}패{r.t ? ` ${r.t}무` : ''} · 승률 {rate3(s.winPct(r))}</span>}
            {!ours && <span className="tag" title="상대 구단 성향 (트레이드 판단)">{TENDENCY_LABEL[session.tendency(team)]}</span>}
            {!ours && <span title="AI 단장 성향">단장 {GM_STYLE_LABEL[gmStyle(session.league, team)]}</span>}
            {mgr && <span>감독 {mgr.name}{mgr.interim ? ' (대행)' : ''}</span>}
          </p>
        </div>
        {ours ? (
          <span className="inline">
            <button type="button" className="ghost" onClick={() => go('roster')}>선수 명단</button>
            <button type="button" className="ghost" onClick={() => go('lineup')}>기용 보드</button>
          </span>
        ) : (
          <span className="inline">
            <button type="button" onClick={startTrade} disabled={!!tradeWhy} title={tradeWhy ?? '트레이드 작업대 ③ 제안을 이 구단으로 엽니다'}>이 구단과 트레이드 ▶</button>
            {tradeWhy && <span className="muted small">{tradeWhy}</span>}
          </span>
        )}
      </div>
    </section>
  );
}

function Overview({ team }: { team: number }) {
  const { session, version } = useGame();
  const won = useWon();
  const off = session.phase === 'offseason';
  const s = session.season;
  const year = session.world.year;
  const money = useMemo(() => teamMoney(session, team), [session, team, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const deals = useMemo(() => teamDeals(session, team), [session, team, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const org = session.world.teams[team]?.org ?? [];
  const depth = useMemo(() => (off ? [] : SLOTS.map((k) => ({ slot: k, g: slotGrade(session, org, k) }))), [session, team, version, off]); // eslint-disable-line react-hooks/exhaustive-deps
  const picks = session.ownedPicks(team);
  const r = s.teams[team];
  const order = s.standings();
  const leader = s.teams[order[0]];
  const form = recentForm(s.log, team);
  const rs = r ? r.rs : 0;
  const ra = r ? r.ra : 0;
  return (
    <div className="cards">
      <section className="card">
        <h2>{off ? `${year} 시즌 성적` : '성적'}</h2>
        {r && r.g > 0 ? (<>
          <p><b>{order.indexOf(team) + 1}위</b> · {r.w}승 {r.l}패{r.t ? ` ${r.t}무` : ''} · 승률 {rate3(s.winPct(r))} · {order[0] === team ? '선두' : `선두와 ${gamesBehind(leader, r).toFixed(1)}경기`}</p>
          <p className="small">최근 10경기 {form.w}승 {form.l}패{form.t ? ` ${form.t}무` : ''}{form.streak ? ` · ${form.streak}` : ''}</p>
          <p className="small">득점 {rs} · 실점 {ra} · 득실차 {rs - ra > 0 ? '+' : ''}{rs - ra} · 홈 {r.homeW}승 {r.homeL}패 · 원정 {r.w - r.homeW}승 {r.l - r.homeL}패</p>
        </>) : <p className="muted">아직 치른 경기가 없습니다.</p>}
      </section>

      <section className="card">
        <h2>계약·연봉</h2>
        {money.limit !== null && (
          <p>캡 대상 <b>{won(money.cap)}</b> / 상한 {won(money.limit)} <span className="muted small">({money.cap <= money.limit ? `남는 몫 ${won(money.limit - money.cap)}` : `${won(money.cap - money.limit)} 넘음`})</span></p>
        )}
        <p className="small">국내 선수 연봉 합 {won(money.payroll)} · 외국인 {money.foreign}명</p>
        <p className="small" title="계약이 끝나고 지금까지 쌓은 1군 연차로 FA 자격이 되는 선수 (이번 시즌 연차는 아직 안 셈)">{off ? session.year + 1 : session.year} 시즌 뒤 FA 후보 {money.faNext}명</p>
        <p className="muted small">{off ? '오프시즌 지금 계약 기준.' : '캡 판정은 개막 때 계약 기준이라 시즌 중 이적은 반영하지 않습니다.'}</p>
      </section>

      {!off && (
        <section className="card">
          <h2>자리별 등급 <span className="muted small">보이는 종합 기준</span></h2>
          <div className="slot-grades">
            {depth.map((d) => <span key={d.slot}><span className="muted small">{d.slot}</span> <Grade v={d.g} /></span>)}
          </div>
          <p className="muted small">야수는 그 자리 최고 종합, SP·RP는 상위 5명 평균 (트레이드 작업대와 같은 임시 기준).</p>
        </section>
      )}

      <section className="card">
        <h2>지명권 <span className="muted small">트레이드할 수 있는 것</span></h2>
        {picks.length ? <p className="small">{picks.map((p) => session.pickLabel(p)).join(' · ')}</p> : <p className="muted small">트레이드할 수 있는 지명권이 없습니다 (아직 지명권 거래가 없는 시대이거나 모두 넘겼습니다).</p>}
      </section>

      <section className="card">
        <h2>최근 거래</h2>
        {deals.length ? (
          <ul className="plain small">
            {deals.map((d, k) => <li key={k}><span className="muted">{d.year !== year ? `${d.year} ` : ''}{shortDate(d.year, d.day)}</span> {d.text}</li>)}
          </ul>
        ) : <p className="muted small">게임 안에서 이 구단이 한 트레이드·방출·영입이 없습니다.</p>}
      </section>
    </div>
  );
}

function RosterTable({ team }: { team: number }) {
  const { session, version } = useGame();
  const won = useWon();
  const potOf = usePotentialOf();
  const { density } = useShell();
  const desk = useDesk(session);
  const [kind, setKind] = useState<'all' | 'hit' | 'pit'>('all');
  const [note, setNote] = useState<string | null>(null);
  const ours = team === session.teamIdx;
  const off = session.phase === 'offseason';
  const all = useMemo(() => teamRows(session, team), [session, team, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = all.filter((r) => kind === 'all' || (kind === 'pit') === r.pitcher);

  const act = (r: TeamRow) => {
    if (!r.p || off) return null;
    const p = r.p;
    const inCmp = desk.compare.includes(p.idx);
    const inDraft = desk.draft.team === team && desk.draft.get.includes(p.idx);
    return (
      <span className="cand-act">
        <WatchStar id={r.id} name={r.name} small bare />
        <button type="button" className="ghost small-btn" disabled={inCmp} aria-label={`${r.name} 비교에 넣기`}
          onClick={() => setNote(addToCompare(session, p.idx) ?? `${r.name}: 비교 칸 ${deskOf(session).compare.length}/${COMPARE_MAX}`)}>
          {inCmp ? '비교 중' : '+비교'}
        </button>
        {!ours && (
          <button type="button" className="ghost small-btn" disabled={!!r.block || inDraft} title={r.block ?? undefined} aria-label={`${r.name} 제안에 넣기`}
            onClick={() => setNote(addToDraft(session, p) ?? `${r.name}: 받을 선수에 넣었습니다 (영입 > 트레이드 ③ 제안)`)}>
            {inDraft ? '제안 중' : '+제안'}
          </button>
        )}
      </span>
    );
  };

  const cols: Column<TeamRow>[] = [
    { key: 'name', label: '이름', fixed: true, text: true, value: (r) => r.name, cell: (r) => (r.p && !off ? <PlayerLink p={r.p} /> : <span>{r.name}{r.lp?.foreign ? <span className="tag">외</span> : null}</span>) },
    { key: 'where', label: off ? '구분' : '1·2군', brief: true, text: true, value: (r) => r.where },
    { key: 'slot', label: '자리', brief: true, value: (r) => SLOTS.indexOf(r.slot as typeof SLOTS[number]), cell: (r) => (r.pitcher ? r.slot : <Pos pos={r.slot} />) },
    { key: 'age', label: '나이', brief: true, lower: true, value: (r) => r.age },
    { key: 'ov', label: '종합', brief: true, value: (r) => r.ov, cell: (r) => <Grade v={r.ov} /> },
    { key: 'pot', label: '잠재', brief: true, title: '27세 이하 범위(스카우트 짐작), 28~30세 숫자, 31세 이상 숨김', value: (r) => (r.lp ? potentialSortValue(potOf(r.lp, r.age)) : null), cell: (r) => (r.lp ? <PotCell v={potOf(r.lp, r.age)} /> : '-') },
    { key: 'sal', label: '연봉', brief: true, value: (r) => r.lp?.contract.salary ?? null, cell: (r) => (r.lp ? (r.lp.foreign ? dollarText(r.lp.contract.salary) : won(r.lp.contract.salary)) : '-') },
    { key: 'until', label: '계약', brief: true, title: '계약 마지막 해', value: (r) => r.lp?.contract.until ?? null },
    { key: 'st', label: '상태', text: true, value: (r) => r.block ?? r.status,
      cell: (r) => (r.block ? <span className="muted small" title={r.block}>{r.lp?.foreign ? '외국인 · 트레이드 불가' : '트레이드 불가'}</span> : <span className="small">{r.status}</span>) },
    { key: 'act', label: '', fixed: true, value: () => null, cell: act },
  ];

  return (
    <section className="stack tight">
      <div className="seg" role="tablist" aria-label="선수 구분">
        {([['all', '전체'], ['hit', '야수'], ['pit', '투수']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {label} {k === 'all' ? all.length : all.filter((r) => (k === 'pit') === r.pitcher).length}
          </button>
        ))}
      </div>
      <DataTable id="team-roster" cols={cols} rows={rows} rowKey={(r) => r.id} full={density === 'full'} searchText={(r) => r.name}
        rowClass={(r) => (r.block ? 'blocked' : r.p && desk.compare.includes(r.p.idx) ? 'in-cmp' : undefined)} label="구단 선수 명단" empty="선수가 없습니다." />
      {note && <p className="muted small" role="status">{note}</p>}
      <p className="muted small">종합·잠재는 보이는 능력 기준이고 우리 선수와 같은 규칙으로 보입니다. 외국인 선수는 트레이드할 수 없습니다.</p>
    </section>
  );
}

function Depth({ team }: { team: number }) {
  const { session, version } = useGame();
  const d = useMemo(() => teamDepth(session, team), [session, team, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="muted">예상 기용은 시즌 중에만 볼 수 있습니다 (개막 뒤 열림).</p>;
  const name = (p: SimPlayer | null) => (p ? <PlayerLink p={p} /> : <span className="muted">-</span>);
  return (
    <div className="cards">
      <section className="card">
        <h2>주전 야수 <span className="muted small">다음 경기 기준</span></h2>
        <table className="depth-table">
          <tbody>
            {d.starters.map((x) => <tr key={x.slot}><th className="l"><Pos pos={x.slot} /></th><td className="l">{name(x.p)}</td></tr>)}
          </tbody>
        </table>
        {d.bench.length > 0 && <p className="small"><span className="muted">서브</span> {d.bench.map((p, i) => <span key={p.idx}>{i ? ', ' : ''}<PlayerLink p={p} /></span>)}</p>}
      </section>
      <section className="card">
        <h2>투수진</h2>
        <table className="depth-table">
          <tbody>
            {d.rotation.map((p, i) => <tr key={p.idx}><th className="l">선발 {i + 1}</th><td className="l"><PlayerLink p={p} /></td></tr>)}
            <tr><th className="l">마무리</th><td className="l">{name(d.closer)}</td></tr>
          </tbody>
        </table>
        {d.pen.length > 0 && <p className="small"><span className="muted">불펜</span> {d.pen.map((p, i) => <span key={p.idx}>{i ? ', ' : ''}<PlayerLink p={p} /></span>)}</p>}
      </section>
      <p className="muted small">{team === session.teamIdx ? '우리 구단은 기용 보드의 기용표(없으면 AI 감독 배치)입니다.' : 'AI 감독의 지금 배치입니다. 쉬는 날·결장·상대 선발에 따라 경기마다 바뀝니다. 타순은 경기 직전에 정합니다.'}</p>
    </div>
  );
}
