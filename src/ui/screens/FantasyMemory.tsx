// 회귀자 모드의 기억 노트 (docs/fantasy-mode.md 2단계): 원래 역사(실제 기록), 앞으로 터질 선수, 다가올 드래프트, 역사가 바뀐 시즌.
// 기록 사실만 보여 준다. "기억을 떠올리기"는 AI가 단장의 독백을 쓴다 (이야기 기록에 남는다).
import { useMemo, useState } from 'react';
import { breakouts, divergences, draftGems, memoryContext, seasonMemory } from '../../fantasy/history';
import { complete } from '../../fantasy/llm';
import { loadAiSettings } from '../../fantasy/settings';
import { gameContext } from '../../fantasy/context';
import { MEMORY_SYSTEM, splitArticle } from '../../fantasy/prompts';
import { loadNaiSettings } from '../../fantasy/nai';
import { useGame } from '../context';

export function FantasyMemory({ onWrote }: { onWrote: () => void }) {
  const { session, store, changed } = useGame();
  const year = session.phase === 'season' ? session.world.year : session.year + 1;
  const last = Math.max(...store.meta.years);
  const [open, setOpen] = useState<number | null>(year);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const years = useMemo(() => store.meta.years.filter((y) => y >= year), [store, year]);
  const breaks = useMemo(() => breakouts(store, session.league, year), [store, session.league, year]);
  const drafts = useMemo(() => [year, year + 1, year + 2].filter((y) => y <= last + 1).map((y) => ({ y, gems: draftGems(store, y + 1) })).filter((x) => x.gems.length), [store, year, last]);
  const div = divergences(store, session.league);

  const recall = async () => {
    setBusy(true);
    setMsg({ text: 'AI가 기억을 떠올리는 중입니다…' });
    try {
      const text = await complete(loadAiSettings(), {
        system: MEMORY_SYSTEM,
        messages: [{ role: 'user', content: `[게임 상황]\n${gameContext(session)}\n\n${memoryContext(store, session.league, year)}\n\n지금 주인공의 독백을 써 줘.` }],
        maxTokens: 900,
        mockReply: `다시 돌아온 ${year}년\n\n나는 이 시즌이 어떻게 끝나는지 안다. (시험용 글)`,
      });
      const { title, body } = splitArticle(text);
      if (!body) throw new Error('AI 답이 비어 있습니다. 다시 시도하세요.');
      session.addFantasy({ kind: 'memory', title, text: body, who: '회귀자의 기억' });
      changed();
      setMsg({ text: '이야기에 남겼습니다.' });
      const nai = loadNaiSettings();
      if (nai.auto && nai.token.trim()) onWrote();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  if (!years.length) {
    return <section className="panel"><h2>기억 노트</h2><p className="muted">자료가 있는 마지막 해({last})를 지났습니다. 이제부터는 아무도 모르는 시간입니다.</p></section>;
  }
  return (
    <section className="stack">
      <div className="panel">
        <div className="row-between wrap">
          <h2>기억 노트 <span className="muted small">원래 역사 (실제 기록, {year}~{last})</span></h2>
          <button type="button" onClick={() => void recall()} disabled={busy}>{busy ? '떠올리는 중…' : '기억을 떠올리기 (AI 독백)'}</button>
        </div>
        {msg && <p className={msg.error ? 'note error-box' : 'muted small'} role="status">{msg.text}</p>}
        <p className="muted small">단장만 아는 기록입니다. 게임은 이 역사와 다르게 흘러갈 수 있습니다. 선수 능력이 기록대로 나오는 것은 아닙니다.</p>
      </div>

      {div.length > 0 && (
        <div className="panel">
          <h3>지나온 시즌: 원래 역사와 비교</h3>
          <ul className="plain small">
            {div.map((d) => (
              <li key={d.year}>{d.year}: {d.same ? <>원래대로 <strong>{d.gameChampion}</strong> 우승</> : <>원래 <strong>{d.realChampion ?? '?'}</strong> 우승 → 이번에는 <strong className="up">{d.gameChampion ?? '?'}</strong> (역사가 바뀌었다)</>}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <h3>시즌별 원래 역사</h3>
        {years.map((y) => {
          const m = seasonMemory(store, y);
          if (!m) return null;
          const isOpen = open === y;
          return (
            <div key={y} className="memory-year">
              <button type="button" className="link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : y)}>
                {isOpen ? '▾' : '▸'} {y}: {m.champion ? <>우승 <strong>{m.champion}</strong></> : '진행 중 (정규시즌 순위)'} · 1위 {m.standings[0]?.team}
              </button>
              {isOpen && (
                <div className="small memory-body">
                  <p>순위: {m.standings.map((s) => `${s.rank}.${s.team} (${s.w}승 ${s.l}패)`).join(' · ')}</p>
                  <p>타이틀: {m.leaders.map((l) => `${l.label} ${l.name}(${l.team}) ${l.value}`).join(' · ')}</p>
                  <p>가장 빛난 선수: {m.stars.map((s) => `${s.name}(${s.team}) ${s.line}`).join(' · ')}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {breaks.length > 0 && (
        <div className="panel">
          <h3>앞으로 터질 선수 <span className="muted small">지금 리그에 있는 선수의 실제 최고 시즌 (가치 순)</span></h3>
          <ul className="plain small">
            {breaks.map((b) => <li key={b.id}><strong>{b.name}</strong> (지금 {b.team}{b.age !== null ? `, 그때 ${b.age}세` : ''}): {b.year}년 {b.line}</li>)}
          </ul>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="panel">
          <h3>다가올 신인 드래프트 <span className="muted small">실제로 나중에 크게 된 선수 (통산 가치 순, 게임 드래프트에 같은 선수가 나온다)</span></h3>
          {drafts.map(({ y, gems }) => (
            <p key={y} className="small"><strong>{y}년 가을 지명 ({y + 1} 입단)</strong>: {gems.map((g) => `${g.name} (${g.team} ${g.pick}, ${g.peakYear}년 정점)`).join(' · ')}</p>
          ))}
        </div>
      )}
    </section>
  );
}
