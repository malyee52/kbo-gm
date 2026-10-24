// 박스스코어 부품 (2026-10-23 UI 2단계 U2-3, 기획안 2.2.1): 라인스코어(R·H·E·B), 타자·투수 표.
// 경기 결과 창(GameCast)·일정·결과·가을야구 화면이 함께 쓴다.
// 휴대폰은 라인스코어 합계(R·H·E)를 고정하고 이닝만 가로로 밀며, 박스스코어 표는 팀 하나씩 고른다.
import { useState } from 'react';
import type { BoxScore, BoxSide, GameLog } from '../engine';
import { formatDate } from '../game/calendar';
import { pitchDecision, sideTotals } from '../game/boxscore';
import { ipText } from '../game/stats';
import { PlayerLink, Pos, TeamName, useGame } from './context';

const NARROW = '(max-width: 768px)';
export const useNarrow = () => useState(() => typeof matchMedia === 'function' && matchMedia(NARROW).matches)[0];

type Teams = Pick<GameLog, 'home' | 'away' | 'homeRuns' | 'awayRuns'>;

/**
 * 라인스코어. 진행 중인 중계는 ls(그 장면까지 이닝별 점수)·runs를 넘기고, 그때는 H·E·B를 비워 둔다 (결과가 미리 보이지 않게).
 * now: 지금 이닝 (중계 중 강조)
 */
