// 게임 화면들이 함께 쓰는 상태와 작은 표시 부품.
import { lineTeam } from '../engine';
import { createContext, useContext, type ReactNode } from 'react';
import type { BrowserStore } from '../data/loadBrowser';
import type { DisplayGrades, SimPlayer } from '../engine';
import type { GameSession } from '../game/session';
import { darkBand, teamPalette } from './teams';
import { priceIndex, wonText } from '../league/salary';
import { foreignTag } from './foreignTag';

export type Screen = 'home' | 'fantasy' | 'roster' | 'schedule' | 'standings' | 'leaders' | 'trade' | 'market' | 'club' | 'postseason' | 'growth' | 'awards' | 'records' | 'articles' | 'save' | 'season-end' | 'offseason'
  | 'finance' | 'stadium' | 'staff' | 'club-history'
  | 'rec-career' | 'rec-season' | 'rec-teams' | 'rec-dynasty' | 'rec-hof' | 'about' | 'search' | 'allstar'
  // 2026-10-22 UI 대개편 1차 (menu.ts): 결정함, 구단 소식, 기용 보드, 입대, 구단주
  | 'inbox' | 'news' | 'lineup' | 'enlist' | 'owner'
  // 2026-10-23 UI 2단계 공통 기능: 다른 구단 보기(arg = 구단 색인), 관심 명단, 전체 검색
  | 'team' | 'watch' | 'find'
  // 규칙 알림: 규칙 연표
  | 'rules';

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
  /** 직접 지휘 시작 (오늘 또는 다음 우리 경기). 시즌 중에만 */
  command(): void;
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

/** 화면이 연봉을 보여 줄 때 쓰는 물가 연도: 시즌 중이면 그 해, 오프시즌이면 다음 시즌 */
export function usePriceYear(): number {
  const { session } = useGame();
  return session.phase === 'offseason' ? session.year + 1 : session.year;
}

/** 그 해 물가 계수 (연봉 입력을 내부 단위로 바꿀 때 나눈다) */
export function usePriceIndex(): number {
  return priceIndex(usePriceYear());
}

/** 연봉 표기 (그 해 물가로). 내부 값은 2026년 물가 */
export function useWon(): (man: number) => string {
  const year = usePriceYear();
  return (man) => wonText(man, year);
}

/** 구단 색 표시 변수: 밝은 모드는 주색(--c), 다크 모드는 밝힌 구단색(--cd), 다크 모드 띠(--cbd, teams.ts darkBand) */
export function chipVars(franchise: string, name?: string): Record<string, string> {
  const p = teamPalette(franchise, name);
  return { '--c': p.primary, '--cd': p.dark, '--cbd': darkBand(p) };
}

/** 구단 이름 + 색 표시 */
export function TeamName({ idx, short = false }: { idx: number; short?: boolean }) {
  const { session } = useGame();
  if (idx < 0) return <span className="team muted">자유계약</span>; // 시즌 중 방출·시장 선수 (market.ts)
  const t = session.teamInfo(idx);
  const mine = idx === session.teamIdx;
  return (
    <span className={`team${mine ? ' mine' : ''}`}>
      <i className="chip" style={chipVars(t.franchise, t.name)} aria-hidden />
      {short ? t.name : t.name}
    </span>
  );
}

/** 구단 이름 + 색 표시. 누르면 그 구단 창(시즌 > 구단들)이 열린다 (UI 2단계 다른 구단 보기, 기획안 4장 1) */
export function TeamLink({ idx }: { idx: number }) {
  const { go } = useGame();
  if (idx < 0) return <TeamName idx={idx} />;
  return (
    <button type="button" className="link team-link" onClick={(e) => { e.stopPropagation(); go('team', idx); }} title="구단 보기">
      <TeamName idx={idx} />
    </button>
  );
}

/** 외국인 태그: 아시아쿼터는 "아"·"아시아쿼터", 일반 외국인은 "외"·"외국인" (foreignTag.ts). 국내 선수는 아무것도 없다 */
export function ForeignMark({ p, long = false }: { p: SimPlayer; long?: boolean }) {
  const { session } = useGame();
  const t = foreignTag(p, (id) => session.leaguePlayer(id));
  return t && <span className="tag" title={t.title}>{long ? t.long : t.short}</span>;
}

/** 선수 이름. 누르면 선수 상세가 열린다 */
export function PlayerLink({ p, showTeam = false }: { p: SimPlayer; showTeam?: boolean }) {
  const { openPlayer, session } = useGame();
  return (
    <button type="button" className="link" onClick={() => openPlayer(p.idx)}>
      {p.name}
      <ForeignMark p={p} />
      {showTeam && <span className="muted small"> {lineTeam(p) >= 0 ? session.teamInfo(lineTeam(p)).name : '자유계약'}{p.teamIdx < 0 && p.formerTeam !== undefined ? ' (방출)' : ''}</span>}
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

/** 수비 포지션 한글 이름. 화면에는 툴팁(title)으로만 쓴다 */
export const POS_KO: Record<string, string> = {
  C: '포수', '1B': '1루수', '2B': '2루수', '3B': '3루수', SS: '유격수', LF: '좌익수', CF: '중견수', RF: '우익수', DH: '지명타자', IF: '내야수', OF: '외야수',
};

/** 화면의 수비 포지션 표기: 영문 약자 C·1B·2B·3B·SS·LF·CF·RF·DH, 세부를 모르면 IF·OF (2026-10-22 사용자 결정). 투수 보직은 따로 한글로 쓴다 */
export function posName(pos: string | null | undefined): string {
  return pos || '-';
}

/** 포지션 약자 + 한글 이름 툴팁 */
export function Pos({ pos }: { pos: string | null | undefined }) {
  return <span title={pos ? POS_KO[pos] : undefined}>{posName(pos)}</span>;
}
