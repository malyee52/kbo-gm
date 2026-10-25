// 전체 검색 (2026-10-23 UI 2단계 공통 기능, 기획안 4장 2·결정 10): 계산만. 그리기는 screens/Find.tsx.
// 상태 줄 검색 칸이 선수(현역·은퇴), 구단, 경기(이번 시즌 날짜·상대 "6/14 LG"), 연표(연도), 소식·기사를 묶어 찾는다.
// 결과는 이미 있는 화면(선수 상세·구단 창·일정·아카이브·소식)으로만 이어진다: 숨은 능력·AI 판단값은 여기서 새지 않는다.
// 지난 시즌의 경기 기록은 저장하지 않으므로 옛 경기는 기사(경기 기사)와 연표로 찾는다.
import { dateOf, shortDate } from '../game/calendar';
import type { GameSession } from '../game/session';
import { lineTeam } from '../engine';

export type HitKind = 'player' | 'retired' | 'team' | 'game' | 'year' | 'news' | 'article';
export const HIT_LABEL: Record<HitKind, string> = {
  player: '선수', retired: '은퇴·떠난 선수', team: '구단', game: '이번 시즌 경기', year: '연표', news: '구단 소식', article: '기사',
};
export const HIT_ORDER: HitKind[] = ['player', 'team', 'game', 'retired', 'year', 'news', 'article'];

export interface Hit {
  kind: HitKind;
  key: string;
  title: string;
  sub: string;
  /** 선수 상세를 열 수 있는 선수 (시즌 월드 색인) */
  idx?: number;
  /** 관심 명단에 담을 선수 id */
  id?: string;
  team?: number;
  /** 일정 화면에 넘길 경기 로그 색인 */
  game?: number;
}

export interface FindResult { hits: Record<HitKind, Hit[]>; more: Record<HitKind, number>; date: { month: number; date: number } | null; words: string[] }

/** 한 갈래에 보이는 최대 수 */
export const FIND_LIMIT = 20;

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '');

/** "6/14", "6.14", "6-14", "6월 14일" → 날짜. 나머지 낱말은 이름·구단 조건 */
export function parseQuery(q: string): { date: { month: number; date: number } | null; words: string[] } {
  const m = q.match(/(\d{1,2})\s*(?:[/.-]|월)\s*(\d{1,2})\s*일?/);
  const date = m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= 31 ? { month: Number(m[1]), date: Number(m[2]) } : null;
  const rest = (m ? q.replace(m[0], ' ') : q).split(/\s+/).map((w) => w.trim()).filter(Boolean);
  return { date, words: rest };
}

