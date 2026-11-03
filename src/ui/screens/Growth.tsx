// 시즌 뒤 성장·하락 결과 (2026-10-08 사용자 요청). 오프시즌을 시작할 때 판정한 능력 변화를 보여 준다.
// 능력치 v2 17.6: 진짜 기여·등급은 보이지 않는다. 우리 구단은 갈래 추측 전 → 후(지난 시즌 월드 → 다음 시즌 보기),
// 리그 전체는 기록 변화(OPS·평균자책 전 → 후)로 늘어놓는다 (진짜 성장 폭 순으로 고르면 순서로 정답이 드러난다).
import { emptyBatLine, emptyPitLine, isStarterSkill, type BatLine, type PitLine } from '../../engine';
import { useState } from 'react';
import { FlowNext } from '../FlowNext';
import type { LeaguePlayer } from '../../league/types';
import { guessMid, guessText, type GuessSet } from '../../league/scout';
import { era, fixed2, ops, rate3 } from '../../game/stats';
import { Pos, TeamName, useGame } from '../context';
import { GuessGrade } from '../parts';

type Scope = 'mine' | 'league';

const BAT_KEYS = Object.keys(emptyBatLine()) as (keyof BatLine)[];
const PIT_KEYS = Object.keys(emptyPitLine()) as (keyof PitLine)[];
/** 리그 기록 변화에 넣는 최소 표본: 두 해 모두 타석 / 아웃 (임시값) */
const MIN_PA = 200;
const MIN_OUTS = 150;
/** 추측 가운데값이 이만큼 움직여야 ▲▼를 붙인다 (폭만 줄어든 작은 흔들림은 표시하지 않음, 임시값) */
const ARROW_MIN = 2;

/**
 * 그 해 1군 기록 (여러 구단에서 뛰었으면 더한다). 게임 안 이력에 그 해가 없으면(게임 시작 전 해) 실제 자료의 그 해 기록으로
 */
function yearLine(p: LeaguePlayer, year: number, store: ReturnType<typeof useGame>['store']): { bat: BatLine; pit: PitLine } {
  const bat = emptyBatLine();
  const pit = emptyPitLine();
  const hs = p.history.filter((x) => x.year === year);
  for (const h of hs) {
    if (h.bat) BAT_KEYS.forEach((k, i) => { (bat[k] as number) += h.bat![i] ?? 0; });
    if (h.pit) PIT_KEYS.forEach((k, i) => { (pit[k] as number) += h.pit![i] ?? 0; });
  }
  if (!hs.length) {
    const ss = store.season(year);
    for (const r of ss?.bat.filter((x) => x.id === p.id) ?? []) {
      Object.assign(bat, { pa: bat.pa + r.pa, ab: bat.ab + r.ab, h: bat.h + r.h, d: bat.d + r.d, t: bat.t + r.t, hr: bat.hr + r.hr, bb: bat.bb + (r.bb ?? 0), hbp: bat.hbp + (r.hbp ?? 0), sf: bat.sf + (r.sf ?? 0) });
    }
    for (const r of ss?.pit.filter((x) => x.id === p.id) ?? []) Object.assign(pit, { outs: pit.outs + r.outs, er: pit.er + r.er });
  }
  return { bat, pit };
}

interface RecRow { p: LeaguePlayer; team: number; age: number | null; text: string; d: number }

