// AI 선수 가치(src/ai/value.ts)와 하드힛 WAR의 순위 상관 (2026-10-22, 하드힛 항목 5).
// 그 해 개막 월드(createLeague, 능력 = 직전 3시즌)의 가치를 그 해 WAR·직전 시즌 WAR과 견준다. 가치 계산은 고치지 않는다.
// 하드힛 WAR은 data-src/hardhit_derived/war.csv (tools/hardhit_derive.py가 만든 가공값)라 원본 없이도 돈다.
// 실행: npx tsx tools/hardhit_war_check.ts [--years 2019,2023,2025,2026] [--seed war-check] [--out reports/hardhit-war-check.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, type SimPlayer } from '../src/engine';
import { currentRuns, isStarter, playerValue, valueContext, WOBA_SCALE } from '../src/ai/value';
import { horizonWeights } from '../src/ai/trade';
import { createLeague } from '../src/league/create';
import { aiPotential } from '../src/league/owner';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const YEARS = (arg('years') ?? '2019,2023,2025,2026').split(',').map(Number);
const SEED = arg('seed') ?? 'war-check';
const OUT = arg('out') ?? 'reports/hardhit-war-check.md';

/** 표본 기준: 그 해 타자 200타석, 투수는 하드힛이 WAR을 주는 선(약 30이닝)을 그대로 쓴다 */
const MIN_PA = 200;
/** 직전 시즌 WAR은 이만큼 뛴 경우만 (타자 타석, 투수 아웃) */
const MIN_PRIOR_PA = 100;
/** 출전량 보정 WAR의 한 시즌 기준 (타자 600타석, 선발 150이닝, 구원 65이닝) */
const FULL = { bat: 600, sp: 450, rp: 195 };

type WarRow = { war: number; rwar: number | null; n: number; role: string };
const hh = new Map<string, WarRow>(); // `${연도}/${선수ID}/${구분}`
{
  const lines = readFileSync('data-src/hardhit_derived/war.csv', 'utf8').trim().split(/\r?\n/).slice(1);
  for (const l of lines) {
    const [y, id, kind, role, n, war, rwar] = l.split(',');
    hh.set(`${y}/${id}/${kind}`, { war: Number(war), rwar: rwar === '' ? null : Number(rwar), n: Number(n), role });
  }
}
const warOf = (y: number, p: SimPlayer) => hh.get(`${y}/${p.id}/${p.isPitcher ? '투수' : '타자'}`);

/** 평균 순위 (같은 값은 순위를 나눠 가진다) */
function ranks(xs: number[]): number[] {
  const o = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < o.length; ) {
    let j = i;
    while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
    for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}
/** 스피어만 순위 상관. 표본이 8 미만이면 NaN */
function spearman(a: number[], b: number[]): number {
  return a.length < 8 ? NaN : pearson(ranks(a), ranks(b));
}
/** 0~1 백분위 (클수록 높다) */
function pct(xs: number[]): number[] {
  const r = ranks(xs);
  return r.map((v) => (xs.length > 1 ? v / (xs.length - 1) : 0.5));
}

interface Pt {
  year: number;
  p: SimPlayer;
  team: string;
  /** 이번 시즌 기여 (런, currentRuns) */
  runs: number;
  /** AI 트레이드 가치 (우승 도전 가중치 4시즌) */
  value: number;
  /** 타자의 타격 몫만 (포지션 보정·수비 없음) */
  batOnly: number | null;
  war: number;
  rwar: number | null;
  /** 출전량 보정 WAR */
  warRate: number;
  prior: number | null;
  /** 하드힛 그 해 보직 (투수) */
  hhRole: string;
  /** 하드힛 그 해 타석·아웃 */
  n: number;
  // 그 해 표본 안에서의 백분위 (타자·투수 따로)
  pRuns?: number;
  pWar?: number;
  pBat?: number;
  // 직전 시즌 WAR이 있는 선수 안에서의 백분위
  qRuns?: number;
  qPrior?: number;
}

