// 개막 라인업이 실제 자리에 서는지 잰다 (2026-10-22, 하드힛 포지션 반영 전·후 비교용).
// 구단마다 개막 때 야수 전원으로 최적 배정(assignSlots, 휴식 없음)을 하고, 수비 자리(DH 제외)가
//  (가) 게임 주 포지션(SimPlayer.pos)과 다른 수, (나) 그 해 하드힛 주 포지션(data-src/hardhit_derived/position.csv)과 다른 수를 센다.
// 하드힛 값이 없는 선수(그 해 포지션 파일에 없음)는 (나)에서 "모름"으로 따로 센다. 수비 가능 포지션(등급 40 이상)이 하나뿐인 야수 비율도 낸다.
// 사용법:  npx tsx tools/lineup_positions.ts [--years 2025,2026] [--out reports/lineup-positions.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, assignSlots, defenseAt, defenseGrade, playablePositions } from '../src/engine';
import { newPlayerStates, refreshActive } from '../src/engine/team';
import { GameSession } from '../src/game/session';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const years = (arg('years') ?? '2025,2026').split(',').map(Number);
const out = arg('out');
const store = loadDataStore();
// 수비 난이도 (engine/defense.ts SPECTRUM과 같은 값). 하드힛 주 포지션 밖 배치를 이동 종류로 나눈다
const HARD: Record<string, number> = { C: 3, SS: 4, '2B': 3, CF: 3, '3B': 2.5, RF: 1.5, LF: 1, '1B': 0 };
const OF = new Set(['LF', 'CF', 'RF']);
const kindOf = (slot: string, main: string | null, real: string) =>
  OF.has(slot) && OF.has(real) ? '외야끼리' : slot === main ? '게임 주 포지션이 그 해와 다름'
    : (HARD[slot] ?? 0) <= (HARD[main ?? ''] ?? 0) ? '게임 주 포지션보다 쉬운 자리' : '게임 주 포지션보다 어려운 자리';
const lines: string[] = [];
const emit = (s: string) => { lines.push(s); console.log(s); };

for (const year of years) {
  const g = GameSession.create(store, { year, teamIdx: 0, seed: 'lineup' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
  const hh = new Map<string, string>();
  for (const line of readFileSync('data-src/hardhit_derived/position.csv', 'utf8').trim().split(/\r?\n/).slice(1)) {
    const [y, id, pos] = line.split(',');
    if (Number(y) === year) hh.set(id, pos);
  }
  const states = newPlayerStates(g.world.players.length);
  let slots = 0, offMain = 0, offHh = 0, unknown = 0, hitters = 0, single = 0;
  const odd: string[] = [];
  const kinds = new Map<string, number>();
  for (const ts of g.season.teamSeasons) {
    refreshActive(ts, g.world, states, 0);
    for (const p of ts.hitters) {
      hitters++;
      if (playablePositions(p.bat).length === 1) single++;
    }
    for (const { p, slot } of assignSlots(ts.hitters)) {
      if (slot === 'DH') continue;
      slots++;
      const real = hh.get(p.id);
      const a = p.pos !== slot;
      const b = real !== undefined && real !== slot;
      if (a) offMain++;
      if (real === undefined) unknown++;
      else if (b) offHh++;
      const kind = b ? kindOf(slot, p.pos, real!) : '';
      if (kind) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (a || b) odd.push(`| ${ts.team.name} | ${p.name} | ${slot} | ${defenseGrade(defenseAt(p, slot))} | ${p.pos ?? '-'} | ${real ?? '모름'} | ${kind} | ${playablePositions(p.bat).join(' ')} |`);
    }
  }
  emit(`## ${year}년 개막 라인업`);
  emit('');
  emit(`- 수비 자리 ${slots}개 중 게임 주 포지션 밖 **${offMain}**, 그 해 하드힛 주 포지션 밖 **${offHh}** (하드힛 값 모름 ${unknown})`);
  emit(`- 하드힛 주 포지션 밖 배치의 종류: ${[...kinds.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  emit(`- 야수 ${hitters}명 중 수비 가능 포지션(등급 40 이상)이 하나뿐인 선수 ${single}명 (${(single / hitters * 100).toFixed(1)}%)`);
  emit('');
  emit('| 구단 | 선수 | 배치 | 그 자리 등급 | 게임 주 포지션 | 하드힛 그 해 | 종류 | 수비 가능 (좋은 순) |');
  emit('|---|---|---|---:|---|---|---|---|');
  odd.forEach(emit);
  emit('');
}
if (out) writeFileSync(out, `# 개막 라인업 포지션 점검\n\n\`npx tsx tools/lineup_positions.ts\`가 만든다.\n\n${lines.join('\n')}\n`, 'utf8');
