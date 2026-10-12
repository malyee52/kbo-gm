// 판타지 모드의 가상 인물 (3단계 자유 대화). 게임 시드로 정해지므로 저장하지 않아도 늘 같은 사람이다.
// 실존 인물이 아니다: 이름은 가상 이름 생성기로 만들고, 실존 선수 이름과 겹치면 다시 뽑는다.
import { Rng } from '../engine';
import { koreanName } from '../league/names';
import type { LeagueState } from '../league/types';

export interface CastMember {
  key: string;
  role: string;
  name: string;
  /** 성격·말투 (지시문에 들어간다) */
  persona: string;
}

const ROLES: { key: string; role: string; persona: string }[] = [
  { key: 'aide', role: '단장 보좌', persona: '꼼꼼하고 현실적인 30대 실무자. 숫자와 일정을 챙기고, 단장에게 직언한다. 존댓말.' },
  { key: 'scout', role: '수석 스카우트', persona: '20년 넘게 전국을 돈 50대 베테랑. 유망주 이야기에 눈이 반짝이고, 감과 경험을 믿는다. 구수한 말투의 존댓말.' },
  { key: 'reporter', role: '담당 기자', persona: '구단을 맡은 스포츠지 기자. 친근하지만 기삿거리에 예민하고, 질문이 날카롭다. 존댓말.' },
  { key: 'agent', role: '선수 에이전트', persona: '여러 선수를 맡은 에이전트. 계약과 돈 이야기에 밝고, 협상에서는 능청스럽다. 존댓말.' },
  { key: 'owner', role: '구단주 비서실장', persona: '모기업 회장의 뜻을 전하는 사람. 정중하지만 성적과 돈에 대한 압박을 돌려 말한다. 존댓말.' },
];

const cache = new WeakMap<object, CastMember[]>();

export function castOf(league: Pick<LeagueState, 'seed' | 'players'>): CastMember[] {
  const hit = cache.get(league);
  if (hit) return hit;
  const rng = new Rng(`${league.seed}/fantasy-cast`);
  const taken = new Set(league.players.map((p) => p.name));
  const out = ROLES.map((r) => {
    const name = koreanName(rng, taken);
    taken.add(name);
    return { ...r, name };
  });
  cache.set(league, out);
  return out;
}
