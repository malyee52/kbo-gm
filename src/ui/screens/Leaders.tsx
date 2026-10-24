// 개인 기록 (2026-10-23 UI 2단계 U2-4, 기획안 2.3.2): 1위 보드(요약 기본, 부문마다 5위·상세 10위)와 전체 표(상세 기본).
// 전체 표는 공통 표(DataTable): 머리 눌러 정렬, 이름 거르기, 보기 묶음(기본·세이버·투구 수), 열 고르기(이 브라우저에 기억), 리그 평균 줄.
// 거르기는 팀·자리·나이·규정 이상. 규정 미만 줄은 흐리게 (표본 미만 세이버 극단값을 표시로 완화).
// 퓨처스 기록은 이 표에 없다 (2군 성적은 능력·출전 몫으로 만든 근사라 선수 상세 기록 탭에서만).
import { useMemo, useState } from 'react';
import { seasonWar } from '../../league/awards';
import type { BatLine, PitLine } from '../../engine';
import {
  avg, BAT_CATEGORIES, batQualified, era, fixed2, ipText, leaders, obp, ops, PIT_CATEGORIES, pitQualified, qualifiedOuts, qualifiedPa, rate3, slg, whip,
  type LeaderCategory,
} from '../../game/stats';
import { babip, bbPct, fip, iso, kPct, leagueBase, pct1, pitBabip, pitBbPct, pitKPct, woba, wrcPlus, type LeagueBase } from '../../game/saber';
import { PlayerLink, Pos, TeamName, useGame } from '../context';
import { leagueRank } from '../compare';
import { DataTable, VsLeague } from '../parts';
import { useShell } from '../shell';
import type { Column } from '../table';
import { batRecs, EMPTY_REC_FILTER, filterRecs, pitRecs, type BatRec, type PitRec, type RecFilter } from '../records';

const BAT_POS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P'];
const PIT_POS = ['SP', 'RP'];

export function Leaders() {
  const { session, version } = useGame();
  const { density } = useShell();
  const full = density === 'full';
  const war = useMemo(() => seasonWar(session.world, session.season), [session, version]);
  const [kind, setKind] = useState<'bat' | 'pit'>('bat');
  const [view, setView] = useState<'board' | 'table'>(full ? 'table' : 'board');
  const [mineOnly, setMineOnly] = useState(false);
  const s = session.season;
  // 이도류(투타 겸업): 타자 순위에는 타석이 있는 투수도, 투수 순위에는 던진 타자도 (2026-10-13)
  const players = session.world.players.filter((p) => (kind === 'pit' ? p.isPitcher || s.pit[p.idx].bf > 0 : !p.isPitcher || s.bat[p.idx].pa > 0) && (!mineOnly || p.teamIdx === session.teamIdx));
  const g = s.teams[session.teamIdx].g;

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="부문">
          <button type="button" role="tab" aria-selected={kind === 'bat'} className={kind === 'bat' ? 'on' : ''} onClick={() => setKind('bat')}>타자</button>
          <button type="button" role="tab" aria-selected={kind === 'pit'} className={kind === 'pit' ? 'on' : ''} onClick={() => setKind('pit')}>투수</button>
        </div>
        <div className="seg" role="tablist" aria-label="보기">
          <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>1위 보드</button>
          <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>전체 표</button>
        </div>
        <label className="inline small"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> 우리 구단만</label>
      </div>
      <p className="muted small">
        비율 기록은 규정을 채운 선수만 (규정 타석 = 팀 경기 수 × 3.1, 규정 이닝 = 팀 경기 수 × 1).
        지금 우리 구단 기준 규정 타석 {qualifiedPa(g)}, 규정 이닝 {qualifiedOuts(g) / 3}.
      </p>
      {s.log.length === 0 ? <p className="muted">아직 치른 경기가 없습니다.</p> : view === 'board' ? (
        <div className={kind === 'bat' ? 'leader-grid' : 'leader-grid six'}>
          <WarBoard war={war} players={players} n={full ? 10 : 5} />
          {kind === 'bat'
            ? BAT_CATEGORIES.map((c) => <Board<BatLine> key={c.key} cat={c} lines={s.bat} players={players} q={batQualified} n={full ? 10 : 5} />)
            : PIT_CATEGORIES.map((c) => <Board<PitLine> key={c.key} cat={c} lines={s.pit} players={players} q={pitQualified} n={full ? 10 : 5} />)}
        </div>
      ) : (
        <RecordTable kind={kind} players={players} war={war} full={full} />
      )}
    </div>
  );
}

