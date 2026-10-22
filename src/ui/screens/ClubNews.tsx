// 브리핑 > 소식 > 구단 소식 (2026-10-22 UI 대개편 1차): 예전 홈의 '알림' 카드(종류별 보기)와 진행 중인 효과를 옮겼다.
import { useState } from 'react';
import type { NewsKind } from '../../game/session';
import { shortDate } from '../../game/calendar';
import { useGame } from '../context';

type NewsGroup = 'all' | 'player' | 'move' | 'club' | 'season';
/** 알림 묶음 (session.ts NewsKind) */
const NEWS_GROUPS: Record<NewsGroup, { label: string; kinds: NewsKind[] }> = {
  all: { label: '전체', kinds: [] },
  player: { label: '선수', kinds: ['absence', 'return', 'callup', 'entry', 'plan'] },
  move: { label: '이적', kinds: ['trade', 'offseason'] },
  club: { label: '구단', kinds: ['owner', 'event'] },
  season: { label: '시즌', kinds: ['season'] },
};
const PAGE = 50;

export function ClubNews() {
  const { session } = useGame();
  const year = session.year;
  // 고른 묶음은 이 브라우저에 기억한다
  const [kind, setKindState] = useState<NewsGroup>(() => { try { return (localStorage.getItem('kbo-news-kind') as NewsGroup) || 'all'; } catch { return 'all'; } });
  const setKind = (k: NewsGroup) => { setKindState(k); try { localStorage.setItem('kbo-news-kind', k); } catch { /* 저장 못 해도 화면은 그대로 */ } };
  const [shown, setShown] = useState(PAGE);
  const all = [...session.news].reverse().filter((n) => kind === 'all' || NEWS_GROUPS[kind].kinds.includes(n.kind));
  return (
    <div className="stack">
      <ActiveEffects />
      <section className="panel">
        <div className="row-between wrap">
          <h2>구단 소식 <span className="muted small">{all.length}건</span></h2>
          <div className="seg small" role="tablist" aria-label="소식 종류">
            {(Object.keys(NEWS_GROUPS) as NewsGroup[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{NEWS_GROUPS[k].label}</button>
            ))}
          </div>
        </div>
        {all.length === 0 ? <p className="muted">소식이 없습니다.</p> : (
          <ul className="alerts">
            {all.slice(0, shown).map((n, k) => (
              <li key={k} className={`news-${n.kind}`}>
                <span className="muted small num">{n.day < 0 ? `${n.year ?? year} 오프시즌` : shortDate(n.year ?? year, n.day)}</span>
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        )}
        {all.length > shown && <button type="button" className="link small" onClick={() => setShown(shown + PAGE)}>더 보기 ({all.length - shown}건 남음)</button>}
      </section>
    </div>
  );
}

/** 무작위 이벤트로 지금 걸려 있는 효과 (경기력·관중률) */
function ActiveEffects() {
  const { session } = useGame();
  const ev = session.league.events;
  const year = session.world.year;
  const day = session.day;
  if (!ev || session.phase !== 'season') return null;
  const name = (id: string) => session.world.players.find((p) => p.id === id)?.name ?? id;
  const rows = [
    ...(ev.forms ?? []).filter((f) => f.year === year && f.team === session.teamIdx && day < f.until).map((f) => ({
      key: `f-${f.from}-${f.note}-${f.player ?? f.side ?? ''}`,
      who: f.player ? name(f.player) : f.side === 'bat' ? '타자진' : f.side === 'pit' ? '투수진' : '선수단',
      what: `경기력 ${f.edge > 0 ? '+' : ''}${(f.edge * 100).toFixed(1)}`, up: f.edge > 0, note: f.note, from: f.from, until: f.until,
    })),
    ...ev.buffs.filter((b) => b.year === year && b.team === session.teamIdx && day < b.until).map((b) => ({
      key: `b-${b.from}-${b.note}`, who: '관중', what: `관중률 ${b.fill > 0 ? '+' : ''}${Math.round(b.fill * 100)}%p`, up: b.fill > 0, note: b.note, from: b.from, until: b.until,
    })),
  ].sort((x, y) => x.until - y.until);
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>진행 중인 효과 <span className="muted small">경기력은 타석마다 유리한 정도 (%p, 홈 이점 1.3)</span></h2>
      <ul className="news">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="muted small">{r.from > day ? `${r.from - day}일 뒤부터 ` : ''}{r.until - Math.max(day, r.from)}일</span>
            <span><strong className={r.up ? 'up' : 'down'}>{r.who} {r.what}</strong> · {r.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
