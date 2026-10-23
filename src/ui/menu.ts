// 메뉴 구조 (2026-10-22 UI 대개편 1차, 짚쨩 안1 "결정 브리핑"): 대분류 6개 + 공통 도구.
// 대분류 → 하위 화면(item) → 화면 안 작은 탭(tabs). 메뉴 자리는 시즌이 바뀌어도 그대로 두고,
// 지금 쓸 수 없는 화면은 숨기지 않고 흐리게 + 사유와 열리는 때를 보여 준다 (block).
// 기존 화면 → 새 메뉴 대응은 docs/ui-menu.md.
import type { GameSession } from '../game/session';
import type { Screen } from './context';

export type Group = '브리핑' | '전력' | '영입' | '시즌' | '경영' | '아카이브';
export const GROUPS: Group[] = ['브리핑', '전력', '영입', '시즌', '경영', '아카이브'];
/** 휴대폰 아래 탭에 바로 나오는 대분류. 나머지는 '전체'에 */
export const MOBILE_GROUPS: Group[] = ['브리핑', '전력', '영입'];

export interface MenuTab {
  screen: Screen;
  label: string;
  /** 오프시즌에 바뀌는 이름 (지난 시즌 기록 등) */
  offLabel?: string;
}

export interface MenuItem {
  key: string;
  group: Group | '공통';
  label: string;
  offLabel?: string;
  /** 화면 안 작은 탭. 하나뿐이면 탭 줄을 그리지 않는다 */
  tabs: MenuTab[];
}

const one = (key: string, group: MenuItem['group'], label: string, screen: Screen, offLabel?: string): MenuItem =>
  ({ key, group, label, offLabel, tabs: [{ screen, label, offLabel }] });

export const MENU: MenuItem[] = [
  one('home', '브리핑', '홈', 'home'),
  one('inbox', '브리핑', '결정함', 'inbox'),
  { key: 'news', group: '브리핑', label: '소식', tabs: [{ screen: 'news', label: '구단 소식' }, { screen: 'articles', label: '기사' }] },
  one('fantasy', '브리핑', '대화', 'fantasy'),

  // 전력에 들어가면 기용 보드가 먼저 (2026-10-23 사용자 결정), 1·2군 명단은 그다음
  one('lineup', '전력', '기용 보드', 'lineup'),
  one('roster', '전력', '선수 명단', 'roster'),
  one('growth', '전력', '성장', 'growth'),
  one('enlist', '전력', '입대', 'enlist'),

  one('search', '영입', '선수 검색', 'search'),
  one('market', '영입', '시장', 'market'),
  one('trade', '영입', '트레이드', 'trade'),
  one('offseason', '영입', '계약·지명', 'offseason'),
  one('watch', '영입', '관심 명단', 'watch'),

  one('schedule', '시즌', '일정·결과', 'schedule', '지난 시즌 일정'),
  one('standings', '시즌', '순위', 'standings', '지난 시즌 순위'),
  one('teams', '시즌', '구단들', 'team'),
  one('leaders', '시즌', '개인 기록', 'leaders', '지난 시즌 기록'),
  one('allstar', '시즌', '올스타', 'allstar'),
  one('postseason', '시즌', '가을야구', 'postseason'),
  { key: 'season-end', group: '시즌', label: '결산·시상', tabs: [{ screen: 'season-end', label: '결산' }, { screen: 'awards', label: '시상' }] },

  one('club', '경영', '구단 현황', 'club'),
  one('finance', '경영', '재정', 'finance'),
  one('stadium', '경영', '구장·팬', 'stadium'),
  one('staff', '경영', '감독·코치', 'staff'),
  one('owner', '경영', '구단주', 'owner'),

  { key: 'records', group: '아카이브', label: '연표', tabs: [{ screen: 'records', label: '리그 연표' }, { screen: 'rules', label: '규칙 연표' }] },
  { key: 'rec-stats', group: '아카이브', label: '통산·시즌', tabs: [{ screen: 'rec-career', label: '통산' }, { screen: 'rec-season', label: '단일 시즌' }] },
  one('rec-teams', '아카이브', '구단 역사', 'rec-teams'),
  one('rec-dynasty', '아카이브', '왕조·라이벌', 'rec-dynasty'),
  one('rec-hof', '아카이브', '명예의 전당', 'rec-hof'),
  one('club-history', '아카이브', '이력·업적', 'club-history'),

  one('find', '공통', '전체 검색', 'find'),
  one('save', '공통', '저장·설정', 'save'),
  one('about', '공통', '정보·출처', 'about'),
];

/** 그 화면이 들어 있는 메뉴 칸 */
export function itemOf(screen: Screen): MenuItem | undefined {
  return MENU.find((m) => m.tabs.some((t) => t.screen === screen));
}

export function itemsOf(group: MenuItem['group']): MenuItem[] {
  return MENU.filter((m) => m.group === group);
}

/** 기본 모드에서 아예 안 보이는 칸 (판타지 모드 전용 '대화') */
export function hidden(s: GameSession, item: MenuItem): boolean {
  return item.key === 'fantasy' && !s.fantasy;
}

/**
 * 지금 그 화면을 열 수 없으면 사유와 열리는 때 (짧은 한 줄). 열 수 있으면 null.
 * 규칙은 예전 GameShell의 메뉴 표시 조건(season·off·shown)을 그대로 옮겼다.
 */
export function blockOf(s: GameSession, screen: Screen): string | null {
  const off = s.phase === 'offseason';
  switch (screen) {
    case 'roster':
    case 'lineup':
      return off ? '오프시즌에는 쉼 · 다음 시즌 개막 뒤 열림 (계약은 영입 > 계약·지명)' : null;
    case 'search':
    case 'market':
    case 'trade':
      return off ? '오프시즌에는 쉼 · 다음 시즌 개막 뒤 열림 (계약은 영입 > 계약·지명)' : null;
    case 'growth':
      return s.offseason?.growth ? null : '시즌 결산 뒤 열림';
    case 'enlist':
      return off || s.done ? null : '정규시즌이 끝난 뒤 열림';
    case 'offseason':
      return off ? null : '시즌 결산 뒤 열림 (오프시즌)';
    case 'postseason':
      return (s.done || off) && (s.postseason || s.league.lastSeason?.postseason) ? null : '정규시즌이 끝난 뒤 열림';
    case 'season-end':
      return s.done ? null : '정규시즌이 끝난 뒤 열림';
    case 'awards':
      return s.league.awards?.length ? null : '시즌 결산 뒤 열림';
    case 'fantasy':
      return s.fantasy ? null : '판타지 모드 게임에서만';
    default:
      return null;
  }
}

/** 칸을 눌렀을 때 열 화면: 열 수 있는 첫 탭, 없으면 첫 탭 (막힌 사유를 보여 준다) */
export function entryOf(s: GameSession, item: MenuItem): Screen {
  return (item.tabs.find((t) => !blockOf(s, t.screen)) ?? item.tabs[0]).screen;
}

/** 칸 전체가 막혔나 (모든 탭이 막힘) */
export function itemBlock(s: GameSession, item: MenuItem): string | null {
  const blocks = item.tabs.map((t) => blockOf(s, t.screen));
  return blocks.every((b) => b) ? blocks[0] : null;
}

export function tabLabel(s: GameSession, t: MenuTab | MenuItem): string {
  return s.phase === 'offseason' && t.offLabel ? t.offLabel : t.label;
}
