// 브리핑 홈 (2026-10-22 UI 대개편 1차, 짚쨩 안1 "결정 브리핑"). 읽는 순서:
// 확인할 일 → 다음 경기 → 전력 변화 → 순위(우리 팀 주변) → 소식 → 7일 일정.
// 가을야구 중에는 시리즈 카드, 정규시즌이 끝나면 마무리 카드, 오프시즌에는 단계 카드가 다음 경기 자리에 온다.
// '요약 / 상세'(shell.tsx)에 따라 같은 카드에서 보여 주는 양만 바뀐다.
import { useState } from 'react';
import type { SimPlayer } from '../../engine';
import { formatDate, gameTime, shortDate } from '../../game/calendar';
import { fixed2, gamesBehind, ipText, rate3, recentForm } from '../../game/stats';
import { lastOutings, outingText } from '../../game/boxscore';
import { isRivalry } from '../../league/rivals';
import { stadiumName } from '../../league/naming';
import { ROUND_LABEL, stillAlive, currentSeries } from '../../league/postseason';
import { STAGE_LABEL, STAGES } from '../../league/offseason';
import { pregameBlock, pregameTalk, PREGAME_WHO } from '../../fantasy/gameday';
import { loadAiSettings } from '../../fantasy/settings';
import { ScenarioBanner } from '../ScenarioBanner';
import { FantasyFree } from './FantasyFree';
import { chipVars, PlayerLink, Pos, TeamName, useGame } from '../context';
import { byKind, type Decision } from '../decisions';
import { DensityToggle, useCurrentStep, useShell } from '../shell';
import { useRankMoves } from '../Motion';

export function Briefing() {
  const { session } = useGame();
  const { density } = useShell();
  const off = session.phase === 'offseason';
  const today = off ? `${session.year} 오프시즌` : session.done && !session.postseasonRunning ? `${session.year} 시즌 종료` : formatDate(session.world.year, session.currentDay, true);

  return (
    <div className="briefing">
      <header className="brief-head">
        <h1>브리핑 <span>{today}</span></h1>
        <DensityToggle />
      </header>
      <ScenarioBanner />
      {session.fantasy?.free && <FantasyFree compact />}
      <TodoStrip />
      <div className={`brief-grid${density === 'full' ? ' full' : ''}`}>
        <div className="brief-col">
          <div className="b-match">
            {off ? <OffseasonCard /> : session.postseasonRunning ? <PostseasonCard /> : session.done ? <WrapCard /> : <MatchCard />}
          </div>
          {!off && !session.done && <div className="b-form"><FormCard /></div>}
        </div>
        <div className="brief-col side">
          <div className="b-stand"><StandingsCard /></div>
          <div className="b-news"><NewsCard /></div>
        </div>
        {!off && !session.done && <div className="b-week"><WeekCard /></div>}
      </div>
    </div>
  );
}

// ---- 1. 확인할 일

