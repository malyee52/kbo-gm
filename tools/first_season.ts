// 첫 시즌 밸런스 점검 (2026-10-21 사용자: "첫 시즌 기준으로 10번만 반복해서 시드만 바꿔 가며 돌리고 중복적으로 나오는 것들 조정하자").
// 같은 조건(시작 연도·기본 난이도·기본 모드)에서 시드만 바꿔 정규시즌 + 가을야구 + 첫 오프시즌(다음 해 개막 직전)까지 돌리고,
// 시드마다 지표를 모은 뒤 10시드 평균·범위와 "여러 시드에서 반복해 나오는 것"(같은 수상자·이벤트 쏠림 등)을 표로 낸다.
// 우리 구단도 AI에게 맡긴다 (challenge_odds.ts와 같은 방식: 이벤트는 첫 선택지로 자동, 오프시즌은 자동 진행).
//
// 실행: npx tsx tools/first_season.ts [--year 2026] [--team 0] [--basis season|prior] [--seeds s01,...,s10 | --n 10] [--out reports/first-season.md] [--json out.json]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS, winPct } from '../src/engine';
import { GameSession } from '../src/game/session';
import { capPayroll, salaryCap } from '../src/league/salary';
import { isServing } from '../src/league/careers';
import { cashOf } from '../src/league/finance';
import { seasonWar } from '../src/league/awards';
import { batWarOf, pitWarOf, realEnvOf } from '../src/league/war';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };

export interface SeedResult {
  seed: string;
  team: string;
  // 정규시즌
  sd: number; maxW: number; minW: number; standings: string[];
  avg: number; obp: number; slg: number; ops: number; era: number; rpg: number; hrPerTeam: number; sbPerTeam: number;
  bbPct: number; soPct: number;
  titles: Record<string, { name: string; team: string; value: string }>;
  mvp: string; rookie: string;
  top: { hr: number; rbi: number; avg: number; w: number; sv: number; so: number; era: number; hld: number };
  // 결장
  injuries: number; injMajor: number; injLong: number; injMinor: number; events: number; longOut: number; seasonOut: number;
  // 알림·이벤트
  newsByKind: Record<string, number>;
  eventTitles: Record<string, number>;
  foreignSwaps: number; aiTrades: number; userOffers: number;
  /** AI 구단 육성선수: 5월 1일 정식 등록 수, 개막 때 수 (2026-10-21) */
  devRegistered?: number; devAi?: number;
  // 가을야구
  champion: string; seeds: string[];
  // 구단주
  trust: number; fired: boolean;
  // 재정
  attendance: { min: number; max: number; mean: number };
  cashMin: number; cashMax: number;
  // 오프시즌
  faEntries: number; faMoved: number; faStayed: number; faLeft: number;
  enlistByTeam: number[]; enlistKinds?: { unit: number; active: number; reserve: number }; servingAfter: number;
  retired: number; retiredReal: number;
  growth: { n: number; meanDelta: number; up5: number; down5: number; byAge: Record<string, number> };
  capOver: number; capShare: { min: number; max: number; mean: number };
  offLog: Record<string, number>;
  rosterSizes: { min: number; max: number };
  /** 구단별 승 (구단 이름 → 승) */
  teamW: Record<string, number>;
  /** 구단별 이닝 상위 5명 비중 (구단 이름 → 비중, 정규시즌. 소속은 시즌 끝 기준) */
  top5: Record<string, number>;
  /** 선수별 주요 기록 (이름(구단) → 값): 반복 독식 확인용 */
  lines: Record<string, { hr: number; rbi: number; avg: number; pa: number; so: number; w: number; sv: number; hld: number; era: number; ip: number }>;
  faUnsigned: string[];
  /** 요구 연봉 5억 원 이상인데 계약하지 못하고 떠난 FA */
  faLeftBig: number;
  /** 계약하지 못한 FA 가운데 2차 드래프트·육성선수로 데려간 수 / 끝까지 남아 시즌 중 자유계약이 된 수 (2026-10-21) */
  faRescued: number; faFree: number;
  cashMinTeam: string;
  offersNone: number;
  /** 결산 직후 자금이 0 이하인 구단 (FA 계약금을 못 내 FA를 잡지 못한다) */
  zeroCash: string[];
  /** 결산 직후 자금 (억 원, 구단 이름 → 값) */
  cashSettle: Record<string, number>;
  /** 선수별 반복 강세 확인: 선수 id → 그 시드에서 받은 것 (타이틀 부문, MVP, 신인상, 골든글러브, 가치 상위 10·30) */
  stars: Record<string, { flags: string[]; war: number }>;
  /** 선수 정보 (id → 이름·구단·나이·투타·실존·외국인) */
  info: Record<string, { name: string; team: string; age: number | null; kind: string; real: boolean; foreign: boolean }>;
}

