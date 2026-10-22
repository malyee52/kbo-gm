// 결정함 (2026-10-22 UI 대개편 1차): 지금 답하거나 처리해야 하는 일을 한곳에 모은다.
// 새 사건을 만들지 않는다. 이미 게임에 있는 처리 대상(이벤트, 오프시즌 단계, 시즌 마무리, 판타지 선택 등)만 모아 보여 준다.
// 기한은 게임에 실제로 있는 단계 조건만 쓰고 날짜를 지어내지 않는다 (when).
import type { GameSession } from '../game/session';
import * as Off from '../league/offseason';
import { ruleOf } from '../league/rules';
import { pendingChoices } from '../fantasy/types';
import { offerExpired } from '../fantasy/rivals';
import { meetingSlot, SLOT_LABEL } from '../fantasy/ownerMeeting';
import { eventDef } from '../league/events';
import type { Screen } from './context';
import type { Group } from './menu';

/** 결정 종류: 홈 카드의 묶음 이름 */
export type DecisionKind = '사건' | '계약' | '지명' | '선수단' | '시즌' | '구단주' | '면담' | '대화';

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
}

/** 지금 처리할 일. 막히는 일 → 단계 순 */
export function decisions(s: GameSession): Decision[] {
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

  // 해고 뒤 영입 제의 (구단 현황의 제의 고르기)
  if (s.owner.offers?.length) {
    out.push({
      key: 'owner-offers', kind: '구단주', group: '경영', title: `영입 제의 ${s.owner.offers.length}곳`,
      why: '해고된 뒤 다른 구단의 제의가 와 있습니다. 하나를 골라야 다음 시즌을 맡습니다.', go: 'club', blocking: true,
    });
  }

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

  return out.sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking));
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
