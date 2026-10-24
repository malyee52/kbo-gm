// 순위표 (2026-10-23 UI 2단계 U2-4, 기획안 2.3.1): 공통 표(DataTable). 요약 열 = 순위·팀·경기·승·패·무·승률·게임차·최근 10·연속,
// 상세 열 = + 득점·실점·득실차·홈·원정·남은 경기. 머리를 눌러 다시 늘어놓으면 가을야구 선은 숨긴다 (순위 순일 때만 뜻이 있다).
// 양대 리그 해(1999·2000)는 드림·매직·통합 탭 (일정 개편 기획안 10.4).
import type { TeamRecord } from '../../engine';
import { seasonPostseasonPlaces } from '../../game/rank';
import { gamesBehind, rate3, recentForm } from '../../game/stats';
import { useMemo, useState } from 'react';
import { TeamLink, useGame } from '../context';
import { DataTable } from '../parts';
import { useShell } from '../shell';
import type { Column } from '../table';

export interface StandRow {
  team: number; rank: number; t: TeamRecord; pct: number; gb: number | null; f: ReturnType<typeof recentForm>; streak: number; left: number;
  /** 양대 리그 해: 소속 리그 이름 */
  league?: string;
  /** 지금 순위로 준플레이오프 조건이 걸린 구단 (양대 리그 해) */
  semi?: boolean;
}

const wlt = (w: number, t: number, l: number) => `${w}-${t}-${l}`;
const diffText = (n: number) => (n > 0 ? `+${n}` : String(n));

export const STAND_COLS: Column<StandRow>[] = [
  // 순위와 팀은 한 칸 (휴대폰에서 첫 열이 고정되므로 팀 이름이 늘 보이게)
  { key: 'rank', label: '순위 · 팀', value: (r) => r.rank, fixed: true, text: true, lower: true, cell: (r) => <><span className="rank-no">{r.rank}</span> <TeamLink idx={r.team} />{r.semi && <span className="tag" title="한 리그 3위 승률이 다른 리그 2위보다 높아 준플레이오프">준PO</span>}</> },
  { key: 'g', label: '경기', value: (r) => r.t.g, brief: true, group: '기본' },
  { key: 'w', label: '승', value: (r) => r.t.w, brief: true, group: '기본' },
  { key: 'l', label: '패', value: (r) => r.t.l, brief: true, group: '기본', lower: true },
  { key: 't', label: '무', value: (r) => r.t.t, brief: true, group: '기본' },
  { key: 'pct', label: '승률', value: (r) => r.pct, cell: (r) => rate3(r.pct), brief: true, group: '기본' },
  { key: 'gb', label: '게임차', value: (r) => r.gb, cell: (r) => (r.gb === null ? '-' : r.gb.toFixed(1)), brief: true, group: '기본', lower: true },
  { key: 'last', label: '최근 10', title: '최근 10경기 승-무-패', value: (r) => r.f.w + r.f.t / 2, cell: (r) => wlt(r.f.w, r.f.t, r.f.l), brief: true, group: '기본' },
  { key: 'streak', label: '연속', value: (r) => r.streak, cell: (r) => r.f.streak || '-', brief: true, group: '기본' },
  { key: 'rs', label: '득점', value: (r) => r.t.rs, group: '득실' },
  { key: 'ra', label: '실점', value: (r) => r.t.ra, group: '득실', lower: true },
  { key: 'diff', label: '득실차', value: (r) => r.t.rs - r.t.ra, cell: (r) => diffText(r.t.rs - r.t.ra), group: '득실' },
  { key: 'home', label: '홈', title: '홈 승-무-패', value: (r) => (r.t.homeW + r.t.homeL ? r.t.homeW / (r.t.homeW + r.t.homeL) : null), cell: (r) => wlt(r.t.homeW, r.t.homeT, r.t.homeL), group: '득실' },
  {
    key: 'away', label: '원정', title: '원정 승-무-패',
    value: (r) => { const w = r.t.w - r.t.homeW; const l = r.t.l - r.t.homeL; return w + l ? w / (w + l) : null; },
    cell: (r) => wlt(r.t.w - r.t.homeW, r.t.t - r.t.homeT, r.t.l - r.t.homeL), group: '득실',
  },
  { key: 'left', label: '남은 경기', value: (r) => r.left, group: '득실' },
];

/** 양대 리그 해 통합 표의 리그 열 */
const LEAGUE_COL: Column<StandRow> = { key: 'lg', label: '리그', value: (r) => r.league ?? null, text: true, brief: true, group: '기본' };

/** 순위 줄 (순위 순, order를 주면 그 순서: 양대 리그 해의 리그 표). 승률은 그 해 무승부 처리(Season.winPct). 연속은 정렬용 값: 연승 +, 연패 −, 무 0 */
export function standRows(season: { teams: TeamRecord[]; log: Parameters<typeof recentForm>[0]; schedule: { home: number; away: number }[][]; day: number; standings(): number[]; winPct(t: TeamRecord): number }, order = season.standings()): StandRow[] {
  const leader = season.teams[order[0]];
  const left = new Map<number, number>();
  for (const day of season.schedule.slice(season.day)) for (const g of day) for (const t of [g.home, g.away]) left.set(t, (left.get(t) ?? 0) + 1);
  return order.map((i, k) => {
    const f = recentForm(season.log, i);
    const n = parseInt(f.streak, 10) || 0;
    return {
      team: i, rank: k + 1, t: season.teams[i], pct: season.winPct(season.teams[i]), gb: k === 0 ? null : gamesBehind(leader, season.teams[i]), f,
      streak: f.streak.endsWith('연승') ? n : f.streak.endsWith('연패') ? -n : 0, left: left.get(i) ?? 0,
    };
  });
}

