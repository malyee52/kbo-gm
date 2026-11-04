// 100시즌 평가 점수표: tools/eval100.ts가 남긴 판(JSON)들을 읽어 평가 항목 100개의 값과 점수를 낸다.
//
// 사용법:  npx tsx tools/eval100_score.ts reports/eval100/raw/*.json [--out reports/eval100.md] [--doc docs/평가100.md] [--json reports/eval100/scores.json]
//
// 점수: 기준 범위 [lo, hi] 안이면 10점, 벗어나면 벗어난 거리 ÷ tol 만큼 깎아 0점까지 (선형).
// 항목 정의·기준·근거는 아래 ITEMS 한 곳에 있고, --doc가 docs/평가100.md 항목 표를 여기서 만든다 (문서와 셈이 어긋나지 않게).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PlayerRec, SeasonRow, YearRow } from './eval100';

interface Run {
  file: string;
  meta: { team: string; real?: boolean; teamIdx: number; focus: number; seed: string; start: number; seasons: number; wanted: number; secs: number; teams: string[] };
  years: YearRow[];
  players: Record<string, PlayerRec>;
  mgr: [number, number][];
  ownerHist: [number, number, number, number][];
  errors: string[];
}

// ---- 셈 도우미 (판 하나)

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const S = { year: 0, team: 1, war: 2, pa: 3, outs: 4, hr: 5, w: 6, sv: 7, age: 8, so: 9, hld: 10 } as const;

interface Ctx {
  r: Run; Y: YearRow[]; n: number; per100: number; teams: number; end: number; start: number;
  P: (PlayerRec & { id: string })[];
  /** 게임 안에서 입단한 국내 선수 (커리어 전체가 게임 안) */
  G: (PlayerRec & { id: string })[];
  /** 그중 은퇴한 선수 */
  GR: (PlayerRec & { id: string })[];
  rows: { p: PlayerRec; s: SeasonRow }[];
}

function ctxOf(r: Run): Ctx {
  const Y = r.years;
  const P = Object.entries(r.players).map(([id, p]) => ({ ...p, id }));
  const G = P.filter((p) => p.entry >= r.meta.start && !p.foreign);
  return {
    r, Y, n: Y.length, per100: 100 / Math.max(1, Y.length), teams: r.meta.teams.length, start: r.meta.start, end: Y.at(-1)?.y ?? r.meta.start,
    P, G, GR: G.filter((p) => p.retired !== undefined), rows: P.flatMap((p) => p.s.map((s) => ({ p, s }))),
  };
}

const careerWar = (p: PlayerRec) => sum(p.s.map((s) => s[S.war]));
const byTeam = (p: PlayerRec) => {
  const m = new Map<number, { seasons: number; war: number }>();
  for (const s of p.s) { const x = m.get(s[S.team]) ?? { seasons: 0, war: 0 }; x.seasons++; x.war += s[S.war]; m.set(s[S.team], x); }
  return m;
};
const franchiseStars = (c: Ctx, team?: number) => c.P.filter((p) => [...byTeam(p)].some(([t, x]) => (team === undefined || t === team) && t >= 0 && x.seasons >= 8 && x.war >= 20));
const yearsOf = (c: Ctx, from: number, to: number) => c.Y.filter((y) => y.y - c.start >= from && y.y - c.start <= to);
function spearman(a: number[], b: number[]): number {
  const n = a.length; let d = 0;
  for (let i = 0; i < n; i++) d += (a[i] - b[i]) ** 2;
  return 1 - (6 * d) / (n * (n * n - 1));
}
function gini(xs: number[]): number {
  const v = xs.map((x) => Math.max(0, x)).sort((a, b) => a - b); const n = v.length; const s = sum(v);
  if (!s) return 0;
  return sum(v.map((x, i) => (2 * (i + 1) - n - 1) * x)) / (n * s);
}
const pct = (y: YearRow, t: number) => y.w[t] / Math.max(1, y.w[t] + y.l[t]);

// ---- 항목

interface Item {
  id: string; cat: string; name: string;
  /** 무엇을 재는지 */
  how: string;
  lo: number; hi: number; tol: number;
  /** 기준의 근거. [근거 약함]이면 weak */
  basis: string; weak?: boolean;
  /** 낮을 때 짐작하는 원인 자리 */
  where?: string;
  /** 구단에 따라 달라지는 항목 (플레이어 구단 기준) */
  team?: boolean;
  fmt?: (v: number) => string;
  f: (c: Ctx) => number;
}

const f2 = (v: number) => v.toFixed(2);
const f1 = (v: number) => v.toFixed(1);
const f3 = (v: number) => v.toFixed(3);
const pc = (v: number) => `${(v * 100).toFixed(1)}%`;

export const CATS: Record<string, string> = {
  A: '프랜차이즈 스타의 탄생과 생존', B: '유망주·성장 (역대급 유망주)', C: '노화·은퇴', D: '기록·칭호 분포', E: '경기 결과·리그 평균',
  F: '팀 격차·왕조', G: '재정·자본 흐름의 용이성', H: '연봉·FA·계약', I: '트레이드·AI 판단', J: '드래프트·신인', K: '외국인·아시아쿼터',
  L: '병역', M: '부상·사건', N: '투수 운용', O: '구단주·감독', P: '시장·방출', Q: '리그 구성·선수층', R: '진행 안정',
};

