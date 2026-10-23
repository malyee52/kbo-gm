// 축하 연출의 계기 (2026-10-12 사용자 요청 "애니메이션": 우승·기록 축하 연출).
// 지금 게임 상태에서 이룬 일을 모은다. 화면은 처음 본 것만 축하한다 (GameShell이 이미 본 key를 기억한다).
import { seasonPlace } from './rank';
import type { GameSession } from './session';

export interface Achievement {
  key: string;
  title: string;
  sub: string;
  /** 꽃가루와 큰 배너 (아니면 작은 알림) */
  big: boolean;
}

export function achievements(s: GameSession): Achievement[] {
  const out: Achievement[] = [];
  const me = s.teamIdx;
  const year = s.world.year;
  const name = s.team.name;
  // 양대 리그 해(1999·2000)는 리그 1위 ("드림리그 1위!"), 진출 자리는 대진의 자리 이름 ("드림 2위로 진출")
  if (s.phase === 'season' && s.season.done) {
    const p = seasonPlace(s.season, me);
    if (p.rank === 1) out.push({ key: `${year}-first`, title: p.league ? `${p.league}리그 1위!` : '정규시즌 1위!', sub: `${year} ${name}`, big: true });
  }
  const ps = s.postseason;
  if (ps?.seeds.includes(me)) out.push({ key: `${year}-ps`, title: '가을야구 진출!', sub: `${year} ${name} · ${ps.seedLabels?.[ps.seeds.indexOf(me)] ?? `${ps.seeds.indexOf(me) + 1}위`}로 진출`, big: true });
  if (ps) {
    const last = ps.series[ps.series.length - 1];
    const final = ps.series.length === ps.rounds.length ? last : undefined;
    if (final && (final.high === me || final.low === me)) out.push({ key: `${year}-ks`, title: '한국시리즈 진출!', sub: `${year} ${name}`, big: true });
    if (ps.done && final?.winner === me) out.push({ key: `${year}-champ`, title: '한국시리즈 우승!', sub: `${year} ${name} 정상에 올랐습니다`, big: true });
  }
  const ch = s.league.challenge;
  if (ch?.result === 'success') out.push({ key: `ch-${ch.id}`, title: ch.complete ? '도전 완전 클리어!' : '도전 성공!', sub: `${ch.from}~${ch.doneYear}`, big: true });
  const fr = s.team.franchise;
  for (const a of s.league.articles ?? []) {
    if (a.franchise !== fr || (a.kind !== 'record' && a.kind !== 'milestone')) continue;
    out.push({ key: `art-${a.year}-${a.day}-${a.title}`, title: a.kind === 'record' ? '신기록' : '통산 기록', sub: a.title, big: false });
  }
  return out;
}
