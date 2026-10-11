// 여러 날 진행(일주일·한 달·시즌 끝까지)한 뒤의 요약 창 (2026-10-11 사용자 요청).
// 진행 직전 상태를 찍어 두고(takeSnapshot), 진행이 끝나면 그동안의 성적·순위·선수·소식·자금 변화를 보여 준다.
import { useEffect, useRef, useState } from 'react';
import type { BatLine, PitLine } from '../engine';
import { formatDate, shortDate } from '../game/calendar';
import type { GameSession } from '../game/session';
import type { Attention, AttentionKind } from '../game/stops';
import type { Screen } from './context';
import { fixed2, ipText, ops, rate3 } from '../game/stats';
import { PlayerLink, useGame, useWon } from './context';
import { teamColor } from './teams';
import { GameCast } from './GameCast';
import { CountUp } from './Motion';
import { highlights } from '../game/highlights';
import type { CastGame } from '../game/session';

export interface AdvanceSnapshot {
  year: number;
  day: number;
  w: number;
  l: number;
  t: number;
  rank: number;
  cash: number;
  news: number;
  articles: number;
  bat: Map<number, BatLine>;
  pit: Map<number, PitLine>;
}

export function takeSnapshot(session: GameSession): AdvanceSnapshot {
  const s = session.season;
  const me = session.teamIdx;
  const r = s.teams[me];
  return {
    year: session.world.year, day: s.day, w: r.w, l: r.l, t: r.t, rank: s.standings().indexOf(me) + 1,
    cash: session.cashNow(), news: session.news.length, articles: session.league.articles?.length ?? 0,
    bat: new Map(session.team.org.map((p) => [p.idx, { ...s.bat[p.idx] }])),
    pit: new Map(session.team.org.map((p) => [p.idx, { ...s.pit[p.idx] }])),
  };
}

/** 숫자 칸끼리 뺀다 (그 기간 기록) */
function diff<T extends object>(now: T, before: T | undefined): T {
  const out = { ...now } as Record<string, unknown>;
  if (!before) return now;
  for (const [k, v] of Object.entries(now)) if (typeof v === 'number') out[k] = v - ((before as Record<string, number>)[k] ?? 0);
  return out as T;
}

const NEWS_KINDS = new Set(['trade', 'event', 'absence', 'return', 'owner', 'callup']);

/** 멈춘 까닭별 제목과 바로 갈 화면 (멈춤 설정 stops.ts) */
const STOP_INFO: Record<AttentionKind, { title: string; go: Screen; button: string }> = {
  injury: { title: '1군 선수가 빠졌습니다. 엔트리·기용표를 확인하세요.', go: 'roster', button: '선수단으로' },
  losing: { title: '연패 중입니다.', go: 'roster', button: '선수단으로' },
  deadline: { title: '트레이드 마감일입니다.', go: 'trade', button: '트레이드로' },
  dev: { title: '육성선수 정식 등록이 열렸습니다.', go: 'roster', button: '선수단으로' },
  crisis: { title: '오늘 경기에 위기·승부처가 옵니다.', go: 'home', button: '홈으로' },
};
const STOP_ORDER: AttentionKind[] = ['injury', 'losing', 'deadline', 'dev', 'crisis'];

