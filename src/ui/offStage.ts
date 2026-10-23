// 오프시즌 단계 화면의 계산 (2026-10-23 UI 2단계 U2-6, 기획안 2.5): 남은 처리와 "넘기면 일어나는 일", 단계 요약 줄, 지난 단계 기록.
// 화면 계산만 한다. 단계 진행·자동 처리는 늘 세션 조작(nextStage·autoComp·autoDraft·autoRelease)을 거쳐 조작 기록에 남는다.
// "넘기면 일어나는 일" 문구는 league/offseason.ts의 실제 단계 처리(advanceStage·blockedReason·closeOffseason)와 맞춘다.
import type { GameSession } from '../game/session';
import * as Off from '../league/offseason';
import { dollarText, FA_COMP, salaryCap, teamCapPayroll, wonText } from '../league/salary';
import { ruleOf } from '../league/rules';

/** 남은 처리를 한 번에 해결하고 넘기는 길 (조작 하나 + 다음 단계) */
export type LeftoverFix = 'auto-comp' | 'auto-draft' | 'auto-release';

export interface Leftover {
  key: string;
  /** 남은 일 */
  title: string;
  /** 그대로 넘기면 일어나는 일 (막히면 막히는 까닭) */
  then: string;
  /** 처리하기 전에는 넘길 수 없다 (Off.blockedReason) */
  blocking?: boolean;
  fix?: LeftoverFix;
}

export const FIX_LABEL: Record<LeftoverFix, string> = {
  'auto-comp': '추천대로 고르고 넘기기',
  'auto-draft': '남은 지명 자동으로 하고 넘기기',
  'auto-release': '정원까지 자동 방출하고 넘기기',
};

