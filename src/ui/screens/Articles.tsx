// 기사 (역사와 서사 1단계, league/articles.ts): 통산 기록, 신기록, 연승·연패, 우승, 시상, 은퇴, 시나리오.
import { useMemo, useState } from 'react';
import { ARTICLE_LABEL, type ArticleKind } from '../../league/articles';
import { formatDate } from '../../game/calendar';
import { useGame } from '../context';

export function Articles() {
  const { session, version } = useGame();
  const [mine, setMine] = useState(false);
  const [kind, setKind] = useState<ArticleKind | ''>('');
  const me = session.team.franchise;
  const list = useMemo(() => [...(session.league.articles ?? [])].reverse()
    .filter((a) => (!mine || a.franchise === me) && (!kind || a.kind === kind)), [session, version, mine, kind, me]);

  return (
    <div className="stack">
      <section className="row-between wrap">
        <div>
          <p className="muted small">통산 기록 달성, 시즌 신기록, 연승·연패, 우승·MVP, 명예의 전당·은퇴식 소식입니다. 최근 400건까지 남습니다.</p>
        </div>
        <div className="toolbar">
          <label className="small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 우리 구단만</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as ArticleKind | '')} aria-label="기사 종류">
            <option value="">전체</option>
            {(Object.keys(ARTICLE_LABEL) as ArticleKind[]).map((k) => <option key={k} value={k}>{ARTICLE_LABEL[k]}</option>)}
          </select>
        </div>
      </section>
      <section className="panel">
        {list.length === 0 ? <p className="muted">아직 기사가 없습니다. 경기를 진행하면 기록에 따라 기사가 나옵니다.</p> : (
          <ul className="articles">
            {list.map((a, k) => (
              <li key={k} className={a.franchise === me ? 'mine' : ''}>
                <div className="muted small">
                  <span className="tag">{ARTICLE_LABEL[a.kind]}</span> {a.day < 0 ? `${a.year} 시즌 결산` : formatDate(a.year, a.day, true)}
                </div>
                <strong>{a.title}</strong>
                <p className="small">{a.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 홈 화면용 최근 헤드라인 */
export function Headlines({ n = 4 }: { n?: number }) {
  const { session, go } = useGame();
  const list = (session.league.articles ?? []).slice(-n).reverse();
  if (list.length === 0) return null;
  return (
    <section>
      <h2>기사 <button type="button" className="small-btn" onClick={() => go('articles')}>더 보기</button></h2>
      <ul className="news">
        {list.map((a, k) => (
          <li key={k}>
            <span className="muted small">{a.day < 0 ? `${a.year} 결산` : formatDate(a.year, a.day)}</span>
            <span><strong>{a.title}</strong></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
