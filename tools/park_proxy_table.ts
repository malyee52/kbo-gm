// 옛 해 구장 대리값 표 (구장효과 기획안 P5, 4.3): 해마다 구단별 실제 구장 값(근거·득점 계수·사건별 지수, 100 = 리그 평균)을 낸다.
// 자료(parks.json·meta.json)와 params.park만 읽고 시뮬레이션은 하지 않는다.
// 사용법:  npx tsx tools/park_proxy_table.ts [--years 1982,1985,1991,2003,2009,2010,2014,2015] [--out reports/park-proxy.md]
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, leagueRpa, mainParkId, realParkYear } from '../src/engine';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const store = loadDataStore();
const years = (arg('years') ?? '1982,1985,1986,1991,1995,2000,2003,2008,2009,2010,2013,2014,2015,2019,2022').split(',').map(Number);
const out = arg('out');
const LABEL = { measured: '실측', back: '실측 거꾸로', diff: '차이 방식', guess: '짐작', none: '중립' } as const;
const src = { parkFactors: store.meta.parkFactors, parkEvents: store.meta.parkEvents, parks: store.parks };
const ix = (x: number | undefined) => (x === undefined ? '-' : String(Math.round(x * 100)));

const lines: string[] = [];
const emit = (s: string) => { lines.push(s); console.log(s); };
emit(`params.park: 당김 w ${DEFAULT_PARAMS.park.specFit.w}, 지수 안타 ${DEFAULT_PARAMS.park.hitExp} · 홈런 ${DEFAULT_PARAMS.park.hrExp}`);
emit('');
emit('| 해 | 계보 | 구장 | 근거 | 득점 | 단타 | 2루타 | 3루타 | 홈런 | 좌타 홈런 | 우타 홈런 |');
emit('|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const y of years) {
  const s = store.season(y);
  if (!s) continue;
  const frs = s.teams.map((t) => t.franchise);
  const tab = realParkYear(src, y, frs, leagueRpa(s.league), DEFAULT_PARAMS.park);
  for (const fr of frs) {
    const v = tab.get(fr);
    const e = v?.ev;
    const f = v?.run ?? 1;
    const hit = f ** DEFAULT_PARAMS.park.hitExp;
    const hr = f ** DEFAULT_PARAMS.park.hrExp;
    emit(`| ${y} | ${fr} | ${store.parks ? mainParkId(store.parks, fr, y) ?? '-' : '-'} | ${v ? LABEL[v.basis] : LABEL.none} | ${ix(f)} | ${ix(e?.s1 ?? hit)} | ${ix(e?.d2 ?? hit)} | ${ix(e?.t3 ?? hit)} | ${ix(e?.hr ?? hr)} | ${ix(e?.L?.hr ?? e?.hr ?? hr)} | ${ix(e?.R?.hr ?? e?.hr ?? hr)} |`);
  }
}
if (out) writeFileSync(out, ['# 옛 해 구장 대리값 표', '', `\`npx tsx tools/park_proxy_table.ts --years ${years.join(',')}\``, '', ...lines, ''].join('\n'));
