// 개막 알림 "올해 달라지는 규칙"의 일정 항목 (일정 개편 기획안 2.3·8장 11단계).
//
// 표시 기능이다: 연도별 일정 규칙 표(data/schedule.ts)만 읽고 난수를 쓰지 않으며, 저장 형식·조작 기록에 닿지 않는다.
// 지난해 규칙과 견줘 바뀐 것만 줄로 만든다: 경기 수·상대별, 연전 틀, 올스타 휴식, 우천 순연·더블헤더, 국제대회 등으로 쉬는 기간.
// 실제 올스타전이 여러 경기였던 해(1982~1985, 2000)는 "게임은 1경기로 단순화" 줄을 늘 붙인다 (결정 10).
// 양대 리그(1999·2000 드림·매직)의 시작·재편·끝도 여기서 한 줄로 만든다 (leagueNews, 기획안 10.6).
// 이 브랜치에는 개막 알림 창(규칙 알림, league/ruleNews.ts)이 아직 없어 개막 소식 한 줄로 보인다. 그 창과 합치면 이 줄들을 창의 일정 분류로 넘긴다.
import { daysBetween, type Divisions, type IsoDate, type YearScheduleRule } from '../data/schedule';
import type { ScheduleFrame } from '../data/types';

export type ScheduleRule = Pick<YearScheduleRule, 'year' | 'games' | 'vs' | 'vsOther' | 'frame' | 'breaks' | 'allStar' | 'allStarGamesReal' | 'postpone' | 'dhBan' | 'status' | 'projected'>;

/** 일정 알림 한 줄 */
export interface ScheduleNewsLine {
  key: 'games' | 'frame' | 'allStarBreak' | 'allStarGames' | 'postpone' | 'stop' | 'league';
  title: string;
  /** 전 → 후 (전이 없으면 후만) */
  before?: string;
  after?: string;
  /** 게임이 실제와 다르게 단순화한 내용 */
  simplified?: string;
  /** 규칙 표의 확인 상태 (조사값·출처 갈림, 2027~는 2026 모양) */
  status: string;
}

/** 연전 틀 설명 (기획안 2.1) */
const FRAME_LABEL: Record<ScheduleFrame, string> = {
  W82: '수요일 단발(목요일이 열리면 2연전) + 토·일 2연전',
  W83: '주중 2·3연전 + 토·일 2연전',
  T3W2: '화~목 3연전 + 토·일 2연전',
  S2: '2연전 (화·수 / 목·금 / 토·일)',
  S33: '3연전 (화~목 / 금~일)',
  'S33-99': '3연전, 후반기에 2연전 섞음',
  'S33-9': '3연전 + 2연전 (9구단, 한 팀씩 휴식)',
  S33L2: '3연전, 여름부터 2연전',
  S33F: '3연전, 올스타 뒤 4연전',
};

const md = (d: IsoDate) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const span = (from: IsoDate, to: IsoDate) => `${md(from)}~${md(to)}`;

function gamesText(r: ScheduleRule): string {
  const vs = r.vsOther !== undefined ? `같은 리그 ${r.vs}·다른 리그 ${r.vsOther}차전` : `상대별 ${r.vs}차전`;
  return `팀당 ${r.games}경기 (${vs})`;
}

/** 연전 틀 (2연전 시작일은 해마다 달라 넣지 않는다: 날짜만 바뀐 해에 줄이 생기지 않게) */
function frameText(r: ScheduleRule): string {
  return FRAME_LABEL[r.frame];
}

const isAllStarBreak = (reason: string) => reason.includes('올스타');
const isStop = (reason: string) => !reason.includes('올스타') && !reason.includes('전후기');

/** 올스타 휴식 (경기 없는 날 수). 올스타가 없는 해는 null */
function allStarBreakDays(r: ScheduleRule): number | null {
  if (!r.allStar) return null;
  const b = r.breaks.find((x) => isAllStarBreak(x.reason) && x.from <= r.allStar! && r.allStar! <= x.to);
  return b ? daysBetween(b.from, b.to) + 1 : 1;
}

function allStarText(r: ScheduleRule): string {
  const n = allStarBreakDays(r);
  return n === null ? '올스타전 없음' : `${n}일`;
}

/** 우천 순연·더블헤더 (기획안 4.3, engine/weather.ts) */
function postponeText(r: ScheduleRule): string {
  const ban = r.dhBan.length ? `, ${r.dhBan.map((b) => span(b.from, b.to)).join('·')} 더블헤더 없음` : '';
  switch (r.postpone) {
    case 'R1': return '비로 미룬 경기는 다음 날 더블헤더 (평일·주말), 아니면 그 주 빈 날이나 시즌 끝';
    case 'R2':
      return r.year <= 2007 ? '주말 취소는 다음 월요일, 나머지는 시즌 끝 잔여 경기. 더블헤더 없음'
        : r.year <= 2009 ? '주말 취소는 다음 월요일, 나머지는 시즌 끝 잔여 경기. 일요일만 더블헤더'
          : '주말 취소는 다음 월요일, 나머지는 시즌 끝 잔여 경기. 잔여 경기 주말에만 더블헤더';
    case 'R3': return `주말 취소는 다음 월요일, 나머지는 잔여 경기 발표 때 다시 편성 (월요일 경기·더블헤더 포함)${ban}`;
    case 'R3c': return `취소 다음 날 같은 상대면 더블헤더(수·목·토·일), 아니면 월요일${ban}`;
    case 'R4': return `금·토 취소는 다음 날 더블헤더, 그 밖은 다음 월요일 또는 잔여 경기. 월요일 더블헤더 없음${ban}`;
    case 'R5': return `금·토 취소는 다음 날 더블헤더, 그 밖은 다음 월요일 또는 잔여 경기. 월요일·2주 연속 더블헤더 없음${ban}`;
  }
}