export const ITEMS: Item[] = [
  // A 프랜차이즈 스타
  { id: 'A1', cat: 'A', name: '프랜차이즈 스타 수 (리그)', how: '한 구단에서 8시즌 이상·그 구단 WAR 20 이상인 선수 수, 구단당 100시즌 환산', lo: 25, hi: 55, tol: 15, fmt: f1,
    basis: '실제 1982~2025 같은 셈 41.2 (구단당 100년 환산)', where: 'league/salary.ts FA·재계약, league/careers.ts 은퇴',
    f: (c) => (franchiseStars(c).length / c.teams) * c.per100 },
  { id: 'A2', cat: 'A', name: '프랜차이즈 스타 수 (우리 구단)', how: 'A1과 같은 셈, 처음 맡은 구단만, 100시즌 환산', lo: 25, hi: 55, tol: 15, fmt: f1, team: true,
    basis: 'A1과 같음', weak: true, where: '대리 단장 FA 재계약 규칙(tools/eval100.ts faRound), offseason.ts FA',
    f: (c) => franchiseStars(c, c.r.meta.focus).length * c.per100 },
  { id: 'A3', cat: 'A', name: '프랜차이즈 스타 생존율', how: '29세까지 한 구단에서 5시즌·WAR 12 이상 쌓은 선수가 33세 시즌(그 전에 은퇴하면 마지막 시즌)을 같은 구단에서 보낸 비율', lo: 0.45, hi: 0.8, tol: 0.25, fmt: pc,
    basis: '실제 1982~2025 같은 셈 53.7%·2015~2025 66.7%', where: 'offseason.ts FA 잔류 판단(FA_WILLINGNESS), ai/trade.ts',
    f: (c) => {
      let n = 0, ok = 0;
      for (const p of c.P) {
        if (!p.birth || p.foreign) continue;
        const young = p.s.filter((s) => s[S.age] >= 0 && s[S.age] <= 29);
        const main = [...byTeam({ ...p, s: young })].find(([t, x]) => t >= 0 && x.seasons >= 5 && x.war >= 12);
        if (!main) continue;
        const later = p.s.filter((s) => s[S.age] >= 30 && s[S.age] <= 33);
        const at33 = later.find((s) => s[S.age] === 33) ?? (p.retired !== undefined ? (later.at(-1) ?? young.at(-1)) : undefined);
        if (!at33) continue;
        n++; if (at33[S.team] === main[0]) ok++;
      }
      return n ? ok / n : NaN;
    } },
  { id: 'A4', cat: 'A', name: '원클럽맨 비율', how: '게임 안에서 입단해 은퇴한 통산 WAR 20 이상 선수 가운데 한 구단에서만 뛴 비율', lo: 0.25, hi: 0.5, tol: 0.2, fmt: pc,
    basis: '실제 1982~2025 같은 셈 37.0% (마지막 시즌이 2022 전이면 은퇴로 봄)', where: 'ai/trade.ts 트레이드 대상, offseason.ts FA',
    f: (c) => { const xs = c.GR.filter((p) => careerWar(p) >= 20); return xs.length ? xs.filter((p) => byTeam(p).size === 1).length / xs.length : NaN; } },
  { id: 'A5', cat: 'A', name: '스타 FA 이적률', how: 'FA 신청자 중 리그 상위 5% 기여 선수가 다른 구단과 계약한 비율', lo: 0.2, hi: 0.5, tol: 0.25, fmt: pc,
    basis: '2015~2025 대형 FA(양의지·김현수·최정·박병호 등) 이적은 셋 중 하나꼴', weak: true, where: 'offseason.ts resolveFaRound·FA_WILLINGNESS',
    f: (c) => { const st = sum(c.Y.map((y) => y.fa.star)); return st ? sum(c.Y.map((y) => y.fa.starMoved)) / st : NaN; } },
  { id: 'A6', cat: 'A', name: '스타 전성기 길이', how: 'WAR 4 이상 시즌이 3번 이상인 게임 안 입단 은퇴 선수의 WAR 4 이상 시즌 수 평균', lo: 4, hi: 7, tol: 3, fmt: f1,
    basis: '실제 1982~2025 같은 셈 5.2', where: 'league/growth.ts 노화(DECLINE_START_AGE), branches.ts',
    f: (c) => mean(c.GR.map((p) => p.s.filter((s) => s[S.war] >= 4).length).filter((k) => k >= 3)) },
  { id: 'A7', cat: 'A', name: '구단당 그 해 스타 수', how: '그 해 WAR 4 이상 선수 수 ÷ 구단 수 (해마다 평균)', lo: 2.6, hi: 3.8, tol: 1.5, fmt: f2,
    basis: '실제 같은 셈 1982~2025 3.22·2015~2025 3.26', where: 'engine 능력 분포·환경 맞춤, league/potential.ts',
    f: (c) => mean(c.Y.map((y) => c.rows.filter((x) => x.s[S.year] === y.y && x.s[S.war] >= 4).length / c.teams)) },
  { id: 'A8', cat: 'A', name: '레전드 칭호 새 주인', how: '게임 안에서 새로 레전드 칭호를 얻은 선수 수, 100시즌 환산', lo: 3, hi: 30, tol: 15, fmt: f1,
    basis: '야구 게임 상식: 100년이면 구단마다 레전드가 한둘은 나와야 기억할 이야기가 생긴다', weak: true, where: 'league/titles.ts LEGEND_RULES',
    // legendsNew는 플레이어가 정하는 '구단 레전드'(league.legends)라 대리 단장 판에서는 늘 0이다. 레전드 칭호는 league.titles의 'L:' 키(legendTitles, 2026-11-04 더함). 칸이 없는 옛 판은 잴 수 없음.
    f: (c) => (c.Y.every((y) => y.legendTitles !== undefined) ? sum(c.Y.map((y) => y.legendTitles!)) * c.per100 : NaN) },
  // B 유망주·성장
  { id: 'B1', cat: 'B', name: '역대급 유망주의 탄생', how: '24세 이하 시즌에 WAR 7 이상을 낸 선수 수 (서로 다른 선수), 100시즌 환산', lo: 35, hi: 75, tol: 25, fmt: f1,
    basis: '실제 같은 셈 1982~2025 61.4·2015~2025 45.5 (100년 환산, 게임 WAR 식이 스탯티즈보다 약 1.3배 커서 7WAR가 흔함)', where: 'league/potential.ts 천장·성장 여유분(params.potential.room), offseason.ts 가상 신인',
    f: (c) => c.P.filter((p) => p.s.some((s) => s[S.age] >= 0 && s[S.age] <= 24 && s[S.war] >= 7)).length * c.per100 },
  { id: 'B2', cat: 'B', name: '즉시 전력 신인', how: '1군 첫 두 시즌 안에 WAR 3 이상을 낸 국내 선수 시즌 수, 10시즌당', lo: 6, hi: 16, tol: 8, fmt: f1,
    basis: '실제 같은 셈 2015~2025 10.9 (1982~2025는 초창기 몫으로 55)', where: 'league/potential.ts 시작 능력(학력 시작 식)',
    f: (c) => c.G.reduce((a, p) => a + p.s.slice(0, 2).filter((s) => s[S.war] >= 3).length, 0) / c.n * 10 },
  { id: 'B3', cat: 'B', name: '최상위 유망주 성공률', how: '입단 해 잠재(숨은 값) 상위 10% 국내 신인 가운데 통산 WAR 10 이상이 된 비율 (입단 15년이 지난 선수만)', lo: 0.25, hi: 0.6, tol: 0.25, fmt: pc,
    basis: '야구 게임 상식: 최고 유망주의 절반쯤은 주전급이 되고 나머지는 꺾여야 스카우트가 의미 있다', weak: true, where: 'league/potential.ts·branches.ts 갈래 성장',
    f: (c) => {
      const pool = c.G.filter((p) => p.entry <= c.end - 15);
      const byEntry = new Map<number, typeof pool>();
      for (const p of pool) (byEntry.get(p.entry) ?? byEntry.set(p.entry, []).get(p.entry)!).push(p);
      let n = 0, ok = 0;
      for (const xs of byEntry.values()) {
        const top = [...xs].sort((a, b) => b.pot0 - a.pot0).slice(0, Math.max(1, Math.round(xs.length * 0.1)));
        for (const p of top) { n++; if (careerWar(p) >= 10) ok++; }
      }
      return n ? ok / n : NaN;
    } },
  { id: 'B4', cat: 'B', name: '리그 최고 WAR (가상 선수 시대)', how: '그 해 WAR 1위 값, 마지막 50시즌 평균', lo: 7.5, hi: 10, tol: 2.5, fmt: f2,
    basis: '실제 같은 셈 1982~2025 9.48·2015~2025 8.72', where: 'league/potential.ts draftScale, growth.ts',
    f: (c) => mean(c.Y.filter((y) => y.y > c.end - 50).map((y) => Math.max(...c.rows.filter((x) => x.s[S.year] === y.y).map((x) => x.s[S.war])))) },
  { id: 'B5', cat: 'B', name: '전성기 나이', how: '게임 안 입단 통산 WAR 15 이상 선수의 최고 WAR 시즌 나이 평균', lo: 26.5, hi: 29, tol: 2, fmt: f1,
    basis: '실제 같은 셈 1982~2025 27.6', where: 'params.growth2 나이 곡선, DECLINE_START_AGE',
    f: (c) => mean(c.G.filter((p) => careerWar(p) >= 15 && p.birth).map((p) => [...p.s].sort((a, b) => b[S.war] - a[S.war])[0][S.age])) },
  { id: 'B6', cat: 'B', name: '어린 주전 비율', how: '400타석 또는 100이닝 시즌 가운데 23세 이하 선수 시즌 비율', lo: 0.09, hi: 0.16, tol: 0.06, fmt: pc,
    basis: '실제 같은 셈 1982~2025 14.8%·2015~2025 11.4%', where: 'league/potential.ts 시작 능력, team.ts 기용',
    f: (c) => { const q = c.rows.filter((x) => x.s[S.pa] >= 400 || x.s[S.outs] >= 300); return q.filter((x) => x.s[S.age] >= 0 && x.s[S.age] <= 23).length / Math.max(1, q.length); } },
  { id: 'B7', cat: 'B', name: '늦게 피는 선수', how: 'WAR 3 이상 시즌이 있는 게임 안 입단 선수 가운데 첫 3WAR 시즌이 28세 이상인 비율', lo: 0.1, hi: 0.3, tol: 0.15, fmt: pc,
    basis: '실제 같은 셈 1982~2025 26.3%·2015~2025 10.2%', where: 'league/potential.ts 시기 τ(timing)',
    f: (c) => { const xs = c.G.filter((p) => p.birth && p.s.some((s) => s[S.war] >= 3)); return xs.length ? xs.filter((p) => p.s.find((s) => s[S.war] >= 3)![S.age] >= 28).length / xs.length : NaN; } },
  // C 노화·은퇴
  { id: 'C1', cat: 'C', name: '은퇴 나이 (주전급)', how: '통산 WAR 5 이상(게임 안 기록) 은퇴 선수의 은퇴 나이 평균', lo: 34, hi: 37, tol: 2.5, fmt: f1,
    basis: '실제 같은 셈 1982~2025 35.3 (마지막 시즌 나이 + 1)', where: 'league/careers.ts 은퇴 확률표',
    f: (c) => mean(c.P.filter((p) => p.retired !== undefined && p.retAge && careerWar(p) >= 5).map((p) => p.retAge!)) },
  { id: 'C2', cat: 'C', name: '40세 이상 1군 선수', how: '그 해 40세 이상 1군 선수 수 (해마다 평균)', lo: 2, hi: 7, tol: 4, fmt: f1,
    basis: '실제 같은 셈 1982~2025 2.4·2015~2025 5.7', where: 'league/careers.ts 은퇴, growth.ts 노화',
    f: (c) => mean(c.Y.map((y) => c.rows.filter((x) => x.s[S.year] === y.y && x.s[S.age] >= 40).length)) },
  { id: 'C3', cat: 'C', name: '구단당 해마다 떠나는 선수', how: '그 해가 1군 마지막 시즌인 선수 수 ÷ 구단 (첫 해와 끝 3시즌 빼고). 은퇴 기록(league.retired)은 은퇴 판정만 담아 방출 뒤 사라지는 선수가 빠지므로 1군 마지막 시즌으로 센다', lo: 7, hi: 11, tol: 4, fmt: f1,
    basis: '실제 같은 셈 2015~2025 9.7 (은퇴·방출·해외)', where: 'league/careers.ts 은퇴, offseason.ts releaseOrder',
    f: (c) => { const last = new Map<number, number>(); for (const p of c.P) { const y = p.s.at(-1)?.[S.year]; if (y !== undefined) last.set(y, (last.get(y) ?? 0) + 1); } return mean(c.Y.slice(1, -3).map((y) => (last.get(y.y) ?? 0) / c.teams)); } },
  { id: 'C4', cat: 'C', name: '35세 이상 WAR 몫', how: '양(+) WAR 합 가운데 35세 이상 시즌의 몫', lo: 0.07, hi: 0.14, tol: 0.06, fmt: pc,
    basis: '실제 같은 셈 1982~2025 8.4%·2015~2025 12.5%', where: 'DECLINE_START_AGE·ai/value.ts DECLINE_*',
    f: (c) => { const pos = c.rows.filter((x) => x.s[S.war] > 0 && x.s[S.age] >= 0); return sum(pos.filter((x) => x.s[S.age] >= 35).map((x) => x.s[S.war])) / Math.max(1e-9, sum(pos.map((x) => x.s[S.war]))); } },
  { id: 'C5', cat: 'C', name: '최고령 1군 선수 나이', how: '그 해 1군 최고령 나이 (해마다 평균)', lo: 40, hi: 44, tol: 3, fmt: f1,
    basis: '실제 같은 셈 1982~2025 40.1·2015~2025 41.6', where: 'league/careers.ts',
    f: (c) => mean(c.Y.map((y) => Math.max(...c.rows.filter((x) => x.s[S.year] === y.y).map((x) => x.s[S.age])))) },
  // D 기록·칭호
  { id: 'D1', cat: 'D', name: '홈런왕 홈런 수', how: '그 해 최다 홈런 (평균)', lo: 33, hi: 48, tol: 10, fmt: f1, basis: '실제 같은 셈 1982~2025 35.5·2015~2025 41.8', where: 'engine 환경 맞춤·futureRules 반발계수',
    f: (c) => mean(c.Y.map((y) => y.lead.hr)) },
  { id: 'D2', cat: 'D', name: '50홈런 시즌', how: '50홈런 이상 선수 시즌 수, 100시즌 환산', lo: 4, hi: 25, tol: 15, fmt: f1, basis: '실제 같은 셈 1982~2025 13.6·2015~2025 18.2 (100년 환산)', where: 'params.seasonForm, futureRules ballHrMul',
    f: (c) => sum(c.Y.map((y) => y.cnt.hr50)) * c.per100 },
  { id: 'D3', cat: 'D', name: '타격왕 타율', how: '그 해 규정타석 타율 1위 (평균)', lo: 0.34, hi: 0.372, tol: 0.025, fmt: f3, basis: '실제 같은 셈 1982~2025 .355·2015~2025 .358', where: 'engine/plate.ts·angle.ts 퍼짐',
    f: (c) => mean(c.Y.map((y) => y.lead.avg)) },
  { id: 'D4', cat: 'D', name: '4할 타자', how: '규정타석 4할 시즌 수, 100시즌 환산', lo: 0, hi: 3, tol: 5, fmt: f1, basis: '실제 1982~2025 1번(백인천 1982) → 100년 2.3', where: 'engine 퍼짐',
    f: (c) => sum(c.Y.map((y) => y.cnt.avg400)) * c.per100 },
  { id: 'D5', cat: 'D', name: '20승 투수', how: '20승 이상 투수 수 (해마다 평균)', lo: 0.2, hi: 1.0, tol: 0.8, fmt: f2, basis: '실제 같은 셈 1982~2025 0.50·2015~2025 0.55', where: 'manager.ts 선발 차례·mgr.aceDays',
    f: (c) => mean(c.Y.map((y) => y.cnt.w20)) },
  { id: 'D6', cat: 'D', name: '탈삼진왕 탈삼진', how: '그 해 최다 탈삼진 (평균)', lo: 175, hi: 230, tol: 50, fmt: f1, basis: '실제 같은 셈 1982~2025 189·2015~2025 202', where: 'engine/plate.ts, manager.ts 투구 수',
    f: (c) => mean(c.Y.map((y) => y.lead.so)) },
  { id: 'D7', cat: 'D', name: '세이브왕 세이브', how: '그 해 최다 세이브 (평균)', lo: 30, hi: 42, tol: 10, fmt: f1, basis: '실제 같은 셈 1982~2025 32.0·2015~2025 36.7', where: 'manager.ts 마무리 기용(CLOSER_AVAILABLE_EXTRA)',
    f: (c) => mean(c.Y.map((y) => y.lead.sv)) },
  { id: 'D8', cat: 'D', name: '통산 400홈런 (게임 안 입단)', how: '게임 안 입단 선수 통산 400홈런 수, 100시즌 환산', lo: 4, hi: 14, tol: 8, fmt: f1, basis: '실제 같은 셈 1982~2025 9.1 (100년 환산)', where: 'league/careers.ts 은퇴, growth.ts',
    f: (c) => c.G.filter((p) => sum(p.s.map((s) => s[S.hr])) >= 400).length * c.per100 },
  { id: 'D9', cat: 'D', name: '통산 150승 (게임 안 입단)', how: '게임 안 입단 투수 통산 150승 수, 100시즌 환산', lo: 5, hi: 18, tol: 10, fmt: f1, basis: '실제 같은 셈 1982~2025 11.4 (100년 환산)', where: 'manager.ts 선발 운용, injury.ts 투수 부상',
    f: (c) => c.G.filter((p) => sum(p.s.map((s) => s[S.w])) >= 150).length * c.per100 },
  { id: 'D10', cat: 'D', name: '칭호 발생 꾸준함', how: '그 해 새 칭호 수: 마지막 10시즌 평균 ÷ 11~20번째 시즌 평균', lo: 0.75, hi: 1.33, tol: 0.5, fmt: f2, basis: '야구 게임 상식: 칭호는 시대가 지나도 비슷하게 나와야 한다', weak: true, where: 'league/titles.ts',
    f: (c) => mean(c.Y.slice(-10).map((y) => y.titlesNew)) / mean(yearsOf(c, 10, 19).map((y) => y.titlesNew)) },
  // E 경기
  { id: 'E1', cat: 'E', name: '경기당 득점', how: '팀 경기당 득점 (평균)', lo: 4.4, hi: 5.6, tol: 0.8, fmt: f2, basis: '실제 같은 셈 1982~2025 4.61·2015~2025 5.05 (docs/engine.md 4장)', where: 'engine/season.ts 환경 맞춤, futureRules',
    f: (c) => mean(c.Y.map((y) => y.runsPg)) },
  { id: 'E2', cat: 'E', name: '타석당 홈런', how: '리그 홈런 ÷ 타석 (평균)', lo: 0.02, hi: 0.03, tol: 0.008, fmt: pc, basis: '실제 같은 셈 1982~2025 2.1%·2015~2025 2.3%', where: 'futureRules seasonCor·ballHrMul',
    f: (c) => mean(c.Y.map((y) => y.hrPa)) },
  { id: 'E3', cat: 'E', name: '리그 평균자책', how: '리그 평균자책 (평균)', lo: 4.0, hi: 5.2, tol: 0.8, fmt: f2, basis: 'KBO 2015~2025 4.1~5.2', where: 'engine 환경 맞춤',
    f: (c) => mean(c.Y.map((y) => y.era)) },
  { id: 'E4', cat: 'E', name: '리그 타율', how: '리그 타율 (평균)', lo: 0.255, hi: 0.285, tol: 0.02, fmt: f3, basis: 'KBO 2015~2025 .258~.290', where: 'engine 환경 맞춤',
    f: (c) => mean(c.Y.map((y) => y.avg)) },
  { id: 'E5', cat: 'E', name: '무승부 비율', how: '무승부 ÷ 경기', lo: 0.008, hi: 0.03, tol: 0.02, fmt: pc, basis: '실제 같은 셈 1982~2025 2.2%·2015~2025 2.0%', where: 'engine/records.ts 연장',
    f: (c) => sum(c.Y.map((y) => sum(y.t))) / Math.max(1, sum(c.Y.map((y) => sum(y.w) + sum(y.l) + sum(y.t)))) },
  { id: 'E6', cat: 'E', name: '홈 승률', how: '홈 승 ÷ (홈 승 + 홈 패)', lo: 0.505, hi: 0.545, tol: 0.03, fmt: f3, basis: 'KBO 2015~2025 홈 승률 약 .51~.54', where: 'engine 홈 이점(M8 문제점: 방향 반대 해 있음)',
    f: (c) => sum(c.Y.map((y) => y.homeW)) / Math.max(1, sum(c.Y.map((y) => y.homeW + y.homeL))) },
  { id: 'E7', cat: 'E', name: '득점 흐름 안정', how: '경기당 득점: 마지막 20시즌 평균 ÷ 2~21번째 시즌 평균', lo: 0.92, hi: 1.08, tol: 0.1, fmt: f2, basis: '야구 게임 상식: 100년 동안 리그 득점이 한쪽으로 흘러가면 안 된다', weak: true, where: 'futureRules (가상 규칙 변경)',
    f: (c) => mean(c.Y.slice(-20).map((y) => y.runsPg)) / mean(yearsOf(c, 1, 20).map((y) => y.runsPg)) },
  // F 팀 격차·왕조
  { id: 'F1', cat: 'F', name: '승률 표준편차', how: '그 해 팀 승률 표준편차 (평균)', lo: 0.06, hi: 0.095, tol: 0.03, fmt: f3, basis: '실제 같은 셈 1982~2025 .084·2015~2025 .074', where: 'ai/trade.ts·offseason.ts 전력 쏠림',
    f: (c) => mean(c.Y.map((y) => sd(y.w.map((_, t) => pct(y, t))))) },
  { id: 'F2', cat: 'F', name: '최다승 (144경기 환산)', how: '그 해 최다승 × 144 ÷ 경기 (평균)', lo: 82, hi: 92, tol: 8, fmt: f1, basis: 'KBO 2015~2025 1위 승수 약 83~93', where: '팀 격차',
    f: (c) => mean(c.Y.map((y) => { const t = y.st[0]; return (y.w[t] * 144) / Math.max(1, y.w[t] + y.l[t] + y.t[t]); })) },
  { id: 'F3', cat: 'F', name: '10년 안 우승 구단 수', how: '10시즌 묶음마다 서로 다른 우승 구단 수 (평균)', lo: 3, hi: 7, tol: 3, fmt: f1, basis: 'KBO 10구단 시대 10년마다 약 5~6곳', where: '팀 격차·가을야구',
    f: (c) => mean(Array.from({ length: Math.floor(c.n / 10) }, (_, k) => new Set(c.Y.slice(k * 10, k * 10 + 10).map((y) => y.champ)).size)) },
  { id: 'F4', cat: 'F', name: '왕조 수', how: '5시즌 안 3번 이상 우승한 구단 묶음(겹치면 하나) 수, 100시즌 환산', lo: 3, hi: 15, tol: 8, fmt: f1, basis: 'KBO 44년에 5번쯤(해태·현대·SK·삼성·두산) → 100년 약 10', where: 'ai/gm.ts 윈나우·리빌딩',
    f: (c) => {
      let k = 0; const T = c.teams;
      for (let t = 0; t < T; t++) {
        let until = -1;
        for (let i = 0; i + 5 <= c.n; i++) {
          if (i <= until) continue;
          if (c.Y.slice(i, i + 5).filter((y) => y.champ === t).length >= 3) { k++; until = i + 4; }
        }
      }
      return k * c.per100;
    } },
  { id: 'F5', cat: 'F', name: '가장 긴 무우승', how: '구단마다 우승 없는 가장 긴 기간(판 끝까지 이어지는 것 포함)의 최대', lo: 20, hi: 60, tol: 25, fmt: f1, basis: 'KBO LG 1995~2022 28년·롯데 1993~ 30년 넘게', weak: true, where: '팀 격차',
    f: (c) => Math.max(...Array.from({ length: c.teams }, (_, t) => { let best = 0, run = 0; for (const y of c.Y) { run = y.champ === t ? 0 : run + 1; best = Math.max(best, run); } return best; })) },
  { id: 'F6', cat: 'F', name: '꼴찌의 반등', how: '꼴찌 구단이 다음 시즌 가을야구에 간 비율', lo: 0.05, hi: 0.25, tol: 0.15, fmt: pc, basis: 'KBO 2010~2025 꼴찌 다음 해 진출 약 1할', weak: true, where: 'offseason.ts 지명 순서·FA',
    f: (c) => { let n = 0, ok = 0; for (let i = 0; i + 1 < c.n; i++) { n++; if (c.Y[i + 1].seeds.includes(c.Y[i].st.at(-1)!)) ok++; } return ok / Math.max(1, n); } },
  { id: 'F7', cat: 'F', name: '순위 이어짐', how: '전년 순위와 올해 순위의 스피어만 상관 (평균)', lo: 0.3, hi: 0.65, tol: 0.25, fmt: f2, basis: 'KBO 2010~2025 약 0.4~0.5', weak: true, where: '팀 격차·선수 이동',
    f: (c) => mean(c.Y.slice(1).map((y, i) => { const a = c.Y[i]; const ra = a.st.map((_, t) => a.st.indexOf(t)); const rb = y.st.map((_, t) => y.st.indexOf(t)); return spearman(ra, rb); })) },
  { id: 'F8', cat: 'F', name: '우리 구단 우승', how: '처음 맡은 구단의 우승 수, 100시즌 환산', lo: 4, hi: 18, tol: 8, fmt: f1, team: true, basis: '10구단 고른 몫 10번 ± 운', where: '대리 단장 규칙 (FA·외국인·트레이드 제안)',
    f: (c) => c.Y.filter((y) => y.champ === c.r.meta.focus).length * c.per100 },
  { id: 'F9', cat: 'F', name: '우리 구단 가을야구', how: '처음 맡은 구단의 가을야구 진출 비율', lo: 0.3, hi: 0.7, tol: 0.25, fmt: pc, team: true, basis: '5팀 진출이면 고른 몫 50%', where: '대리 단장 규칙',
    f: (c) => c.Y.filter((y) => y.seeds.includes(c.r.meta.focus)).length / c.n },
  // G 재정·자본 흐름
  { id: 'G1', cat: 'G', name: '긴급 지원 빈도', how: '긴급 지원을 받은 구단-시즌 비율', lo: 0, hi: 0.05, tol: 0.15, fmt: pc, basis: '야구 게임 상식: 모기업이 있는 구단이 파산 직전까지 가는 일은 드물어야 한다 (재정 2 기획)', weak: true, where: 'league/finance.ts settleSeason·긴급 지원',
    f: (c) => sum(c.Y.map((y) => y.fin.filter((f) => f.rescue > 0).length)) / (c.n * c.teams) },
  { id: 'G2', cat: 'G', name: '부채 빈도', how: '결산 뒤 부채가 있는 구단-시즌 비율', lo: 0, hi: 0.1, tol: 0.2, fmt: pc, basis: '재정 2 기획: 부채는 잠깐 쓰고 갚는 수단', weak: true, where: 'league/finance.ts 단기 대여',
    f: (c) => sum(c.Y.map((y) => y.fin.filter((f) => f.debt > 0).length)) / (c.n * c.teams) },
  { id: 'G3', cat: 'G', name: '자금 흐름 (물가 보정)', how: '구단 자금 중앙값 ÷ 연봉 지수: 마지막 10시즌 평균 ÷ 2~11번째 시즌 평균', lo: 0.5, hi: 2, tol: 1.5, fmt: f2, basis: '야구 게임 상식: 돈이 쌓이기만 하거나 마르기만 하면 경영이 사라진다', weak: true, where: 'league/finance.ts 수입·지출 물가(wageIndex)',
    f: (c) => { const med = (y: YearRow) => [...y.fin.map((f) => f.cash)].sort((a, b) => a - b)[Math.floor(c.teams / 2)] / y.wage; return mean(c.Y.slice(-10).map(med)) / mean(yearsOf(c, 1, 10).map(med)); } },
  { id: 'G4', cat: 'G', name: '자금 쏠림', how: '마지막 시즌 구단 자금 지니 계수', lo: 0, hi: 0.4, tol: 0.3, fmt: f2, basis: '야구 게임 상식: 몇 구단만 돈을 다 갖지 않게', weak: true, where: 'finance.ts 관중·중계 배분',
    f: (c) => gini(c.Y.at(-1)!.fin.map((f) => f.cash)) },
  { id: 'G5', cat: 'G', name: '적자 구단 비율', how: '그 해 수지(net) 적자인 구단-시즌 비율', lo: 0.2, hi: 0.6, tol: 0.3, fmt: pc, basis: 'KBO 실제는 모기업 지원 전 대부분 적자, 지원 뒤 흑자·적자가 섞임', weak: true, where: 'finance.ts 모기업 지원(parent)',
    f: (c) => sum(c.Y.map((y) => y.fin.filter((f) => f.net < 0).length)) / (c.n * c.teams) },
  { id: 'G6', cat: 'G', name: '우리 구단 자금 바닥', how: '처음 맡은 구단의 결산 자금이 0 미만인 시즌 비율', lo: 0, hi: 0.05, tol: 0.2, fmt: pc, team: true, basis: '대리 단장이 추천대로만 해도 돈이 바닥나지 않아야 한다', where: 'finance.ts autoBudget·autoPrices',
    f: (c) => c.Y.filter((y) => y.fin[c.r.meta.focus].cash < 0).length / c.n },
  { id: 'G7', cat: 'G', name: '연봉 ÷ 수입', how: '구단 캡 연봉 합 ÷ 그 해 수입 합 (평균)', lo: 0.18, hi: 0.4, tol: 0.2, fmt: pc, basis: 'KBO 구단 매출(모기업 광고 포함) 약 500억 원 안팎 대비 상위 40명 연봉 100억 원 남짓 → 2~3할', weak: true, where: 'finance.ts 수입 규모·salary.ts',
    f: (c) => mean(c.Y.flatMap((y) => y.fin.filter((f) => f.rev > 0).map((f) => f.pay / f.rev))) },
  { id: 'G8', cat: 'G', name: '돈 쌓아 두기', how: '구단-시즌 가운데 (결산 자금 ÷ 그 해 수입)의 최댓값', lo: 0, hi: 2, tol: 3, fmt: f2, basis: '야구 게임 상식: 몇 해 수입을 쌓아 두면 쓸 곳이 없다는 뜻', weak: true, where: 'finance.ts·ai 투자(invest)',
    f: (c) => Math.max(...c.Y.flatMap((y) => y.fin.filter((f) => f.rev > 0).map((f) => f.cash / f.rev))) },
  { id: 'G9', cat: 'G', name: 'FA 시장 돈 흐름', how: '그 해 FA 계약 총액(연봉 × 연수) ÷ 리그 캡 연봉 합 (평균)', lo: 0.3, hi: 0.9, tol: 0.4, fmt: pc, basis: 'KBO 2021~2024 FA 계약 총액 해마다 약 600~990억 원 ÷ 리그 상위 40명 연봉 합 약 1,000~1,100억 원 → 5~9할', weak: true, where: 'offseason.ts FA 요구액·salary.ts',
    f: (c) => mean(c.Y.map((y) => y.fa.money / Math.max(1, sum(y.fin.map((f) => f.pay))))) },
  // H 연봉·FA
  { id: 'H1', cat: 'H', name: 'FA 신청 수', how: '해마다 FA 신청 (해외 복귀 제외)', lo: 10, hi: 30, tol: 15, fmt: f1, basis: 'KBO 2015~2025 해마다 약 15~25명', where: 'offseason.ts faFilingRankPerTeam',
    f: (c) => mean(c.Y.map((y) => y.fa.filed)) },
  { id: 'H2', cat: 'H', name: 'FA 이적 수', how: '해마다 다른 구단과 계약한 FA', lo: 3, hi: 12, tol: 8, fmt: f1, basis: 'KBO 2015~2025 해마다 약 5~10명', where: 'offseason.ts resolveFaRound',
    f: (c) => mean(c.Y.map((y) => y.fa.moved)) },
  { id: 'H3', cat: 'H', name: 'FA 계약률', how: 'FA 신청자 가운데 계약한 비율', lo: 0.75, hi: 1, tol: 0.3, fmt: pc, basis: 'KBO FA 미계약은 해마다 한둘', where: 'offseason.ts aiSignUnsignedFa',
    f: (c) => sum(c.Y.map((y) => y.fa.signed)) / Math.max(1, sum(c.Y.map((y) => y.fa.filed))) },
  { id: 'H4', cat: 'H', name: '샐러리캡 사용률', how: '구단 캡 연봉 ÷ 캡 (캡 있는 해 평균)', lo: 0.6, hi: 0.95, tol: 0.3, fmt: pc, basis: 'KBO 2023~2025 캡 대비 구단 연봉 약 6~10할', where: 'salary.ts·ai 연봉',
    f: (c) => mean(c.Y.filter((y) => y.cap).flatMap((y) => y.fin.map((f) => f.pay / y.cap!))) },
  { id: 'H5', cat: 'H', name: '캡 초과 빈도', how: '캡을 넘은 구단-시즌 비율 (캡 있는 해)', lo: 0, hi: 0.1, tol: 0.2, fmt: pc, basis: 'KBO 2023~2025 초과 구단 해마다 0~2곳', where: 'salary.ts·owner.ts 캡 제재',
    f: (c) => { const ys = c.Y.filter((y) => y.cap); return sum(ys.map((y) => y.capOver)) / Math.max(1, ys.length * c.teams); } },
  { id: 'H6', cat: 'H', name: '연봉 격차', how: '그 해 구단 캡 연봉 최대 ÷ 최소 (평균)', lo: 1.5, hi: 3, tol: 1.5, fmt: f2, basis: 'KBO 2023~2025 구단 연봉 최대/최소 약 1.8~2.5', where: 'salary.ts 하한(salaryFloor)',
    f: (c) => mean(c.Y.map((y) => Math.max(...y.fin.map((f) => f.pay)) / Math.max(1, Math.min(...y.fin.map((f) => f.pay))))) },
  // I 트레이드
  { id: 'I1', cat: 'I', name: '트레이드 수', how: '해마다 AI 구단 간 트레이드 + 우리 구단이 받은 제안 수락', lo: 5, hi: 25, tol: 10, fmt: f1, basis: 'KBO 해마다 트레이드 약 10~20건', where: 'session.ts aiTradeDay, ai/trade.ts',
    f: (c) => mean(c.Y.map((y) => y.aiTrades + y.userTrades)) },
  { id: 'I2', cat: 'I', name: '스타가 낀 트레이드', how: 'AI 트레이드 가운데 리그 상위 5% 기여 선수가 낀 비율', lo: 0.05, hi: 0.3, tol: 0.2, fmt: pc, basis: 'KBO 대형 트레이드는 해마다 한두 건', weak: true, where: 'ai/trade.ts 최소 이득',
    f: (c) => sum(c.Y.map((y) => y.aiTradeStar)) / Math.max(1, sum(c.Y.map((y) => y.aiTrades))) },
  { id: 'I3', cat: 'I', name: '우리에게 오는 트레이드 제안', how: '시즌마다 우리 구단이 받은 트레이드 제안 이벤트 수', lo: 1, hi: 6, tol: 4, fmt: f1, team: true, basis: '야구 게임 상식: 시즌에 몇 번은 제안이 와야 단장 일이 생긴다', weak: true, where: 'session.ts tradeOfferDay',
    f: (c) => mean(c.Y.map((y) => y.offers)) },
  { id: 'I4', cat: 'I', name: '시즌 중 영입', how: '해마다 시즌 중 시장 계약(외국인 교체·자유계약) 수', lo: 3, hi: 15, tol: 8, fmt: f1, basis: 'KBO 해마다 외국인 교체 약 5~10명', where: 'league/market.ts aiMarketDay',
    f: (c) => mean(c.Y.map((y) => y.market.sign ?? 0)) },
  // J 드래프트·신인
  { id: 'J1', cat: 'J', name: '신인왕 나이', how: '신인왕 수상자 나이 (평균)', lo: 20.5, hi: 23.5, tol: 2, fmt: f1, basis: 'KBO 2010~2025 신인왕 대부분 20~23세', where: 'awards.ts 신인 자격',
    f: (c) => mean(c.Y.filter((y) => y.rookie).map((y) => { const p = c.r.players[y.rookie!.id]; return p?.birth ? y.y - p.birth : NaN; }).filter((x) => !Number.isNaN(x))) },
  { id: 'J2', cat: 'J', name: '신인왕 WAR', how: '신인왕 수상자 WAR (평균)', lo: 1.5, hi: 4.5, tol: 2, fmt: f2, basis: 'KBO 2015~2025 신인왕 WAR 약 1.5~5', where: 'potential.ts 시작 능력',
    f: (c) => mean(c.Y.filter((y) => y.rookie).map((y) => y.rookie!.war)) },
  { id: 'J3', cat: 'J', name: '신인 1군 정착률', how: '입단 10년이 지난 게임 안 국내 입단 선수 가운데 통산 1,000타석 또는 300이닝을 넘긴 비율', lo: 0.12, hi: 0.35, tol: 0.15, fmt: pc, basis: 'KBO 지명 선수 가운데 주전급 정착 약 1~3할', weak: true, where: 'offseason.ts 가상 신인·방출',
    f: (c) => { const xs = c.G.filter((p) => p.entry <= c.end - 10); return xs.length ? xs.filter((p) => sum(p.s.map((s) => s[S.pa])) >= 1000 || sum(p.s.map((s) => s[S.outs])) >= 900).length / xs.length : NaN; } },
  { id: 'J4', cat: 'J', name: '신인 유입', how: '해마다 게임 안 국내 입단 선수 수 ÷ 구단 수', lo: 8, hi: 14, tol: 5, fmt: f1, basis: 'KBO 10구단 드래프트 11라운드(구단당 약 11명)', where: 'offseason.ts 드래프트 라운드',
    f: (c) => mean(Array.from({ length: c.n - 1 }, (_, i) => c.G.filter((p) => p.entry === c.start + 1 + i).length / c.teams)) },
  { id: 'J5', cat: 'J', name: '고졸 비율', how: '게임 안 국내 입단 선수 가운데 고졸', lo: 0.55, hi: 0.85, tol: 0.2, fmt: pc, basis: 'KBO 2020년대 지명자 고졸 약 6~8할', where: 'offseason.ts 가상 신인 학력',
    f: (c) => { const xs = c.G.filter((p) => p.school); return xs.filter((p) => p.school === 'HS').length / Math.max(1, xs.length); } },
  // K 외국인
  { id: 'K1', cat: 'K', name: '외국인 WAR 몫', how: '양(+) WAR 합 가운데 외국인 몫', lo: 0.15, hi: 0.3, tol: 0.12, fmt: pc, basis: '실제 같은 셈 2015~2025 25.1% (1982~2025 13.7%)', where: 'league/market.ts·offseason.ts 외국인 후보 능력',
    f: (c) => { const pos = c.rows.filter((x) => x.s[S.war] > 0); return sum(pos.filter((x) => x.p.foreign).map((x) => x.s[S.war])) / Math.max(1e-9, sum(pos.map((x) => x.s[S.war]))); } },
  { id: 'K2', cat: 'K', name: 'WAR 상위 10명 중 외국인', how: '그 해 WAR 상위 10명 가운데 외국인 비율 (평균)', lo: 0.3, hi: 0.6, tol: 0.25, fmt: pc, basis: '실제 같은 셈 2015~2025 48.2%', where: '외국인 후보 능력 분포',
    f: (c) => mean(c.Y.map((y) => c.rows.filter((x) => x.s[S.year] === y.y).sort((a, b) => b.s[S.war] - a.s[S.war]).slice(0, 10).filter((x) => x.p.foreign).length / 10)) },
  { id: 'K3', cat: 'K', name: '외국인 머무는 시즌', how: '판 끝 5시즌 전에 떠난 외국인의 KBO 시즌 수 평균', lo: 1.3, hi: 2.5, tol: 1.5, fmt: f2, basis: '실제 같은 셈 1982~2025 1.57·2015~2025 1.49', where: 'offseason.ts 외국인 재계약',
    f: (c) => mean(c.P.filter((p) => p.foreign && p.s.length && p.s.at(-1)![S.year] < c.end - 5).map((p) => p.s.length)) },
  { id: 'K4', cat: 'K', name: '구단당 외국인 출장 인원', how: '그 해 1군에 나온 외국인(교체 포함) 수 ÷ 구단 (평균)', lo: 3, hi: 5, tol: 2, fmt: f2, basis: '2026 규정 외국인 3 + 아시아쿼터 1, 교체 포함 약 4~5', where: 'market.ts·offseason.ts 외국인',
    f: (c) => mean(c.Y.map((y) => mean(y.foreign))) },
  // L 병역
  { id: 'L1', cat: 'L', name: '구단당 복무 인원', how: '개막 전 복무 중 선수 ÷ 구단 (평균)', lo: 2, hi: 8, tol: 4, fmt: f1, basis: 'KBO 구단마다 상무·현역 복무 약 4~8명', weak: true, where: 'league/careers.ts 입대(AI_ENLIST_TEAM)',
    f: (c) => mean(c.Y.map((y) => y.serving / c.teams)) },
  { id: 'L2', cat: 'L', name: '미필 30세 이상', how: '개막 전 미필 30세 이상 국내 선수 수 (평균)', lo: 0, hi: 3, tol: 6, fmt: f1, basis: '병역법상 입영 연기 한계(대개 28세 안팎)', where: 'careers.ts 강제 입대',
    f: (c) => mean(c.Y.map((y) => y.pendingOld)) },
  // M 부상·사건
  { id: 'M1', cat: 'M', name: '구단당 부상 (시즌)', how: '시즌 부상 이탈 수 ÷ 구단', lo: 15, hi: 45, tol: 20, fmt: f1, basis: 'KBO 부상자 명단 등록 해마다 구단당 약 20~40건', weak: true, where: 'engine/injury.ts',
    f: (c) => mean(c.Y.map((y) => y.inj / c.teams)) },
  { id: 'M2', cat: 'M', name: '구단당 큰 부상', how: '시즌 큰 부상 ÷ 구단', lo: 1, hi: 4, tol: 3, fmt: f2, basis: '수술급 부상 구단당 해마다 한두 건', weak: true, where: 'engine/injury.ts',
    f: (c) => mean(c.Y.map((y) => y.major / c.teams)) },
  { id: 'M3', cat: 'M', name: '실존 선수 구체적 사건', how: '실존 선수에게 붙은 구체적 사건 수 (0이어야 함)', lo: 0, hi: 0, tol: 1, fmt: f1, basis: '기획서 확정 규칙 (CLAUDE.md)', where: 'engine/injury.ts absenceLabel',
    f: (c) => sum(c.Y.map((y) => y.specificReal)) },
  { id: 'M4', cat: 'M', name: '부상 흐름 안정', how: '구단당 부상: 마지막 10시즌 ÷ 2~11번째 시즌', lo: 0.8, hi: 1.25, tol: 0.4, fmt: f2, basis: '야구 게임 상식: 시대가 흘러도 부상 빈도는 비슷', weak: true, where: 'injury.ts·혹사지수',
    f: (c) => mean(c.Y.slice(-10).map((y) => y.inj)) / mean(yearsOf(c, 1, 10).map((y) => y.inj)) },
  // N 투수
  { id: 'N1', cat: 'N', name: '180이닝 투수', how: '해마다 180이닝 이상 투수 수', lo: 3, hi: 8, tol: 4, fmt: f1, basis: '실제 같은 셈 1982~2025 5.3·2015~2025 5.2', where: 'manager.ts mgr.starterDeal·aceDays',
    f: (c) => mean(c.Y.map((y) => y.cnt.ip180)) },
  { id: 'N2', cat: 'N', name: '15승 투수', how: '해마다 15승 이상 투수 수', lo: 2.5, hi: 6, tol: 3, fmt: f1, basis: '실제 같은 셈 1982~2025 3.6·2015~2025 3.8', where: 'manager.ts 선발·승리 투수 규칙',
    f: (c) => mean(c.Y.map((y) => y.cnt.w15)) },
  { id: 'N3', cat: 'N', name: '30세이브 투수', how: '해마다 30세이브 이상 투수 수', lo: 1, hi: 4, tol: 3, fmt: f1, basis: '실제 같은 셈 1982~2025 1.6·2015~2025 2.6', where: 'manager.ts 마무리',
    f: (c) => mean(c.Y.map((y) => y.cnt.sv30)) },
  { id: 'N4', cat: 'N', name: '규정이닝 투수', how: '해마다 규정이닝 투수 수', lo: 16, hi: 25, tol: 8, fmt: f1, basis: '실제 같은 셈 1982~2025 22.8·2015~2025 20.7', where: 'manager.ts 선발 한계 투구 수',
    f: (c) => mean(c.Y.map((y) => y.cnt.qPit)) },
  { id: 'N5', cat: 'N', name: '홀드왕 홀드', how: '그 해 최다 홀드 (평균)', lo: 27, hi: 38, tol: 10, fmt: f1, basis: '실제 같은 셈 2015~2025 32.4 (홀드는 2000년부터)', where: 'manager.ts 셋업 기용',
    f: (c) => mean(c.Y.map((y) => y.lead.hld)) },
  // O 구단주·감독
  { id: 'O1', cat: 'O', name: '해고 횟수', how: '대리 단장이 해고된 횟수, 100시즌 환산', lo: 0, hi: 5, tol: 10, fmt: f1, team: true, basis: '야구 게임 상식: 추천대로 무난히 운영한 단장이 자주 잘리면 억울하다', weak: true, where: 'league/owner.ts 신뢰도 증감·해고선',
    f: (c) => c.Y.filter((y) => y.owner.fired).length * c.per100 },
  { id: 'O2', cat: 'O', name: '구단주 신뢰도', how: '결산 뒤 신뢰도 (평균)', lo: 40, hi: 75, tol: 30, fmt: f1, team: true, basis: '시작 신뢰도 근처에서 오르내려야 한다', weak: true, where: 'owner.ts evaluateOwner',
    f: (c) => mean(c.Y.map((y) => y.owner.trust)) },
  { id: 'O3', cat: 'O', name: '감독 교체', how: '해마다 리그 감독 교체 수', lo: 2, hi: 5, tol: 3, fmt: f1, basis: 'KBO 2015~2025 해마다 감독 교체 약 2~5곳', where: 'league/managers.ts openManagers',
    f: (c) => c.r.mgr.filter(([y]) => y > c.start).length / Math.max(1, c.n - 1) },
  { id: 'O4', cat: 'O', name: '구단주 목표 달성률', how: '대리 단장 구단주 목표 달성 비율', lo: 0.4, hi: 0.75, tol: 0.3, fmt: pc, team: true, basis: '야구 게임 상식: 목표가 너무 쉽거나 어려우면 평가가 의미 없다', weak: true, where: 'owner.ts 목표 기준',
    f: (c) => { const h = c.r.ownerHist; return h.length ? h.filter((x) => x[2]).length / h.length : NaN; } },
  // P 시장·방출
  { id: 'P1', cat: 'P', name: '미계약 FA 남음', how: '개막 전 아무도 데려가지 않은 FA 수 (평균)', lo: 0, hi: 5, tol: 10, fmt: f1, basis: 'KBO 미계약 FA 해마다 0~3명', where: 'offseason.ts aiSignUnsignedFa',
    f: (c) => mean(c.Y.map((y) => y.unsignedFa)) },
  { id: 'P2', cat: 'P', name: '정원 지키기', how: '개막 전 구단 소속이 정원 이하인 시즌 비율', lo: 1, hi: 1, tol: 0.2, fmt: pc, basis: '규정 (정원 68명 등)', where: 'offseason.ts releaseOrder',
    f: (c) => c.Y.filter((y) => y.orgMax <= y.orgLimit).length / c.n },
  { id: 'P3', cat: 'P', name: '웨이버 영입', how: '해마다 시즌 중 방출 선수 데려오기(claim) 수', lo: 0.5, hi: 5, tol: 4, fmt: f1, basis: 'KBO 웨이버 공시 영입 해마다 몇 건', weak: true, where: 'market.ts claim',
    f: (c) => mean(c.Y.map((y) => y.market.claim ?? 0)) },
  // Q 리그 구성
  { id: 'Q1', cat: 'Q', name: '타석 가중 나이', how: '타석 가중 평균 나이 (평균)', lo: 28, hi: 30, tol: 2, fmt: f1, basis: '실제 같은 셈 1982~2025 28.4·2015~2025 29.6', where: 'growth.ts·careers.ts',
    f: (c) => mean(c.Y.map((y) => { const xs = c.rows.filter((x) => x.s[S.year] === y.y && x.s[S.age] >= 0); return sum(xs.map((x) => x.s[S.pa] * x.s[S.age])) / Math.max(1, sum(xs.map((x) => x.s[S.pa]))); })) },
  { id: 'Q2', cat: 'Q', name: '선수층 재능 흐름', how: '그 해 WAR 상위 30명 합: 마지막 20시즌 평균 ÷ 2~11번째 시즌 평균', lo: 0.85, hi: 1.15, tol: 0.3, fmt: f2, basis: 'docs/longterm-plan.md: 장기 진행 기량 유지 목표', where: 'potential.ts draftScale·room',
    f: (c) => { const top = (y: YearRow) => sum(c.rows.filter((x) => x.s[S.year] === y.y).map((x) => x.s[S.war]).sort((a, b) => b - a).slice(0, 30)); return mean(c.Y.slice(-20).map(top)) / mean(yearsOf(c, 1, 10).map(top)); } },
  { id: 'Q3', cat: 'Q', name: '규정타석 타자', how: '해마다 규정타석 타자 수', lo: 42, hi: 58, tol: 15, fmt: f1, basis: '실제 같은 셈 1982~2025 42.4·2015~2025 52.3', where: 'team.ts 휴식(params.restRank)',
    f: (c) => mean(c.Y.map((y) => y.cnt.qBat)) },
  { id: 'Q4', cat: 'Q', name: '이도류 선수', how: '이도류로 뛴 서로 다른 선수 수, 100시즌 환산', lo: 1, hi: 10, tol: 10, fmt: f1, basis: '야구 게임 상식: 드문 볼거리로 100년에 몇 명', weak: true, where: 'league/twoway.ts',
    f: (c) => c.P.filter((p) => p.twoWay).length * c.per100 },
  // R 진행 안정
  { id: 'R1', cat: 'R', name: '완주', how: '마친 시즌 ÷ 계획 시즌', lo: 1, hi: 1, tol: 0.5, fmt: pc, basis: '오류 없이 끝까지', where: '판 오류 로그',
    f: (c) => c.n / c.r.meta.wanted },
  { id: 'R2', cat: 'R', name: '진행 막힘', how: '7일 진행이 사유 없이 0일로 끝난 횟수', lo: 0, hi: 0, tol: 5, fmt: f1, basis: '진행 버튼이 멈추면 안 된다', where: 'session.ts advance',
    f: (c) => sum(c.Y.map((y) => y.stops.zero)) },
  { id: 'R3', cat: 'R', name: '시즌 처리 시간', how: '시즌 하나(정규·가을·오프시즌)를 7일씩 진행하는 데 걸린 초 (평균)', lo: 0, hi: 25, tol: 30, fmt: f1, basis: '야구 게임 상식: 한 시즌 자동 진행이 30초를 넘으면 지루하다 (도구 기준, 화면 그리기 제외)', weak: true, where: 'engine 시즌 시뮬레이션 속도',
    f: (c) => mean(c.Y.map((y) => y.secs)) },
  { id: 'R4', cat: 'R', name: '오프시즌 단계 넘김 실패', how: '다음 단계·개막이 거절된 횟수', lo: 0, hi: 0, tol: 5, fmt: f1, basis: '추천대로 하면 단계가 막히지 않아야 한다', where: 'offseason.ts blockedReason',
    f: (c) => sum(c.Y.map((y) => y.stops.stageFail)) },
];