/** 지금 단계에서 우리 구단이 아직 하지 않은 일 (기획안 2.5.1 "남은 처리"). 없으면 빈 목록 */
export function stageLeftovers(s: GameSession): Leftover[] {
  const off = s.offseason;
  if (s.phase !== 'offseason' || !off) return [];
  const me = s.teamIdx;
  const L = s.league;
  const name = (id: string) => s.leaguePlayer(id)?.name ?? id;
  const names = (ids: string[], max = 4) => ids.slice(0, max).map(name).join(', ') + (ids.length > max ? ` 외 ${ids.length - max}명` : '');
  const out: Leftover[] = [];

  switch (off.stage) {
    case 'fa': {
      const open = off.fa.entries.filter((e) => e.from === me && e.status === 'open' && !off.fa.userOffers[e.id]).map((e) => e.id);
      if (open.length) {
        const last = off.fa.round >= Off.FA_ROUNDS;
        out.push({
          key: 'fa-own', title: `우리 FA ${open.length}명 제시 전 (${names(open)})`,
          then: last
            ? '마지막 라운드라 계약하지 못한 우리 FA는 떠납니다 (무적 선수).'
            : `이번 라운드에 우리 제시가 없어 다른 구단이 제시하면 그 구단과 계약할 수 있습니다 (남은 라운드 ${Off.FA_ROUNDS - off.fa.round}).`,
        });
      }
      break;
    }
    case 'comp': {
      for (const c of off.comp ?? []) {
        if (c.from === me && c.pick === null) {
          out.push({
            key: `comp-pick:${c.fa}`, title: `${name(c.fa)} 보상 고르기`, blocking: true, fix: 'auto-comp',
            then: '보상선수 또는 보상금만을 고르기 전에는 넘길 수 없습니다. 추천 기준은 보호 명단 밖 최고 가치 선수입니다.',
          });
        }
        if (c.to === me) {
          const limit = FA_COMP[c.grade].protect ?? 0;
          if (c.protect.length < limit) {
            out.push({ key: `comp-protect:${c.fa}`, title: `${name(c.fa)} 보호 명단 ${c.protect.length}/${limit}명`, then: `이 명단으로 확정됩니다. 빈 ${limit - c.protect.length}자리만큼 덜 지킵니다.` });
          }
        }
      }
      break;
    }
    case 'second': {
      for (const d of [off.expansion, off.second]) {
        if (!d) continue;
        const label = d.kind === 'second' ? '2차 드래프트' : '특별 지명';
        if (Off.protectDraftTeams(L, off, d).includes(me)) {
          const n = (d.protect[String(me)] ?? []).length;
          if (n < d.limit) out.push({ key: `${d.kind}-protect`, title: `${label} 보호 명단 ${n}/${d.limit}명`, then: `이 명단으로 확정됩니다. 빈 ${d.limit - n}자리만큼 덜 지킵니다.` });
        }
        const picker = d.kind === 'second' || d.team === me;
        if (picker && d.wish.length === 0) {
          out.push({
            key: `${d.kind}-wish`, title: `${label} 지명 희망 없음`,
            then: d.kind === 'second' ? '우리 구단은 지명하지 않습니다 (패스).' : '구단마다 보호 명단 밖 최고 가치 선수를 자동으로 지명합니다.',
          });
        }
      }
      break;
    }
    case 'foreign': {
      const f = off.foreign;
      if (!f) break;
      const drop = Object.entries(f.keep).filter(([, k]) => !k).map(([id]) => id);
      if (drop.length) out.push({ key: 'foreign-drop', title: `재계약하지 않는 외국인 ${drop.length}명 (${names(drop)})`, then: '계약이 끝나 후보 명단으로 나갑니다. 다른 구단이 데려갈 수 있습니다.' });
      if (f.order[f.pointer] === me) {
        const sl = Off.foreignSlots(L, me, off);
        const lim = Off.foreignLimits(off);
        const reg = lim.regular - sl.regular;
        const asia = lim.asia - sl.asia;
        if (reg > 0 || asia > 0) {
          const parts = [reg > 0 ? `일반 ${reg}명` : '', asia > 0 ? `아시아쿼터 ${asia}명` : ''].filter(Boolean).join(' · ');
          out.push({ key: 'foreign-empty', title: `외국인 빈자리 ${parts}`, then: '우리 차례가 끝나고, 빈자리를 비운 채 남은 구단이 고릅니다.' });
        }
      }
      break;
    }
    case 'draft': {
      const d = off.draft;
      if (!d) break;
      const total = Off.draftTotal(off);
      if (d.pick < total && d.pool.length) {
        let mine = 0;
        for (let i = d.pick; i < total; i++) if (Off.draftTeamAt(off, i) === me) mine++;
        out.push({
          key: 'draft', title: mine ? `우리 지명 ${mine}건 남음` : '드래프트 진행 중', blocking: true, fix: 'auto-draft',
          then: '드래프트를 끝내기 전에는 넘길 수 없습니다. 자동 지명은 스카우트 평가가 높은 선수부터 고릅니다.',
        });
      }
      break;
    }
    case 'salary': {
      const sal = off.salary;
      if (sal) {
        const low = Object.keys(sal.offers).filter((id) => sal.offers[id] < sal.demands[id]);
        if (low.length) out.push({ key: 'salary-low', title: `요구액보다 낮게 제시 ${low.length}명 (${names(low)})`, then: '조정을 거쳐 제시액과 요구액의 가운데로 정합니다.' });
      }
      const postings = (off.postings ?? []).filter((x) => !x.decided).map((x) => x.id);
      if (postings.length) out.push({ key: 'posting', title: `포스팅 요청 답하지 않음 ${postings.length}건 (${names(postings)})`, then: '정원 정리 단계부터는 답할 수 없고, 답하지 않으면 붙잡은 것으로 합니다.' });
      break;
    }
    case 'release': {
      const over = Off.userOrgSize(L, off) - ruleOf(L, 'orgLimit');
      if (over > 0) {
        const plan = s.releasePlan();
        out.push({
          key: 'release', title: `정원 초과 ${over}명`, blocking: true, fix: 'auto-release',
          then: `정원에 맞게 방출하거나 육성선수로 돌리기 전에는 넘길 수 없습니다. 자동 방출 대상: ${plan.order.slice(0, over).map((p) => p.name).join(', ')} (되돌릴 수 없음).`,
        });
      }
      break;
    }
    case 'ready':
      break;
  }
  return out;
}