const lineTeamOf = (p: { teamIdx: number; formerTeam?: number }) => (p.teamIdx >= 0 ? p.teamIdx : p.formerTeam ?? -1);

/** 큰 값 n개가 합에서 차지하는 비중 */
function topShare(v: number[], n: number): number {
  const tot = v.reduce((a, b) => a + b, 0);
  return tot ? [...v].sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0) / tot : 0;
}

function sumBy<T>(xs: T[], f: (x: T) => number): number { return xs.reduce((s, x) => s + f(x), 0); }

export function runSeed(store: ReturnType<typeof loadDataStore>, year: number, teamIdx: number, seed: string, basis: 'season' | 'prior' = 'season'): SeedResult {
  // 화면의 새 게임과 같은 조건: DEFAULT_PARAMS, 능력치 기준 기본값 '역사 재현'(season), 기본 난이도
  const g = GameSession.create(store, { year, teamIdx, seed, difficulty: 'normal', ratingBasis: basis }, DEFAULT_PARAMS);
  const before = new Map<string, number>();
  g.advance(100000);
  const s = g.season;
  const w = g.world;
  const name = (t: number) => w.teams[t]?.name ?? String(t);

  const teams = s.teams;
  const pcts = teams.map(winPct);
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const sd = Math.sqrt(pcts.reduce((a, b) => a + (b - mean) ** 2, 0) / pcts.length);
  const games = sumBy(teams, (x) => x.g);

  const B = s.bat; const P = s.pit;
  const pa = sumBy(B, (b) => b.pa), ab = sumBy(B, (b) => b.ab), h = sumBy(B, (b) => b.h);
  const d2 = sumBy(B, (b) => b.d), t3 = sumBy(B, (b) => b.t), hr = sumBy(B, (b) => b.hr);
  const bb = sumBy(B, (b) => b.bb), hbp = sumBy(B, (b) => b.hbp), sf = sumBy(B, (b) => b.sf), so = sumBy(B, (b) => b.so);
  const sb = sumBy(B, (b) => b.sb);
  const er = sumBy(P, (p) => p.er), outs = sumBy(P, (p) => p.outs);
  const runs = sumBy(teams, (x) => x.rs);
  const avg = h / ab;
  const obp = (h + bb + hbp) / (ab + bb + hbp + sf);
  const slg = (h + d2 + 2 * t3 + 3 * hr) / ab;

  // 개인 1위 (타율·평균자책은 규정 타석·이닝)
  const gpt = w.gamesPerTeam;
  const players = w.players;
  let topAvg = 0, topEra = 99;
  for (const p of players) {
    const b = B[p.idx]; const q = P[p.idx];
    if (b.pa >= gpt * 3.1 && b.ab > 0) topAvg = Math.max(topAvg, b.h / b.ab);
    if (q.outs >= gpt * 3) topEra = Math.min(topEra, (q.er * 27) / q.outs);
  }
  const top = {
    hr: Math.max(...B.map((b) => b.hr)), rbi: Math.max(...B.map((b) => b.rbi)), avg: topAvg,
    w: Math.max(...P.map((q) => q.w)), sv: Math.max(...P.map((q) => q.sv)), so: Math.max(...P.map((q) => q.so)), era: topEra, hld: Math.max(...P.map((q) => q.hld ?? 0)),
  };

  // 결장
  const abs = s.absences;
  const len = s.schedule.length;
  const inj = abs.filter((a) => a.kind !== 'event');

  // 구단별 이닝 상위 5명 비중
  const outsBy = teams.map(() => [] as number[]);
  for (const p of players) { const t = lineTeamOf(p); if (t >= 0 && P[p.idx].outs > 0) outsBy[t].push(P[p.idx].outs); }
  const top5 = Object.fromEntries(outsBy.map((v, t) => [name(t), topShare(v, 5)]));

  // 정규시즌 알림 (결산 전)
  const regNews = g.news.filter((n) => n.year === year);
  const evTitles: Record<string, number> = {};
  for (const n of regNews) {
    if (n.kind !== 'event') continue;
    const m = /^이벤트: ([^(]+?)(?: \(|$)/.exec(n.text);
    if (m) evTitles[m[1].trim()] = (evTitles[m[1].trim()] ?? 0) + 1;
  }
  const newsByKind: Record<string, number> = {};
  for (const n of regNews) newsByKind[n.kind] = (newsByKind[n.kind] ?? 0) + 1;
  const foreignSwaps = regNews.filter((n) => n.text.startsWith('[외국인 교체]')).length;
  const aiTrades = regNews.filter((n) => n.kind === 'trade' && !n.text.startsWith('[외국인 교체]')).length;
  const userOffers = evTitles['트레이드 제안 접수'] ?? 0;
  const devRegistered = regNews.filter((n) => n.text.startsWith('[육성선수 정식 등록]')).reduce((a, n) => a + n.text.split(', ').length, 0);
  const devAi = devRegistered + w.players.filter((p) => p.dev && p.teamIdx >= 0 && p.teamIdx !== g.teamIdx).length;

  // 재정 (결산 전 흐름)
  const flows = w.teams.map((t) => g.seasonFinance(t.idx));
  const att = flows.map((f) => (f && f.homeGames ? f.attendance / f.homeGames : 0));

  // 성장 기준점 (결산 전 리그 상태 기준이 아니라 결산의 growth 항목을 쓴다)
  void before;

  // 결산 + 가을야구 + 오프시즌
  const servingPre = new Set(g.league.players.filter(isServing).map((p) => p.id));
  g.beginOffseason();
  const L = g.league;
  const ps = L.lastSeason?.postseason;
  const aw = L.awards?.find((a) => a.year === year);
  const titles: SeedResult['titles'] = {};
  for (const t of aw?.titles ?? []) {
    titles[t.label] = { name: t.winners.map((x) => x.name).join('·'), team: t.winners.map((x) => name(x.team)).join('·'), value: t.value };
  }
  const off = g.offseason!;
  const stars: SeedResult['stars'] = {};
  const info: SeedResult['info'] = {};
  const flag = (id: string, f2: string) => { (stars[id] ??= { flags: [], war: 0 }).flags.push(f2); };
  {
    const wars = [...seasonWar(w, s).entries()].sort((a, b) => b[1] - a[1]);
    wars.forEach(([idx, v], i) => {
      const p = w.players[idx];
      if (i < 30) { (stars[p.id] ??= { flags: [], war: 0 }).war = v; flag(p.id, i < 10 ? '가치10' : '가치30'); if (i < 10) flag(p.id, '가치30'); }
    });
    for (const t of aw?.titles ?? []) for (const x of t.winners) flag(x.id, t.label);
    if (aw?.mvp) flag(aw.mvp.id, 'MVP');
    if (aw?.rookie) flag(aw.rookie.id, '신인상');
    for (const gg of aw?.goldenGlove ?? []) flag(gg.winner.id, '골든글러브');
    for (const id of Object.keys(stars)) {
      const p = w.players.find((x) => x.id === id);
      if (p) info[id] = { name: p.name, team: name(lineTeamOf(p)), age: p.age, kind: p.isPitcher ? '투수' : '타자', real: p.real !== false, foreign: !!p.foreign };
    }
  }
  const cashSettle = Object.fromEntries(w.teams.map((t) => [t.name, Math.round(cashOf(L, t.idx) / 1e4)]));
  const zeroCash = w.teams.filter((t) => cashOf(L, t.idx) <= 0).map((t) => t.name);
  const growth = off.growth ?? [];
  const enlistByTeam = w.teams.map(() => 0);
  for (const gr of growth) if (gr.tags?.includes('입대') && gr.team >= 0) enlistByTeam[gr.team]++;
  // 복무 형태 (2026-10-21 상무 정원·현역·보충역)
  const enlistKinds = { unit: 0, active: 0, reserve: 0 };
  for (const p of L.players) if (p.military?.enlisted === off.year && (p.military.state === 'serving' || p.military.state === 'homeOnly')) enlistKinds[p.military.kind ?? 'unit']++;
  const ages: Record<string, number[]> = {};
  for (const gr of growth) {
    if (gr.tags?.includes('입대')) continue;
    const a = gr.age ?? 0;
    const k = a <= 22 ? '~22' : a <= 25 ? '23-25' : a <= 29 ? '26-29' : a <= 32 ? '30-32' : a <= 35 ? '33-35' : '36~';
    (ages[k] ??= []).push(gr.after - gr.before);
  }
  const deltas = growth.filter((x) => !x.tags?.includes('입대')).map((x) => x.after - x.before);
  const trust = g.owner.trust;
  const fired = (g.owner.firedYears ?? []).includes(year) || !!g.owner.offers?.length;

  let k = 0;
  while (off.stage !== 'ready' && k++ < 40) {
    const st = off.stage;
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
    off.userTeam = st === 'fa' ? -1 : g.teamIdx;
    const r = g.nextStage();
    if (!r.ok && g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
  }
  off.userTeam = g.teamIdx;
  const fa = off.fa.entries;
  const offLog: Record<string, number> = {};
  for (const l of off.log) offLog[l.stage] = (offLog[l.stage] ?? 0) + 1;
  const o = g.openNextSeason();
  if (!o.ok) throw new Error(o.message);
  const L2 = g.league;
  const cap = salaryCap(year + 1, L2);
  const shares = L2.teams.map((_, i) => (cap ? capPayroll(L2.players, i) / cap : 0));
  const cash = w.teams.map((t) => g.cashNow(t.idx));
  const sizes = L2.teams.map((_, i) => L2.players.filter((p) => p.team === i && !isServing(p) && !p.dev).length);
  const retired = (L2.retired ?? []).filter((r) => r.year === year);

  const lines: SeedResult['lines'] = {};
  for (const p of players) {
    const b = B[p.idx]; const q = P[p.idx];
    if (b.pa < 300 && q.outs < 150 && q.sv < 10 && (q.hld ?? 0) < 10) continue;
    lines[`${p.name}(${name(p.teamIdx >= 0 ? p.teamIdx : p.formerTeam ?? -1)})`] = { hr: b.hr, rbi: b.rbi, avg: b.ab ? b.h / b.ab : 0, pa: b.pa, so: q.so, w: q.w, sv: q.sv, hld: q.hld ?? 0, era: q.outs ? (q.er * 27) / q.outs : 0, ip: q.outs / 3 };
  }
  const lpName = new Map(L.players.map((p) => [p.id, p]));
  const faUnsigned = fa.filter((e) => e.status !== 'signed').map((e) => { const p = lpName.get(e.id) ?? store.players.get(e.id); const age = p?.birthYear ? year + 1 - p.birthYear : '?'; return `${p?.name ?? e.id}(${name(e.from)},${e.grade},${age}세,요구 ${Math.round(e.ask / 1000) / 10}억)`; });
  const ci = cash.indexOf(Math.min(...cash));

  return {
    seed, team: name(teamIdx),
    teamW: Object.fromEntries(teams.map((x, i) => [name(i), x.w])), top5, lines, faUnsigned, cashMinTeam: name(ci), stars, info, faLeftBig: fa.filter((e) => e.status !== 'signed' && e.ask >= 50000).length,
    faRescued: fa.filter((e) => e.status === 'left' && (L2.players.find((p) => p.id === e.id)?.team ?? -1) >= 0).length,
    faFree: fa.filter((e) => e.status === 'left' && L2.players.find((p) => p.id === e.id)?.team === -1).length, zeroCash, cashSettle, offersNone: regNews.filter((n) => n.text.includes('통화를 마쳤습니다')).length,
    sd, maxW: Math.max(...teams.map((x) => x.w)), minW: Math.min(...teams.map((x) => x.w)),
    standings: s.standings().map((t) => `${name(t)} ${teams[t].w}-${teams[t].l}-${teams[t].t}`),
    avg, obp, slg, ops: obp + slg, era: (er * 27) / outs, rpg: runs / games, hrPerTeam: hr / teams.length, sbPerTeam: sb / teams.length,
    bbPct: bb / pa, soPct: so / pa,
    titles, mvp: aw?.mvp ? `${aw.mvp.name}(${name(aw.mvp.team)}) ${aw.mvp.line}` : '-', rookie: aw?.rookie ? `${aw.rookie.name}(${name(aw.rookie.team)}) ${aw.rookie.line}` : '-',
    top,
    injuries: inj.length, injMajor: inj.filter((a) => a.kind === 'major').length, injLong: inj.filter((a) => a.kind === 'long').length, injMinor: inj.filter((a) => a.kind === 'minor').length,
    events: abs.filter((a) => a.kind === 'event').length,
    longOut: abs.filter((a) => a.until - a.day >= 30).length, seasonOut: abs.filter((a) => a.until >= len).length,
    newsByKind, eventTitles: evTitles, foreignSwaps, aiTrades, userOffers, devRegistered, devAi,
    champion: ps?.champion != null ? name(ps.champion) : '-', seeds: (ps?.seeds ?? []).map(name),
    trust, fired,
    attendance: { min: Math.min(...att), max: Math.max(...att), mean: att.reduce((a, b) => a + b, 0) / att.length },
    cashMin: Math.min(...cash), cashMax: Math.max(...cash),
    faEntries: fa.length, faMoved: fa.filter((e) => e.status === 'signed' && e.team !== e.from).length,
    faStayed: fa.filter((e) => e.status === 'signed' && e.team === e.from).length, faLeft: fa.filter((e) => e.status !== 'signed').length,
    enlistByTeam, enlistKinds, servingAfter: L2.players.filter(isServing).length - 0 * servingPre.size,
    retired: retired.length, retiredReal: retired.filter((r) => r.real).length,
    growth: {
      n: deltas.length, meanDelta: deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1),
      up5: deltas.filter((x) => x >= 5).length, down5: deltas.filter((x) => x <= -5).length,
      byAge: Object.fromEntries(Object.entries(ages).map(([k2, v]) => [k2, v.reduce((a, b) => a + b, 0) / v.length])),
    },
    capOver: shares.filter((x) => x > 1).length, capShare: { min: Math.min(...shares), max: Math.max(...shares), mean: shares.reduce((a, b) => a + b, 0) / shares.length },
    offLog, rosterSizes: { min: Math.min(...sizes), max: Math.max(...sizes) },
  };
}

// ---- 표 만들기

const f = (x: number, d = 3) => x.toFixed(d);
function stat(xs: number[], d = 3): string {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `${f(m, d)} (${f(Math.min(...xs), d)}~${f(Math.max(...xs), d)})`;
}
function counts(xs: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** 실제 시즌 가치 (WAR 비슷한 값, league/war.ts). 자료가 없으면 null */
function realWar(store: ReturnType<typeof loadDataStore>, id: string, y: number, pitcher: boolean): number | null {
  const sd = store.season(y);
  if (!sd) return null;
  const env = realEnvOf(store, y);
  if (pitcher) {
    const rows = sd.pit.filter((r) => r.id === id);
    return rows.length ? rows.reduce((a, r) => a + pitWarOf(r, env), 0) : null;
  }
  const rows = sd.bat.filter((r) => r.id === id);
  return rows.length ? rows.reduce((a, r) => a + batWarOf(r, r.pos, env), 0) : null;
}

/** 선수별 반복 강세: 시드 n개 중 min번 이상 같은 것을 받은 선수 */
export function repeatStars(rs: SeedResult[], store: ReturnType<typeof loadDataStore>, year: number, min: number): string {
  const ids = [...new Set(rs.flatMap((r) => Object.keys(r.stars)))];
  const rows: { id: string; best: number; text: string; line: string }[] = [];
  for (const id of ids) {
    const c = new Map<string, number>();
    for (const r of rs) for (const f2 of new Set(r.stars[id]?.flags ?? [])) c.set(f2, (c.get(f2) ?? 0) + 1);
    const best = Math.max(...c.values());
    if (best < min) continue;
    const inf = rs.map((r) => r.info[id]).find(Boolean)!;
    const warSeeds = rs.filter((r) => r.stars[id]?.war);
    const simWar = warSeeds.length ? warSeeds.reduce((a, r) => a + r.stars[id].war, 0) / warSeeds.length : 0;
    const pit = inf.kind === '투수';
    const rw = (y: number) => { const v = realWar(store, id, y, pit); return v === null ? '-' : v.toFixed(1); };
    const flags = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
    rows.push({ id, best, text: flags, line: `| ${inf.name} | ${inf.team} | ${inf.age ?? '?'} | ${inf.kind} | ${inf.real ? '실존' : '가상'}${inf.foreign ? '·외국인' : ''} | ${flags} | ${simWar.toFixed(1)} | ${rw(year - 1)} | ${rw(year)} |` });
  }
  rows.sort((a, b) => b.best - a.best || a.id.localeCompare(b.id));
  return ['| 선수 | 구단 | 나이 | 투타 | 구분 | 받은 것 (횟수/' + rs.length + ') | 시뮬 가치 (상위 30 든 시드 평균) | 실제 ' + (year - 1) + ' 가치 | 실제 ' + year + ' 가치 |', '|---|---|---|---|---|---|---|---|---|', ...rows.map((r) => r.line)].join('\n');
}

export function report(rs: SeedResult[], year: number, real?: ReturnType<ReturnType<typeof loadDataStore>['season']>): string {
  const out: string[] = [];
  const n = rs.length;
  out.push(`시드 ${n}개: ${rs.map((r) => r.seed).join(', ')} · 우리 구단 ${rs[0].team} (AI 운영)\n`);
  out.push('### 정규시즌 리그 지표 (평균, 범위)\n');
  out.push('| 지표 | 값 |', '|---|---|');
  const rows: [string, (r: SeedResult) => number, number][] = [
    ['승률 표준편차', (r) => r.sd, 3], ['최다 승', (r) => r.maxW, 1], ['최소 승', (r) => r.minW, 1],
    ['타율', (r) => r.avg, 3], ['출루율', (r) => r.obp, 3], ['장타율', (r) => r.slg, 3], ['OPS', (r) => r.ops, 3], ['평균자책', (r) => r.era, 2],
    ['팀 경기당 득점', (r) => r.rpg, 2], ['팀당 홈런', (r) => r.hrPerTeam, 1], ['팀당 도루', (r) => r.sbPerTeam, 1], ['볼넷%', (r) => r.bbPct * 100, 1], ['삼진%', (r) => r.soPct * 100, 1],
  ];
  for (const [k, fn, d] of rows) out.push(`| ${k} | ${stat(rs.map(fn), d)} |`);
  out.push('', '### 개인 1위 수치 (평균, 범위)\n', '| 부문 | 값 |', '|---|---|');
  for (const k of ['hr', 'rbi', 'avg', 'w', 'sv', 'so', 'era', 'hld'] as const) out.push(`| ${k} | ${stat(rs.map((r) => r.top[k]), k === 'avg' ? 3 : k === 'era' ? 2 : 1)} |`);
  out.push('', '### 타이틀·시상 수상자 (시드별, 반복 횟수)\n', '| 부문 | 수상자 (횟수/시드) |', '|---|---|');
  const labels = [...new Set(rs.flatMap((r) => Object.keys(r.titles)))];
  for (const l of labels) out.push(`| ${l} | ${counts(rs.map((r) => (r.titles[l] ? `${r.titles[l].name}(${r.titles[l].team}) ${r.titles[l].value}` : '-'))).map(([k2, c]) => `${k2} ×${c}`).join(' / ')} |`);
  out.push(`| MVP | ${counts(rs.map((r) => r.mvp)).map(([k2, c]) => `${k2} ×${c}`).join(' / ')} |`);
  out.push(`| 신인상 | ${counts(rs.map((r) => r.rookie)).map(([k2, c]) => `${k2} ×${c}`).join(' / ')} |`);
  out.push('', '### 순위·가을야구\n', '| 시드 | 1위 | 꼴찌 | 우승 | 진출 |', '|---|---|---|---|---|');
  for (const r of rs) out.push(`| ${r.seed} | ${r.standings[0]} | ${r.standings[r.standings.length - 1]} | ${r.champion} | ${r.seeds.join(', ')} |`);
  const firsts = counts(rs.map((r) => r.standings[0].split(' ')[0]));
  const lasts = counts(rs.map((r) => r.standings[r.standings.length - 1].split(' ')[0]));
  const champs = counts(rs.map((r) => r.champion));
  out.push('', `1위 횟수: ${firsts.map(([k2, c]) => `${k2} ${c}`).join(', ')} · 꼴찌: ${lasts.map(([k2, c]) => `${k2} ${c}`).join(', ')} · 우승: ${champs.map(([k2, c]) => `${k2} ${c}`).join(', ')}`);
  // 구단별 평균 승 (실제 시즌과 비교)
  out.push('', '### 구단별 승 (시뮬 평균·범위, 실제)\n', '| 구단 | 시뮬 승 | 실제 승 (경기) |', '|---|---|---|');
  const realW = new Map((real?.teams ?? []).map((t) => [t.name, `${t.w} (${t.g})`]));
  const tnames = Object.keys(rs[0].teamW).sort((a, b) => sumBy(rs, (r) => r.teamW[b]) - sumBy(rs, (r) => r.teamW[a]));
  for (const t of tnames) out.push(`| ${t} | ${stat(rs.map((r) => r.teamW[t]), 1)} | ${realW.get(t) ?? '-'} |`);
  // 구단별 이닝 상위 5명 비중 (실제는 그 해 기록의 구단 열)
  const realOuts = new Map<string, number[]>();
  for (const r of real?.pit ?? []) { if (r.outs > 0) { const v = realOuts.get(r.team) ?? []; v.push(r.outs); realOuts.set(r.team, v); } }
  const realTop5 = new Map([...realOuts].map(([t, v]) => [t, topShare(v, 5)]));
  out.push('', '### 구단별 이닝 상위 5명 비중 (시뮬 평균·범위, 실제)\n', '| 구단 | 시뮬 | 실제 |', '|---|---|---|');
  for (const t of tnames) out.push(`| ${t} | ${stat(rs.map((r) => r.top5[t]), 3)} | ${realTop5.has(t) ? realTop5.get(t)!.toFixed(3) : '-'} |`);
  const rt = [...realTop5.values()];
  out.push(`| 리그 평균 | ${stat(rs.map((r) => Object.values(r.top5).reduce((a, b) => a + b, 0) / Object.values(r.top5).length), 3)} | ${rt.length ? (rt.reduce((a, b) => a + b, 0) / rt.length).toFixed(3) : '-'} |`);
  // 선수별 반복 상위 (부문마다 시드 평균 상위 6명과 1위 횟수)
  out.push('', '### 선수별 주요 기록 (시드 평균 상위, 괄호는 1위 횟수)\n', '| 부문 | 선수: 평균 (1위 횟수) |', '|---|---|');
  type Line = SeedResult['lines'][string];
  type K = keyof Line;
  const cats: [string, K, boolean, (l: Line) => boolean][] = [
    ['홈런', 'hr', false, () => true], ['타점', 'rbi', false, () => true], ['타율 (446타석+)', 'avg', false, (l) => l.pa >= 446],
    ['다승', 'w', false, () => true], ['탈삼진', 'so', false, () => true], ['평균자책 (144이닝+)', 'era', true, (l) => l.ip >= 144], ['세이브', 'sv', false, () => true], ['홀드', 'hld', false, () => true],
  ];
  const allNames = [...new Set(rs.flatMap((r) => Object.keys(r.lines)))];
  for (const [label, k, low, ok] of cats) {
    const vals = (nm: string) => rs.map((r) => r.lines[nm]).filter((l): l is Line => !!l && ok(l)).map((l) => l[k]);
    // 낮을수록 좋은 부문(평균자책)은 자격을 채운 시즌만 평균, 나머지는 시드 수로 나눈다 (못 뛴 시즌 = 0)
    const mean = (nm: string) => { const v = vals(nm); return low ? (v.length >= rs.length / 2 ? v.reduce((a, b) => a + b, 0) / v.length : 99) : v.reduce((a, b) => a + b, 0) / rs.length; };
    const firsts = new Map<string, number>();
    for (const r of rs) {
      const c = Object.entries(r.lines).filter(([, l]) => ok(l)).sort((a, b) => (low ? a[1][k] - b[1][k] : b[1][k] - a[1][k]))[0];
      if (c) firsts.set(c[0], (firsts.get(c[0]) ?? 0) + 1);
    }
    const best = allNames.filter((nm) => vals(nm).length).sort((a, b) => (low ? mean(a) - mean(b) : mean(b) - mean(a))).slice(0, 6);
    const d = k === 'avg' ? 3 : k === 'era' ? 2 : 1;
    out.push(`| ${label} | ${best.map((nm) => `${nm} ${mean(nm).toFixed(d)} (${firsts.get(nm) ?? 0})`).join(', ')} |`);
  }
  out.push('', '### 결장·이벤트·알림 (평균, 범위)\n', '| 지표 | 값 |', '|---|---|');
  const r2: [string, (r: SeedResult) => number][] = [
    ['부상 (전체)', (r) => r.injuries], ['큰 부상', (r) => r.injMajor], ['긴 부상', (r) => r.injLong], ['작은 부상', (r) => r.injMinor], ['이탈 이벤트', (r) => r.events],
    ['30일 이상 결장', (r) => r.longOut], ['시즌 아웃', (r) => r.seasonOut], ['외국인 교체 (AI)', (r) => r.foreignSwaps], ['AI 육성선수 (개막)', (r) => r.devAi ?? 0], ['그중 5월 1일 정식 등록', (r) => r.devRegistered ?? 0], ['AI끼리 트레이드 알림', (r) => r.aiTrades], ['우리에게 온 트레이드 제안', (r) => r.userOffers], ['그중 제안 없음(통화만)', (r) => r.offersNone],
  ];
  for (const [k2, fn] of r2) out.push(`| ${k2} | ${stat(rs.map(fn), 1)} |`);
  const kinds = [...new Set(rs.flatMap((r) => Object.keys(r.newsByKind)))];
  for (const k2 of kinds) out.push(`| 알림 ${k2} | ${stat(rs.map((r) => r.newsByKind[k2] ?? 0), 1)} |`);
  out.push('', '### 무작위 이벤트 (우리 구단, 종류별 10시드 합계와 나온 시드 수)\n', '| 이벤트 | 합계 | 나온 시드 | 한 시즌 최다 |', '|---|---|---|---|');
  const evs = [...new Set(rs.flatMap((r) => Object.keys(r.eventTitles)))];
  const evRows = evs.map((e) => ({ e, total: sumBy(rs, (r) => r.eventTitles[e] ?? 0), seeds: rs.filter((r) => r.eventTitles[e]).length, max: Math.max(...rs.map((r) => r.eventTitles[e] ?? 0)) }))
    .sort((a, b) => b.total - a.total);
  for (const x of evRows) out.push(`| ${x.e} | ${x.total} | ${x.seeds}/${n} | ${x.max} |`);
  out.push(`\n시즌당 이벤트 합계: ${stat(rs.map((r) => sumBy(Object.values(r.eventTitles), (v) => v)), 1)}, 종류 수 ${evs.length}`);
  out.push('', '### 구단주·재정\n', '| 지표 | 값 |', '|---|---|');
  out.push(`| 구단주 신뢰 (우리) | ${stat(rs.map((r) => r.trust), 1)} |`, `| 해고 | ${rs.filter((r) => r.fired).length}/${n} |`);
  out.push(`| 홈 경기 평균 관중 (구단 평균) | ${stat(rs.map((r) => r.attendance.mean), 0)} |`, `| 관중 최소 구단 | ${stat(rs.map((r) => r.attendance.min), 0)} |`, `| 관중 최다 구단 | ${stat(rs.map((r) => r.attendance.max), 0)} |`);
  out.push(`| 개막 직전 자금 최소 (만 원) | ${stat(rs.map((r) => r.cashMin), 0)} |`, `| 자금 최대 | ${stat(rs.map((r) => r.cashMax), 0)} |`);
  out.push(`| 다음 해 캡 초과 구단 | ${stat(rs.map((r) => r.capOver), 1)} |`, `| 캡 대비 연봉 (평균 구단) | ${stat(rs.map((r) => r.capShare.mean * 100), 0)}% |`, `| 캡 대비 최대 구단 | ${stat(rs.map((r) => r.capShare.max * 100), 0)}% |`, `| 캡 대비 최소 구단 | ${stat(rs.map((r) => r.capShare.min * 100), 0)}% |`);
  out.push('', '### 첫 오프시즌\n', '| 지표 | 값 |', '|---|---|');
  const r3: [string, (r: SeedResult) => number][] = [
    ['FA 신청', (r) => r.faEntries], ['FA 이적', (r) => r.faMoved], ['FA 잔류', (r) => r.faStayed], ['FA 미계약', (r) => r.faLeft], ['그중 요구 5억+', (r) => r.faLeftBig], ['그중 2차 드래프트·육성선수로', (r) => r.faRescued ?? 0], ['그중 시즌 중 자유계약으로', (r) => r.faFree ?? 0],
    ['입대 (리그 합)', (r) => sumBy(r.enlistByTeam, (x) => x)], ['입대 최다 구단', (r) => Math.max(...r.enlistByTeam)], ['입대 최소 구단', (r) => Math.min(...r.enlistByTeam)],
    ['입대: 군 야구단', (r) => r.enlistKinds?.unit ?? 0], ['입대: 현역', (r) => r.enlistKinds?.active ?? 0], ['입대: 보충역', (r) => r.enlistKinds?.reserve ?? 0], ['복무 중 (개막 직전)', (r) => r.servingAfter],
    ['은퇴', (r) => r.retired], ['은퇴 (실존)', (r) => r.retiredReal],
    ['성장 평균 (런)', (r) => r.growth.meanDelta], ['+5런 이상', (r) => r.growth.up5], ['-5런 이하', (r) => r.growth.down5],
    ['소속 인원 최소', (r) => r.rosterSizes.min], ['소속 인원 최대', (r) => r.rosterSizes.max],
  ];
  for (const [k2, fn] of r3) out.push(`| ${k2} | ${stat(rs.map(fn), 2)} |`);
  const ageKeys = ['~22', '23-25', '26-29', '30-32', '33-35', '36~'];
  for (const a of ageKeys) out.push(`| 성장 ${a}세 평균 | ${stat(rs.map((r) => r.growth.byAge[a] ?? 0), 2)} |`);
  out.push('', `결산 직후 자금 0 이하 구단 수: ${stat(rs.map((r) => r.zeroCash.length), 1)} · 구단별 횟수: ${counts(rs.flatMap((r) => r.zeroCash)).map(([k2, c]) => `${k2} ${c}`).join(', ')}`);
  out.push('', `결산 직후 자금 평균 (억 원): ${Object.keys(rs[0].cashSettle).map((t) => `${t} ${(sumBy(rs, (r) => r.cashSettle[t]) / rs.length).toFixed(0)}`).join(', ')}`);
  out.push('', `자금 최소 구단: ${counts(rs.map((r) => r.cashMinTeam)).map(([k2, c]) => `${k2} ${c}`).join(', ')}`);
  out.push('', `FA 미계약 (시드마다): ${rs.map((r) => `${r.seed}: ${r.faUnsigned.join(', ')}`).join(' / ')}`);
  out.push('', `입대 구단별 (시드마다): ${rs.map((r) => r.enlistByTeam.join('·')).join(' / ')}`);
  void year;
  return out.join('\n');
}

async function main(): Promise<void> {
  const year = Number(arg('year', '2026'));
  const team = Number(arg('team', '0'));
  const basis = arg('basis', 'season') as 'season' | 'prior';
  const nSeeds = Number(arg('n', '10'));
  const seeds = (arg('seeds') ?? Array.from({ length: nSeeds }, (_, i) => `s${String(i + 1).padStart(2, '0')}`).join(',')).split(',');
  const store = loadDataStore();
  // --no-traits: 숨겨진 특수능력을 모두 끄고 잰다 (효과 크기 점검용 A/B. 누가 가졌는지는 출력하지 않는다)
  if (process.argv.includes('--no-traits')) store.traits = {};
  const rs: SeedResult[] = [];
  for (const sd of seeds) {
    const t0 = Date.now();
    const r = runSeed(store, year, team, sd, basis);
    rs.push(r);
    console.error(`[${sd}] ${((Date.now() - t0) / 1000).toFixed(1)}초 · 1위 ${r.standings[0]} · MVP ${r.mvp} · 우승 ${r.champion}`);
  }
  const text = `## ${year} 첫 시즌 (${new Date().toISOString().slice(0, 10)})\n\n${report(rs, year, store.season(year))}\n`
    + `\n### 선수별 반복 강세 (${Math.ceil(rs.length * 0.7)}번 이상)\n\n가치10·가치30 = 시즌 가치(WAR 비슷한 값) 리그 상위 10위·30위 안. 시뮬 가치는 상위 30위 안에 든 시드의 평균. 실제 가치는 같은 계산(league/war.ts)을 실제 기록에 쓴 값.\n\n`
    + `${repeatStars(rs, store, year, Math.ceil(rs.length * 0.7))}\n`;
  const out = arg('out');
  const json = arg('json');
  if (json) { mkdirSync(dirname(json), { recursive: true }); writeFileSync(json, JSON.stringify(rs, null, 1)); }
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text); console.error(`${out}에 썼습니다.`); } else console.log(text);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/first_season.ts')) void main();