function stopText(r: ScheduleRule): string {
  return r.breaks.filter((b) => isStop(b.reason)).map((b) => `${span(b.from, b.to)} ${b.reason}`).join(', ');
}

/**
 * 그 해 일정 알림 줄. prev = 지난해 규칙 (없으면 시작 해처럼 경기 수·연전·올스타·순연을 모두 보인다).
 * 쉬는 기간(국제대회 등)과 올스타 단순화는 지난해와 상관없이 그 해에 있으면 보인다
 */
export function scheduleNews(rule: ScheduleRule, prev?: ScheduleRule): ScheduleNewsLine[] {
  const status = rule.projected ? '2026 모양 (임시값)' : rule.status;
  const out: ScheduleNewsLine[] = [];
  const diff = (key: ScheduleNewsLine['key'], title: string, f: (r: ScheduleRule) => string) => {
    const after = f(rule);
    if (!prev) out.push({ key, title, after, status });
    else if (f(prev) !== after) out.push({ key, title, before: f(prev), after, status });
  };
  diff('games', '정규시즌 경기 수', gamesText);
  diff('frame', '연전', frameText);
  diff('allStarBreak', '올스타 휴식', allStarText);
  diff('postpone', '우천 순연·더블헤더', postponeText);
  if (rule.allStarGamesReal > 1) {
    out.push({ key: 'allStarGames', title: '올스타전', after: '1경기', simplified: `실제 올스타전은 ${rule.allStarGamesReal}경기, 게임은 1경기로 단순화`, status });
  }
  const stop = stopText(rule);
  if (stop) out.push({ key: 'stop', title: '정규시즌 중단', after: stop, status });
  return out;
}

/** 시즌 자료의 구단별 리그 칸 (`league`). 두 가지 값이면 양대 리그 해 */
type LeagueData = { teams: { franchise: string; league: string | null }[] } | undefined;
const isSplit = (d: LeagueData) => !!d && d.teams.every((t) => t.league) && new Set(d.teams.map((t) => t.league)).size === 2;

/**
 * 양대 리그 알림 (일정 개편 기획안 10.6 개막 알림): 1999 "드림·매직 양대 리그 (…)", 2000 "리그 재편: 삼성 드림, 롯데 매직",
 * 2001 "양대 리그 → 단일 리그". 자료는 양대 리그인데 게임 구단이 자료와 맞지 않아 나누지 않은 해(divisions null)는 "단일 리그로 진행".
 * cur = 올해 월드의 나눔, teams = 올해 구단 (색인 순), data·prevData = 올해·지난해 시즌 자료. 지난해 소속은 자료의 계보로 견준다
 * (게임 안 승계로 계보가 바뀐 구단은 견주지 않는다: 2000 SK). 난수·저장과 무관한 표시 기능
 */
export function leagueNews(cur: Divisions | null | undefined, teams: readonly { name: string; franchise: string }[], data: LeagueData, prevData: LeagueData): ScheduleNewsLine[] {
  const status = '자료집';
  const prevSplit = isSplit(prevData);
  if (cur) {
    const d = cur;
    const lineup = d.names.map((n, k) => `${n} ${d.teams[k].map((t) => teams[t].name).join('·')}`).join(' / ');
    if (!prevSplit) {
      return [{ key: 'league', title: '리그', ...(prevData ? { before: '단일 리그' } : {}),
        after: `${d.names.join('·')} 양대 리그 (${lineup}). 각 리그 1·2위가 가을야구에 나가고, 한 리그 3위 승률이 다른 리그 2위보다 높으면 둘이 준플레이오프`, status }];
    }
    const prevOf = new Map(prevData!.teams.map((t) => [t.franchise, t.league]));
    const moved = d.teams.flatMap((ts, k) => ts.filter((t) => {
      const p = prevOf.get(teams[t].franchise);
      return p !== undefined && p !== d.names[k];
    }).map((t) => `${teams[t].name} ${d.names[k]}`));
    return moved.length ? [{ key: 'league', title: '리그 재편', after: `${moved.join(', ')} (${lineup})`, status }] : [];
  }
  if (isSplit(data)) return [{ key: 'league', title: '리그', after: '단일 리그로 진행 (구단 구성이 그 해 실제와 달라 양대 리그로 나누지 않음)', status }];
  if (prevSplit) return [{ key: 'league', title: '리그', before: '양대 리그', after: '단일 리그', status }];
  return [];
}

/** 소식 한 줄: "1983 시즌 일정 (조사값): 정규시즌 경기 수 팀당 80경기 … → 팀당 100경기 … / …". 줄이 없으면 null */
export function scheduleNewsText(year: number, lines: readonly ScheduleNewsLine[]): string | null {
  if (!lines.length) return null;
  const statuses = [...new Set(lines.map((l) => l.status))].join('·');
  const parts = lines.map((l) => (l.simplified ? `${l.title}: ${l.simplified}`
    : `${l.title}: ${l.before !== undefined ? `${l.before} → ${l.after}` : l.after}`));
  return `${year} 시즌 일정 (${statuses}): ${parts.join(' / ')}.`;
}