const store = loadDataStore();
const pts: Pt[] = [];
const coverage: string[] = [];
for (const year of YEARS) {
  const params = { ...DEFAULT_PARAMS, ratingBasis: 'prior' as const };
  const { league, world } = createLeague(store, year, SEED, params);
  const ctx = valueContext(world);
  ctx.potential = new Map(league.players.map((p) => [p.id, aiPotential(league, p)]));
  const weights = horizonWeights('contend', 1);
  let inWorld = 0, withWar = 0, kept = 0;
  const ids = new Set<string>();
  for (const p of world.players) {
    if (p.teamIdx < 0) continue;
    inWorld++;
    ids.add(`${p.id}/${p.isPitcher ? '투수' : '타자'}`);
    const w = warOf(year, p);
    if (!w) continue;
    withWar++;
    if (!p.isPitcher && w.n < MIN_PA) continue;
    kept++;
    const pr = warOf(year - 1, p);
    const sp = p.isPitcher && isStarter(p);
    const full = p.isPitcher ? (sp ? FULL.sp : FULL.rp) : FULL.bat;
    pts.push({
      year, p, team: world.teams[p.teamIdx]?.name ?? '-',
      runs: currentRuns(p, ctx),
      value: playerValue(p, ctx, weights),
      batOnly: p.isPitcher ? null : ((p.value - ctx.replBat) / WOBA_SCALE) * 600,
      war: w.war, rwar: w.rwar, warRate: w.n > 0 ? (w.war * full) / w.n : 0,
      prior: pr && pr.n >= (p.isPitcher ? 0 : MIN_PRIOR_PA) ? pr.war : null,
      hhRole: w.role, n: w.n,
    });
  }
  // 그 해 WAR이 있는데 개막 월드에 없는 선수 (시즌 중 들어온 외국인·신인, 복무 복귀 등)
  let missing = 0;
  for (const k of hh.keys()) {
    const [y, id, kind] = k.split('/');
    if (Number(y) === year && !ids.has(`${id}/${kind}`)) missing++;
  }
  coverage.push(`| ${year} | ${inWorld} | ${withWar} | ${kept} | ${missing} |`);
}
for (const year of YEARS) {
  for (const pit of [false, true]) {
    const g = pts.filter((x) => x.year === year && x.p.isPitcher === pit);
    const a = pct(g.map((x) => x.runs)), b = pct(g.map((x) => x.war)), c = pct(g.map((x) => x.batOnly ?? 0));
    g.forEach((x, i) => { x.pRuns = a[i]; x.pWar = b[i]; x.pBat = c[i]; });
    const h = g.filter((x) => x.prior !== null);
    const d = pct(h.map((x) => x.runs)), e = pct(h.map((x) => x.prior!));
    h.forEach((x, i) => { x.qRuns = d[i]; x.qPrior = e[i]; });
  }
}

const f2 = (v: number) => (Number.isNaN(v) ? '-' : v.toFixed(2));
const f1 = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
const isSP = (x: Pt) => isStarter(x.p);
const OF = new Set(['LF', 'CF', 'RF', 'OF']);
const IF = new Set(['2B', '3B', 'SS', 'IF']);

