// 자유 모드 판정 미리보기 (2026-10-13 사용자 선택 "판정 다시 하기·결과 미리보기").
// 게임 마스터의 판정을 바로 넣지 않고 먼저 보여 준다: 받아들이기 / 다시 판정 / 거둬들이기.
// 다시 판정은 하루(오프시즌은 한 오프시즌)에 AI 판정 단계만큼 (leniency.ts): 엄격할수록 적다. 거둬들인 행동도 "철회"로 기록에 남아
// 게임 마스터가 안다 (같은 행동을 되풀이해 좋은 결과를 낚지 못하게). 다시 판정 횟수는 이야기 글(rerolls)에 남아 재현된다.
import { useState } from 'react';
import { freeAction, type FreeOp } from '../../fantasy/free';
import { effectText } from '../../fantasy/effects';
import { loadAiSettings } from '../../fantasy/settings';
import { dueText } from '../../fantasy/promises';
import { leniencyOf, type Leniency } from '../../fantasy/leniency';
import { RULE_DEFS } from '../../league/rules';
import type { FantasyEntry } from '../../fantasy/types';
import type { GameSession } from '../../game/session';
import { useGame } from '../context';

export function opText(op: FreeOp, nameOf: (id: string) => string, teamName: (t: number) => string): string {
  switch (op.op) {
    case 'move': return op.to < 0 ? `${nameOf(op.player)} 방출` : `${nameOf(op.player)} → ${teamName(op.to)}`;
    case 'create': return `${op.real ? '영입 (리그 밖)' : '새 선수'} ${op.name} (${teamName(op.team)}, ${op.pos === 'P' ? (op.role === 'RP' ? '구원 투수' : op.role === 'SP' ? '선발 투수' : '투수') : op.pos === 'C' ? '포수' : op.pos === 'IF' ? '내야수' : '외야수'} ${op.age}세, 능력 ${op.now} 잠재 ${op.potential})`;
    case 'ability': return `${nameOf(op.player)} ${op.now !== undefined ? `능력 ${op.now}` : ''}${op.now !== undefined && op.potential !== undefined ? ' · ' : ''}${op.potential !== undefined ? `잠재 ${op.potential}` : ''}`;
    case 'contract': return `${nameOf(op.player)} 계약 연 ${(op.salary / 10000).toFixed(1)}억 원 ${op.years}년`;
    case 'teamCash': return `${teamName(op.team)} 자금 ${op.amount > 0 ? '+' : '−'}${Math.abs(op.amount / 10000).toFixed(1)}억 원`;
    case 'effect': return effectText(op.effect, nameOf);
    case 'pick': return `${op.draft} ${op.round}라운드 지명권(${teamName(op.from)} 원래) → ${teamName(op.to)}`;
    case 'rule': return `규정 변경: ${RULE_DEFS.find((d) => d.key === op.key)?.label ?? op.key} → ${op.value ?? '실제 규정'}`;
  }
}

/** 하루(오프시즌은 한 오프시즌) 다시 판정 횟수: 판정 단계 1~7 */
export const REROLLS: Record<Leniency, number> = { 0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 3, 6: 5 };

export function rerollBudget(g: GameSession): { limit: number; used: number } {
  const year = g.year;
  const day = g.phase === 'season' ? g.currentDay : -1;
  const used = (g.fantasy?.log ?? []).filter((e) => e.year === year && e.day === day).reduce((s, e) => s + (e.rerolls ?? 0), 0);
  return { limit: REROLLS[leniencyOf(g.league)], used };
}

type Draft = Omit<FantasyEntry, 'year' | 'day'>;
interface Pending { action: string; entry: Draft; dropped: string[]; rerolls: number }

/** 판정을 받아 미리보기로 두는 손잡이 */
export function useGmJudge(onDone?: (e: Draft, accepted: boolean) => void) {
  const { session, store, changed, autosave } = useGame();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = async (action: string, rerolls: number) => {
    setBusy(true);
    setError(null);
    try {
      const { entry, dropped } = await freeAction(session, store, loadAiSettings(), action);
      setPending({ action, entry, dropped, rerolls });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const finish = (e: Draft, accepted: boolean) => {
    session.addFantasy(e);
    setPending(null);
    changed();
    void autosave();
    onDone?.(e, accepted);
  };
  return {
    pending, busy, error,
    run: (action: string) => call(action, 0),
    reroll: () => { if (pending) void call(pending.action, pending.rerolls + 1); },
    accept: () => { if (pending) finish({ ...pending.entry, ...(pending.rerolls ? { rerolls: pending.rerolls } : {}) }, true); },
    withdraw: () => {
      if (!pending) return;
      const { ops: _o, promises: _p, settles: _s, ...rest } = pending.entry;
      finish({ ...rest, title: `(철회) ${rest.title}`, withdrawn: true, ...(pending.rerolls ? { rerolls: pending.rerolls } : {}) }, false);
    },
  };
}

export type GmJudge = ReturnType<typeof useGmJudge>;

export function GmPreviewCard({ judge }: { judge: GmJudge }) {
  const { session } = useGame();
  const p = judge.pending;
  if (!p) return null;
  const L = session.league;
  const nameOf = (id: string) => L.players.find((x) => x.id === id)?.name ?? id;
  const teamName = (t: number) => L.teams[t]?.name ?? '?';
  const { limit, used } = rerollBudget(session);
  const left = limit - used - p.rerolls;
  const e = p.entry;
  return (
    <div className="panel gm-preview stack" role="dialog" aria-label="판정 미리보기">
      <p className="muted small">판정 미리보기 — 아직 반영되지 않았습니다{p.rerolls ? ` (다시 판정 ${p.rerolls}번째)` : ''}</p>
      <h3>{e.title}</h3>
      {e.text.split('\n').filter(Boolean).map((line, k) => <p key={k}>{line}</p>)}
      {e.ops?.length ? <ul className="plain small fantasy-ops">{e.ops.map((op, k) => <li key={k}>→ {opText(op, nameOf, teamName)}</li>)}</ul> : <p className="muted small">게임 변화 없음</p>}
      {e.promises?.map((x, k) => <p key={k} className="small">🤝 약속: {x.party} — {x.text} (기한 {dueText(x)})</p>)}
      {p.dropped.length > 0 && <p className="muted small">반영할 수 없는 조작: {p.dropped.join(', ')}</p>}
      <div className="actions">
        <button type="button" onClick={judge.accept} disabled={judge.busy}>받아들이기</button>
        <button type="button" className="secondary" onClick={judge.reroll} disabled={judge.busy || left <= 0} title="같은 행동을 게임 마스터가 다시 판정합니다">
          {judge.busy ? '판정 중…' : `다시 판정 (오늘 ${Math.max(0, left)}번 남음)`}
        </button>
        <button type="button" className="secondary" onClick={judge.withdraw} disabled={judge.busy} title="행동을 거둬들입니다. 거둬들인 일도 기록에 남아 게임 마스터가 압니다">거둬들이기</button>
      </div>
    </div>
  );
}
