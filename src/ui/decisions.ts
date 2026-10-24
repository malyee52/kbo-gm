// 결정함 (2026-10-22 UI 대개편 1차): 지금 답하거나 처리해야 하는 일을 한곳에 모은다.
// 새 사건을 만들지 않는다. 이미 게임에 있는 처리 대상(이벤트, 오프시즌 단계, 시즌 마무리, 판타지 선택 등)만 모아 보여 준다.
// 기한은 게임에 실제로 있는 단계 조건만 쓰고 날짜를 지어내지 않는다 (when).
import type { GameSession } from '../game/session';
import { LINEUP_SLOTS, MIN_PLAN_ROTATION, teamRules } from '../engine';
import * as Off from '../league/offseason';
import { ruleOf } from '../league/rules';
import { pendingChoices } from '../fantasy/types';
import { offerExpired } from '../fantasy/rivals';
import { meetingSlot, SLOT_LABEL } from '../fantasy/ownerMeeting';
import { eventDef } from '../league/events';
import type { Screen } from './context';
import type { Group } from './menu';

/** 결정 종류: 홈 카드의 묶음 이름 */
export type DecisionKind = '사건' | '계약' | '지명' | '선수단' | '엔트리' | '시즌' | '구단주' | '면담' | '대화';

export interface Decision {
  key: string;
  kind: DecisionKind;
  /** 메뉴 배지를 붙일 대분류 */
  group: Group;
  title: string;
  /** 왜 해야 하는지 한 문장 */
  why: string;
  /** 실제 단계 조건 (예: "FA 2/3라운드 마감 전"). 없으면 생략 */
  when?: string;
  /** 처리하러 갈 화면 */
  go: Screen;
  /** 답하기 전에는 진행이 막히는 일 */
  blocking?: boolean;
  /**
   * "확인"으로 내려 둘 수 있는 알림이면 지금 상태 서명 (2026-10-23 UI 2차 결정 3).
   * 확인한 서명과 지금 서명이 같으면 다시 띄우지 않고, 상태가 바뀌면(서명이 달라지면) 다시 띄운다
   */
  ack?: string;
}

/** 확인한 알림: 결정 key → 확인할 때의 상태 서명 */
export type Acked = Record<string, string>;