type Group = { label: string; f: (x: Pt) => boolean };
const groups: Group[] = [
  { label: '타자 전체', f: (x) => !x.p.isPitcher },
  { label: '투수 전체', f: (x) => x.p.isPitcher },
  { label: '투수 · 선발 (게임 판정)', f: (x) => x.p.isPitcher && isSP(x) },
  { label: '투수 · 불펜 (게임 판정)', f: (x) => x.p.isPitcher && !isSP(x) },
  { label: '타자 · 포수', f: (x) => !x.p.isPitcher && x.p.pos === 'C' },
  { label: '타자 · 1루수', f: (x) => !x.p.isPitcher && x.p.pos === '1B' },
  { label: '타자 · 2루·3루·유격', f: (x) => !x.p.isPitcher && IF.has(x.p.pos ?? '') },
  { label: '타자 · 외야수', f: (x) => !x.p.isPitcher && OF.has(x.p.pos ?? '') },
  { label: '타자 · 지명타자', f: (x) => !x.p.isPitcher && x.p.pos === 'DH' },
  { label: '타자 · 국내', f: (x) => !x.p.isPitcher && !x.p.foreign },
  { label: '타자 · 외국인', f: (x) => !x.p.isPitcher && x.p.foreign },
  { label: '투수 · 국내', f: (x) => x.p.isPitcher && !x.p.foreign },
  { label: '투수 · 외국인', f: (x) => x.p.isPitcher && x.p.foreign },
  { label: '투수 · 외국인 재계약 (직전 기록으로 능력)', f: (x) => x.p.isPitcher && x.p.foreign && !x.p.debutEstimate },
  { label: '투수 · 외국인 신규 (그 해 기록으로 능력)', f: (x) => x.p.isPitcher && x.p.foreign && x.p.debutEstimate },
  { label: '타자 · 그 해 기록으로 능력 (직전 3시즌 기록 없음)', f: (x) => !x.p.isPitcher && x.p.debutEstimate },
  { label: '투수 · 그 해 기록으로 능력 (직전 3시즌 기록 없음)', f: (x) => x.p.isPitcher && x.p.debutEstimate },
  { label: '타자 · 직전 기록으로 능력', f: (x) => !x.p.isPitcher && !x.p.debutEstimate },
  { label: '투수 · 직전 기록으로 능력', f: (x) => x.p.isPitcher && !x.p.debutEstimate },
];

function rho(g: Pt[], a: (x: Pt) => number | null, b: (x: Pt) => number | null): { r: number; n: number } {
  const xs = g.filter((x) => a(x) !== null && b(x) !== null);
  return { r: spearman(xs.map((x) => a(x)!), xs.map((x) => b(x)!)), n: xs.length };
}
const cellOf = (c: { r: number; n: number }) => `${f2(c.r)} (${c.n})`;

// 보고서 앞의 손으로 쓴 해석(MARK 위)은 다시 돌려도 남긴다
const MARK = '<!-- 아래는 tools/hardhit_war_check.ts가 만든다 -->';
const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const out: string[] = [];
if (old.includes(MARK)) out.push(old.slice(0, old.indexOf(MARK)).trimEnd(), '');
else out.push('# AI 선수 가치와 하드힛 WAR 대조', '');
out.push(MARK, '');
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
out.push(`만든 날: ${ymd}. 도구: \`npx tsx tools/hardhit_war_check.ts\` (시드 \`${SEED}\`). 하드힛 WAR 가공값: \`data-src/hardhit_derived/war.csv\` (\`python -I -X utf8 tools/hardhit_derive.py\`).`, '');
out.push('기록 일부: 하드힛(https://hardhit.ai), 비상업적 이용.', '');
out.push('## 무엇을 견줬나', '');
out.push('- **게임 가치**: 그 해 새 게임 개막 월드(`createLeague`, 능력 = 직전 3시즌)에서 `currentRuns` (이번 시즌 기여, 런). AI 트레이드 가치 `playerValue`(우승 도전 가중치 1·0.5·0.3·0.2, AI 잠재력 = 보통 난이도 오차)는 따로 한 줄.');
out.push('- **하드힛 WAR**: 타자는 o-WAR(= WAR_타격주루 + WAR_출장, **수비·포지션 보정 없음**), 투수는 fWAR (rWAR은 따로 한 줄). 투수 WAR은 하드힛이 약 30이닝 이상에만 준다.');
out.push(`- 표본: 개막 월드에 있고 그 해 하드힛 WAR이 있는 선수. 타자는 그 해 ${MIN_PA}타석 이상. 직전 시즌 WAR은 타자 ${MIN_PRIOR_PA}타석 이상일 때만.`);
out.push('- 상관은 스피어만 순위 상관, 괄호는 표본 수. "출전량 보정"은 WAR을 한 시즌 기준(타자 600타석, 선발 150이닝, 구원 65이닝)으로 늘린 값이다. 게임 가치는 출전량을 한 시즌으로 가정한 값이라, 출전량 차이를 빼고 보려는 참고 열이다.');
// 원본이 빠진 해 (예: 처음 받은 2022 타자 saber는 2020 자료였다. 2026-10-22 다시 받음)
for (const y of YEARS) {
  if (![...hh.keys()].some((k) => k.startsWith(`${y - 1}/`) && k.endsWith('/타자'))) out.push(`- ${y}년의 직전 시즌(${y - 1}) 타자 WAR이 하드힛 가공값에 없다.`);
}
out.push('- 직전 3시즌 1군 기록이 없는 선수(신인·신규 외국인 등)는 게임이 **그 해 기록**으로 능력을 추정한다 (`debutEstimate`, CLAUDE.md M2의 예외). 이들은 그 해 WAR과의 상관이 저절로 높게 나오므로 따로 묶었다.', '');
out.push('| 연도 | 개막 월드 선수 | 그 해 WAR 있음 | 표본 | WAR 있는데 개막 월드에 없음 |', '|---|---:|---:|---:|---:|', ...coverage, '');