/** 단계 위 줄 요약 (기획안 2.5.2 "위 줄"). 글자 몇 조각 */
export function stageHeadline(s: GameSession): string[] {
  const off = s.offseason;
  if (!off) return [];
  const me = s.teamIdx;
  const L = s.league;
  const next = off.year + 1;
  const cap = salaryCap(next, L);
  const pay = teamCapPayroll(L, me, next);
  const capText = cap ? `캡 여유 ${wonText(cap - pay, next)}` : `연봉 총액 ${wonText(pay, next)}`;
  switch (off.stage) {
    case 'vote':
      return [];
    case 'fa': {
      const offers = Object.keys(off.fa.userOffers).length;
      return [`${off.fa.round}/${Off.FA_ROUNDS}라운드`, `우리 제시 ${offers}건`, capText];
    }
    case 'comp': {
      const cases = off.comp ?? [];
      return [`우리가 고를 것 ${cases.filter((c) => c.from === me).length}건`, `우리가 낼 보호 명단 ${cases.filter((c) => c.to === me).length}건`];
    }
    case 'second': {
      const out: string[] = [];
      for (const d of [off.expansion, off.second]) {
        if (!d) continue;
        out.push(`${d.kind === 'second' ? '2차 드래프트' : '특별 지명'} 보호 ${(d.protect[String(me)] ?? []).length}/${d.limit}명 · 희망 ${d.wish.length}명`);
      }
      return out.length ? out : ['이번 오프시즌은 지명이 없습니다'];
    }
    case 'foreign': {
      const sl = Off.foreignSlots(L, me, off);
      const lim = Off.foreignLimits(off);
      const turn = off.foreign && off.foreign.order[off.foreign.pointer] === me;
      return [
        `보유 ${sl.regular}/${lim.regular}명${lim.asia ? ` · 아시아쿼터 ${sl.asia}/${lim.asia}명` : ''}`,
        `총액 ${dollarText(sl.regularPay)} / ${dollarText(sl.cap)}`,
        turn ? '우리 차례' : '우리 차례 아님',
      ];
    }
    case 'draft': {
      const d = off.draft;
      if (!d) return [];
      const total = Off.draftTotal(off);
      let nextPick = -1;
      let left = 0;
      for (let i = d.pick; i < total; i++) if (Off.draftTeamAt(off, i) === me) { if (nextPick < 0) nextPick = i; left++; }
      return [
        d.pick >= total || !d.pool.length ? '드래프트 끝' : nextPick < 0 ? '우리 지명 끝' : nextPick === d.pick ? '우리 차례' : `우리 다음 지명 ${nextPick + 1}번째`,
        `남은 우리 지명 ${left}건`,
      ];
    }
    case 'salary': {
      const sal = off.salary;
      const n = sal ? Object.keys(sal.offers).length : 0;
      return [`협상 ${n}명`, capText];
    }
    case 'release': {
      const size = Off.userOrgSize(L, off);
      const lim = ruleOf(L, 'orgLimit');
      return [`소속 ${size}/${lim}명${size > lim ? ' ⚠' : ''}`];
    }
    case 'ready':
      return [];
  }
}

/** 지난 단계 기록 (읽기 전용): 그 단계 소식 묶음. 'settle'은 결산 */
export function stageRecord(s: GameSession, stage: Off.LogStage, all = false): { text: string; mine: boolean }[] {
  const off = s.offseason;
  if (!off) return [];
  return off.log.filter((l) => l.stage === stage && (all || l.mine || l.major)).map((l) => ({ text: l.text, mine: l.mine }));
}
