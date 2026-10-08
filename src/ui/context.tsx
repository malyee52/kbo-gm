// 게임 화면들이 함께 쓰는 상태와 작은 표시 부품.
import { createContext, useContext, type ReactNode } from 'react';
import type { BrowserStore } from '../data/loadBrowser';
import type { DisplayGrades, SimPlayer } from '../engine';
import type { GameSession } from '../game/session';
import { teamColor } from './teams';

export type Screen = 'home' | 'roster' | 'schedule' | 'standings' | 'leaders' | 'trade' | 'club' | 'postseason' | 'growth' | 'awards' | 'save' | 'season-end' | 'offseason';

export interface GameUi {
  store: BrowserStore;
  session: GameSession;
  grades: DisplayGrades;
  /** 세션이 바뀔 때마다 오른다 (세션 객체는 그대로 두고 내용만 바뀌므로 다시 그리기용) */
  version: number;
  changed(): void;
  /** 자동 저장 칸에 저장 */
  autosave(): Promise<void>;
  go(screen: Screen, arg?: number): void;
  openPlayer(idx: number): void;
}

const Ctx = createContext<GameUi | null>(null);

export function GameProvider({ value, children }: { value: GameUi; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGame(): GameUi {
  const v = useContext(Ctx);
  if (!v) throw new Error('GameProvider 밖에서 useGame을 불렀습니다');
  return v;
}

/** 구단 이름 + 색 표시 */
export function TeamName({ idx, short = false }: { idx: number; short?: boolean }) {
  const { session } = useGame();
  const t = session.world.teams[idx];
  const mine = idx === session.teamIdx;
  return (
    <span className={`team${mine ? ' mine' : ''}`}>
      <i className="chip" style={{ background: teamColor(t.franchise) }} aria-hidden />
      {short ? t.name : t.name}
    </span>
  );
}

/** 선수 이름. 누르면 선수 상세가 열린다 */
export function PlayerLink({ p, showTeam = false }: { p: SimPlayer; showTeam?: boolean }) {
  const { openPlayer, session } = useGame();
  return (
    <button type="button" className="link" onClick={() => openPlayer(p.idx)}>
      {p.name}
      {p.foreign && <span className="tag" title="외국인 선수">외</span>}
      {showTeam && <span className="muted small"> {session.world.teams[p.teamIdx].name}</span>}
    </button>
  );
}

/** 20~80 등급의 색 구분: 65 이상 매우 좋음, 55 이상 좋음, 45 이하 아쉬움, 35 이하 나쁨 */
export function gradeClass(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return v >= 65 ? 'g-hi' : v >= 55 ? 'g-up' : v <= 35 ? 'g-lo' : v <= 45 ? 'g-dn' : '';
}

export function Grade({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="muted">-</span>;
  return <span className={`grade ${gradeClass(v)}`}>{v}</span>;
}

export const HAND: Record<string, string> = { R: '우', L: '좌', S: '양' };

export const POS_KO: Record<string, string> = {
  C: '포수', '1B': '1루', '2B': '2루', '3B': '3루', SS: '유격', LF: '좌익', CF: '중견', RF: '우익', DH: '지명', IF: '내야', OF: '외야',
};

export function posName(pos: string | null): string {
  return pos ? (POS_KO[pos] ?? pos) : '-';
}