export function Growth() {
  const { session, store, grades, openPlayer, go } = useGame();
  const off = session.offseason;
  const [scope, setScope] = useState<Scope>('mine');
  const list = off?.growth;

  if (!off || !list) {
    return (
      <div className="stack">
        <h1>선수 성장</h1>
        <p className="muted">시즌이 끝나고 오프시즌을 시작하면 선수들의 성장·하락 결과를 볼 수 있습니다.</p>
      </div>
    );
  }

  const me = off.userTeam;
  // 전: 지난 시즌 월드의 등급(GameShell), 후: 다음 시즌 보기의 등급. 같은 z라 추측의 움직임은 실제 변화를 따라간다
  const nextGrades = session.offGrades();
  const mine = list.filter((g) => g.team === me).map((g) => {
    const before = session.guessSet(g.id, grades);
    const after = session.guessSet(g.id, nextGrades);
    const shift = before && after ? after.sort - before.sort : 0;
    return { g, before, after, shift };
  }).sort((a, b) => b.shift - a.shift || a.g.id.localeCompare(b.g.id));
  const upN = mine.filter((r) => r.shift >= ARROW_MIN).length;
  const downN = mine.filter((r) => r.shift <= -ARROW_MIN).length;

  // 리그 전체: 두 해 모두 표본이 있는 선수의 기록 변화 (타자 OPS, 투수 평균자책)
  const recs: RecRow[] = [];
  for (const g of list) {
    if (g.tags?.includes('복무 중')) continue;
    const p = session.leaguePlayer(g.id);
    if (!p) continue;
    const a = yearLine(p, off.year - 1, store);
    const b = yearLine(p, off.year, store);
    if (p.isPitcher) {
      if (a.pit.outs < MIN_OUTS || b.pit.outs < MIN_OUTS) continue;
      recs.push({ p, team: g.team, age: g.age, text: `평균자책 ${fixed2(era(a.pit))} → ${fixed2(era(b.pit))}`, d: era(a.pit) - era(b.pit) });
    } else {
      if (a.bat.pa < MIN_PA || b.bat.pa < MIN_PA) continue;
      // OPS 0.1을 평균자책 1점쯤으로 보고 견준다 (투타를 한 줄에 세우기 위한 임시 환산)
      recs.push({ p, team: g.team, age: g.age, text: `OPS ${rate3(ops(a.bat))} → ${rate3(ops(b.bat))}`, d: (ops(b.bat) - ops(a.bat)) * 10 });
    }
  }
  const ups = [...recs].sort((a, b) => b.d - a.d).slice(0, 15);
  const downs = [...recs].sort((a, b) => a.d - b.d).slice(0, 15);

  const open = (id: string, name: string) => {
    const sp = session.world.players.find((x) => x.id === id);
    return sp ? <button type="button" className="link" onClick={() => openPlayer(sp.idx)}>{name}</button> : name;
  };
  const role = (p: LeaguePlayer) => (p.isPitcher ? (isStarterSkill(p.pit) ? '선발' : '구원') : <Pos pos={p.pos} />);
  const change = (before: GuessSet | null, after: GuessSet | null) => {
    if (!after) return <span className="muted">-</span>;
    return (
      <span className="guess-set">
        {after.items.map((it, k) => {
          const b = before?.items[k];
          const d = b ? guessMid(it.view) - guessMid(b.view) : 0;
          return (
            <span key={it.key}>
              <span className="muted small">{it.short}</span>
              {b && guessText(b.view) !== guessText(it.view) && <span className="small">{guessText(b.view)} → </span>}
              <GuessGrade v={it.view} />{d >= ARROW_MIN ? <span className="up">▲</span> : d <= -ARROW_MIN ? <span className="down">▼</span> : null}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="stack">
      {(off.stage === 'fa' || off.stage === 'vote') && <FlowNext step="선수 성장" label="다음: 오프시즌" onNext={() => go('offseason')} />}
      <section className="row-between wrap">
        <div>
          <h1>{off.year} 시즌 뒤 선수 성장</h1>
          <p className="muted small">
            우리 선수는 능력의 전 → 후입니다 (우리 구단 선수라 정확한 값, 타자 컨·파·선 = 컨택·파워·선구, 투수 구·제·체 = 구위·제구·체력). 리그 전체는 두 시즌 기록의 변화입니다.
            성장은 나이·출전 기회·운과 선수마다 다른 성장 여지로 정해지고, 다음 시즌 성적으로 이어집니다.
          </p>
        </div>
        <div className="inline">
          <button type="button" className={scope === 'mine' ? '' : 'ghost'} onClick={() => setScope('mine')}>우리 구단</button>
          <button type="button" className={scope === 'league' ? '' : 'ghost'} onClick={() => setScope('league')}>리그 전체</button>
        </div>
      </section>

      {scope === 'mine' ? (
        <section className="panel">
          <h2>
            <TeamName idx={me} />{' '}
            <span className="muted small">상승 {upN}명 · 하락 {downN}명</span>
          </h2>
          {mine.length ? (
            <table>
              <thead><tr><th className="l">선수</th><th>자리</th><th>나이</th><th className="l">능력 (전 → 후)</th><th className="l">비고</th></tr></thead>
              <tbody>
                {mine.map(({ g, before, after }) => {
                  const p = session.leaguePlayer(g.id);
                  if (!p) return null;
                  return (
                    <tr key={g.id}>
                      <td className="l">{open(g.id, p.name)}</td><td>{role(p)}</td><td>{g.age ?? '-'}</td>
                      <td className="l">{change(before, after)}</td><td className="l small">{g.tags?.join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="muted small">판정한 선수가 없습니다.</p>}
        </section>
      ) : (
        <>
          {([['기록이 가장 좋아진 선수', ups], ['기록이 가장 나빠진 선수', downs]] as const).map(([title, rows]) => (
            <section className="panel" key={title}>
              <h2>{title} <span className="muted small">{off.year - 1} → {off.year}, 두 해 모두 {MIN_PA}타석·{MIN_OUTS / 3}이닝 이상</span></h2>
              {rows.length ? (
                <table>
                  <thead><tr><th className="l">선수</th><th className="l">구단</th><th>자리</th><th>나이</th><th className="l">기록 (전 → 후)</th></tr></thead>
                  <tbody>
                    {rows.map((r: RecRow) => (
                      <tr key={r.p.id}>
                        <td className="l">{open(r.p.id, r.p.name)}</td><td className="l"><TeamName idx={r.team} /></td><td>{role(r.p)}</td><td>{r.age ?? '-'}</td>
                        <td className="l small">{r.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="muted small">견줄 선수가 없습니다.</p>}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
