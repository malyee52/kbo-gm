// 시즌 포지션 값이 흔들리는 선수-시즌과 그 값이 게임 수비 능력에 주는 영향 (2026-10-22 사용자 "해당 시즌 포지션 능력치를 수정해야겠다, 그런 것들도 따로 조사해 놔").
// 고치지 않고 조사만 한다. 세 분류:
//  ① 2009: 자료집 세부 포지션(지금 쓰는 값)이 하드힛 2008·2010 값과 다른 선수. 대안 = 2008(없으면 2010) 하드힛 값
//  ② 바꿈: 2003~2026에서 자료집 세부 포지션을 하드힛 값으로 바꾼 시즌. 대안 = 옛 자료집 값 (git 커밋 BEFORE의 시즌 JSON)
//  ③ 한 해만: 그 해 포지션이 앞뒤 해와 다르고 앞뒤 해는 서로 같은 시즌. 대안 = 앞뒤 해 값
// 영향: 그 시즌 바로 다음 해(평가 연도) 시작 월드에서, 그 한 시즌 값만 대안으로 바꿔 만든 수비 등급(20~80, 8자리)과 지금 값을 견준다.
// 평가 연도에 1군 기록이 없는 선수(은퇴 등)는 "평가 못 함"으로 센다.
// 사용법:  npx tsx tools/position_season_check.ts [--before 38442a9] [--md reports/position-season-check.md] [--csv 경로]
//          python tools/position_season_xlsx.py <csv> reports/position-season-check.xlsx
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import type { RawSeason, SeasonData } from '../src/data/types';
import { DEFAULT_PARAMS, FIELD_POS, defenseGrade, worldForYear, type World } from '../src/engine';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const BEFORE = arg('before') ?? '38442a9';
const mdOut = arg('md');
const csvOut = arg('csv');
const store = loadDataStore();
const params = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const LAST = store.meta.years.at(-1)!;
const SPECIFIC = new Set<string>([...FIELD_POS, 'DH']);

type Cat = '① 2009' | '② 바꿈' | '③ 한 해만';
interface Rec { cat: Cat; id: string; year: number; team: string; pa: number; cur: string; alt: string; note: string }
const recs: Rec[] = [];

// 선수-시즌 포지션 (한 해 여러 구단이면 첫 행, 타석은 합)
const posOf = new Map<number, Map<string, { pos: string | null; src: string | null; team: string; pa: number }>>();
for (const y of store.meta.years) {
  const m = new Map<string, { pos: string | null; src: string | null; team: string; pa: number }>();
  for (const r of store.season(y)!.bat) {
    const x = m.get(r.id);
    if (x) x.pa += r.pa;
    else m.set(r.id, { pos: r.pos, src: r.posSrc ?? null, team: r.team, pa: r.pa });
  }
  posOf.set(y, m);
}
const isPitcher = (id: string) => store.players.get(id)?.kind === 'P';

// ① 2009
for (const [id, x] of posOf.get(2009) ?? []) {
  if (isPitcher(id) || !x.pos || !SPECIFIC.has(x.pos)) continue;
  const n = [2008, 2010].map((y) => posOf.get(y)?.get(id)).map((r) => (r?.src === 'H' ? r.pos : null));
  if (n.every((q) => q === null) || n.every((q) => q === null || q === x.pos)) continue;
  const alt = (n[0] ?? n[1])!;
  recs.push({ cat: '① 2009', id, year: 2009, team: x.team, pa: x.pa, cur: x.pos, alt, note: `2008 ${n[0] ?? '-'} / 2010 ${n[1] ?? '-'}` });
}

// ② 자료집 → 하드힛으로 바꾼 시즌
for (const y of store.meta.years.filter((q) => q >= 2003 && q !== 2009)) {
  const raw = JSON.parse(execSync(`git show ${BEFORE}:public/data/seasons/${y}.json`, { maxBuffer: 64 << 20 }).toString('utf8')) as RawSeason;
  const pi = raw.batFields.indexOf('pos');
  const seen = new Set<string>();
  for (const row of raw.bat) {
    const id = String(row[0]);
    if (seen.has(id)) continue;
    seen.add(id);
    const old = row[pi] as string | null;
    const now = posOf.get(y)!.get(id);
    if (!now || now.src !== 'H' || !old || !SPECIFIC.has(old) || old === now.pos) continue;
    recs.push({ cat: '② 바꿈', id, year: y, team: now.team, pa: now.pa, cur: now.pos!, alt: old, note: `자료집 ${old} → 하드힛 ${now.pos}` });
  }
}

// ③ 한 해만 다른 시즌 (앞뒤 해가 같고 그 해만 다름. 그 해는 하드힛 확인값만)
for (const y of store.meta.years.filter((q) => q >= 2003 && q < LAST)) {
  for (const [id, x] of posOf.get(y)!) {
    if (isPitcher(id) || x.src !== 'H' || !x.pos) continue;
    const a = posOf.get(y - 1)?.get(id)?.pos;
    const b = posOf.get(y + 1)?.get(id)?.pos;
    if (!a || !b || a !== b || a === x.pos || !SPECIFIC.has(a)) continue;
    recs.push({ cat: '③ 한 해만', id, year: y, team: x.team, pa: x.pa, cur: x.pos, alt: a, note: `${y - 1} ${a} · ${y} ${x.pos} · ${y + 1} ${b}` });
  }
}