/** WAR 순위 (근사, 시상과 같은 계산 league/awards.ts seasonWar). 규정과 상관없이 누적 */
function WarBoard({ war, players, n }: { war: Map<number, number>; players: ReturnType<typeof useGame>['session']['world']['players']; n: number }) {
  const { session } = useGame();
  const rows = players.filter((p) => war.has(p.idx)).sort((a, b) => war.get(b.idx)! - war.get(a.idx)! || a.idx - b.idx).slice(0, n);
  return (
    <div className="board war">
      <h3 title="대체 선수보다 몇 승을 더 벌었나 (근사). 타자는 공격·포지션·수비, 투수는 평균자책과 FIP를 반씩">WAR</h3>
      {rows.length === 0 ? <p className="muted small">해당 선수가 없습니다.</p> : (
        <ol>
          {rows.map((p) => (
            <li key={p.idx} className={p.teamIdx === session.teamIdx ? 'me' : ''}>
              <PlayerLink p={p} showTeam /> <strong>{war.get(p.idx)!.toFixed(1)}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Board<L extends BatLine | PitLine>({ cat, lines, players, q, n }: {
  cat: LeaderCategory<L>; lines: L[]; players: ReturnType<typeof useGame>['session']['world']['players']; q: (l: L, g: number) => boolean; n: number;
}) {
  const { session } = useGame();
  const rows = leaders(players, lines, cat, session.season.teams, q, n);
  return (
    <div className="board">
      <h3>{cat.label}</h3>
      {rows.length === 0 ? <p className="muted small">해당 선수가 없습니다.</p> : (
        <ol>
          {rows.map((r) => (
            <li key={r.player.idx} className={r.player.teamIdx === session.teamIdx ? 'me' : ''}>
              <PlayerLink p={r.player} showTeam /> <strong>{r.value}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---- 전체 표

const fin = (x: number) => (Number.isFinite(x) ? x : null);
const SABER_TIP = {
  wrc: 'wRC+: 득점 생산력. 100이 리그 평균',
  woba: 'wOBA: 안타 종류·볼넷마다 득점 가치를 매긴 출루율 꼴 지표',
  iso: 'ISO: 순장타율 (장타율 - 타율)',
  babip: 'BABIP: 인플레이 타구 타율. 크게 높거나 낮으면 운이 섞였을 수 있다',
  fip: 'FIP: 삼진·볼넷·사구·홈런만으로 계산한 평균자책',
};

type Rank = (v: number) => number | null;

/** 리그 대비 칸 (결정 1): 요약은 ▲▼, 상세는 상위 N%. 규정 미만 선수는 표시하지 않는다 */
const vsCell = (text: string, v: number, q: boolean, rank: Rank, full: boolean) => (
  <>{text}{q && Number.isFinite(v) && <> <VsLeague rank={rank(v)} full={full} /></>}</>
);

function batCols(lg: LeagueBase, rankAvg: Rank, rankOps: Rank, full: boolean): Column<BatRec>[] {
  return [
    { key: 'name', label: '선수', value: (r) => r.p.name, fixed: true, text: true, cell: (r) => <PlayerLink p={r.p} /> },
    { key: 'team', label: '팀', value: (r) => r.team, text: true, brief: true, group: '기본', cell: (r) => <TeamName idx={r.team} /> },
    { key: 'pos', label: '자리', value: (r) => r.pos, text: true, brief: true, group: '기본', cell: (r) => <Pos pos={r.pos} /> },
    { key: 'age', label: '나이', value: (r) => r.age, group: '기본', lower: true },
    { key: 'g', label: '경기', value: (r) => r.l.g, group: '기본' },
    { key: 'pa', label: '타석', value: (r) => r.l.pa, brief: true, group: '기본' },
    { key: 'avg', label: '타율', value: (r) => fin(avg(r.l)), cell: (r) => vsCell(rate3(avg(r.l)), avg(r.l), r.q, rankAvg, full), brief: true, group: '기본' },
    { key: 'obp', label: '출루율', value: (r) => fin(obp(r.l)), cell: (r) => rate3(obp(r.l)), group: '기본' },
    { key: 'slg', label: '장타율', value: (r) => fin(slg(r.l)), cell: (r) => rate3(slg(r.l)), group: '기본' },
    { key: 'ops', label: 'OPS', value: (r) => fin(ops(r.l)), cell: (r) => vsCell(rate3(ops(r.l)), ops(r.l), r.q, rankOps, full), brief: true, group: '기본' },
    { key: 'h', label: '안타', value: (r) => r.l.h, group: '기본' },
    { key: 'd', label: '2루타', value: (r) => r.l.d, group: '기본' },
    { key: 't', label: '3루타', value: (r) => r.l.t, group: '기본' },
    { key: 'hr', label: '홈런', value: (r) => r.l.hr, brief: true, group: '기본' },
    { key: 'rbi', label: '타점', value: (r) => r.l.rbi, brief: true, group: '기본' },
    { key: 'r', label: '득점', value: (r) => r.l.r, group: '기본' },
    { key: 'bb', label: '볼넷', value: (r) => r.l.bb, group: '기본' },
    { key: 'so', label: '삼진', value: (r) => r.l.so, group: '기본', lower: true },
    { key: 'sb', label: '도루', value: (r) => r.l.sb, group: '기본' },
    { key: 'wrc', label: 'wRC+', title: SABER_TIP.wrc, value: (r) => fin(Math.round(wrcPlus(r.l, lg))), group: '세이버' },
    { key: 'woba', label: 'wOBA', title: SABER_TIP.woba, value: (r) => fin(woba(r.l)), cell: (r) => rate3(woba(r.l)), group: '세이버' },
    { key: 'iso', label: 'ISO', title: SABER_TIP.iso, value: (r) => fin(iso(r.l)), cell: (r) => rate3(iso(r.l)), group: '세이버' },
    { key: 'babip', label: 'BABIP', title: SABER_TIP.babip, value: (r) => fin(babip(r.l)), cell: (r) => rate3(babip(r.l)), group: '세이버' },
    { key: 'bbp', label: 'BB%', value: (r) => fin(bbPct(r.l)), cell: (r) => pct1(bbPct(r.l)), group: '세이버' },
    { key: 'kp', label: 'K%', value: (r) => fin(kPct(r.l)), cell: (r) => pct1(kPct(r.l)), group: '세이버', lower: true },
    { key: 'war', label: 'WAR', title: '대체 선수 대비 승 (근사)', value: (r) => r.war, cell: (r) => (r.war === null ? '—' : r.war.toFixed(1)), group: '세이버' },
  ];
}

function pitCols(lg: LeagueBase, rankEra: Rank, rankWhip: Rank, full: boolean): Column<PitRec>[] {
  const npOk = (r: PitRec) => r.l.np > 0;
  return [
    { key: 'name', label: '선수', value: (r) => r.p.name, fixed: true, text: true, cell: (r) => <PlayerLink p={r.p} /> },
    { key: 'team', label: '팀', value: (r) => r.team, text: true, brief: true, group: '기본', cell: (r) => <TeamName idx={r.team} /> },
    { key: 'role', label: '자리', title: '이번 시즌 선발 등판이 절반 이상이면 SP', value: (r) => r.role, text: true, brief: true, group: '기본' },
    { key: 'age', label: '나이', value: (r) => r.age, group: '기본', lower: true },
    { key: 'g', label: '경기', value: (r) => r.l.g, brief: true, group: '기본' },
    { key: 'gs', label: '선발', value: (r) => r.l.gs, group: '기본' },
    { key: 'w', label: '승', value: (r) => r.l.w, brief: true, group: '기본' },
    { key: 'l', label: '패', value: (r) => r.l.l, group: '기본', lower: true },
    { key: 'sv', label: '세이브', value: (r) => r.l.sv, brief: true, group: '기본' },
    { key: 'hld', label: '홀드', value: (r) => r.l.hld, group: '기본' },
    { key: 'ip', label: '이닝', value: (r) => r.l.outs, cell: (r) => ipText(r.l.outs), brief: true, group: '기본' },
    { key: 'era', label: '평균자책', value: (r) => fin(era(r.l)), cell: (r) => vsCell(fixed2(era(r.l)), era(r.l), r.q, rankEra, full), brief: true, group: '기본', lower: true },
    { key: 'whip', label: 'WHIP', value: (r) => fin(whip(r.l)), cell: (r) => vsCell(fixed2(whip(r.l)), whip(r.l), r.q, rankWhip, full), group: '기본', lower: true },
    { key: 'h', label: '피안타', value: (r) => r.l.h, group: '기본', lower: true },
    { key: 'hr', label: '피홈런', value: (r) => r.l.hr, group: '기본', lower: true },
    { key: 'bb', label: '볼넷', value: (r) => r.l.bb, group: '기본', lower: true },
    { key: 'so', label: '탈삼진', value: (r) => r.l.so, brief: true, group: '기본' },
    { key: 'fip', label: 'FIP', title: SABER_TIP.fip, value: (r) => fin(fip(r.l, lg)), cell: (r) => fixed2(fip(r.l, lg)), group: '세이버', lower: true },
    { key: 'pk', label: 'K%', value: (r) => fin(pitKPct(r.l)), cell: (r) => pct1(pitKPct(r.l)), group: '세이버' },
    { key: 'pb', label: 'BB%', value: (r) => fin(pitBbPct(r.l)), cell: (r) => pct1(pitBbPct(r.l)), group: '세이버', lower: true },
    { key: 'pbabip', label: '피BABIP', value: (r) => fin(pitBabip(r.l)), cell: (r) => rate3(pitBabip(r.l)), group: '세이버', lower: true },
    { key: 'war', label: 'WAR', title: '대체 선수 대비 승 (근사)', value: (r) => r.war, cell: (r) => (r.war === null ? '—' : r.war.toFixed(1)), group: '세이버' },
    { key: 'np', label: '투구 수', value: (r) => (npOk(r) ? r.l.np : null), group: '투구 수' },
    { key: 'npg', label: '경기당', title: '경기당 투구 수 (선발·구원 등판을 함께 센다)', value: (r) => (npOk(r) ? r.l.np / r.l.g : null), cell: (r) => (npOk(r) ? (r.l.np / r.l.g).toFixed(1) : '—'), group: '투구 수', lower: true },
    { key: 'npip', label: '이닝당', title: '이닝당 투구 수 (적을수록 공을 아낀다)', value: (r) => (npOk(r) && r.l.outs ? (r.l.np * 3) / r.l.outs : null), cell: (r) => (npOk(r) && r.l.outs ? ((r.l.np * 3) / r.l.outs).toFixed(1) : '—'), group: '투구 수', lower: true },
    { key: 'npbf', label: '타자당', title: '상대 타자당 투구 수', value: (r) => (npOk(r) ? r.l.np / r.l.bf : null), cell: (r) => (npOk(r) ? (r.l.np / r.l.bf).toFixed(2) : '—'), group: '투구 수', lower: true },
  ];
}

function sum<L extends BatLine | PitLine>(lines: L[]): L {
  const t = { ...lines[0] } as Record<string, number>;
  for (const k of Object.keys(t)) t[k] = 0;
  for (const l of lines) for (const [k, v] of Object.entries(l)) t[k] += v as number;
  return t as unknown as L;
}

function RecordTable({ kind, players, war, full }: { kind: 'bat' | 'pit'; players: ReturnType<typeof useGame>['session']['world']['players']; war: Map<number, number>; full: boolean }) {
  const { session, version } = useGame();
  const s = session.season;
  const me = session.teamIdx;
  const [f, setF] = useState<RecFilter>(EMPTY_REC_FILTER);
  const set = (patch: Partial<RecFilter>) => setF((x) => ({ ...x, ...patch }));
  // 리그 기준(세이버 상수·평균 줄·리그 대비)은 거르기와 상관없이 리그 전체
  const lg = useMemo(() => {
    const qb: BatLine[] = [];
    const qp: PitLine[] = [];
    for (const p of session.world.players) {
      const t = s.teams[p.teamIdx >= 0 ? p.teamIdx : p.formerTeam ?? -1];
      if (!t) continue;
      if (batQualified(s.bat[p.idx], t.g)) qb.push(s.bat[p.idx]);
      if (pitQualified(s.pit[p.idx], t.g)) qp.push(s.pit[p.idx]);
    }
    return { base: leagueBase(s.bat, s.pit), bat: sum(s.bat), pit: sum(s.pit), qb, qp };
  }, [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rank = (sample: number[], hb: boolean): Rank => (v) => leagueRank(v, sample, hb);
  const teamSel = (
    <label className="small">팀
      <select value={String(f.team)} onChange={(e) => set({ team: e.target.value === 'all' ? 'all' : Number(e.target.value) })}>
        <option value="all">전체</option>
        {session.world.teams.map((_, i) => <option key={i} value={i}>{session.teamInfo(i).name}{i === me ? ' (우리)' : ''}</option>)}
      </select>
    </label>
  );
  const tools = (pos: string[]) => (
    <div className="form-row rec-filter">
      {teamSel}
      <label className="small">자리
        <select value={f.pos} onChange={(e) => set({ pos: e.target.value })}>
          <option value="">전체</option>
          {pos.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="small">나이 이하<input type="number" min={17} max={50} value={f.ageMax ?? ''} placeholder="전체" style={{ width: '5.5em' }}
        onChange={(e) => set({ ageMax: e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value)) ? null : Number(e.target.value) })} /></label>
      <label className="small">규정
        <select value={f.qualified ? 'q' : 'all'} onChange={(e) => set({ qualified: e.target.value === 'q' })}>
          <option value="all">전체 (미만은 흐리게)</option><option value="q">규정 이상</option>
        </select>
      </label>
    </div>
  );
  const rowClass = (r: BatRec | PitRec) => (r.team === me ? 'me' : undefined);
  if (kind === 'bat') {
    const rows = filterRecs(batRecs(players, s, war), f).sort((a, b) => b.l.pa - a.l.pa || a.p.idx - b.p.idx);
    const lb = lg.bat;
    const foot = lb.pa > 0 ? [{ label: '리그 평균', cells: { avg: rate3(avg(lb)), obp: rate3(obp(lb)), slg: rate3(slg(lb)), ops: rate3(ops(lb)), wrc: '100', woba: rate3(woba(lb)), iso: rate3(iso(lb)), babip: rate3(babip(lb)), bbp: pct1(bbPct(lb)), kp: pct1(kPct(lb)) } }] : undefined;
    return (
      <section className="panel">
        {tools(BAT_POS)}
        <DataTable id="leaders-bat" label="타자 개인 기록" cols={batCols(lg.base, rank(lg.qb.map(avg), true), rank(lg.qb.map(ops), true), full)} rows={rows}
          rowKey={(r) => String(r.p.idx)} full={full} searchText={(r) => r.p.name} thin={(r) => !r.q} thinToggle={false} rowClass={rowClass} foot={foot}
          empty="조건에 맞는 선수가 없습니다." />
        <p className="muted small">{rows.length}명 · 처음은 타석 순. 머리를 누르면 정렬합니다 (고른 열·정렬은 이 브라우저에 기억).</p>
      </section>
    );
  }
  const rows = filterRecs(pitRecs(players, s, war), f).sort((a, b) => b.l.outs - a.l.outs || a.p.idx - b.p.idx);
  const lp = lg.pit;
  const foot = lp.outs > 0 ? [{
    label: '리그 평균',
    cells: {
      era: fixed2(era(lp)), whip: fixed2(whip(lp)), fip: fixed2(era(lp)), pk: pct1(pitKPct(lp)), pb: pct1(pitBbPct(lp)), pbabip: rate3(pitBabip(lp)),
      ...(lp.np > 0 ? { npg: (lp.np / Math.max(1, lp.g)).toFixed(1), npip: ((lp.np * 3) / lp.outs).toFixed(1), npbf: (lp.np / Math.max(1, lp.bf)).toFixed(2) } : {}),
    },
  }] : undefined;
  return (
    <section className="panel">
      {tools(PIT_POS)}
      <DataTable id="leaders-pit" label="투수 개인 기록" cols={pitCols(lg.base, rank(lg.qp.map(era), false), rank(lg.qp.map(whip), false), full)} rows={rows}
        rowKey={(r) => String(r.p.idx)} full={full} searchText={(r) => r.p.name} thin={(r) => !r.q} thinToggle={false} rowClass={rowClass} foot={foot}
        empty="조건에 맞는 선수가 없습니다." />
      <p className="muted small">{rows.length}명 · 처음은 이닝 순. 머리를 누르면 정렬합니다 (고른 열·정렬은 이 브라우저에 기억).</p>
    </section>
  );
}