out.push('## 순위 상관 (게임 가치 `currentRuns` 대 하드힛 WAR)', '');
for (const year of YEARS) {
  const ys = pts.filter((x) => x.year === year);
  out.push(`### ${year}`, '', '| 묶음 | 그 해 WAR | 직전 시즌 WAR | 그 해 WAR (출전량 보정) |', '|---|---:|---:|---:|');
  for (const g of groups) {
    const s = ys.filter(g.f);
    if (s.length === 0) continue;
    out.push(`| ${g.label} | ${cellOf(rho(s, (x) => x.runs, (x) => x.war))} | ${cellOf(rho(s, (x) => x.runs, (x) => x.prior))} | ${cellOf(rho(s, (x) => x.runs, (x) => x.warRate))} |`);
  }
  out.push('');
}

out.push('## 다른 견줌 (4개 연도)', '', `| 견줌 | ${YEARS.join(' | ')} |`, `|---|${YEARS.map(() => '---:').join('|')}|`);
const extra: [string, (s: Pt[]) => { r: number; n: number }, (x: Pt) => boolean][] = [
  ['타자: 타격 몫만(포지션·수비 뺌) 대 o-WAR', (s) => rho(s, (x) => x.batOnly, (x) => x.war), (x) => !x.p.isPitcher],
  ['타자: AI 트레이드 가치 대 o-WAR', (s) => rho(s, (x) => x.value, (x) => x.war), (x) => !x.p.isPitcher],
  ['투수: AI 트레이드 가치 대 fWAR', (s) => rho(s, (x) => x.value, (x) => x.war), (x) => x.p.isPitcher],
  ['투수: 게임 가치 대 rWAR', (s) => rho(s, (x) => x.runs, (x) => x.rwar), (x) => x.p.isPitcher],
  ['투수: 하드힛 직전 시즌 fWAR 대 그 해 fWAR (참고: WAR 자체의 해마다 이어짐)', (s) => rho(s, (x) => x.prior, (x) => x.war), (x) => x.p.isPitcher],
  ['타자: 하드힛 직전 시즌 o-WAR 대 그 해 o-WAR (참고)', (s) => rho(s, (x) => x.prior, (x) => x.war), (x) => !x.p.isPitcher],
];
for (const [label, fn, f] of extra) out.push(`| ${label} | ${YEARS.map((y) => cellOf(fn(pts.filter((x) => x.year === y && f(x))))).join(' | ')} |`);
out.push('');

