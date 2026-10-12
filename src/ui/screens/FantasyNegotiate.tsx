// 판타지 협상 화면 조각 (src/fantasy/negotiate.ts): 트레이드 설득, 에이전트 설득. 판타지 게임에서만 보인다.
import { useState } from 'react';
import type { SimPlayer } from '../../engine';
import { isStarterSkill } from '../../engine';
import { currentRuns } from '../../ai/value';
import { TENDENCY_LABEL } from '../../ai/trade';
import type { DraftPick } from '../../league/picks';
import { GM_STYLE_LABEL, gmStyle } from '../../league/gm';
import type { LeaguePlayer } from '../../league/types';
import { agentTalk, agentTalkBlock, negotiatorOf, tradeTalk, tradeTalkBlock, GOODWILL_DAYS } from '../../fantasy/negotiate';
import { effectText } from '../../fantasy/effects';
import { goodwillFor, discountFor } from '../../fantasy/types';
import { loadAiSettings } from '../../fantasy/settings';
import { GmPreviewCard, useGmJudge } from './GmPreview';
import { avg, era, fixed2, ipText, ops, rate3 } from '../../game/stats';
import { useGame, posName } from '../context';
import { runsGrade } from '../grades';

function playerLine(session: ReturnType<typeof useGame>['session'], p: SimPlayer): string {
  const b = session.season.bat[p.idx];
  const q = session.season.pit[p.idx];
  const role = p.isPitcher ? (isStarterSkill(p.pit) ? '선발' : '구원') : posName(p.pos);
  const grade = runsGrade(currentRuns(p, session.values), session.year);
  const rec = p.isPitcher ? (q.bf ? `${ipText(q.outs)}이닝 평균자책 ${fixed2(era(q))}` : '기록 없음') : (b.pa ? `${b.pa}타석 타율 ${rate3(avg(b))} OPS ${rate3(ops(b))}` : '기록 없음');
  return `${p.name}${p.real === false ? '(가상)' : '(실존)'} ${role} ${p.age ?? '?'}세, 능력 ${grade}, 올해 ${rec}`;
}

