// 구단 연대기 (2026-10-13 사용자 선택 "구단 연대기"): 시즌이 끝나면(오프시즌) AI가 그 해의 성적·가을야구·주요 선수·행동·사건·
// 단장 노트를 모아 연대기 한 장을 쓴다. 연대기는 이야기 기록과 따로 남겨(오래된 글이 잘려도 남게) 판정 맥락에 최근 몇 장이 들어간다.
import type { GameSession } from '../game/session';
import { yearLeagues, yearPlaceLabel } from '../league/history';
import { completeJsonText, extractJson, preview, type LlmSettings } from './llm';
import { RULES } from './prompts';
import type { FantasyEntry } from './types';

export const CHRONICLE_WHO = '구단 연대기';

/** 그 해 연대기가 이미 있나 */
export const chronicleOf = (g: GameSession, year: number) => g.league.fantasy?.chronicles?.find((c) => c.year === year);

/** 연대기를 쓸 차례인가: 판타지·자유 모드 오프시즌, 그 해 기록이 있고 아직 연대기가 없다 */
export function chronicleDue(g: GameSession): number | null {
  if (!g.league.fantasy || g.phase !== 'offseason') return null;
  const year = g.year;
  if (!g.league.yearbook?.some((y) => y.year === year)) return null;
  return chronicleOf(g, year) ? null : year;
}

/** 그 해 요약 (AI 입력): 순위·성적, 가을야구, 우리 주요 선수 기록, 그 해 행동·사건 제목, 단장 노트 */
export function chronicleSummary(g: GameSession, year: number): string {
  const L = g.league;
  const me = L.teams[g.teamIdx];
  const yb = L.yearbook?.find((y) => y.year === year);
  const lines: string[] = [`[${year} 시즌] 우리 구단 ${me.name}`];
  if (yb) {
    const rank = yb.teams.findIndex((t) => t.franchise === me.franchise || t.name === me.name);
    const t = yb.teams[rank];
    // 양대 리그 해(1999·2000)는 리그 순위와 리그마다 1위 (league/history.ts yearLeagues)
    const lg = yearLeagues(g.store, yb);
    const firsts = lg ? lg.flatMap((x, i) => (x.rank === 1 ? [`${x.league} 1위 ${yb.teams[i].name}`] : [])).join(', ') : `1위 ${yb.teams[0].name}`;
    if (t) lines.push(`정규시즌 ${yearPlaceLabel(lg, rank)} (${t.w}승 ${t.l}패${t.t ? ` ${t.t}무` : ''}). ${firsts}`);
    if (yb.champion) lines.push(`한국시리즈 우승 ${yb.champion}${yb.runnerUp ? `, 준우승 ${yb.runnerUp}` : ''}`);
    const ours = (yb.series ?? []).filter((s) => s.a === me.franchise || s.b === me.franchise || s.a === me.name || s.b === me.name);
    if (ours.length) lines.push(`우리 가을야구: ${ours.map((s) => `${s.a} 대 ${s.b} → ${s.winner} 승${s.ks ? ' (한국시리즈)' : ''}`).join(', ')}`);
  }
  // 우리 구단 그 해 주요 선수 (기록: 타자 홈런·안타, 투수 승·세이브·탈삼진)
  const rows = L.players.flatMap((p) => p.history.filter((h) => h.year === year && h.team === me.name).map((h) => ({ p, h })));
  const hitters = rows.filter((r) => r.h.bat && r.h.bat[1] >= 300).sort((a, b) => (b.h.bat![7] ?? 0) - (a.h.bat![7] ?? 0)).slice(0, 4)
    .map(({ p, h }) => `${p.name} ${h.bat![4]}안타 ${h.bat![7]}홈런 ${h.bat![8]}타점`);
  const pitchers = rows.filter((r) => r.h.pit && r.h.pit[5] >= 150).sort((a, b) => (b.h.pit![2] + b.h.pit![4]) - (a.h.pit![2] + a.h.pit![4])).slice(0, 4)
    .map(({ p, h }) => `${p.name} ${h.pit![2]}승 ${h.pit![4]}세이브 ${h.pit![11]}탈삼진`);
  if (hitters.length) lines.push(`주요 타자: ${hitters.join(', ')}`);
  if (pitchers.length) lines.push(`주요 투수: ${pitchers.join(', ')}`);
  const f = L.fantasy;
  const events = (f?.log ?? []).filter((e) => e.year === year && e.who !== CHRONICLE_WHO && !e.withdrawn).slice(-25).map((e) => `- ${e.title}`);
  if (events.length) lines.push('[그 해 이야기]', ...events);
  if (f?.notes?.length) lines.push('[단장 노트]', ...f.notes.slice(-10).map((n) => `- ${n.text}`));
  const prev = (f?.chronicles ?? []).filter((c) => c.year < year).slice(-2).map((c) => `- ${c.year}: ${c.title}`);
  if (prev.length) lines.push('[지난 연대기]', ...prev);
  return lines.join('\n');
}

export const CHRONICLE_SYSTEM = `너는 KBO 단장 시뮬레이션의 구단 역사가다. 한 시즌이 끝났다. 주어진 그 해 기록과 이야기로 구단 연대기 한 장을 쓴다.
- 그 해의 흐름(시작·고비·끝), 단장의 결정과 그 결과, 주요 선수, 다음 시즌으로 이어질 과제를 담는다.
- 기록 숫자는 주어진 것만 쓴다. 지난 연대기와 단장 노트의 이야기를 이어 간다.
${RULES}

[형식] JSON 하나만: {"title": "그 해를 한 줄로 (예: 2001 — 무너진 마운드, 살아난 타선)", "text": "연대기 본문 6~10문장"}`;

/** 연대기 한 장 → 이야기 글 (적용되면 fantasy.chronicles에도 남는다) */
export async function writeChronicle(g: GameSession, s: LlmSettings, year: number): Promise<Omit<FantasyEntry, 'year' | 'day'>> {
  const raw = await completeJsonText(s, {
    system: CHRONICLE_SYSTEM,
    messages: [{ role: 'user', content: chronicleSummary(g, year) }],
    mockReply: JSON.stringify({ title: `(시험용) ${year} 연대기`, text: '한 해가 지나갔다.' }),
  });
  const j = extractJson<{ title?: string; text?: string }>(raw);
  const text = String(j?.text ?? '').trim();
  if (!text) throw new Error(`AI가 형식에 맞지 않게 답했습니다. 답 앞부분: ${preview(raw)}`);
  return { kind: 'article', who: CHRONICLE_WHO, title: String(j?.title ?? `${year} 연대기`).slice(0, 80), text: text.slice(0, 4000), chronicle: year };
}