// 영향 계산: (분류, 평가 연도)마다 지금 월드와 대안 월드
const baseWorld = new Map<number, World>();
const world = (y: number) => {
  let w = baseWorld.get(y);
  if (!w) baseWorld.set(y, (w = worldForYear(store, y, params)));
  return w;
};
const grades = (w: World, id: string) => {
  const p = w.players.find((q) => q.id === id && !q.isPitcher && q.bat?.def);
  return p ? { pos: p.pos ?? '-', g: FIELD_POS.map((q) => defenseGrade(p.bat!.def![q] ?? -99)) } : null;
};
interface Out extends Rec { evalYear: number; a: { pos: string; g: number[] } | null; b: { pos: string; g: number[] } | null; maxPos: string; maxDiff: number }
const out: Out[] = [];
const groups = new Map<string, Rec[]>();
for (const r of recs) {
  const k = `${r.cat}|${r.year + 1}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
for (const [k, rs] of groups) {
  const evalYear = Number(k.split('|')[1]);
  if (evalYear > LAST) {
    for (const r of rs) out.push({ ...r, evalYear, a: null, b: null, maxPos: '-', maxDiff: 0 });
    continue;
  }
  const src = store.season(rs[0].year)!;
  const alt = new Map(rs.map((r) => [r.id, r.alt]));
  const modified: SeasonData = { ...src, bat: src.bat.map((row) => (alt.has(row.id) ? { ...row, pos: alt.get(row.id)! } : row)) };
  const altStore = { ...store, season: (y: number) => (y === rs[0].year ? modified : store.season(y)) };
  const wa = world(evalYear);
  const wb = worldForYear(altStore, evalYear, params);
  for (const r of rs) {
    const a = grades(wa, r.id);
    const b = grades(wb, r.id);
    let maxPos = '-';
    let maxDiff = 0;
    if (a && b) FIELD_POS.forEach((q, i) => { if (Math.abs(a.g[i] - b.g[i]) > Math.abs(maxDiff)) { maxDiff = a.g[i] - b.g[i]; maxPos = q; } });
    out.push({ ...r, evalYear, a, b, maxPos, maxDiff });
  }
}
out.sort((p, q) => Math.abs(q.maxDiff) - Math.abs(p.maxDiff) || q.pa - p.pa);

const name = (id: string) => store.players.get(id)?.name ?? id;
const lines: string[] = [];
const cats: Cat[] = ['① 2009', '② 바꿈', '③ 한 해만'];
lines.push('| 분류 | 선수-시즌 | 평가 못 함 | 차 0 | 1~4 | 5~9 | 10 이상 | 주 포지션이 바뀜 |', '|---|---:|---:|---:|---:|---:|---:|---:|');
for (const c of cats) {
  const xs = out.filter((o) => o.cat === c);
  const ok = xs.filter((o) => o.a && o.b);
  const bin = (lo: number, hi: number) => ok.filter((o) => Math.abs(o.maxDiff) >= lo && Math.abs(o.maxDiff) <= hi).length;
  lines.push(`| ${c} | ${xs.length} | ${xs.length - ok.length} | ${bin(0, 0)} | ${bin(1, 4)} | ${bin(5, 9)} | ${bin(10, 999)} | ${ok.filter((o) => o.a!.pos !== o.b!.pos).length} |`);
}
for (const c of cats) {
  lines.push('', `### ${c} — 영향 큰 순 20건`, '', '| 선수 | 시즌 | 팀 | 타석 | 지금 → 대안 | 평가 연도 | 주 포지션 (지금 / 대안) | 가장 큰 차 |', '|---|---:|---|---:|---|---:|---|---|');
  for (const o of out.filter((x) => x.cat === c && x.a && x.b).slice(0, 20)) {
    lines.push(`| ${name(o.id)} | ${o.year} | ${o.team} | ${o.pa} | ${o.cur} → ${o.alt} | ${o.evalYear} | ${o.a!.pos} / ${o.b!.pos} | ${o.maxPos} ${o.maxDiff > 0 ? '+' : ''}${o.maxDiff} |`);
  }
}
console.log(lines.join('\n'));
if (mdOut) writeFileSync(mdOut, lines.join('\n') + '\n', 'utf8');
if (csvOut) {
  const head = ['분류', '선수ID', '이름', '시즌', '팀', '타석', '지금 포지션', '대안 포지션', '근거', '평가 연도', '주 포지션 지금', '주 포지션 대안', '가장 큰 차 자리', '가장 큰 차',
    ...FIELD_POS.map((q) => `지금 ${q}`), ...FIELD_POS.map((q) => `대안 ${q}`)];
  const rows = out.map((o) => [o.cat, o.id, name(o.id), o.year, o.team, o.pa, o.cur, o.alt, o.note, o.evalYear, o.a?.pos ?? '평가 못 함', o.b?.pos ?? '', o.maxPos, o.maxDiff,
    ...(o.a?.g ?? FIELD_POS.map(() => '')), ...(o.b?.g ?? FIELD_POS.map(() => ''))]);
  writeFileSync(csvOut, [head, ...rows].map((r) => r.join(',')).join('\n') + '\n', 'utf8');
}
