// 홈 (2026-10-12 개편): 카드 4장 — 다음 경기 · 알림 · 최근 경기 · 순위(우리 팀 앞뒤). 우리 구단 성적은 위쪽 머리 부분에 있다.
import { useState } from 'react';
import { ScenarioBanner } from '../ScenarioBanner';
import { FantasyFree } from './FantasyFree';
import { pendingChoices } from '../../fantasy/types';
import type { NewsKind } from '../../game/session';
import { isRivalry } from '../../league/rivals';
import { formatDate, shortDate } from '../../game/calendar';
import { fixed2, gamesBehind, rate3, recentForm } from '../../game/stats';
import { winPct } from '../../engine';
import { useWon, PlayerLink, TeamName, useGame } from '../context';
import { GOAL_LABEL } from '../../league/owner';
import { CountUp, useRankMoves } from '../Motion';
import { offerExpired } from '../../fantasy/rivals';

type NewsGroup = 'all' | 'player' | 'move' | 'club' | 'season';
/** 알림 묶음 (session.ts NewsKind) */
const NEWS_GROUPS: Record<NewsGroup, { label: string; kinds: NewsKind[] }> = {
  all: { label: '전체', kinds: [] },
  player: { label: '선수', kinds: ['absence', 'return', 'callup', 'entry', 'plan'] },
  move: { label: '이적', kinds: ['trade', 'offseason'] },
  club: { label: '구단', kinds: ['owner', 'event'] },
  season: { label: '시즌', kinds: ['season'] },
};