export function Standings() {
  const { session, version } = useGame();
  const { density } = useShell();
  const fut = useMemo(() => session.futures().teams, [session, version]);
  const s = session.season;
  const divs = s.divisionStandings();
  const cut = session.world.rules.postseasonTeams;
  const me = session.teamIdx;
  // 지금 순위로 가을야구에 나가는 구단. 양대 리그 해에 리그 3위가 들어 있으면 그 팀과 다른 리그 2위가 준플레이오프
  const semi = new Set<number>();
  if (divs) {
    const ps = seasonPostseasonPlaces(s, cut);
    for (const [a, b] of [[0, 1], [1, 0]] as const) {
      if (ps.includes(divs[a].teams[2])) { semi.add(divs[a].teams[2]); semi.add(divs[b].teams[1]); }
    }
  }
  const leagueOf = new Map<number, string>();
  divs?.forEach((d) => d.teams.forEach((t) => leagueOf.set(t, d.name)));
  // 2026-10-12 UI 개편: 1군과 퓨처스를 한 화면에 쌓지 않고 골라 본다. 양대 리그 해의 첫 탭은 우리 구단의 리그 (임시 규칙)
  const myLeague = divs?.findIndex((d) => d.teams.includes(me)) ?? -1;
  const [tab, setTab] = useState<string>(myLeague >= 0 ? `div${myLeague}` : 'kbo');
  const view = tab === 'futures' ? 'futures' : divs && tab.startsWith('div') ? Number(tab.slice(3)) : 'kbo';
  const tabs: [string, string][] = [
    ...(divs ? divs.map((d, k) => [`div${k}`, `${d.name}리그`] as [string, string]) : []),
    ['kbo', divs ? '통합' : '정규시즌'], ['futures', '퓨처스'],
  ];
  const rows = useMemo(() => {
    const base = typeof view === 'number' ? standRows(s, divs![view].teams) : standRows(s);
    return base.map((r) => ({
      ...r,
      ...(leagueOf.has(r.team) ? { league: leagueOf.get(r.team) } : {}),
      ...(semi.has(r.team) && (typeof view === 'number' ? r.rank === 3 : true) ? { semi: true } : {}),
    }));
  }, [s, version, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = divs && view === 'kbo' ? [STAND_COLS[0], LEAGUE_COL, ...STAND_COLS.slice(1)] : STAND_COLS;
  // 가을야구 선: 단일 리그는 상위 cut팀 아래, 리그 탭은 2위 아래 (준플레이오프 조건을 채운 3위는 표시만), 양대 리그 통합 표는 없음
  const line = divs ? (typeof view === 'number' ? 2 : 0) : cut;

  return (
    <div className="stack tight">
      <div className="row-between wrap">
        <div className="seg" role="tablist" aria-label="리그">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <span className="muted small">{view === 'futures' ? '2군 성적은 능력과 출전 몫으로 만듭니다 (1군 경기 수의 약 80%)'
          : divs ? `승률 순 · ${typeof view === 'number' ? '점선 위 리그 1·2위가 가을야구, 게임차는 리그 1위 기준' : '게임차는 통합 1위 기준'} · 홈·원정·최근 10은 승-무-패`
          : `승률 순 · 점선 위 상위 ${cut}팀이 가을야구 · 홈·원정·최근 10은 승-무-패`}</span>
      </div>
      {divs && view !== 'futures' && <p className="muted small">
        {session.world.year}년은 {divs.map((d) => d.name).join('·')} 양대 리그입니다. 각 리그 1·2위가 가을야구에 나가고, 한 리그 3위의 승률이 다른 리그 2위보다 높으면 둘이 준플레이오프를 치릅니다.
        {semi.size > 0 && ` 지금 순위로는 준플레이오프 조건이 걸립니다: ${[...semi].map((t) => session.world.teams[t].name).join(' 대 ')}.`}
      </p>}
      {view !== 'futures' && (
        <DataTable id="standings" label="정규시즌 순위" cols={cols} rows={rows} rowKey={(r) => String(r.team)} full={density === 'full'}
          rowClass={(r, sorted) => [r.team === me ? 'me' : '', !sorted && r.rank === line ? 'cutline' : ''].filter(Boolean).join(' ') || undefined} />
      )}

      {view === 'futures' && <>
      <details className="help small">
        <summary>퓨처스리그는?</summary>
        2군 경기는 한 타석씩 돌리지 않고, 2군에 있는 선수의 능력과 출전 몫으로 성적을 만듭니다. 득점·실점에서 승률을 정합니다. 1군 진입 전 창단 구단도 여기서 뜁니다. 퓨처스 출전량과 활약은 시즌 뒤 성장 판정에 들어갑니다.
      </details>
      <div className="scroll">
        <table>
          <thead><tr><th>순위</th><th className="l">팀</th><th>경기</th><th>승</th><th>패</th><th>승률</th><th>득점</th><th>실점</th></tr></thead>
          <tbody>
            {fut.map((t, k) => (
              <tr key={t.team} className={t.team === session.teamIdx ? 'me' : ''}>
                <td>{k + 1}</td><td className="l"><TeamLink idx={t.team} /></td><td>{t.g}</td><td>{t.w}</td><td>{t.l}</td>
                <td>{t.g ? rate3(t.w / t.g) : '-'}</td><td>{t.rs}</td><td>{t.ra}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}
