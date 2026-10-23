// AI에게 줄 게임 상황 요약 (docs/fantasy-mode.md). 기록 사실만 담는다.
// 숨겨진 특수능력(traits)은 넣지 않는다 (CLAUDE.md). 선수마다 실존/가상을 붙여 AI가 규칙을 지키게 한다.
import type { GameSession } from '../game/session';
import { formatDate } from '../game/calendar';
import { rankText } from '../game/rank';
import { avg, era, fixed2, ipText, ops, rate3, recentForm } from '../game/stats';
import { lineTeam, type SimPlayer } from '../engine';

const tag = (p: Pick<SimPlayer, 'real'>) => (p.real === false ? '(가상)' : '(실존)');

/** 지금 게임 상황을 글로 (수천 자 안쪽) */
export function gameContext(g: GameSession): string {
  const out: string[] = [];
  const year = g.world.year;
  const me = g.teamIdx;
  const team = g.league.teams[me];
  if (g.phase === 'season') {
    const s = g.season;
    const day = Math.min(g.currentDay, s.schedule.length - 1);
    out.push(`[날짜] ${formatDate(year, day)} (${year} 정규시즌${g.done ? ' 종료' : ''})`);
    const order = s.standings();
    const rec = s.teams[me];
    const divs = s.divisionStandings();
    out.push(`[우리 구단] ${team.name} — ${rec.w}승 ${rec.l}패 ${rec.t}무, ${rankText(g, me)} / ${divs ? `${divs.find((d) => d.teams.includes(me))?.teams.length ?? order.length}구단 (양대 리그)` : `${order.length}구단`}`);
    for (const d of divs ?? [{ name: '', teams: order }]) {
      out.push(`[${d.name ? `${d.name}리그 ` : ''}순위] ${d.teams.map((t, i) => `${i + 1}.${g.world.teams[t].name} ${s.teams[t].w}-${s.teams[t].l}`).join(', ')}`);
    }
    const form = recentForm(s.log, me);
    if (form.w + form.l + form.t) out.push(`[최근 ${form.w + form.l + form.t}경기] ${form.w}승 ${form.l}패 ${form.t}무${form.streak ? `, ${form.streak}` : ''}`);
    const mine = g.world.players.filter((p) => lineTeam(p) === me);
    const hitters = mine.filter((p) => !p.isPitcher && s.bat[p.idx].pa >= 20).sort((a, b) => s.bat[b.idx].pa - s.bat[a.idx].pa).slice(0, 9);
    if (hitters.length) {
      out.push('[우리 타자 (타석 많은 순)]');
      for (const p of hitters) {
        const b = s.bat[p.idx];
        out.push(`- ${p.name}${tag(p)} ${p.age ?? '?'}세: ${b.pa}타석 타율 ${rate3(avg(b))} ${b.hr}홈런 ${b.rbi}타점 OPS ${rate3(ops(b))}`);
      }
    }
    const pitchers = mine.filter((p) => p.isPitcher && s.pit[p.idx].outs >= 9).sort((a, b) => s.pit[b.idx].outs - s.pit[a.idx].outs).slice(0, 7);
    if (pitchers.length) {
      out.push('[우리 투수 (이닝 많은 순)]');
      for (const p of pitchers) {
        const q = s.pit[p.idx];
        out.push(`- ${p.name}${tag(p)} ${p.age ?? '?'}세: ${ipText(q.outs)}이닝 ${q.w}승 ${q.l}패 ${q.sv}세이브 평균자책 ${fixed2(era(q))}`);
      }
    }
    // 우리 경기 최근 결과 몇 개
    const games = s.log.filter((x) => x.home === me || x.away === me).slice(-3);
    if (games.length) {
      out.push('[최근 우리 경기]');
      for (const x of games) out.push(`- ${g.world.teams[x.away].name} ${x.awayRuns} : ${x.homeRuns} ${g.world.teams[x.home].name}`);
    }
  } else {
    out.push(`[날짜] ${year} 시즌 뒤 오프시즌 (${g.offseason?.stage ?? ''} 단계)`);
    const last = g.league.lastSeason;
    for (const d of last ? last.divisions ?? [{ name: '', teams: last.standings }] : []) {
      out.push(`[지난 시즌 ${d.name ? `${d.name}리그 ` : ''}순위] ${d.teams.map((t, i) => `${i + 1}.${g.league.teams[t].name}`).join(', ')}`);
    }
    if (last?.postseason) out.push(`[우승] ${g.league.teams[last.postseason.champion]?.name ?? '-'}`);
  }
  const o = g.league.owner;
  if (o) out.push(`[구단주 신뢰] ${Math.round(o.trust)} / 100`);
  out.push(`[구단 자금] ${Math.round(g.cashNow() / 10000)}억 원`);
  const news = g.news.slice(-12).map((n) => `- ${n.text}`);
  if (news.length) out.push('[최근 소식]', ...news);
  const story = g.league.fantasy?.log.slice(-5).map((e) => `- ${e.title}`) ?? [];
  if (story.length) out.push('[지난 이야기 제목]', ...story);
  return out.join('\n');
}