export function findAll(s: GameSession, q: string, limit = FIND_LIMIT): FindResult {
  const { date, words } = parseQuery(q);
  const all: Record<HitKind, Hit[]> = { player: [], retired: [], team: [], game: [], year: [], news: [], article: [] };
  const empty = { hits: all, more: { player: 0, retired: 0, team: 0, game: 0, year: 0, news: 0, article: 0 }, date, words };
  if (!date && !words.length) return empty;
  const year = s.world.year;
  const L = s.league;
  const teams = L.teams.map((t, i) => ({ i, name: t.name, n: norm(t.name) }));
  // 낱말 가운데 구단 이름에 맞는 것은 구단 조건, 나머지는 글 조건
  const teamWords = words.filter((w) => norm(w).length >= 2 && teams.some((t) => t.n.includes(norm(w)))); // 한 글자는 이름 조건으로만
  const want = teams.filter((t) => teamWords.some((w) => t.n.includes(norm(w)))).map((t) => t.i);
  const textWords = words.map(norm);
  const has = (text: string) => textWords.every((w) => norm(text).includes(w));
  // 선수 이름은 구단 낱말을 뺀 나머지로 찾고, 구단 낱말이 있으면 그 구단 선수만 ("김 LG")
  const nameWords = words.filter((w) => !teamWords.includes(w)).map(norm);
  const named = (name: string) => nameWords.length > 0 && nameWords.every((w) => norm(name).includes(w));
  const inTeams = (t: number) => !want.length || want.includes(t);
  const tname = (t: number) => (t >= 0 ? s.teamInfo(t).name : '자유계약');

  // 구단
  if (words.length && !date) {
    for (const t of teams) if (want.includes(t.i)) all.team.push({ kind: 'team', key: `t${t.i}`, title: t.name, sub: '구단 창 (명단·예상 기용·계약)', team: t.i });
  }

  // 선수: 시즌 중엔 월드(트레이드·방출 반영), 오프시즌엔 리그 상태 + 지난 시즌 월드
  if (nameWords.length && !date) {
    const seen = new Set<string>();
    const wps = new Map(s.world.players.map((p) => [p.id, p]));
    if (s.phase === 'season') {
      for (const p of s.world.players) {
        if (!named(p.name) || !inTeams(lineTeam(p))) continue;
        const lp = s.leaguePlayer(p.id);
        if (p.teamIdx < 0 && !lp?.market && p.formerTeam === undefined) continue; // 아직 시장에 나오지 않은 선수
        seen.add(p.id);
        all.player.push({ kind: 'player', key: `p${p.id}`, title: p.name, sub: `${tname(lineTeam(p))} · ${p.isPitcher ? '투수' : p.pos ?? '야수'}${p.age !== null ? ` · ${p.age}세` : ''}`, idx: p.idx, id: p.id, team: p.teamIdx });
      }
    }
    for (const lp of L.players) {
      if (seen.has(lp.id) || !named(lp.name) || !inTeams(lp.team) || lp.reserve !== undefined) continue;
      if (s.phase === 'season') continue; // 시즌 중 월드에 없는 리그 선수는 복무 중·해외 (관심 명단에서 본다)
      seen.add(lp.id);
      const wp = wps.get(lp.id);
      const where = lp.team >= 0 ? tname(lp.team) : lp.abroad ? '해외 리그' : lp.freeAgent ? '미계약 FA' : s.offseason?.draft?.pool.includes(lp.id) ? '신인 지명 후보' : '소속 없음';
      all.player.push({ kind: 'player', key: `p${lp.id}`, title: lp.name, sub: `${where} · ${lp.isPitcher ? '투수' : lp.pos ?? '야수'}`, idx: wp?.idx, id: lp.id, team: lp.team });
    }
    // 은퇴·리그를 떠난 선수 (게임 안 통산, history.ts)
    const gone = new Set<string>();
    for (const a of L.archive ?? []) {
      if (seen.has(a.id) || gone.has(a.id) || !named(a.name) || want.length) continue;
      gone.add(a.id);
      all.retired.push({ kind: 'retired', key: `r${a.id}`, title: a.name, sub: `${a.why === 'retired' ? '은퇴' : '리그를 떠남'} · ${a.lastYear}년 ${a.lastTeam} · 게임 안 ${a.seasons}시즌`, id: a.id });
    }
    for (const r of L.retired ?? []) {
      if (seen.has(r.id) || gone.has(r.id) || !named(r.name) || !inTeams(r.team)) continue;
      gone.add(r.id);
      all.retired.push({ kind: 'retired', key: `r${r.id}`, title: r.name, sub: `은퇴 · ${r.year}년 ${L.teams[r.team]?.name ?? ''}${r.age !== null ? ` · ${r.age}세` : ''}`, id: r.id });
    }
  }

  // 이번 시즌 경기: 날짜 또는 구단 (두 구단이면 맞대결)
  if (s.phase === 'season' && (date || teamWords.length)) {
    const log = s.season.log;
    for (let i = log.length - 1; i >= 0; i--) {
      const g = log[i];
      if (date) {
        const d = dateOf(year, g.day);
        if (d.month !== date.month || d.date !== date.date) continue;
      }
      if (want.length && !want.every((t) => g.home === t || g.away === t)) continue;
      all.game.push({ kind: 'game', key: `g${i}`, title: `${shortDate(year, g.day)} ${tname(g.away)} ${g.awayRuns} : ${g.homeRuns} ${tname(g.home)}`, sub: g.innings > 9 ? `연장 ${g.innings}회` : '', game: i });
    }
  }

  // 연표: 연도 (4자리 숫자)
  for (const w of words) {
    if (!/^\d{4}$/.test(w)) continue;
    const y = (L.yearbook ?? []).find((r) => r.year === Number(w));
    if (y) all.year.push({ kind: 'year', key: `y${y.year}`, title: `${y.year} 시즌`, sub: `1위 ${y.teams[0]?.name ?? '-'}${y.champion ? ` · 우승 ${y.champion}` : ''}${y.inGame ? '' : ' (실제 기록)'}` });
  }

  // 소식·기사: 글에 낱말이 모두 들어 있으면 (날짜면 그날)
  const dayOk = (y: number | undefined, d: number) => {
    if (!date) return true;
    if (d < 0 || (y ?? year) !== year) return false;
    const x = dateOf(year, d);
    return x.month === date.month && x.date === date.date;
  };
  for (let i = s.news.length - 1; i >= 0; i--) {
    const n = s.news[i];
    if ((words.length && !has(n.text)) || !dayOk(n.year, n.day)) continue;
    all.news.push({ kind: 'news', key: `n${i}`, title: n.text, sub: `${n.year ?? L.startYear}${n.day >= 0 ? ` ${shortDate(n.year ?? year, n.day)}` : ' 오프시즌'}` });
  }
  const arts = L.articles ?? [];
  for (let i = arts.length - 1; i >= 0; i--) {
    const a = arts[i];
    if ((words.length && !has(`${a.title} ${a.body}`)) || !dayOk(a.year, a.day)) continue;
    all.article.push({ kind: 'article', key: `a${i}`, title: a.title, sub: `${a.year}${a.day >= 0 ? ` ${shortDate(a.year, a.day)}` : ''}` });
  }

  const hits = {} as Record<HitKind, Hit[]>;
  const more = {} as Record<HitKind, number>;
  for (const k of HIT_ORDER) {
    hits[k] = all[k].slice(0, limit);
    more[k] = Math.max(0, all[k].length - limit);
  }
  return { hits, more, date, words };
}
