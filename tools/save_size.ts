// 저장 크기·직렬화 시간 측정 (Q55, 2026-11-25).
// 시즌마다 개막 저장의 JSON 크기, 칸별 크기, JSON.stringify·parse 시간, 나눠 저장(splitSave) 뒤 본 칸 크기를 잰다.
// IndexedDB 쓰기 시간은 Node에 IndexedDB가 없어 여기서 재지 않는다 (브라우저 측정은 보고서에 따로).
// 쓰는 법: npx tsx tools/save_size.ts --seasons 50 --seed size-a --out reports/save-size.md [--breakdown] [--dump 2027,2036,2051,2076]
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { splitSave, joinSave } from '../src/game/saveSplit';
import { installCalCache } from './calCache';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const seasons = Number(arg('seasons', '5'));
const seed = arg('seed', 'size-a');
const out = arg('out', '');
const breakdown = process.argv.includes('--breakdown');
// 브라우저 측정(tools/save_bench.html)에 쓸 저장을 이 해 개막마다 reports/tmp/save-bench-<해>.json으로 쓴다
const dump = new Set(arg('dump', '').split(',').filter(Boolean).map(Number));
installCalCache();

const store = loadDataStore();
const teamIdx = store.season(2026)!.teams.findIndex((t) => t.name === 'KT');
const kb = (n: number) => Math.round(n / 1024);
const len = (v: unknown) => (v === undefined ? 0 : JSON.stringify(v).length);

function time<T>(f: () => T, reps = 3): [T, number] {
  let r!: T; const t0 = performance.now();
  for (let i = 0; i < reps; i++) r = f();
  return [r, (performance.now() - t0) / reps];
}

interface Row { year: number; full: number; stringify: number; parse: number; main: number; mainStringify: number; detail: number; ok: boolean; parts: Record<string, number> }
const rows: Row[] = [];

let t = Date.now();
const g = GameSession.create(store, { year: 2026, teamIdx, seed }, DEFAULT_PARAMS);
console.log(`create(2026) ${Date.now() - t}ms`);

function measure() {
  const save = g.toSave();
  const [text, ts] = time(() => JSON.stringify(save));
  const [, tp] = time(() => JSON.parse(text));
  const { main, details } = splitSave(save);
  const [mainText, tms] = time(() => JSON.stringify(main));
  const detail = details.reduce((s, d) => s + JSON.stringify(d).length, 0);
  // 다시 합치면 원래 저장과 같아야 한다
  const ok = JSON.stringify(joinSave(main, details)) === text;
  const parts: Record<string, number> = {};
  if (breakdown) {
    for (const [k, v] of Object.entries(save)) if (k !== 'league' && k !== 'finishedLeague') parts[k] = len(v);
    for (const [k, v] of Object.entries(save.league)) parts[`league.${k}`] = len(v);
    const players = save.league.players;
    parts['league.players.history'] = players.reduce((s, p) => s + len(p.history), 0);
    if (save.finishedLeague) parts['finishedLeague'] = len(save.finishedLeague);
  }
  if (dump.has(g.year)) { mkdirSync('reports/tmp', { recursive: true }); writeFileSync(`reports/tmp/save-bench-${g.year}.json`, text); }
  rows.push({ year: g.year, full: text.length, stringify: ts, parse: tp, main: mainText.length, mainStringify: tms, detail, ok, parts });
  console.log(`${g.year} 개막: 전체 ${kb(text.length)}KB (stringify ${ts.toFixed(0)}ms, parse ${tp.toFixed(0)}ms) → 본 칸 ${kb(mainText.length)}KB (stringify ${tms.toFixed(0)}ms) + 기록 칸 ${kb(detail)}KB, 합치기 ${ok ? '같음' : '다름!'}`);
  if (breakdown) {
    const top = Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 14);
    console.log('   ' + top.map(([k, v]) => `${k} ${kb(v)}`).join(' · '));
  }
}

measure();
for (let i = 0; i < seasons; i++) {
  t = Date.now();
  g.advance(100000);
  g.beginOffseason();
  for (let k = 0; k < 5 && g.phase === 'offseason' && (g.offseason!.stage as string) !== 'ready'; k++) {
    g.autoOffseason();
    if ((g.offseason!.stage as string) !== 'ready' && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
  }
  const o = g.openNextSeason();
  if (!o.ok) throw new Error(`${g.year}: ${o.message}`);
  process.stdout.write(`(${Date.now() - t}ms) `);
  measure();
}

if (out) {
  const lines = [
    `# 저장 크기 측정 (Q55)`, '',
    `\`npx tsx tools/save_size.ts --seasons ${seasons} --seed ${seed}\`, KT, 오프시즌은 \`autoOffseason\`. 크기는 JSON 글자 수(KB), 시간은 Node에서 세 번 평균.`,
    '"본 칸"은 나눠 저장 뒤 시즌마다 다시 쓰는 칸, "기록 칸"은 지난 시즌 자세한 기록(해마다 한 번 쓰고 다시 쓰지 않는 칸)의 합이다.', '',
    '| 개막 | 전체 KB | stringify ms | parse ms | 본 칸 KB | 본 칸 stringify ms | 기록 칸 합 KB | 합치기 |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.year} | ${kb(r.full)} | ${r.stringify.toFixed(0)} | ${r.parse.toFixed(0)} | ${kb(r.main)} | ${r.mainStringify.toFixed(0)} | ${kb(r.detail)} | ${r.ok ? '같음' : '다름'} |`),
  ];
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`→ ${out}`);
}