/** 실제 KBO 대조 판(tools/eval100_real.ts)으로도 잴 수 있는 항목: 선수 기록·리그 합계만 쓰는 것 */
export const REAL_OK = new Set(['A1', 'A3', 'A4', 'A6', 'A7', 'B1', 'B2', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'C5',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'E1', 'E2', 'E5', 'F1', 'F2', 'K1', 'K2', 'K3', 'N1', 'N2', 'N3', 'N4', 'N5', 'Q1', 'Q3']);

export function scoreOf(it: Item, v: number): number {
  if (!Number.isFinite(v)) return NaN;
  if (v >= it.lo && v <= it.hi) return 10;
  const d = v < it.lo ? it.lo - v : v - it.hi;
  return Math.max(0, 10 * (1 - d / it.tol));
}

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const files = argv.filter((a, i) => a.endsWith('.json') && !['--out', '--doc', '--json', '--append'].includes(argv[i - 1]));

function docText(): string {
  const lines: string[] = [];
  for (const [k, name] of Object.entries(CATS)) {
    lines.push(`### ${k}. ${name}\n`, '| 번호 | 항목 | 재는 것 | 기준 (10점) | 0점까지 | 근거 |', '|---|---|---|---|---|---|');
    for (const it of ITEMS.filter((x) => x.cat === k)) {
      const f = it.fmt ?? f2;
      lines.push(`| ${it.id} | ${it.name}${it.team ? ' (구단별)' : ''} | ${it.how} | ${f(it.lo)} ~ ${f(it.hi)} | 범위 밖 ${f(it.tol)} | ${it.basis}${it.weak ? ' [근거 약함]' : ''} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  const docOut = opt('doc');
  if (docOut) {
    const path = docOut;
    const cur = readFileSync(path, 'utf8');
    const a = cur.indexOf('<!-- 항목표 시작 -->'), b = cur.indexOf('<!-- 항목표 끝 -->');
    if (a < 0 || b < 0) throw new Error('문서에 항목표 표시가 없습니다');
    writeFileSync(path, cur.slice(0, a + '<!-- 항목표 시작 -->'.length) + '\n\n' + docText() + '\n' + cur.slice(b));
    console.log(`${path} 항목표를 고쳤습니다 (${ITEMS.length}개)`);
    if (!files.length) return;
  }
  const all: Run[] = files.map((f) => ({ file: f, ...JSON.parse(readFileSync(f, 'utf8')) }));
  const runs = all.filter((r) => !r.meta.real);
  const realRuns = all.filter((r) => r.meta.real);
  const realCtxs = realRuns.map(ctxOf);
  const realVals = realCtxs.map((rc) => ITEMS.map((it) => { if (!REAL_OK.has(it.id)) return NaN; try { return it.f(rc); } catch { return NaN; } }));
  const realCell = (i: number, f: (v: number) => string) => realVals.map((rv) => (Number.isFinite(rv[i]) ? f(rv[i]) : '-')).join(' · ') || '-';
  const realHead = realRuns.map((r) => r.meta.team.replace('실제 ', '')).join(' · ');
  const ctxs = runs.map(ctxOf);
  const tail = (r: Run) => (/-[a-z]$/.test(r.meta.seed) ? r.meta.seed.slice(-1) : '');
  const label = (r: Run) => `${r.meta.team}${tail(r) ? ` ${tail(r)}` : ''}`;
  const vals = ITEMS.map((it) => ctxs.map((c) => { try { return it.f(c); } catch { return NaN; } }));
  const scores = ITEMS.map((it, i) => vals[i].map((v) => scoreOf(it, v)));
  const avgFinite = (xs: number[]) => mean(xs.filter((x) => Number.isFinite(x)));
  const itemAvg = scores.map(avgFinite);
  const out: string[] = [];
  out.push(`# 100시즌 평가 점수표\n`,
    `만든 날: ${new Date().toISOString().slice(0, 10)}. 도구: \`npx tsx tools/eval100.ts\` (판) → \`npx tsx tools/eval100_score.ts\` (점수). 항목 정의·기준은 \`docs/평가100.md\`.\n`,
    `판: ${runs.map((r) => `${r.meta.team} (시드 ${r.meta.seed}, ${r.meta.seasons}/${r.meta.wanted}시즌, ${(r.meta.secs / 60).toFixed(0)}분)`).join(', ')}.\n`,
    '점수: 기준 범위 안 10점, 벗어나면 벗어난 거리 ÷ "0점까지" 비율로 깎음. 값이 없는 칸(표본 없음)은 평균에서 뺀다.\n');
  // 대분류
  const catRows = Object.entries(CATS).map(([k, name]) => {
    const idx = ITEMS.map((it, i) => (it.cat === k ? i : -1)).filter((i) => i >= 0);
    const perRun = ctxs.map((_, j) => avgFinite(idx.map((i) => scores[i][j])));
    return { k, name, n: idx.length, avg: avgFinite(idx.map((i) => itemAvg[i])), perRun };
  });
  const total = avgFinite(itemAvg) * ITEMS.length; // 값이 없는 항목은 빼고 1000점으로 환산
  const perRunTotal = ctxs.map((_, j) => sum(scores.map((s) => s[j]).filter(Number.isFinite)) / scores.filter((s) => Number.isFinite(s[j])).length * ITEMS.length);
  out.push(`## 총점: ${total.toFixed(0)} / ${ITEMS.length * 10} (항목 평균 ${(total / ITEMS.length).toFixed(2)}점)\n`);
  out.push('## 대분류 평균\n', `| 대분류 | 항목 수 | 평균 | ${runs.map(label).join(' | ')} |`, `|---|---|---|${runs.map(() => '---|').join('')}`,
    ...catRows.map((c) => `| ${c.k}. ${c.name} | ${c.n} | ${c.avg.toFixed(2)} | ${c.perRun.map((x) => (Number.isFinite(x) ? x.toFixed(1) : '-')).join(' | ')} |`),
    `| 총점 (1000점 환산) | ${ITEMS.length} | ${total.toFixed(0)} | ${perRunTotal.map((x) => x.toFixed(0)).join(' | ')} |`, '');
  // 구단별 (시드 평균)
  const teamsSeen = [...new Set(runs.map((r) => r.meta.team))];
  if (teamsSeen.length < runs.length) {
    const byTeam = teamsSeen.map((t) => runs.map((r, j) => (r.meta.team === t ? j : -1)).filter((j) => j >= 0));
    out.push('## 구단별 (시드 평균)\n', `| 대분류 | ${teamsSeen.join(' | ')} |`, `|---|${teamsSeen.map(() => '---|').join('')}`,
      ...catRows.map((c) => `| ${c.k}. ${c.name} | ${byTeam.map((js) => avgFinite(js.map((j) => c.perRun[j])).toFixed(1)).join(' | ')} |`),
      `| 총점 | ${byTeam.map((js) => avgFinite(js.map((j) => perRunTotal[j])).toFixed(0)).join(' | ')} |`, '');
  }
  // 항목 × 판
  out.push('## 항목 × 구단 (값 / 점수)\n',
    `"실제"는 실제 KBO 기록(${realHead || '없음'})을 같은 셈으로 잰 값 (tools/eval100_real.ts, 게임과 같은 WAR 식). 100시즌 환산 항목은 그 기간 길이로 환산했다. 점수 평균에는 넣지 않는다.\n`,
    `| 번호 | 항목 | 기준 | 실제 | 평균 점수 | ${runs.map(label).join(' | ')} |`, `|---|---|---|---|---|${runs.map(() => '---|').join('')}`);
  ITEMS.forEach((it, i) => {
    const f = it.fmt ?? f2;
    out.push(`| ${it.id} | ${it.name} | ${f(it.lo)}~${f(it.hi)} | ${realCell(i, f)} | ${Number.isFinite(itemAvg[i]) ? itemAvg[i].toFixed(1) : '-'} | ${vals[i].map((v, j) => (Number.isFinite(v) ? `${f(v)} / ${scores[i][j].toFixed(0)}` : '-')).join(' | ')} |`);
  });
  out.push('');
  // 낮은 항목
  const low = ITEMS.map((it, i) => ({ it, i, s: itemAvg[i] })).filter((x) => Number.isFinite(x.s)).sort((a, b) => a.s - b.s).slice(0, 25);
  out.push('## 낮은 항목 (평균 점수 낮은 차례 25개)\n', '| 번호 | 항목 | 평균 점수 | 값 범위 (판 사이) | 기준 | 실제 | 가장 나쁜 판 (재현 시드) | 짐작하는 원인 자리 |', '|---|---|---|---|---|---|---|---|');
  for (const x of low) {
    const f = x.it.fmt ?? f2;
    const v = vals[x.i].filter(Number.isFinite);
    const worst = scores[x.i].reduce((m, s, j) => (Number.isFinite(s) && (m < 0 || s < scores[x.i][m]) ? j : m), -1);
    const w = worst >= 0 ? runs[worst] : null;
    out.push(`| ${x.it.id} | ${x.it.name} | ${x.s.toFixed(1)} | ${f(Math.min(...v))} ~ ${f(Math.max(...v))} | ${f(x.it.lo)}~${f(x.it.hi)} | ${realCell(x.i, f)} | ${w ? `\`--team ${w.meta.team} --seed ${w.meta.seed}\` (${f(vals[x.i][worst])})` : '-'} | ${x.it.where ?? ''} |`);
  }
  out.push('');
  const errs = runs.flatMap((r) => r.errors.map((e) => `- ${label(r)}: ${e.split('\n')[0]}`));
  if (errs.length) out.push('## 판 오류\n', ...errs, '');
  const ap = opt('append'); // 손으로 쓴 분석(다음에 고칠 것·물음)을 점수표 뒤에 붙인다
  if (ap) out.push(readFileSync(ap, 'utf8'));
  const text = out.join('\n');
  const o = opt('out');
  if (o) { mkdirSync(dirname(o), { recursive: true }); writeFileSync(o, text); console.log(`${o}에 썼습니다`); } else console.log(text);
  const j = opt('json');
  if (j) writeFileSync(j, JSON.stringify({ items: ITEMS.map((it, i) => ({ id: it.id, name: it.name, cat: it.cat, avg: itemAvg[i], real: realVals.map((rv) => rv[i]), vals: vals[i], scores: scores[i] })), runs: runs.map((r) => r.meta), cats: catRows }, null, 1));
}

main();
