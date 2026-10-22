// 전체 검색 (2026-10-23 UI 2단계 공통 기능, 기획안 4장 2·결정 10): 상태 줄 검색 칸 또는 공통 > 전체 검색.
// 선수(현역·은퇴), 구단, 이번 시즌 경기(날짜·상대), 연표(연도), 구단 소식·기사를 갈래별로 보여 준다. 계산은 ui/find.ts.
// 결과는 이미 있는 화면으로만 이어진다 (선수 상세·구단 창·일정·아카이브·소식).
import { useMemo, useState } from 'react';
import { findAll, HIT_LABEL, HIT_ORDER, type Hit } from '../find';
import { useGame } from '../context';
import { WatchStar } from './Watch';

export function Find({ initialText = '' }: { initialText?: string }) {
  const { session, version, go, openPlayer } = useGame();
  const [text, setText] = useState(initialText);
  const [q, setQ] = useState(initialText);
  const r = useMemo(() => findAll(session, q), [session, q, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = HIT_ORDER.reduce((a, k) => a + r.hits[k].length + r.more[k], 0);

  const open = (h: Hit) => {
    if (h.kind === 'player') { if (h.idx !== undefined) openPlayer(h.idx); return; }
    if (h.kind === 'team') go('team', h.team);
    else if (h.kind === 'game') go('schedule', h.game);
    else if (h.kind === 'retired') go('rec-career');
    else if (h.kind === 'year') go('records');
    else if (h.kind === 'news') go('news');
    else if (h.kind === 'article') go('articles');
  };
  const canOpen = (h: Hit) => h.kind !== 'player' || h.idx !== undefined;
  const where: Partial<Record<Hit['kind'], string>> = { retired: '아카이브 > 통산에서 기록 보기', year: '아카이브 > 연표', news: '브리핑 > 소식', article: '브리핑 > 기사', game: '일정·결과에서 박스스코어' };

  return (
    <div className="stack">
      <form className="find-form" role="search" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); }}>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="선수 이름, 구단, 날짜(6/14), 연도(2031)" aria-label="전체 검색" autoFocus={!initialText} />
        <button type="submit">찾기</button>
        <button type="button" className="ghost" onClick={() => go('search')} disabled={session.phase !== 'season'}
          title={session.phase !== 'season' ? '오프시즌에는 쉼 (계약은 영입 > 계약·지명)' : '자리·나이·등급·계약 조건으로 현역 선수 찾기'}>조건으로 선수 찾기</button>
      </form>
      <p className="muted small">
        예: <code>김</code> (이름), <code>LG</code> (구단과 이번 시즌 LG 경기), <code>6/14 LG</code> (그날 LG 경기), <code>2031</code> (그 해 연표).
        지난 시즌 경기는 따로 남기지 않아 기사·연표로 찾습니다.
      </p>
      {q && total === 0 && <p className="muted">"{q}"에 맞는 것이 없습니다.</p>}
      {HIT_ORDER.filter((k) => r.hits[k].length).map((k) => (
        <section key={k} className="find-group">
          <h2>{HIT_LABEL[k]} <span className="muted small">{r.hits[k].length + r.more[k]}건{r.more[k] ? ` (앞 ${r.hits[k].length}건만, 더 좁혀 찾으세요)` : ''}</span></h2>
          <ul className="plain find-list">
            {r.hits[k].map((h) => (
              <li key={h.key}>
                {canOpen(h)
                  ? <button type="button" className="link" onClick={() => open(h)} title={where[h.kind]}>{h.title}</button>
                  : <span>{h.title}</span>}
                {h.sub && <span className="muted small"> {h.sub}</span>}
                {(h.kind === 'player' || h.kind === 'retired') && h.id && <> <WatchStar id={h.id} name={h.title} small /></>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
