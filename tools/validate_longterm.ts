// 장기 진행 검사. 실패 직전 저장과 시드·연도를 함께 남겨 같은 상태에서 재현한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { GameSession } from '../src/game/session';
import { ORG_LIMIT, capPayroll, salaryCap } from '../src/league/salary';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && (!process.argv[i + 1] || process.argv[i + 1].startsWith('--'))) throw new Error(`--${name} 값이 필요합니다`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const seasons = Number(arg('seasons', '20'));
const seeds = arg('seeds', 'longterm-a,longterm-b,longterm-c').split(',');
const out = arg('out', 'reports/longterm');
if (!Number.isInteger(seasons) || seasons < 1 || seeds.some((s) => !s.trim())) throw new Error('시즌 수는 양의 정수, 시드는 빈칸 없는 목록이어야 합니다');
mkdirSync(dirname(out), { recursive: true });
const store = loadDataStore();
const rows: object[] = [];
const lines = [
  '# 다년 진행 검증', '',
  `2026년 시작, 시드 ${seeds.join(', ')}, 각각 ${seasons}시즌. 기본 엔진 보정 횟수 사용.`, '',
  '플레이어 구단은 매 시드 순번에 따라 바꾼다. FA 제시는 생략하고, 외국인은 기본 재계약 선택을 유지하며 드래프트·방출은 자동으로 한다.',
  '득점 ±15%는 장기 안정성 경고 기준(임시값)이며 M2의 100시즌 평균 ±5% 합격 기준을 대체하지 않는다.', '',
  '| 시드 | 연도 | 득점/팀경기 | 승률 표준편차 | 평균 나이 | 최대 나이 | 인원 범위 | 최소 야수/투수/포수 | 신규 입단 | 은퇴 | 경고 |',
  '|---|---:|---:|---:|---:|---:|---|---|---:|---:|---|',
];
let failed = false;
for (const [index, seed] of seeds.entries()) {
  let g: GameSession | undefined;
  try {
    g = GameSession.create(store, { year: 2026, teamIdx: index % store.season(2026)!.teams.length, seed });
    for (let i = 0; i < seasons; i++) {
      const year = g.year;
      const openingIds = new Set(g.league.players.map((p) => p.id));
      g.advance(1000);
      if (!g.done || g.season.teams.some((t) => t.g !== g!.world.gamesPerTeam)) throw new Error('시즌 경기 수 불일치');
      const orgs = g.world.teams.map((t) => t.org);
      const counts = orgs.map((ps) => ({ total: ps.length, hitters: ps.filter((p) => !p.isPitcher).length,
        pitchers: ps.filter((p) => p.isPitcher).length, catchers: ps.filter((p) => !p.isPitcher && p.pos === 'C').length }));
      const errors: string[] = [];
      const warnStart: string[] = [];
      counts.forEach((c, t) => {
        // 시작 연도는 실제 자료(시즌 중 들고 난 선수 포함)라 정원 초과를 경고로만 남긴다
        if (c.total > ORG_LIMIT && year === 2026) warnStart.push(`${g!.world.teams[t].name} 시작 ${c.total}명`);
        else if (c.catchers < 2) warnStart.push(`${g!.world.teams[t].name} 포수 ${c.catchers}명`);
        if (c.total > ORG_LIMIT && year !== 2026 || c.hitters < 18 || c.pitchers < 18 || c.catchers < 1) errors.push(`${g!.world.teams[t].name}: 선수 수 ${JSON.stringify(c)}`);
      });
      if (openingIds.size !== g.league.players.length) errors.push('선수 ID 중복');
      for (const p of g.league.players) {
        const nums = [p.potential, p.contract.salary, ...Object.values(p.bat ?? {}), ...Object.values(p.pit ?? {})].filter((v) => typeof v !== 'object');
        if (nums.some((v) => !Number.isFinite(v))) errors.push(`${p.id}: 유한하지 않은 능력/계약`);
      }
      const rates = g.season.teams.map((t) => t.w / Math.max(1, t.w + t.l));
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      const sd = Math.sqrt(rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length);
      const ages = g.world.players.flatMap((p) => p.age === null ? [] : [p.age]);
      const runs = g.season.totals.r / (g.season.totals.games * 2);
      const targetYears = year === 2026 ? [2026] : store.meta.years.slice(-5);
      const target = targetYears.reduce((s, y) => s + store.season(y)!.league.runsPerTeamGame, 0) / targetYears.length;
      const warnings = [...warnStart, ...(Math.abs(runs / target - 1) > 0.15 ? ['득점 ±15% 초과'] : [])];
      const payroll = orgs.map((_, t) => capPayroll(g!.league.players, t, year));
      g.beginOffseason();
      let guard = 0;
      while (g.offseason!.stage !== 'ready') {
        if (++guard > 50) throw new Error(`오프시즌 진행 정체: ${g.offseason!.stage}`);
        const offers = g.owner.offers;
        if (offers?.length) g.acceptOffer(offers[0]);
        if (g.offseason!.stage === 'draft') g.autoDraft();
        if (g.offseason!.stage === 'comp') g.autoComp();
        if (g.offseason!.stage === 'release') g.autoRelease();
        const result = g.nextStage();
        if (!result.ok) throw new Error(result.message);
      }
      // 오프시즌을 마친 리그 상태: 복무 중을 뺀 정원
      for (let t = 0; t < g.league.teams.length; t++) {
        const n = g.league.players.filter((p) => p.team === t && p.military?.state !== 'serving').length;
        if (n > ORG_LIMIT) errors.push(`${g.league.teams[t].name}: 오프시즌 뒤 ${n}명 (정원 ${ORG_LIMIT})`);
      }
      if (errors.length) throw new Error(errors.join('; '));
      const retired = g.offseason!.log.filter((l) => l.text.includes('은퇴')).length;
      const entrants = g.league.players.filter((p) => p.team >= 0 && !openingIds.has(p.id)).length;
      const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;
      rows.push({ seed, year, runs, target, winPctSd: sd, avgAge, maxAge: Math.max(...ages), counts, payroll, salaryCap: salaryCap(year), entrants, retired, warnings, errors });
      lines.push(`| ${seed} | ${year} | ${runs.toFixed(3)} | ${sd.toFixed(3)} | ${avgAge.toFixed(1)} | ${Math.max(...ages)} | ${Math.min(...counts.map((c) => c.total))}–${Math.max(...counts.map((c) => c.total))} | ${Math.min(...counts.map((c) => c.hitters))}/${Math.min(...counts.map((c) => c.pitchers))}/${Math.min(...counts.map((c) => c.catchers))} | ${entrants} | ${retired} | ${[...warnings, ...errors].join('; ')} |`);
      console.log(`${seed} ${year}: 득점 ${runs.toFixed(3)}, 평균 나이 ${avgAge.toFixed(1)}, 오류 ${errors.length}`);
      if (errors.length) throw new Error(errors.join('; '));
      // 매년 오프시즌 종료 저장을 JSON 왕복한다. 마지막에도 다음 개막까지 확인한다.
      g = GameSession.load(store, JSON.parse(JSON.stringify(g.toSave())));
      const result = g.openNextSeason();
      if (!result.ok) throw new Error(result.message);
    }
  } catch (error) {
    failed = true;
    const message = String(error);
    lines.push('', `실패: ${seed}, ${g?.year ?? 2026}년 — ${message}`);
    writeFileSync(`${out}-failure-${index}.json`, JSON.stringify({ seed, year: g?.year, error: message, save: g?.toSave() }));
    console.error(message);
  }
}
writeFileSync(`${out}.json`, JSON.stringify(rows, null, 2));
writeFileSync(`${out}.md`, lines.join('\n') + '\n');
if (failed) process.exitCode = 1;
