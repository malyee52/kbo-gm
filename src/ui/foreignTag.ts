// 외국인 선수 태그: 아시아쿼터와 일반 외국인을 나눠 보여 준다.
// 아시아 여부는 리그 상태(LeaguePlayer.asia)에만 있어 여기서 한 길로 찾는다 (SimPlayer에는 foreign만 있다).
import type { SimPlayer } from '../engine';
import type { LeaguePlayer } from '../league/types';

export interface ForeignTag {
  /** 짧은 태그 (명단 표의 한 글자) */
  short: string;
  /** 긴 태그 (선수 이름 옆) */
  long: string;
  /** 툴팁 */
  title: string;
}

const ASIA: ForeignTag = { short: '아', long: '아시아쿼터', title: '아시아쿼터 선수' };
const FOREIGN: ForeignTag = { short: '외', long: '외국인', title: '외국인 선수' };

/** 외국인이 아니면 null */
export function foreignTag(p: Pick<SimPlayer, 'id' | 'foreign'>, leaguePlayer: (id: string) => LeaguePlayer | undefined): ForeignTag | null {
  if (!p.foreign) return null;
  return leaguePlayer(p.id)?.asia ? ASIA : FOREIGN;
}