export function Home() {
  const won = useWon();
  const { session, go } = useGame();
  const s = session.season;
  const me = session.teamIdx;
  const year = session.world.year;
  const rec = s.teams[me];
  const order = s.standings();
  const rank = order.indexOf(me) + 1;
  const leader = s.teams[order[0]];
  const form = recentForm(s.log, me);
  const next = session.nextGame();
  const myGames = s.log.map((g, i) => ({ g, i })).filter(({ g }) => g.home === me || g.away === me);
  const recent = myGames.slice(-5).reverse();
  // 알림 종류별 보기 (2026-10-12). 고른 것은 이 브라우저에 기억한다
  const [newsKind, setNewsKindState] = useState<NewsGroup>(() => { try { return (localStorage.getItem('kbo-news-kind') as NewsGroup) || 'all'; } catch { return 'all'; } });
  const setNewsKind = (k: NewsGroup) => { setNewsKindState(k); try { localStorage.setItem('kbo-news-kind', k); } catch { /* 저장 못 해도 화면은 그대로 */ } };
  const [newsMore, setNewsMore] = useState(false);
  const news = [...session.news].reverse().filter((n) => newsKind === 'all' || NEWS_GROUPS[newsKind].kinds.includes(n.kind)).slice(0, 30);
  const cut = session.world.rules.postseasonTeams;
  const moves = useRankMoves(order);

  // 순위는 우리 팀 앞뒤 5줄만 (전체는 리그 > 순위)
  const at = order.indexOf(me);
  const from = Math.max(0, Math.min(at - 2, order.length - 5));
  const near = order.slice(from, from + 5);

  return (
    <div className="stack">
      {session.done && (
        <div className="note row-between">
          <span>
            정규시즌이 끝났습니다. 최종 {rank}위.
            {session.postseasonRunning ? ' 가을야구가 진행 중입니다 (위쪽 버튼으로 한 경기씩).' : session.postseason?.done ? ' 가을야구가 끝났습니다. 시즌 결과에서 결산하세요.' : ''}
          </span>
          <span className="inline">
            {session.postseason && <button type="button" onClick={() => go('postseason')}>가을야구</button>}
            <button type="button" className="ghost" onClick={() => go('season-end')}>시즌 결과</button>
          </span>
        </div>
      )}
      <ScenarioBanner />
      {session.fantasy?.free && <FantasyFree compact />}
      {pendingChoices(session.fantasy).filter((e) => !offerExpired(session, e)).length > 0 && (
        <div className="note row-between">
          <span>판타지: 답을 기다리는 일이 {pendingChoices(session.fantasy).filter((e) => !offerExpired(session, e)).length}건 있습니다 ({pendingChoices(session.fantasy).filter((e) => !offerExpired(session, e)).slice(-1)[0].title}).</span>
          <button type="button" onClick={() => go('fantasy')}>판타지로</button>
        </div>
      )}
      <section className="dash">
        <div className="card wide">
          <h2>다음 경기</h2>
          {next ? <NextGame next={next} /> : <p className="muted">남은 경기가 없습니다.</p>}
        </div>

        <div className="card side">
          <h2>알림 <button type="button" className="link small card-more" onClick={() => go('articles')}>기사</button></h2>
          <ActiveEffects />
          <div className="seg small" role="tablist" aria-label="알림 종류">
            {(Object.keys(NEWS_GROUPS) as NewsGroup[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={newsKind === k} className={newsKind === k ? 'on' : ''} onClick={() => setNewsKind(k)}>{NEWS_GROUPS[k].label}</button>
            ))}
          </div>
          {news.length === 0 ? <p className="muted">알림이 없습니다.</p> : (
            <ul className="alerts">
              {news.slice(0, newsMore ? 30 : 5).map((n, k) => (
                <li key={k} className={`news-${n.kind}`}>
                  <span>{n.text}</span>
                  <span className="muted small">{n.day < 0 ? `${n.year ?? year} 오프시즌` : shortDate(n.year ?? year, n.day)}</span>
                </li>
              ))}
            </ul>
          )}
          {news.length > 5 && <button type="button" className="link small" onClick={() => setNewsMore(!newsMore)}>{newsMore ? '접기' : `더 보기 (최근 ${news.length}개)`}</button>}
        </div>

        <div className="card wide">
          <h2>최근 경기 <button type="button" className="link small card-more" onClick={() => go('schedule')}>일정·결과 전체</button></h2>
          {recent.length === 0 ? (
            <p className="muted">아직 치른 경기가 없습니다. 위쪽 "다음 경기"로 시즌을 시작하세요.</p>
          ) : (
            <div className="tiles">
              {recent.map(({ g, i }) => {
                const home = g.home === me;
                const mine = home ? g.homeRuns : g.awayRuns;
                const theirs = home ? g.awayRuns : g.homeRuns;
                const r = mine > theirs ? '승' : mine < theirs ? '패' : '무';
                return (
                  <button key={i} type="button" className={`tile r-${r}`} onClick={() => go('schedule', i)} title="박스스코어">
                    <span className="small">{shortDate(year, g.day)} {home ? 'vs' : '@'} {session.teamInfo(home ? g.away : g.home).name}</span>
                    <strong>{r} {mine}:{theirs}</strong>
                    {g.innings > 9 && <span className="small">{g.innings}회</span>}
                  </button>
                );
              })}
            </div>
          )}
          <p className="small muted dash-line">
            {rec.g > 0 && <>승률 <strong>{rate3(winPct(rec))}</strong> · 최근 10경기 <strong>{form.w}-{form.l}{form.t ? `-${form.t}` : ''}</strong> · 득점 {rec.rs} / 실점 {rec.ra}· </>}
            {session.owner.goal?.year === year && <>구단주 목표 <strong>{GOAL_LABEL[session.owner.goal.kind]}</strong> · 신뢰도 {session.owner.trust} · 자금 <strong><CountUp value={session.cashNow()} format={(v) => won(Math.round(v))} /></strong></>}
          </p>
        </div>

        <div className="card side">
          <h2>순위 <span className="muted small">상위 {cut}팀 가을야구</span> <button type="button" className="link small card-more" onClick={() => go('standings')}>전체 순위</button></h2>
          <table className="mini">
            <tbody>
              {near.map((t) => {
                const k = order.indexOf(t);
                return (
                  <tr key={t} className={`${t === me ? 'me' : ''}${k === cut - 1 ? ' cutline' : ''}${moves.has(t) ? ' moved' : ''}`}>
                    <td className="l">{k + 1}{moves.has(t) && <span className={`move ${moves.get(t)! > 0 ? 'up' : 'down'}`}>{moves.get(t)! > 0 ? '▲' : '▼'}{Math.abs(moves.get(t)!)}</span>}</td>
                    <td className="l"><TeamName idx={t} /></td>
                    <td>{s.teams[t].w}-{s.teams[t].l}{s.teams[t].t ? `-${s.teams[t].t}` : ''}</td>
                    <td className="muted">{k === 0 ? '-' : gamesBehind(leader, s.teams[t]).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NextGame({ next }: { next: { day: number; home: number; away: number } }) {
  const { session, command } = useGame();
  const me = session.teamIdx;
  const home = next.home === me;
  const opp = home ? next.away : next.home;
  const mySp = session.probableStarter(me);
  const oppSp = session.probableStarter(opp);
  const line = (idx: number | undefined) => {
    if (idx === undefined) return '';
    const p = session.season.pit[idx];
    return p.g ? `${p.w}승 ${p.l}패 평균자책 ${fixed2((p.er * 27) / Math.max(1, p.outs))}` : '시즌 첫 등판';
  };
  const team = (idx: number, sp: typeof mySp, right = false) => (
    <div className={`vs-side${right ? ' right' : ''}`}>
      <span className="vs-name"><TeamName idx={idx} /></span>
      <span className="small">{sp ? <PlayerLink p={sp} /> : '선발 미정'} <span className="muted">{line(sp?.idx)}</span></span>
    </div>
  );
  return (
    <>
      <p className="muted small">{formatDate(session.world.year, next.day)} · {home ? '홈' : '원정'}{isRivalry(session.league, me, opp) && <span className="tag rival">라이벌전</span>}</p>
      <div className="vs">
        {team(home ? opp : me, home ? oppSp : mySp)}
        <span className="vs-mid">VS</span>
        {team(home ? me : opp, home ? mySp : oppSp, true)}
      </div>
      {session.phase === 'season' && !session.done && (
        <p className="vs-actions"><button type="button" onClick={command}>직접 지휘</button></p>
      )}
    </>
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
    <section>
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
