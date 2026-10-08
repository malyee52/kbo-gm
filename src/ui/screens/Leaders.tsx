// 리그 기록: 타자·투수 부문별 순위.
import { useState } from 'react';
import type { BatLine, PitLine } from '../../engine';
import {
  BAT_CATEGORIES, PIT_CATEGORIES, batQualified, leaders, pitQualified, qualifiedOuts, qualifiedPa, type LeaderCategory,
} from '../../game/stats';
import { PlayerLink, useGame } from '../context';

export function Leaders() {
  const { session } = useGame();
  const [kind, setKind] = useState<'bat' | 'pit'>('bat');
  const [mineOnly, setMineOnly] = useState(false);
  const s = session.season;
  const players = session.world.players.filter((p) => (kind === 'pit') === p.isPitcher && (!mineOnly || p.teamIdx === session.teamIdx));
  const g = s.teams[session.teamIdx].g;

  return (
    <div className="stack">
      <h1>기록</h1>
      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="부문">
          <button type="button" role="tab" aria-selected={kind === 'bat'} className={kind === 'bat' ? 'on' : ''} onClick={() => setKind('bat')}>타자</button>
          <button type="button" role="tab" aria-selected={kind === 'pit'} className={kind === 'pit' ? 'on' : ''} onClick={() => setKind('pit')}>투수</button>
        </div>
        <label className="inline small"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> 우리 구단만</label>
      </div>
      <p className="muted small">
        비율 기록은 규정을 채운 선수만 (규정 타석 = 팀 경기 수 × 3.1, 규정 이닝 = 팀 경기 수 × 1).
        지금 우리 구단 기준 규정 타석 {qualifiedPa(g)}, 규정 이닝 {qualifiedOuts(g) / 3}.
      </p>
      {s.log.length === 0 ? <p className="muted">아직 치른 경기가 없습니다.</p> : (
        <div className="leader-grid">
          {kind === 'bat'
            ? BAT_CATEGORIES.map((c) => <Board<BatLine> key={c.key} cat={c} lines={s.bat} players={players} q={batQualified} />)
            : PIT_CATEGORIES.map((c) => <Board<PitLine> key={c.key} cat={c} lines={s.pit} players={players} q={pitQualified} />)}
        </div>
      )}
    </div>
  );
}

function Board<L extends BatLine | PitLine>({ cat, lines, players, q }: {
  cat: LeaderCategory<L>; lines: L[]; players: ReturnType<typeof useGame>['session']['world']['players']; q: (l: L, g: number) => boolean;
}) {
  const { session } = useGame();
  const rows = leaders(players, lines, cat, session.season.teams, q, 10);
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