out.push('## 묶음별 치우침 (4개 연도 합침)', '');
out.push('그 해 표본 안(타자·투수 따로)에서 게임 가치 백분위 − WAR 백분위의 평균. **+면 게임이 WAR보다 높게, −면 낮게 본다.** 묶음 안 상관과 달리 묶음 전체가 한쪽으로 쏠렸는지를 본다.', '');
out.push('타자의 "타격 몫만" 열은 게임 가치에서 포지션 보정·수비를 뺀 값으로 같은 계산을 한 것이다 (하드힛 o-WAR에는 포지션 보정이 없다).', '');
out.push('| 묶음 | 표본 | 평균 치우침 (백분위 점) | 타격 몫만 치우침 | 게임 가치 평균 (런) | WAR 평균 |', '|---|---:|---:|---:|---:|---:|');
const roleGroups: Group[] = [
  ...groups.slice(2),
  { label: '투수 · 게임 선발인데 그 해 하드힛 보직이 선발 아님', f: (x) => x.p.isPitcher && isSP(x) && x.hhRole !== '선발' },
  { label: '투수 · 게임 불펜인데 그 해 하드힛 보직이 선발', f: (x) => x.p.isPitcher && !isSP(x) && x.hhRole === '선발' },
  { label: '투수 · 하드힛 마무리·셋업', f: (x) => x.p.isPitcher && (x.hhRole === '마무리' || x.hhRole === '셋업') },
  { label: '나이 · 24세 이하', f: (x) => (x.p.age ?? 28) <= 24 },
  { label: '나이 · 35세 이상', f: (x) => (x.p.age ?? 28) >= 35 },
];
for (const g of roleGroups) {
  const s = pts.filter(g.f);
  if (!s.length) continue;
  const avg = (fn: (x: Pt) => number) => s.reduce((t, x) => t + fn(x), 0) / s.length;
  const bat = s.every((x) => !x.p.isPitcher) ? f1(avg((x) => (x.pBat! - x.pWar!) * 100)) : '-';
  out.push(`| ${g.label} | ${s.length} | ${f1(avg((x) => (x.pRuns! - x.pWar!) * 100))} | ${bat} | ${avg((x) => x.runs).toFixed(1)} | ${avg((x) => x.war).toFixed(2)} |`);
}
out.push('');

out.push('## 크게 어긋나는 선수 (4개 연도, 그 해 WAR 기준)', '');
out.push('치우침 = 게임 가치 백분위 − 그 해 WAR 백분위 (타자·투수 따로). 높게 본 쪽 10명, 낮게 본 쪽 10명. 게임 보직은 개막 월드 판정, 하드힛 보직은 그 해 실제.', '');
const head = '| 연도 | 선수 | 구단 | 게임 포지션·보직 | 하드힛 보직 | 외국인 | 능력 근거 | 나이 | 게임 가치 (런) | 그 해 WAR | 타석·이닝 | 직전 시즌 WAR | 치우침 |';
const sep = '|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|';
const row = (x: Pt) => `| ${x.year} | ${x.p.name} | ${x.team} | ${x.p.isPitcher ? (isSP(x) ? '선발' : '불펜') : x.p.pos ?? '-'} | ${x.p.isPitcher ? x.hhRole : '-'} | ${x.p.foreign ? '○' : ''} | ${x.p.debutEstimate ? '그 해' : '직전'} | ${x.p.age ?? '-'} | ${x.runs.toFixed(1)} | ${x.war.toFixed(2)} | ${x.p.isPitcher ? `${Math.floor(x.n / 3)}.${x.n % 3}` : x.n} | ${x.prior === null ? '-' : x.prior.toFixed(2)} | ${f1(gapOf(x) * 100)} |`;
let gapOf = (x: Pt) => x.pRuns! - x.pWar!;
const byGap = [...pts].sort((a, b) => gapOf(b) - gapOf(a) || a.p.id.localeCompare(b.p.id));
out.push('### 게임이 높게 본 선수', '', head, sep, ...byGap.slice(0, 10).map(row), '');
out.push('### 게임이 낮게 본 선수', '', head, sep, ...byGap.slice(-10).reverse().map(row), '');
out.push('## 크게 어긋나는 선수 (직전 시즌 WAR 기준, 참고)', '');
out.push('능력이 직전 3시즌으로 정해지므로 그 해의 급등·급락을 빼고 보려는 목록이다. 직전 시즌 WAR이 있는 선수 안에서 백분위를 다시 쟀다. 치우침 = 게임 가치 백분위 − 직전 시즌 WAR 백분위.', '');
gapOf = (x: Pt) => x.qRuns! - x.qPrior!;
const byPrior = pts.filter((x) => x.prior !== null).sort((a, b) => gapOf(b) - gapOf(a) || a.p.id.localeCompare(b.p.id));
out.push('### 게임이 높게 본 선수', '', head, sep, ...byPrior.slice(0, 10).map(row), '');
out.push('### 게임이 낮게 본 선수', '', head, sep, ...byPrior.slice(-10).reverse().map(row), '');

writeFileSync(OUT, out.join('\n') + '\n');
console.log(`${OUT}: 표본 ${pts.length}명`);