/** 지금 처리할 일. 막히는 일 → 단계 순. acked에 같은 상태로 확인한 알림은 뺀다 */
export function decisions(s: GameSession, acked: Acked = {}): Decision[] {
  const out: Decision[] = [];
  const me = s.teamIdx;

  // 무작위 이벤트: 답하기 전에는 진행할 수 없다 (EventDialog)
  const ev = s.pendingEvent;
  if (ev) {
    out.push({
      key: `event:${ev.id}`, kind: '사건', group: '브리핑', title: eventDef(ev.id)?.title ?? '이벤트',
      why: '답하기 전에는 경기를 진행할 수 없습니다.', when: '진행 전', go: 'home', blocking: true,
    });
  }

  // 진행 중인 경기 (UI 2단계 2.2.2): 지휘하던 경기 창을 닫았다. 끝까지 지휘하거나 감독에게 맡기기 전에는 진행·선수단 조작이 막힌다 (session.gameLock)
  if (s.gameLock) {
    const v = s.pendingScore();
    const at = v ? (v.over ? `경기 끝 ${v.awayRuns}:${v.homeRuns}` : `${v.inn}회${v.top ? '초' : '말'} ${v.awayRuns}:${v.homeRuns}`) : '';
    out.push({
      key: 'live-game', kind: '시즌', group: '브리핑', title: `진행 중인 경기${at ? ` (${at})` : ''}`,
      why: '지휘하던 경기가 저장돼 있습니다. 홈의 다음 경기 카드에서 이어서 지휘하거나 감독에게 맡겨 끝내야 진행·선수단 조작을 할 수 있습니다.', go: 'home', blocking: true,
    });
  }

  // 해고 뒤 영입 제의 (구단 현황의 제의 고르기)
  if (s.owner.offers?.length) {
    out.push({
      key: 'owner-offers', kind: '구단주', group: '경영', title: `영입 제의 ${s.owner.offers.length}곳`,
      why: '해고된 뒤 다른 구단의 제의가 와 있습니다. 하나를 골라야 다음 시즌을 맡습니다.', go: 'club', blocking: true,
    });
  }

  // 엔트리: 직접 관리하는 1군·기용표에 이미 생긴 빈 곳만 (기한 없음)
  if (s.phase === 'season' && s.canManage && s.manualEntry) out.push(...entryDecisions(s));

  if (s.phase === 'season' && s.done) {
    if (s.postseasonRunning) {
      out.push({ key: 'ps', kind: '시즌', group: '시즌', title: '가을야구 진행 중', why: '가을야구를 끝까지 치러야 시즌 결산을 할 수 있습니다.', go: 'postseason' });
    } else {
      const { cands, chosen } = s.enlistOptions();
      if (cands.length) {
        out.push({
          key: 'enlist', kind: '선수단', group: '전력', title: `입대 선택 (후보 ${cands.length}명, 지금 ${chosen.length}명)`,
          why: '이번 오프시즌에 입대할 선수를 결산 전에 정합니다. 그대로 두면 추천대로 갑니다.', when: '시즌 결산 전', go: 'enlist',
        });
      }
      out.push({ key: 'settle', kind: '시즌', group: '시즌', title: '시즌 결산', why: '결산하면 구단주 평가·시상·성장 판정을 하고 오프시즌이 열립니다.', go: 'season-end' });
    }
  }

  const off = s.offseason;
  if (s.phase === 'offseason' && off) {
    const stageText = `${Off.STAGE_LABEL[off.stage]} 단계`;
    if (off.stage === 'fa') {
      const leaving = off.fa.entries.filter((e) => e.from === me && e.status === 'open' && !off.fa.userOffers[e.id]);
      if (leaving.length) {
        out.push({
          key: 'fa-own', kind: '계약', group: '영입', title: `우리 FA ${leaving.length}명 제시 전`,
          why: '붙잡으려면 제시해야 합니다. 마지막 라운드까지 계약하지 못하면 떠납니다.',
          when: `FA ${off.fa.round}/${Off.FA_ROUNDS}라운드 마감 전`, go: 'offseason',
        });
      }
    }
    if (off.stage === 'comp') {
      for (const c of off.comp ?? []) {
        const name = s.leaguePlayer(c.fa)?.name ?? c.fa;
        if (c.from === me && c.pick === null) {
          out.push({ key: `comp-pick:${c.fa}`, kind: '계약', group: '영입', title: `${name} 보상 고르기`, why: '보상선수 또는 보상금만을 고릅니다. 고르지 않으면 추천 기준으로 정합니다.', when: '보상선수 단계 마감 전', go: 'offseason' });
        }
        if (c.to === me) {
          out.push({ key: `comp-protect:${c.fa}`, kind: '계약', group: '영입', title: `${name} 보호선수 명단`, why: '다른 구단이 데려갈 수 없게 지킬 선수를 정합니다.', when: '보상선수 단계 마감 전', go: 'offseason' });
        }
      }
    }
    if (off.stage === 'draft' && off.draft) {
      const total = Off.draftTotal(off);
      if (off.draft.pick < total && Off.draftTeamAt(off, off.draft.pick) === me) {
        out.push({ key: 'draft', kind: '지명', group: '영입', title: '신인 지명 차례', why: '우리 구단이 지명할 차례입니다.', when: '지금', go: 'offseason' });
      }
    }
    if (off.stage === 'release') {
      const count = s.league.players.filter((p) => p.team === me && p.military?.state !== 'serving' && !p.dev).length;
      const over = count - ruleOf(s.league, 'orgLimit');
      if (over > 0) {
        out.push({ key: 'release', kind: '선수단', group: '영입', title: `정원 초과 ${over}명`, why: '정원에 맞게 방출하거나 육성선수로 돌려야 다음 단계로 갈 수 있습니다.', when: '정원 정리 단계', go: 'offseason', blocking: true });
      }
    }
    const postings = (off.postings ?? []).filter((x) => !x.decided);
    if (postings.length && off.stage !== 'release' && off.stage !== 'ready') {
      out.push({ key: 'posting', kind: '계약', group: '영입', title: `포스팅 요청 ${postings.length}건`, why: '답하지 않으면 붙잡은 것으로 합니다.', when: '정원 정리 단계 전', go: 'offseason' });
    }
    // 단계 진행 자체: 다른 할 일이 없어도 오프시즌은 단계를 넘겨야 끝난다
    out.push({
      key: `stage:${off.stage}`, kind: '시즌', group: '영입',
      title: off.stage === 'ready' ? `${off.year + 1} 시즌 개막` : `오프시즌 ${stageText}`,
      why: off.stage === 'ready' ? '선수단 구성이 끝났습니다. 개막하면 새 시즌이 시작됩니다.' : '이 단계를 마치면 다음 단계로 넘어갑니다.',
      go: 'offseason',
    });
  }

  // 판타지: 답을 기다리는 선택 (기한이 지난 제안은 뺀다)
  const choices = pendingChoices(s.fantasy).filter((e) => !offerExpired(s, e));
  if (choices.length) {
    out.push({ key: 'fantasy-choices', kind: '대화', group: '브리핑', title: `답을 기다리는 일 ${choices.length}건`, why: choices.at(-1)!.title, go: 'fantasy' });
  }
  // 판타지: 구단주 면담 (열린 때가 정해져 있다)
  const slot = meetingSlot(s);
  if (slot) {
    const when = slot === 'pre' ? '개막 뒤 10일 안' : slot === 'mid' ? '시즌 중반 ±15일 안' : '이번 오프시즌 안';
    out.push({ key: `meeting:${slot}`, kind: '면담', group: '경영', title: SLOT_LABEL[slot], why: '구단주 쪽 안건을 듣고 답합니다.', when, go: 'owner' });
  }

  return out.filter((d) => d.ack === undefined || acked[d.key] !== d.ack).sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking));
}