function TodoStrip() {
  const { go } = useGame();
  const { decisions, density } = useShell();
  if (!decisions.length) {
    return <p className="todo-clear" role="status"><b>확인 완료</b> <span className="muted">지금 답해야 할 일이 없습니다.</span></p>;
  }
  const groups = byKind(decisions);
  const shown = groups.slice(0, 3);
  const open = (items: Decision[]) => go(items.length === 1 ? items[0].go : 'inbox');
  return (
    <section className="todo" aria-label="확인할 일">
      <div className="todo-head">
        <h2>확인할 일 <b className="badge">{decisions.length}</b></h2>
        {(groups.length > 3 || decisions.length > shown.length) && <button type="button" className="link small" onClick={() => go('inbox')}>결정함 전체 {decisions.length}건</button>}
      </div>
      <div className="todo-cards">
        {shown.map(({ kind, items }) => (
          <button key={kind} type="button" className={`todo-card${items.some((d) => d.blocking) ? ' urgent' : ''}`} onClick={() => open(items)}>
            <span className="todo-kind">{kind} <b className="badge">{items.length}</b></span>
            <strong>{items[0].title}</strong>
            {items[0].when && <span className="small muted">{items[0].when}</span>}
            {density === 'full' && <span className="small">{items[0].why}</span>}
            <span className="todo-go">보기 ›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- 2. 다음 경기

/** 최근 n경기 결과 (오래된 것부터) */
function lastResults(session: ReturnType<typeof useGame>['session'], team: number, n = 5): ('승' | '패' | '무')[] {
  return session.season.log.filter((g) => g.home === team || g.away === team).slice(-n).map((g) => {
    const mine = g.home === team ? g.homeRuns : g.awayRuns;
    const theirs = g.home === team ? g.awayRuns : g.homeRuns;
    return mine > theirs ? '승' : mine < theirs ? '패' : '무';
  });
}

function FormChips({ list }: { list: ('승' | '패' | '무')[] }) {
  if (!list.length) return <span className="muted small">경기 전</span>;
  return <span className="form-chips" aria-label={`최근 ${list.length}경기 ${list.join(' ')}`}>{list.map((r, k) => <i key={k} className={`res res-${r}`}>{r}</i>)}</span>;
}

function MatchCard() {
  const { session, go, command } = useGame();
  const { advanceNext, advanceDisabled, openProgress, density, busy } = useShell();
  const next = session.nextGame();
  const s = session.season;
  const me = session.teamIdx;
  if (!next) return <section className="card match"><h2>다음 경기</h2><p className="muted">남은 경기가 없습니다.</p></section>;
  const home = next.home === me;
  const opp = home ? next.away : next.home;
  const order = s.standings();
  const park = stadiumName(session.league, next.home, session.year);
  const gap = next.day - session.day;
  const last = s.log.map((g, i) => ({ g, i })).filter(({ g }) => g.home === me || g.away === me).at(-1);
  // 우리 선발의 지난 등판 (투구 수·휴식일, 2026-10-23 U2-3). 상대 구단은 박스스코어가 우리와 붙은 경기뿐이라 보이지 않는다
  const outings = lastOutings(s, me, next.day);
  const side = (t: number) => {
    const r = s.teams[t];
    const sp = session.probableStarter(t);
    const o = t === me && sp ? outings.get(sp.idx) : undefined;
    return (
      <div className={`match-side${t === me ? ' mine' : ''}`} style={chipVars(session.teamInfo(t).franchise, session.teamInfo(t).name)}>
        <strong className="match-team">{session.teamInfo(t).name}</strong>
        <i className="match-band" aria-hidden />
        <span className="small muted num">{r.g ? `${r.w}–${r.l}${r.t ? `–${r.t}` : ''} · ${order.indexOf(t) + 1}위` : '개막 전'}</span>
        <div className="match-sp">
          <span className="tag">SP</span> {sp ? <PlayerLink p={sp} /> : <span className="muted">선발 미정</span>}
          <span className="small num">{sp ? spLine(session, sp) : ''}</span>
          {o && <span className="small muted num" title="지난 등판 · 그 뒤 쉰 날">지난 등판 {outingText(o, session.world.year)}</span>}
        </div>
        <div className="small"><span className="muted">최근 5경기 </span><FormChips list={lastResults(session, t)} /></div>
      </div>
    );
  };
  return (
    <section className="card match" aria-label="다음 경기">
      <div className="card-top">
        <h2>다음 경기</h2>
        <span className="small muted">정규시즌 · {formatDate(session.world.year, next.day)} {gameTime(session.world.year, next.day)}{gap > 0 ? ` (${gap}일 뒤)` : ' (오늘)'} · {park ?? `${session.teamInfo(next.home).name} 홈`}{isRivalry(session.league, me, opp) && <span className="tag rival">라이벌전</span>}</span>
      </div>
      <div className="match-vs">
        {side(home ? opp : me)}
        <span className="match-mid">VS<small>{home ? '홈' : '원정'}</small></span>
        {side(home ? me : opp)}
      </div>
      {last && density === 'full' && (
        <p className="small muted">지난 경기: {(() => {
          const g = last.g;
          const h = g.home === me;
          const mine = h ? g.homeRuns : g.awayRuns;
          const theirs = h ? g.awayRuns : g.homeRuns;
          return <>{shortDate(session.year, g.day)} {h ? 'vs' : '@'} {session.teamInfo(h ? g.away : g.home).name} {mine}:{theirs} <button type="button" className="link" onClick={() => go('schedule', last.i)}>박스스코어</button></>;
        })()}</p>
      )}
      {session.fantasy && <PregameTalk />}
      <div className="match-actions">
        <button type="button" className="go" onClick={advanceNext} disabled={advanceDisabled}>{busy ?? '다음 경기'}</button>
        <button type="button" className="ghost" onClick={() => go('lineup')}>기용 확인</button>
        <button type="button" className="ghost" onClick={openProgress}>진행 설정</button>
        {density === 'full' && <button type="button" className="ghost" onClick={command} disabled={advanceDisabled}>직접 지휘</button>}
      </div>
      {session.pendingEvent && <p className="small error-text">이벤트에 답한 뒤 진행할 수 있습니다 (화면 위쪽).</p>}
    </section>
  );
}

function spLine(session: ReturnType<typeof useGame>['session'], p: SimPlayer): string {
  const l = session.season.pit[p.idx];
  if (!l.g) return '시즌 첫 등판';
  return `${l.w}승 ${l.l}패 · 평균자책 ${fixed2((l.er * 27) / Math.max(1, l.outs))} · ${ipText(l.outs)}이닝`;
}

/** 가을야구 중: 지금 시리즈와 다음 경기 */
function PostseasonCard() {
  const { session, go } = useGame();
  const { advanceNext, advanceDisabled, openProgress, busy } = useShell();
  const st = session.postseason!;
  const x = currentSeries(st)!;
  const me = session.teamIdx;
  const alive = stillAlive(st, me);
  const ours = x.high === me || x.low === me;
  return (
    <section className="card match" aria-label="가을야구">
      <div className="card-top">
        <h2>가을야구</h2>
        <span className="small muted">{ROUND_LABEL[x.round]} {x.games.length + 1}차전 · {formatDate(session.world.year, st.day)}</span>
      </div>
      <div className="match-vs">
        <div className="match-side"><strong className="match-team"><TeamName idx={x.high} /></strong><span className="num big">{x.winsHigh}승</span></div>
        <span className="match-mid">VS<small>시리즈</small></span>
        <div className="match-side"><strong className="match-team"><TeamName idx={x.low} /></strong><span className="num big">{x.winsLow}승</span></div>
      </div>
      {x.round === 'wc' && <p className="small muted">와일드카드 결정전은 4위가 1승을 안고 시작합니다.</p>}
      <p className="small">{ours ? '우리 구단 시리즈입니다.' : alive ? '우리 구단은 다음 시리즈를 기다립니다.' : st.seeds.includes(me) ? '우리 구단은 탈락했습니다.' : '우리 구단은 가을야구에 나가지 못했습니다.'}</p>
      <div className="match-actions">
        <button type="button" className="go" onClick={advanceNext} disabled={advanceDisabled}>{busy ?? '다음 경기'}</button>
        <button type="button" className="ghost" onClick={() => go('postseason')}>대진·결과</button>
        <button type="button" className="ghost" onClick={openProgress}>진행 설정</button>
      </div>
    </section>
  );
}

/** 정규시즌(과 가을야구)이 끝난 뒤, 결산 전 */
function WrapCard() {
  const { session, go } = useGame();
  const order = session.season.standings();
  const rank = order.indexOf(session.teamIdx) + 1;
  const ps = session.postseason;
  return (
    <section className="card match" aria-label="시즌 마무리">
      <div className="card-top"><h2>시즌 마무리</h2><span className="small muted">{session.year} 정규시즌 최종 {rank}위{ps?.done ? ' · 가을야구 종료' : ''}</span></div>
      <ol className="steps" aria-label="시즌 마무리 단계">
        <li className={ps ? 'done' : ''}>가을야구</li>
        <li className="now" aria-current="step">시즌 결산</li>
        <li>시상식</li>
        <li>선수 성장</li>
        <li>오프시즌</li>
      </ol>
      <p className="small">결산 전에 이번 오프시즌 입대 선수를 정할 수 있습니다. 결산하면 구단주 평가·시상·성장 판정을 하고 오프시즌이 열립니다.</p>
      <div className="match-actions">
        <button type="button" className="go" onClick={() => go('season-end')}>시즌 결산</button>
        <button type="button" className="ghost" onClick={() => go('enlist')}>입대 선택</button>
        {ps && <button type="button" className="ghost" onClick={() => go('postseason')}>가을야구 결과</button>}
      </div>
    </section>
  );
}

/** 오프시즌: 지금 단계와 남은 처리 */
function OffseasonCard() {
  const { session, go } = useGame();
  const { decisions } = useShell();
  const off = session.offseason!;
  const at = STAGES.indexOf(off.stage);
  const tasks = decisions.filter((d) => d.go === 'offseason' && !d.key.startsWith('stage:'));
  const steps = useCurrentStep<HTMLOListElement>(off.stage);
  return (
    <section className="card match" aria-label="오프시즌">
      <div className="card-top"><h2>오프시즌</h2><span className="small muted">{off.year} 시즌 뒤 · {off.year + 1} 시즌 준비</span></div>
      <ol className="steps" aria-label="오프시즌 단계" ref={steps}>
        {STAGES.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>{STAGE_LABEL[s]}</li>)}
      </ol>
      {tasks.length ? (
        <ul className="plain off-tasks">
          {tasks.map((d) => <li key={d.key}><strong>{d.title}</strong>{d.when && <span className="muted small"> · {d.when}</span>}<br /><span className="small muted">{d.why}</span></li>)}
        </ul>
      ) : <p className="small muted">이 단계에서 우리 구단이 꼭 처리할 일은 없습니다. 단계를 넘기면 됩니다.</p>}
      <div className="match-actions">
        <button type="button" className="go" onClick={() => go('offseason')}>{off.stage === 'ready' ? `${off.year + 1} 시즌 개막으로` : `${STAGE_LABEL[off.stage]} 단계로`}</button>
        {off.growth && <button type="button" className="ghost" onClick={() => go('growth')}>성장 결과</button>}
        {!!session.league.awards?.length && <button type="button" className="ghost" onClick={() => go('awards')}>시상식</button>}
        <button type="button" className="ghost" onClick={() => go('staff')}>감독·코치</button>
      </div>
    </section>
  );
}

// ---- 3. 전력 변화

/** 전력 변화 상승·하락 기준 (최근 10경기 대 시즌). 임시값: 2026-10-22 사용자 결정으로 출루 ±0.050, 평균자책 ±1.00 */
const FORM_OBP = 0.05;
const FORM_ERA = 1.0;

interface FormRow { p: SimPlayer; why: '결장' | '상승' | '하락' | '주목'; spark: number[]; base: number; line: string; note?: string; score: number }

/** 우리 팀 박스스코어로 최근 10경기를 본다. 타자는 출루((안타+볼넷)/(타수+볼넷)), 투수는 평균자책의 누적 흐름 */
function formRows(session: ReturnType<typeof useGame>['session']): FormRow[] {
  const s = session.season;
  const me = session.teamIdx;
  const games = s.log.map((g, i) => ({ g, i })).filter(({ g }) => g.home === me || g.away === me).slice(-10);
  const boxes = games.map(({ g, i }) => { const b = s.boxes.get(i); return b ? (g.home === me ? b.home : b.away) : null; });
  const org = session.team.org;
  const rows: FormRow[] = [];
  for (const p of org) {
    if (p.isPitcher) {
      let outs = 0, er = 0, apps = 0;
      const spark: number[] = [];
      for (const b of boxes) {
        const l = b?.pitchers.find((x) => x.idx === p.idx);
        if (l) { outs += l.outs; er += l.er; apps++; spark.push(outs ? (er * 27) / outs : 0); }
      }
      const season = s.pit[p.idx];
      const base = season.outs ? (season.er * 27) / season.outs : 0;
      if (session.isAbsent(p) && apps) { rows.push({ p, why: '결장', spark, base, line: absentLine(session, p), score: 100 }); continue; }
      if (apps < 2 || outs < 15) continue;
      const now = (er * 27) / outs;
      const d = base - now; // 양수면 좋아짐
      rows.push({ p, why: d >= FORM_ERA ? '상승' : d <= -FORM_ERA ? '하락' : '주목', spark, base, line: `${apps}경기 ${ipText(outs)}이닝 · 평균자책 ${fixed2(now)}`, note: `시즌 ${fixed2(base)}`, score: Math.abs(d) >= FORM_ERA ? 10 + Math.abs(d) : outs / 30 });
    } else {
      let ab = 0, h = 0, bb = 0, hr = 0, rbi = 0, gp = 0;
      const spark: number[] = [];
      for (const b of boxes) {
        const l = b?.batters.find((x) => x.idx === p.idx);
        if (l) { ab += l.ab; h += l.h; bb += l.bb; hr += l.hr; rbi += l.rbi; gp++; }
        if (ab + bb > 0) spark.push((h + bb) / (ab + bb));
      }
      const season = s.bat[p.idx];
      const base = season.ab + season.bb > 0 ? (season.h + season.bb) / (season.ab + season.bb) : 0;
      if (session.isAbsent(p) && gp) { rows.push({ p, why: '결장', spark, base, line: absentLine(session, p), score: 100 }); continue; }
      if (ab + bb < 15) continue;
      const now = (h + bb) / (ab + bb);
      const d = now - base;
      rows.push({ p, why: d >= FORM_OBP ? '상승' : d <= -FORM_OBP ? '하락' : '주목', spark, base, line: `타율 ${rate3(ab ? h / ab : 0)} · 홈런 ${hr} · 타점 ${rbi}`, note: `시즌 출루 ${rate3(base)}`, score: Math.abs(d) >= FORM_OBP ? 10 + Math.abs(d) * 20 : now });
    }
  }
  return rows.sort((a, b) => b.score - a.score || a.p.idx - b.p.idx).slice(0, 3);
}

function absentLine(session: ReturnType<typeof useGame>['session'], p: SimPlayer): string {
  const back = session.returnDay(p);
  const reason = session.absenceReason(p);
  const when = back === null ? '' : back >= session.season.schedule.length ? '시즌 아웃' : `${shortDate(session.year, back)} 복귀 예정`;
  return [reason, when].filter(Boolean).join(' · ');
}

function Spark({ values, base, invert = false }: { values: number[]; base: number; invert?: boolean }) {
  if (values.length < 2) return <span className="muted small">—</span>;
  const w = 96, h = 26;
  const lo = Math.min(base, ...values), hi = Math.max(base, ...values);
  const span = hi - lo || 1;
  const y = (v: number) => { const t = (v - lo) / span; return (invert ? t : 1 - t) * (h - 4) + 2; };
  const x = (k: number) => (k / (values.length - 1)) * (w - 2) + 1;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <line x1="0" x2={w} y1={y(base)} y2={y(base)} className="spark-base" />
      <polyline points={values.map((v, k) => `${x(k)},${y(v)}`).join(' ')} className="spark-line" />
    </svg>
  );
}

function FormCard() {
  const { session, go } = useGame();
  const { density } = useShell();
  const rows = formRows(session);
  return (
    <section className="card form" aria-label="전력 변화">
      <div className="card-top">
        <h2>전력 변화</h2>
        <span className="small muted">우리 팀 최근 10경기</span>
        <button type="button" className="link small card-more" onClick={() => go('roster')}>선수 명단</button>
      </div>
      {rows.length === 0 ? <p className="muted small">최근 10경기에 눈에 띄는 변화가 없습니다. 경기를 더 치르면 결장·상승·하락한 선수가 여기 나옵니다.</p> : (
        <table className="form-table">
          <thead>
            <tr>
              <th className="l">선수</th><th className="l">POS</th><th className="l">변화</th>
              <th className="l" title="타자: 출루 흐름, 투수: 평균자책 흐름 (점선은 시즌 값)">최근 10경기</th>
              <th className="l">기록</th>
              {density === 'full' && <th className="l" title="컨디션 표시는 경기 엔진 2의 컨디션이 들어간 뒤 채웁니다">상태</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.idx}>
                <td className="l"><PlayerLink p={r.p} /></td>
                <td className="l">{r.p.isPitcher ? (session.pitcherRole(r.p) === 'SP' ? 'SP' : session.pitcherRole(r.p) === 'CL' ? 'CP' : 'RP') : <Pos pos={session.slotOf(r.p) ?? r.p.pos} />}</td>
                <td className="l"><span className={`why why-${r.why}`}>{r.why}</span></td>
                <td className="l"><Spark values={r.spark} base={r.base} invert={r.p.isPitcher} /></td>
                <td className="l small">{r.line}{density === 'full' && r.note && <span className="muted"> · {r.note}</span>}</td>
                {density === 'full' && <td className="l muted">—</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---- 4. 순위

function StandingsCard() {
  const { session, go } = useGame();
  const { density } = useShell();
  const off = session.phase === 'offseason';
  const last = session.league.lastSeason;
  const order = off ? last?.standings ?? [] : session.season.standings();
  const teams = off ? last?.teams ?? [] : session.season.teams;
  const moves = useRankMoves(order);
  // 휴대폰에서는 접힌 채로 시작한다 (펼치기 단추). 넓은 화면은 접기와 상관없이 늘 보인다 (game.css .stand.folded)
  const [folded, setFolded] = useState(true);
  const me = session.teamIdx;
  const cut = session.world.rules.postseasonTeams;
  if (!order.length) return null;
  const at = Math.max(0, order.indexOf(me));
  const from = Math.max(0, Math.min(at - 2, order.length - 5));
  const rows = density === 'full' ? order : order.slice(from, from + 5);
  const leader = teams[order[0]];
  return (
    <section className={`card stand${folded ? ' folded' : ''}`} aria-label="순위">
        <div className="card-top">
          <h2>순위</h2>
          <span className="small muted">{off ? `${last?.year} 최종` : `상위 ${cut}팀 가을야구`}</span>
          <button type="button" className="link small card-more" onClick={() => go('standings')}>전체</button>
          <button type="button" className="ghost small-btn fold-btn" aria-expanded={!folded} onClick={() => setFolded(!folded)}>{folded ? '펼치기' : '접기'}</button>
        </div>
        <div className="fold-body">
        <table className="mini">
          <thead><tr><th className="l">순위</th><th className="l">팀</th><th>승</th><th>패</th><th>차</th></tr></thead>
          <tbody>
            {rows.map((t) => {
              const k = order.indexOf(t);
              const r = teams[t];
              return (
                <tr key={t} className={`${t === me ? 'me' : ''}${k === cut - 1 ? ' cutline' : ''}${moves.has(t) ? ' moved' : ''}`}>
                  <td className="l">{k + 1}{moves.has(t) && <span className={`move ${moves.get(t)! > 0 ? 'up' : 'down'}`}>{moves.get(t)! > 0 ? '▲' : '▼'}{Math.abs(moves.get(t)!)}</span>}</td>
                  <td className="l"><TeamName idx={t} /></td>
                  <td>{r?.w ?? '—'}</td>
                  <td>{r?.l ?? '—'}</td>
                  <td className="muted">{k === 0 || !r ? '—' : gamesBehind(leader, r).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!off && density === 'full' && (() => {
          const f = recentForm(session.season.log, me);
          const r = session.season.teams[me];
          return r.g ? <p className="small muted">최근 10경기 {f.w}-{f.l}{f.t ? `-${f.t}` : ''}{f.streak ? ` · ${f.streak}` : ''} · 득점 {r.rs} / 실점 {r.ra}</p> : null;
        })()}
        </div>
    </section>
  );
}

// ---- 5. 소식

function NewsCard() {
  const { session, go } = useGame();
  const { density } = useShell();
  const n = density === 'full' ? 10 : 5;
  const news = [...session.news].reverse().slice(0, n);
  const year = session.year;
  return (
    <section className="card news-card" aria-label="소식">
      <div className="card-top">
        <h2>소식</h2>
        <button type="button" className="link small card-more" onClick={() => go('news')}>더 보기</button>
      </div>
      {news.length === 0 ? <p className="muted small">소식이 없습니다.</p> : (
        <ul className="alerts">
          {news.map((x, k) => (
            <li key={k} className={`news-${x.kind}`}>
              <span className="muted small num">{x.day < 0 ? `${x.year ?? year} 오프` : shortDate(x.year ?? year, x.day)}</span>
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- 6. 7일 일정

function WeekCard() {
  const { session } = useGame();
  const s = session.season;
  const me = session.teamIdx;
  const days = Array.from({ length: 7 }, (_, k) => session.day + k).filter((d) => d < s.schedule.length);
  if (!days.length) return null;
  return (
    <section className="card week" aria-label="7일 일정">
      <h2>7일 일정</h2>
      <ol className="week-days">
        {days.map((d) => {
          const g = s.schedule[d].find((x) => x.home === me || x.away === me);
          const opp = g ? (g.home === me ? g.away : g.home) : -1;
          const t = opp >= 0 ? session.teamInfo(opp) : null;
          return (
            <li key={d} className={g ? '' : 'rest'}>
              <span className="small muted num">{shortDate(session.year, d)}{g ? ` ${gameTime(session.year, d)}` : ''}</span>
              {t ? <span className="week-opp"><i className="chip" style={chipVars(t.franchise, t.name)} aria-hidden />{g!.home === me ? 'vs' : '@'} {t.name}</span> : <span className="muted small">휴식</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** 판타지·자유 모드: 경기 전 미팅 (src/fantasy/gameday.ts). 단장의 말을 AI가 듣고 선수단 경기력을 1~3일 바꾼다. 하루 한 번 */
function PregameTalk() {
  const { session, store, changed, autosave } = useGame();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const block = pregameBlock(session);
  const today = session.fantasy?.log.filter((e) => e.who === PREGAME_WHO && e.year === session.year && e.day === session.currentDay).at(-1);
  const talk = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const e = await pregameTalk(session, store, loadAiSettings(), text.trim());
      session.addFantasy(e);
      setText('');
      setOpen(false);
      changed();
      void autosave();
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  if (today) {
    const fx = today.effects?.[0];
    return <p className="small pregame">🗣 오늘 미팅: {today.text} {fx && fx.type === 'teamForm' && <span className={fx.edge > 0 ? 'up' : 'down'}>(선수단 경기력 {fx.edge > 0 ? '+' : ''}{Math.round(fx.edge * 1000) / 10}%p, {fx.days}일)</span>}</p>;
  }
  if (block) return null;
  if (!open) return <button type="button" className="small-btn ghost" onClick={() => setOpen(true)}>경기 전 미팅</button>;
  return (
    <div className="negotiate small">
      <textarea rows={2} maxLength={500} value={text} disabled={busy} placeholder="예: 오늘은 순위 싸움의 분수령이다. 결과는 내가 책임질 테니 마음껏 휘둘러라" onChange={(e) => setText(e.target.value)} />
      <span className="inline">
        <button type="button" className="small-btn" onClick={() => void talk()} disabled={busy || !text.trim()}>{busy ? '선수단이 듣는 중…' : '말하기'}</button>
        <button type="button" className="small-btn ghost" onClick={() => setOpen(false)}>닫기</button>
      </span>
      {msg && <p className={msg.error ? 'note error-box' : 'note'}>{msg.text}</p>}
    </div>
  );
}
