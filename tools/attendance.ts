// 관중 맞추기 (2026-10-13 사용자 선택 "관중 자료로 팬덤 맞추기"): 역사 재현으로 한 시즌을 돌려 구단별 정규시즌 평균 관중을
// 실제와 비교하고, 연고 시장 보정(finance.ts BALLPARK market)을 얼마나 바꿔야 하는지 알려 준다.
// 실제 2024 구단별 평균 관중: 뉴스서울 2024-10-02 "2024 KBO 리그 최종 관중 1,088만 7,705명" (KBO 발표 인용).
// 한화는 2024년 옛 구장(약 12,000석)이라 게임 구장(17,000석) 관중률이 맞지 않아, 새 구장 첫해 2025 전반기(평균 16,929명, 거의 매진)로 본다.
// 사용법: npx tsx tools/attendance.ts [--year 2024] [--seeds a,b]
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { BALLPARK } from '../src/league/finance';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const year = Number(arg('year') ?? 2024);
const seeds = (arg('seeds') ?? 'at1,at2').split(',');

/** 실제 평균 관중 (계보 이름) */
export const REAL_AVG_2024: Record<string, number> = {
  LG: 19_144, 삼성: 18_452, 두산: 18_335, KIA: 17_250, 롯데: 17_364, SSG: 16_109, KT: 11_887, 한화: 16_929, 히어로즈: 11_073, NC: 10_261,
};

const store = loadDataStore();
const sim = new Map<string, { att: number; games: number; wp: number }>();
for (const seed of seeds) {
  const g = GameSession.create(store, { year, teamIdx: 0, seed }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  g.advance(100000);
  for (let t = 0; t < g.world.teams.length; t++) {
    const f = g.seasonFinance(t)!;
    const fr = g.league.teams[t].franchise;
    const rec = g.season.teams[t];
    const x = sim.get(fr) ?? { att: 0, games: 0, wp: 0 };
    x.att += f.attendance;
    x.games += f.homeGames;
    x.wp += rec.w / Math.max(1, rec.w + rec.l) / seeds.length;
    sim.set(fr, x);
  }
}
let totReal = 0;
let totSim = 0;
/** 실제 승률 (한화는 관중 목표를 2025로 잡아 2025 승률) */
function realWp(fr: string): number {
  const y = fr === '한화' ? 2025 : year;
  const t = store.season(y)!.teams.find((x) => x.franchise === fr)!;
  return t.w / (t.w + t.l);
}
console.log('| 구단 | 승률 실제/시뮬 | 실제 평균 | 시뮬 평균 | 실제 관중률 | 시뮬 관중률 | 지금 market | 제안 market |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [fr, x] of sim) {
  const park = BALLPARK[fr];
  const real = REAL_AVG_2024[fr];
  if (!park || !real) continue;
  const avg = x.att / x.games;
  const rf = real / park.capacity;
  const sf = avg / park.capacity;
  // 실제 승률 차이 몫(관중률 = … + 0.8 × (승률 − 0.5))을 빼고, 연고 시장은 관중률과 팬 만족도 기본값(→ 관중률 ±8%p) 두 곳에 들어가 대략 1.4배로 효과가 난다
  const rw = realWp(fr);
  const next = park.market + (rf - sf - 0.8 * (rw - x.wp)) / 1.4;
  totReal += real * x.games / seeds.length;
  totSim += x.att / seeds.length;
  console.log(`| ${fr} | ${rw.toFixed(3)} / ${x.wp.toFixed(3)} | ${real.toLocaleString()} | ${Math.round(avg).toLocaleString()} | ${rf.toFixed(3)} | ${sf.toFixed(3)} | ${park.market} | ${next.toFixed(3)} |`);
}
console.log(`
정규시즌 관중 합: 실제(같은 경기 수) ${Math.round(totReal).toLocaleString()} / 시뮬 ${Math.round(totSim).toLocaleString()}`);