/**
 * 결정함 '엔트리' 기준 (2026-10-22 UI 대개편 2차): 지금 이미 있는 상태만 센다.
 * 1군 정원 초과·미달, 1군 결장 선수, (기용표를 직접 정했을 때) 결장·말소로 빈 주전 자리, 마무리·선발 역할 칸 빈 곳.
 * AI 감독 기용이면 자리·역할은 AI가 채우므로 세지 않는다
 */
export function entryDecisions(s: GameSession): Decision[] {
  const out: Decision[] = [];
  const reg = s.registered();
  const regIdx = new Set(reg.map((p) => p.idx));
  const size = teamRules(s.world, s.team).rosterSize;
  const base = { kind: '엔트리' as const, group: '전력' as const, go: 'lineup' as const };
  if (reg.length > size) {
    out.push({ ...base, key: 'entry-size', title: `1군 정원 초과 ${reg.length - size}명`, why: `1군은 ${size}명까지입니다 (지금 ${reg.length}명).` });
  } else if (reg.length < size) {
    // 빈자리는 일부러 비워 두기도 한다: 한 번 확인하면 1군 인원이 바뀔 때까지 다시 띄우지 않는다 (UI 2차 결정 3)
    out.push({ ...base, key: 'entry-size', title: `1군 빈자리 ${size - reg.length}명`, why: `1군 ${size}명 중 ${reg.length}명만 등록돼 있습니다.`, ack: `${reg.length}/${size}` });
  }
  const absent = reg.filter((p) => s.isAbsent(p));
  if (absent.length) {
    out.push({
      ...base, key: 'entry-absent', title: `1군 결장 ${absent.length}명`,
      why: `${absent.map((p) => p.name).join(', ')}이(가) 결장 중인데 1군 자리를 차지하고 있습니다. 모자라면 경기 때 2군에서 임시로 올립니다.`,
    });
  }
  const plan = s.plan;
  if (plan) {
    const P = s.world.players;
    const out1 = (i: number) => !regIdx.has(i) || s.isAbsent(P[i]);
    const empty = LINEUP_SLOTS.filter((sl) => plan.starters[sl] !== undefined && out1(plan.starters[sl]!));
    if (empty.length) {
      out.push({
        ...base, key: 'entry-starter', title: `빈 주전 자리 ${empty.join('·')}`,
        why: `${empty.map((sl) => `${sl} ${P[plan.starters[sl]!].name}(${regIdx.has(plan.starters[sl]!) ? '결장' : '1군에 없음'})`).join(', ')}. 그동안은 AI 감독이 대기 선수로 채웁니다.`,
      });
    }
    const roles: string[] = [];
    if (plan.closer === null) roles.push('마무리 없음');
    else if (out1(plan.closer)) roles.push(`마무리 ${P[plan.closer].name} ${regIdx.has(plan.closer) ? '결장' : '1군에 없음'}`);
    const rot = plan.rotation.filter((i) => !out1(i)).length;
    if (rot < MIN_PLAN_ROTATION) roles.push(`선발 ${rot}명`);
    if (roles.length) {
      out.push({ ...base, key: 'entry-role', title: `투수 역할 빈 칸: ${roles.join(', ')}`, why: '빈 역할은 AI 감독이 대신 정합니다. 직접 정하려면 기용 보드에서 고릅니다.' });
    }
  }
  return out;
}

const ACK_KEY = 'kbo-gm.ack';

/** 확인한 알림 (게임마다, 이 브라우저에 기억). 화면 취향이라 저장 파일·조작 기록에는 넣지 않는다 */
export function loadAcked(game: string): Acked {
  try {
    const all = JSON.parse(localStorage.getItem(ACK_KEY) ?? '{}') as Record<string, Acked>;
    return all[game] ?? {};
  } catch {
    return {};
  }
}

export function saveAcked(game: string, acked: Acked): void {
  try {
    const all = JSON.parse(localStorage.getItem(ACK_KEY) ?? '{}') as Record<string, Acked>;
    all[game] = acked;
    localStorage.setItem(ACK_KEY, JSON.stringify(all));
  } catch { /* 기억하지 못해도 화면은 그대로 (다시 뜰 뿐) */ }
}

/** 종류별 묶음 (홈 카드) */
export function byKind(list: Decision[]): { kind: DecisionKind; items: Decision[] }[] {
  const out: { kind: DecisionKind; items: Decision[] }[] = [];
  for (const d of list) {
    const g = out.find((x) => x.kind === d.kind);
    if (g) g.items.push(d);
    else out.push({ kind: d.kind, items: [d] });
  }
  return out;
}

/** 대분류별 건수 (메뉴 배지) */
export function countByGroup(list: Decision[]): Partial<Record<Group, number>> {
  const out: Partial<Record<Group, number>> = {};
  for (const d of list) out[d.group] = (out[d.group] ?? 0) + 1;
  return out;
}
