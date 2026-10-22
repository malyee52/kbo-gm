// 순위표 (2026-10-23 UI 2단계 U2-4, 기획안 2.3.1): 공통 표(DataTable). 요약 열 = 순위·팀·경기·승·패·무·승률·게임차·최근 10·연속,
// 상세 열 = + 득점·실점·득실차·홈·원정·남은 경기. 머리를 눌러 다시 늘어놓으면 가을야구 선은 숨긴다 (순위 순일 때만 뜻이 있다).
import { winPct, type TeamRecord } from '../../engine';
import { gamesBehind, rate3, recentForm } from '../../game/stats';
import { useMemo, useState } from 'react';
import { TeamLink, useGame } from '../context';
import { DataTable } from '../parts';
import { useShell } from '../shell';
import type { Column } from '../table';

export interface StandRow { team: number; rank: number; t: TeamRecord; gb: number | null; f: ReturnType<typeof recentForm>; streak: number; left: number }

const wlt = (w: number, t: number, l: number) => `${w}-${t}-${l}`;
const diffText = (n: number) => (n > 0 ? `+${n}` : String(n));

export const STAND_COLS: Column<StandRow>[] = [
  // 순위와 팀은 한 칸 (휴대폰에서 첫 열이 고정되므로 팀 이름이 늘 보이게)
  { key: 'rank', label: '순위 · 팀', value: (r) => r.rank, fixed: true, text: true, lower: true, cell: (r) => <><span className="rank-no">{r.rank}</span> <TeamLink idx={r.team} /></> },
  { key: 'g', label: '경기', value: (r) => r.t.g, brief: true, group: '기본' },
  { key: 'w', label: '승', value: (r) => r.t.w, brief: true, group: '기본' },
  { key: 'l', label: '패', value: (r) => r.t.l, brief: true, group: '기본', lower: true },
  { key: 't', label: '무', value: (r) => r.t.t, brief: true, group: '기본' },
  { key: 'pct', label: '승률', value: (r) => winPct(r.t), cell: (r) => rate3(winPct(r.t)), brief: true, group: '기본' },
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

/** 순위 줄 (순위 순). 연속은 정렬용 값: 연승 +, 연패 −, 무 0 */
export function standRows(season: { teams: TeamRecord[]; log: Parameters<typeof recentForm>[0]; schedule: { home: number; away: number }[][]; day: number; standings(): number[] }): StandRow[] {
  const order = season.standings();
  const leader = season.teams[order[0]];
  const left = new Map<number, number>();
  for (const day of season.schedule.slice(season.day)) for (const g of day) for (const t of [g.home, g.away]) left.set(t, (left.get(t) ?? 0) + 1);
  return order.map((i, k) => {
    const f = recentForm(season.log, i);
    const n = parseInt(f.streak, 10) || 0;
    return {
      team: i, rank: k + 1, t: season.teams[i], gb: k === 0 ? null : gamesBehind(leader, season.teams[i]), f,
      streak: f.streak.endsWith('연승') ? n : f.streak.endsWith('연패') ? -n : 0, left: left.get(i) ?? 0,
    };
  });
}

export function Standings() {
  const { session, version } = useGame();
  const { density } = useShell();
  const fut = useMemo(() => session.futures().teams, [session, version]);
  const s = session.season;
  const rows = useMemo(() => standRows(s), [s, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cut = session.world.rules.postseasonTeams;
  // 2026-10-12 UI 개편: 1군과 퓨처스를 한 화면에 쌓지 않고 골라 본다
  const [league, setLeague] = useState<'kbo' | 'futures'>('kbo');

  return (
    <div className="stack tight">
      <div className="row-between wrap">
        <div className="seg" role="tablist" aria-label="리그">
          <button type="button" role="tab" aria-selected={league === 'kbo'} className={league === 'kbo' ? 'on' : ''} onClick={() => setLeague('kbo')}>정규시즌</button>
          <button type="button" role="tab" aria-selected={league === 'futures'} className={league === 'futures' ? 'on' : ''} onClick={() => setLeague('futures')}>퓨처스</button>
        </div>
        <span className="muted small">{league === 'kbo' ? `승률(무승부 제외) 순 · 점선 위 상위 ${cut}팀이 가을야구 · 홈·원정·최근 10은 승-무-패` : '2군 성적은 능력과 출전 몫으로 만듭니다 (1군 경기 수의 약 80%)'}</span>
      </div>
      {league === 'kbo' && (
        <DataTable id="standings" label="정규시즌 순위" cols={STAND_COLS} rows={rows} rowKey={(r) => String(r.team)} full={density === 'full'}
          rowClass={(r, sorted) => [r.team === session.teamIdx ? 'me' : '', !sorted && r.rank === cut ? 'cutline' : ''].filter(Boolean).join(' ') || undefined} />
      )}

      {league === 'futures' && <>
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