/** 트레이드 설득: 지금 고른 제안으로 상대 운영팀장과 이야기한다. 결과 호감이 트레이드 평가에 더해진다 */
export function TradeTalk({ team, give, get, cash, picks, pickLabel }: {
  team: number; give: SimPlayer[]; get: SimPlayer[]; cash: number; picks: { give: DraftPick[]; get: DraftPick[] }; pickLabel: (p: DraftPick) => string;
}) {
  const { session, changed, autosave } = useGame();
  const [arg, setArg] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ text: string; error?: boolean } | null>(null);
  // 자유 모드: 판정 미리보기 (GmPreview.tsx)
  const judge = useGmJudge((e, ok) => { setArg(''); setOut({ text: ok ? (e.ops?.length ? '→ 게임에 반영했습니다.' : '→ 성사되지 않았습니다.') : '→ 거둬들였습니다.' }); });
  if (!session.fantasy) return null;
  const { name, role } = negotiatorOf(session.league, team);
  const now = goodwillFor(session.fantasy, team, session.world.year, session.currentDay);
  const block = session.fantasy.free ? null : tradeTalkBlock(session, team);
  const free = !!session.fantasy.free;
  const talk = async () => {
    setBusy(true);
    setOut(null);
    try {
      if (free) {
        // 자유 모드: 게임 마스터(AI)가 직접 판정한다. 안전망 없음 (사용자 결정 2026-10-13)
        const action = `${session.league.teams[team].name}에 트레이드를 제안한다. 우리가 주는 것: ${give.map((p) => p.name).join(', ') || '선수 없음'}${cash > 0 ? `, 현금 ${(cash / 10000).toFixed(1)}억 원` : ''}${picks.give.length ? `, 지명권 ${picks.give.map(pickLabel).join(', ')}` : ''}. 받는 것: ${get.map((p) => p.name).join(', ') || '선수 없음'}${cash < 0 ? `, 현금 ${(-cash / 10000).toFixed(1)}억 원` : ''}${picks.get.length ? `, 지명권 ${picks.get.map(pickLabel).join(', ')}` : ''}. 상대 ${role} ${name}를 이렇게 설득한다: ${arg.trim()}`;
        await judge.run(action);
        return;
      }
      const ev = session.evaluateTrade(team, give, get, cash, picks);
      const gap = Math.max(0, ev.detail.need - ev.detail.gain);
      const verdict = ev.verdict === 'accept' ? 'accept' : ev.verdict === 'reject-value' ? (gap <= 6 ? 'short' : 'far') : 'invalid';
      const lines = [
        `우리(상대 구단)가 받는 것: ${give.map((p) => playerLine(session, p)).join(' / ') || '선수 없음'}`,
        `우리가 내주는 것: ${get.map((p) => playerLine(session, p)).join(' / ') || '선수 없음'}`,
        cash ? `현금: ${cash > 0 ? `단장 쪽이 ${(cash / 10000).toFixed(1)}억 원을 준다` : `우리가 ${(-cash / 10000).toFixed(1)}억 원을 준다`}` : '',
        picks.give.length ? `받는 지명권: ${picks.give.map(pickLabel).join(', ')}` : '',
        picks.get.length ? `내주는 지명권: ${picks.get.map(pickLabel).join(', ')}` : '',
      ].filter(Boolean).join('\n');
      const sit = session.situation(team);
      const tendency = `${TENDENCY_LABEL[session.tendency(team)]}, ${sit.rank}위, 단장 성향 ${GM_STYLE_LABEL[gmStyle(session.league, team)]}`;
      const e = await tradeTalk(session, loadAiSettings(), { team, proposal: lines, verdict, gap, tendency, argument: arg.trim() });
      session.addFantasy(e);
      const runs = e.effects?.[0]?.type === 'tradeGoodwill' ? e.effects[0].runs : 0;
      const after = session.evaluateTrade(team, give, get, cash, picks);
      setOut({ text: `${name}: "${e.text}"\n→ 호감 ${runs > 0 ? '+' : ''}${runs}런 (${GOODWILL_DAYS}일). 지금 제안은 ${after.verdict === 'accept' ? '받아들여질 만합니다. "제안하기"를 누르세요.' : '아직 모자랍니다.'}` });
      setArg('');
      changed();
      void autosave();
    } catch (err) {
      setOut({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="negotiate">
      <h3>설득하기 <span className="muted small">{role} {name} (가상 인물){free ? ' · AI가 직접 판정' : ` · 지금 호감 ${now > 0 ? '+' : ''}${now}런`}</span></h3>
      <p className="muted small">{free
        ? '자유 모드: 상대(AI)가 설득을 듣고 받아들이면 그 자리에서 트레이드가 성사됩니다. 조건을 바꿔 역제안할 수도 있습니다.'
        : `고른 제안을 두고 상대를 설득합니다. 상대 구단 사정에 맞는 논리면 호감이 생겨 트레이드 평가에 더해지고(최대 ±6런, ${GOODWILL_DAYS}일), 무리한 압박은 오히려 깎입니다. 다시 협상하면 호감이 바뀝니다.`}</p>
      <textarea rows={3} maxLength={600} value={arg} placeholder="예: 리빌딩 중이시니 젊은 포수가 필요하실 겁니다. 우리 ○○는 2군에서…" disabled={busy || !!block} onChange={(e) => setArg(e.target.value)} />
      <div className="actions">
        <button type="button" onClick={() => void talk()} disabled={busy || judge.busy || !!judge.pending || !!block || !arg.trim() || (give.length === 0 && get.length === 0)}>{busy || judge.busy ? '상대가 듣는 중…' : '설득하기'}</button>
        {block && <span className="muted small">{block}</span>}
      </div>
      {judge.error && <p className="note error-box" role="status">{judge.error}</p>}
      <GmPreviewCard judge={judge} />
      {out && <p className={out.error ? 'note error-box' : 'note'} role="status" style={{ whiteSpace: 'pre-line' }}>{out.text}</p>}
    </div>
  );
}

/** 에이전트 설득 (FA·다년 계약): 그 선수 요구액 할인·할증 */
export function AgentTalk({ p, situation }: { p: LeaguePlayer; situation: string }) {
  const { session, changed, autosave } = useGame();
  const [open, setOpen] = useState(false);
  const [arg, setArg] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ text: string; error?: boolean } | null>(null);
  const judge = useGmJudge((e, ok) => { setArg(''); setOut({ text: ok ? (e.ops?.length ? '→ 게임에 반영했습니다.' : '→ 변화 없음') : '→ 거둬들였습니다.' }); });
  if (!session.fantasy) return null;
  const pct = discountFor(session.fantasy, p.id, session.year);
  const free = !!session.fantasy.free;
  const block = free ? null : agentTalkBlock(session, p);
  const talk = async () => {
    setBusy(true);
    setOut(null);
    try {
      if (free) {
        await judge.run(`${p.name}의 에이전트와 계약을 협상한다 (${situation}). 이렇게 말한다: ${arg.trim()}`);
        return;
      }
      const e = await agentTalk(session, loadAiSettings(), p, situation, arg.trim());
      session.addFantasy(e);
      setOut({ text: `"${e.text}" → ${e.effects!.map((x) => effectText(x, () => p.name)).join(', ')}` });
      changed();
      void autosave();
    } catch (err) {
      setOut({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <span className="inline">
        {pct !== 0 && <span className={pct > 0 ? 'up small' : 'down small'}>협상 {pct > 0 ? `−${Math.round(pct * 100)}%` : `+${Math.round(-pct * 100)}%`}</span>}
        {!block && <button type="button" className="small-btn ghost" onClick={() => setOpen(true)}>에이전트 설득</button>}
      </span>
    );
  }
  return (
    <div className="negotiate small">
      <textarea rows={2} maxLength={600} value={arg} placeholder={`${p.name} 측 에이전트를 설득할 말 (이번 오프시즌 한 번)`} disabled={busy} onChange={(e) => setArg(e.target.value)} />
      <span className="inline">
        <button type="button" className="small-btn" onClick={() => void talk()} disabled={busy || judge.busy || !!judge.pending || !arg.trim() || !!block}>{busy || judge.busy ? '듣는 중…' : '설득'}</button>
        <button type="button" className="small-btn ghost" onClick={() => setOpen(false)} disabled={!!judge.pending}>닫기</button>
      </span>
      {judge.error && <p className="note error-box">{judge.error}</p>}
      <GmPreviewCard judge={judge} />
      {out && <p className={out.error ? 'note error-box' : 'note'}>{out.text}</p>}
    </div>
  );
}