export function AdvanceSummary({ snap, attention = [], onClose }: { snap: AdvanceSnapshot; attention?: Attention[]; onClose: () => void }) {
  const { go } = useGame();
  const { session } = useGame();
  const won = useWon();
  const ref = useRef<HTMLDialogElement>(null);
  const [cast, setCast] = useState<CastGame | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const s = session.season;
  const me = session.teamIdx;
  const year = session.world.year;
  // 시즌이 바뀌었으면(오프시즌을 거쳤으면) 요약하지 않는다
  if (year !== snap.year) return null;
  const r = s.teams[me];
  const w = r.w - snap.w;
  const l = r.l - snap.l;
  const t = r.t - snap.t;
  const rank = s.standings().indexOf(me) + 1;
  const endDay = Math.min(s.day, s.schedule.length) - 1;

  // 그 기간 우리 선수 기록
  const players = session.team.org;
  const hitters = players
    .map((p) => ({ p, b: diff(s.bat[p.idx], snap.bat.get(p.idx)) }))
    .filter((x) => x.b.pa >= Math.max(8, (w + l + t) * 2))
    .sort((a, b) => ops(b.b) - ops(a.b));
  const pitchers = players
    .map((p) => ({ p, x: diff(s.pit[p.idx], snap.pit.get(p.idx)) }))
    .filter((x) => x.x.outs >= 9)
    .sort((a, b) => (a.x.er * 27) / a.x.outs - (b.x.er * 27) / b.x.outs || b.x.outs - a.x.outs);
  const hrLeader = [...hitters].sort((a, b) => b.b.hr - a.b.hr)[0];

  const news = session.news.slice(snap.news).filter((n) => NEWS_KINDS.has(n.kind) && (n.year ?? year) === year);
  const articles = (session.league.articles ?? []).slice(snap.articles);
  const cash = session.cashNow();

  // 이 기간 우리 경기와 하이라이트 (중계 기록은 최근 경기만 남는다)
  const games = session.ourGames(snap.day);
  const nameOf = (idx: number) => session.world.players[idx]?.name ?? '?';
  const teamName = (t: number) => session.teamInfo(t).name;

  const close = () => { ref.current?.close(); onClose(); };
  return (
    <dialog ref={ref} className="player summary" onClose={onClose} style={{ ['--team' as string]: teamColor(session.team.franchise) }}>
      <div className="dialog-body">
        <header className="row-between">
          <div>
            <h2>진행 요약</h2>
            <p className="muted small">{formatDate(year, snap.day)} ~ {formatDate(year, Math.max(snap.day, endDay))} · {Math.max(0, s.day - snap.day)}일</p>
          </div>
          <button type="button" className="ghost" onClick={close}>닫기</button>
        </header>

        {attention.length > 0 && (
          <section className="note error-box">
            <p><strong>진행을 멈췄습니다.</strong> <span className="muted small">(멈출 때는 진행 버튼 옆 ⚙ 멈춤에서 고릅니다)</span></p>
            {STOP_ORDER.filter((k) => attention.some((a) => a.kind === k)).map((k) => (
              <div key={k}>
                <p><strong>{STOP_INFO[k].title}</strong></p>
                <ul className="plain small">{attention.filter((a) => a.kind === k).map((a) => <li key={a.text}>{a.text}</li>)}</ul>
              </div>
            ))}
            <div className="actions">
              {[...new Set(STOP_ORDER.filter((k) => attention.some((a) => a.kind === k)).map((k) => STOP_INFO[k].go))].map((to) => (
                <button key={to} type="button" onClick={() => { close(); go(to); }}>{STOP_ORDER.map((k) => STOP_INFO[k]).find((x) => x.go === to)!.button}</button>
              ))}
            </div>
          </section>
        )}

        <section className="stats">
          <div className="stat"><span className="stat-label">이 기간 성적</span><strong className="stat-value">{w}승 {l}패{t ? ` ${t}무` : ''}</strong></div>
          <div className="stat">
            <span className="stat-label">순위</span>
            <strong className="stat-value">{rank}위</strong>
            <span className={`small ${rank < snap.rank ? 'up' : rank > snap.rank ? 'down' : 'muted'}`}>
              {rank < snap.rank ? `▲${snap.rank - rank}` : rank > snap.rank ? `▼${rank - snap.rank}` : '변동 없음'} (전 {snap.rank}위)
            </span>
          </div>
          <div className="stat"><span className="stat-label">시즌 성적</span><strong className="stat-value">{r.w}승 {r.l}패 {r.t}무</strong></div>
          <div className="stat">
            <span className="stat-label">자금</span>
            <strong className="stat-value"><CountUp value={cash} format={(v) => won(Math.round(v))} /></strong>
            <span className={`small ${cash >= snap.cash ? 'up' : 'down'}`}>{cash >= snap.cash ? '+' : '−'}{won(Math.abs(cash - snap.cash))}</span>
          </div>
        </section>

        {(hitters.length > 0 || pitchers.length > 0) && (
          <section>
            <h3>이 기간 우리 선수</h3>
            <ul className="plain small">
              {hitters[0] && <li>최고 타자: <PlayerLink p={hitters[0].p} /> {hitters[0].b.pa}타석 {rate3(hitters[0].b.ab ? hitters[0].b.h / hitters[0].b.ab : 0)} {hitters[0].b.hr}홈런 OPS {rate3(ops(hitters[0].b))}</li>}
              {hrLeader && hrLeader.b.hr > 0 && hrLeader !== hitters[0] && <li>홈런: <PlayerLink p={hrLeader.p} /> {hrLeader.b.hr}개</li>}
              {pitchers[0] && <li>최고 투수: <PlayerLink p={pitchers[0].p} /> {ipText(pitchers[0].x.outs)}이닝 평균자책 {fixed2((pitchers[0].x.er * 27) / pitchers[0].x.outs)} {pitchers[0].x.w}승 {pitchers[0].x.sv ? `${pitchers[0].x.sv}세이브` : ''}</li>}
              {hitters.length > 1 && <li className="muted">부진: <PlayerLink p={hitters[hitters.length - 1].p} /> OPS {rate3(ops(hitters[hitters.length - 1].b))} ({hitters[hitters.length - 1].b.pa}타석)</li>}
            </ul>
          </section>
        )}

        {games.length > 0 && (
          <section>
            <h3>우리 경기 <span className="muted small">{games.length}경기</span></h3>
            <ul className="plain small game-list">
              {games.slice(-10).reverse().map((g) => {
                const home = g.home === me;
                const mine = home ? g.homeRuns : g.awayRuns;
                const theirs = home ? g.awayRuns : g.homeRuns;
                const res = mine > theirs ? '승' : mine < theirs ? '패' : '무';
                const hs = g.plays ? highlights(g.plays, nameOf, home ? 'home' : 'away', 2) : [];
                return (
                  <li key={g.key}>
                    <span className={`res res-${res}`}>{res}</span> <span className="muted">{g.label ?? shortDate(year, g.day)}</span> {home ? 'vs' : '@'} {teamName(home ? g.away : g.home)} <strong>{mine}:{theirs}</strong>
                    {g.plays && <button type="button" className="link" onClick={() => setCast(g)}>중계</button>}
                    {hs.length > 0 && <div className="muted">{hs.map((m) => m.text).join(' · ')}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {articles.length > 0 && (
          <section>
            <h3>기사 <span className="muted small">{articles.length}건</span></h3>
            <ul className="plain small">{articles.slice(-8).reverse().map((a, k) => <li key={k}><span className="muted">{a.day >= 0 ? shortDate(a.year, a.day) : ''}</span> {a.title}</li>)}</ul>
          </section>
        )}

        <section>
          <h3>우리 구단 소식 <span className="muted small">{news.length}건</span></h3>
          {news.length === 0 ? <p className="muted small">특별한 소식이 없었습니다.</p> : (
            <ul className="plain small">{news.slice(-12).reverse().map((n, k) => <li key={k}><span className="muted">{n.day >= 0 ? shortDate(year, n.day) : ''}</span> {n.text}</li>)}</ul>
          )}
        </section>
        <div className="actions"><button type="button" onClick={close}>확인</button></div>
      </div>
      {cast && <GameCast key={cast.key} game={cast} onClose={() => setCast(null)} />}
    </dialog>
  );
}
