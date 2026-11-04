// 100시즌 평가의 실제 KBO 대조 판: 실제 1982~2025 기록을 tools/eval100.ts 판과 같은 꼴(JSON)로 만든다.
// WAR은 게임과 같은 식(league/war.ts, 실제 시즌 환경 realEnvOf)이라 WAR 기준 항목을 같은 눈금으로 견줄 수 있다.
// 선수 기록으로 잴 수 있는 항목만 쓴다 (tools/eval100_score.ts ITEMS의 real: true). 재정·FA·구단주 등은 자료가 없어 빈칸.
//
// 사용법:  npx tsx tools/eval100_real.ts [--from 1982] [--to 2025] [--out reports/eval100/raw/real.json]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { batWarOf, pitWarOf, realEnvOf } from '../src/league/war';
import type { PlayerRec, SeasonRow, YearRow } from './eval100';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const from = Number(arg('from', '1982')), to = Number(arg('to', '2025'));
const out = arg('out', 'reports/eval100/raw/real.json');
const store = loadDataStore();
const r2 = (x: number) => Math.round(x * 100) / 100;

const franchises: string[] = [];
const fIdx = (f: string) => { let i = franchises.indexOf(f); if (i < 0) { i = franchises.length; franchises.push(f); } return i; };
const players: Record<string, PlayerRec> = {};
const years: Partial<YearRow>[] = [];

for (let y = from; y <= to; y++) {
  const sd = store.season(y);
  if (!sd) continue;
  const env = realEnvOf(store, y);
  const fr = new Map(sd.teams.map((t) => [t.name, fIdx(t.franchise)]));
  type Acc = { team: number; war: number; pa: number; outs: number; hr: number; w: number; sv: number; so: number; hld: number; ab: number; h: number; er: number };
  const acc = new Map<string, Acc>();
  const get = (id: string, team: string) => acc.get(id) ?? acc.set(id, { team: fr.get(team) ?? -1, war: 0, pa: 0, outs: 0, hr: 0, w: 0, sv: 0, so: 0, hld: 0, ab: 0, h: 0, er: 0 }).get(id)!;
  for (const b of sd.bat) {
    const a = get(b.id, b.team);
    a.war += batWarOf(b, b.pos, env); a.pa += b.pa; a.hr += b.hr; a.ab += b.ab; a.h += b.h;
  }
  for (const p of sd.pit) {
    const a = get(p.id, p.team);
    a.war += pitWarOf(p, env); a.outs += p.outs; a.w += p.w; a.sv += p.sv; a.so += p.so; a.hld += p.hld ?? 0; a.er += p.er;
  }
  for (const [id, a] of acc) {
    const m = store.players.get(id);
    let rec = players[id];
    if (!rec) rec = players[id] = { n: m?.name ?? id, real: true, pit: m?.kind === 'P', birth: m?.birthYear ?? null, foreign: !!m?.foreign, asia: false, entry: m?.entryYear ?? y, school: null, pot0: 0, first: y, s: [] };
    const row: SeasonRow = [y, a.team, r2(a.war), a.pa, a.outs, a.hr, a.w, a.sv, rec.birth ? y - rec.birth : -1, a.so, a.hld];
    rec.s.push(row);
  }
  const vals = [...acc.values()];
  const games = sd.games;
  const qb = vals.filter((a) => a.pa >= Math.ceil(3.1 * games) && a.ab > 0);
  const qp = vals.filter((a) => a.outs >= 3 * games);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
  const L = sd.league as unknown as Record<string, number>;
  years.push({
    y, st: [], w: sd.teams.map((t) => t.w), l: sd.teams.map((t) => t.l), t: sd.teams.map((t) => t.t),
    runsPg: L.r / Math.max(1, L.teamGames), hrPa: L.hr / Math.max(1, L.pa),
    lead: { hr: max(vals.map((a) => a.hr)), avg: max(qb.map((a) => a.h / a.ab)), w: max(vals.map((a) => a.w)), so: max(vals.map((a) => a.so)), sv: max(vals.map((a) => a.sv)), hld: max(vals.map((a) => a.hld)), sb: 0 },
    cnt: {
      hr50: vals.filter((a) => a.hr >= 50).length, hr40: vals.filter((a) => a.hr >= 40).length, hr30: vals.filter((a) => a.hr >= 30).length,
      avg400: qb.filter((a) => a.h / a.ab >= 0.4).length, avg300: qb.filter((a) => a.h / a.ab >= 0.3).length,
      w20: vals.filter((a) => a.w >= 20).length, w15: vals.filter((a) => a.w >= 15).length, ip180: vals.filter((a) => a.outs >= 540).length,
      sv30: vals.filter((a) => a.sv >= 30).length, qPit: qp.length, qBat: qb.length, era1: qp.filter((a) => (27 * a.er) / a.outs < 2).length,
    },
  });
}
// 은퇴: 마지막 시즌이 끝에서 3시즌 넘게 전이면 은퇴로 본다 (실제 은퇴 자료 대신)
for (const p of Object.values(players)) {
  const last = p.s.at(-1)!;
  if (last[0] <= to - 3) { p.retired = last[0]; p.retAge = last[8] >= 0 ? last[8] + 1 : null; }
}
const teamsAvg = Math.round(years.reduce((a, y) => a + (y.w?.length ?? 0), 0) / years.length);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ meta: { team: `실제 ${from}~${to}`, real: true, teamIdx: -1, focus: -1, seed: '-', start: from, seasons: years.length, wanted: years.length, secs: 0, teams: franchises.slice(0, teamsAvg) }, years, players, mgr: [], ownerHist: [], errors: [] }));
console.log(`${out}: ${years.length}시즌, 선수 ${Object.keys(players).length}명, 구단(평균) ${teamsAvg}`);