export function LineScore({ log, box, ls, runs, now }: {
  log: Teams; box?: BoxScore; ls?: { away: number[]; home: number[] }; runs?: { away: number; home: number }; now?: number;
}) {
  const { session } = useGame();
  const me = session.teamIdx;
  const line = ls ?? box?.lineScore ?? { away: [], home: [] };
  const n = Math.max(9, line.away.length, line.home.length);
  const live = ls !== undefined;
  const cell = (v: number | undefined) => (v === undefined ? '' : v < 0 ? 'X' : String(v));
  const rows = [['away', log.away] as const, ['home', log.home] as const];
  const tot = (k: 'away' | 'home') => (box && !live ? sideTotals(box[k]) : null);
  return (
    <div className="ls-wrap">
      <div className="scroll ls-inn">
        <table className="linescore">
          <thead><tr><th className="l">팀</th>{Array.from({ length: n }, (_, i) => <th key={i} className={now === i + 1 ? 'now' : ''}>{i + 1}</th>)}</tr></thead>
          <tbody>
            {rows.map(([k, t]) => (
              <tr key={k} className={t === me ? 'me' : ''}>
                <td className="l"><TeamName idx={t} /></td>
                {Array.from({ length: n }, (_, i) => <td key={i} className={(line[k][i] ?? 0) > 0 ? 'scored' : ''}>{cell(line[k][i])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <table className="linescore ls-tot">
        <thead>
          <tr>
            <th title="득점">R</th><th title="안타">H</th>
            <th title="실책 (2026-10-23 전 경기·가을야구는 기록 없음)">E</th><th className="ls-b" title="볼넷">B</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, t]) => {
            const x = tot(k);
            const r = runs ? runs[k] : k === 'away' ? log.awayRuns : log.homeRuns;
            return (
              <tr key={k} className={t === me ? 'me' : ''}>
                <td><strong key={r} className={live ? 'pop' : undefined}>{r}</strong></td>
                <td>{x ? x.h : ''}</td><td>{x ? (x.e ?? '—') : ''}</td><td className="ls-b">{x ? x.b : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const dash = (v: number | undefined) => (v === undefined ? '—' : v);

/** 한 팀 타자·투수 표. full이면 2루타·3루타·도루, 타자 수·자책·피홈런을 더한다 */
function SideTables({ side, log, full }: { side: BoxSide; log: Pick<GameLog, 'win' | 'loss' | 'save'>; full: boolean }) {
  const { session } = useGame();
  const P = session.world.players;
  return (
    <>
      <div className="scroll">
        <table className="box-bat">
          <thead>
            <tr>
              <th title="타순">#</th><th className="l">타자</th><th title="수비 자리">자리</th><th>타수</th><th>득점</th><th>안타</th><th>타점</th><th>홈런</th><th>볼넷</th><th>삼진</th>
              {full && <><th>2루타</th><th>3루타</th><th>도루</th></>}
            </tr>
          </thead>
          <tbody>
            {side.batters.map((b, i) => (
              <tr key={b.idx} className={b.sub ? 'sub-row' : undefined}>
                <td className="muted">{b.sub ? '' : b.order ?? i + 1}</td>
                <td className="l">
                  {b.sub && <span className="tag" title={b.sub === 'PH' ? '대타' : b.sub === 'DEF' ? '대수비' : '대주자'}>{b.sub}</span>} <PlayerLink p={P[b.idx]} />
                </td>
                <td className="small">{b.sub ? '' : b.pos ? <Pos pos={b.pos} /> : '—'}</td>
                <td>{b.ab}</td><td>{b.r}</td><td>{b.h}</td><td>{b.rbi}</td><td>{b.hr}</td><td>{b.bb}</td><td>{b.so}</td>
                {full && <><td>{dash(b.d)}</td><td>{dash(b.t)}</td><td>{dash(b.sb)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="scroll">
        <table className="box-pit">
          <thead>
            <tr>
              <th className="l">투수</th><th title="승·패·세이브·홀드·블론">결과</th><th>이닝</th>{full && <th title="상대 타자">타자</th>}<th>투구 수</th>
              <th>피안타</th><th>실점</th>{full && <th>자책</th>}<th>볼넷</th><th>삼진</th>{full && <th>피홈런</th>}
            </tr>
          </thead>
          <tbody>
            {side.pitchers.map((p) => (
              <tr key={p.idx}>
                <td className="l"><PlayerLink p={P[p.idx]} /></td>
                <td className="small">{pitchDecision(p, log) || ''}</td>
                <td>{ipText(p.outs)}</td>{full && <td>{p.bf}</td>}<td><strong>{p.np > 0 ? p.np : '—'}</strong></td>
                <td>{p.h}</td><td>{p.r}</td>{full && <td>{p.er}</td>}<td>{p.bb}</td><td>{p.so}</td>{full && <td>{p.hr}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** 두 팀 박스스코어 표. 휴대폰은 팀 하나씩 고른다 (처음은 우리 구단) */
export function BoxTables({ log, box, full }: { log: Teams & Pick<GameLog, 'win' | 'loss' | 'save'>; box: BoxScore; full: boolean }) {
  const { session } = useGame();
  const narrow = useNarrow();
  const [pick, setPick] = useState<'away' | 'home'>(log.away === session.teamIdx ? 'away' : 'home');
  const sides = [['away', log.away] as const, ['home', log.home] as const];
  if (narrow) {
    return (
      <div className="box">
        <div className="seg small" role="tablist" aria-label="팀 고르기">
          {sides.map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={pick === k} className={pick === k ? 'on' : ''} onClick={() => setPick(k)}>{session.teamInfo(t).name}</button>
          ))}
        </div>
        <SideTables side={box[pick]} log={log} full={full} />
      </div>
    );
  }
  return (
    <div className="box two">
      {sides.map(([k, t]) => (
        <div key={k}>
          <h3><TeamName idx={t} /></h3>
          <SideTables side={box[k]} log={log} full={full} />
        </div>
      ))}
    </div>
  );
}

/** 일정·결과, 가을야구 화면의 박스스코어 (제목 + 라인스코어 + 표) */
export function BoxView({ log, box, full }: { log: GameLog; box: BoxScore; full: boolean }) {
  const { session } = useGame();
  return (
    <section className="box">
      <h2>박스스코어 <span className="muted small">{formatDate(session.world.year, log.day)}</span></h2>
      <LineScore log={log} box={box} />
      <BoxTables log={log} box={box} full={full} />
    </section>
  );
}
