// 에디터 화면 (아카이브 > 에디터, docs/에디터_기획안.md 6.2): 모든 선수의 진짜 값 표, 구단 진짜 전력, 고친 기록 (E2).
// 진짜 값은 본문 색 등급, 우리 스카우트 추측은 옆의 흐린 글씨.
import { useMemo, useState } from 'react';
import { driveWord, editorRows, editorTeams, timingText, type EditorRow } from '../../game/editor';
import { DataTable } from '../parts';
import type { Column } from '../table';
import { TeamLink, useGame } from '../context';
import { useShell } from '../shell';
import { EditorPlayer } from './EditorPlayer';
import { editRecords } from '../../game/editOps';
import { formatDate } from '../../game/calendar';

type Kind = 'all' | 'hit' | 'pit';
type Who = 'all' | 'free' | number;

const fmt = (x: number, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

export function EditorScreen() {
  const { session, version, go, openPlayer } = useGame();
  const { density } = useShell();
  const full = density === 'full';
  const [tab, setTab] = useState<'players' | 'teams' | 'log'>('players');
  const [who, setWho] = useState<Who>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [sel, setSel] = useState<string | null>(null);
  const on = session.editorOn;
  const all = useMemo(() => editorRows(session) ?? [], [session, version, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const teams = useMemo(() => editorTeams(session) ?? [], [session, version, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => all.filter((r) => (kind === 'all' || (kind === 'pit') === r.isPitcher)
    && (who === 'all' || (who === 'free' ? r.team < 0 : r.team === who))), [all, kind, who]);

  if (!on) {
    return (
      <section className="panel">
        <h2>에디터</h2>
        <p className="muted">에디터가 꺼져 있습니다. 저장·설정에서 켜면 숨긴 값을 볼 수 있습니다.</p>
        <button type="button" onClick={() => go('save')}>저장·설정으로</button>
      </section>
    );
  }

  const cols: Column<EditorRow>[] = [
    { key: 'name', label: '이름', text: true, fixed: true, value: (r) => r.name,
      cell: (r) => <button type="button" className="link" onClick={() => setSel(r.id)}>{r.name}{r.foreign ? <span className="tag">외</span> : null}{r.traitCount ? <span className="tag" title="숨겨진 특수능력">특</span> : null}</button> },
    { key: 'place', label: '소속', text: true, brief: true, value: (r) => r.place, cell: (r) => (r.team >= 0 ? <TeamLink idx={r.team} /> : <span className="muted small">{r.place}</span>) },
    { key: 'pos', label: 'POS', text: true, brief: true, value: (r) => r.pos },
    { key: 'age', label: '나이', lower: true, brief: true, value: (r) => r.age, cell: (r) => (r.age === null ? '-' : `${r.ageEstimated ? '약 ' : ''}${r.age}`) },
    { key: 'now', label: '지금', title: '진짜 지금 능력 (한 시즌 기여 → 20~80). 옆 흐린 숫자는 우리 스카우트 추측', brief: true, value: (r) => r.nowRuns,
      cell: (r) => <><span className="grade ed-true">{r.now}</span>{r.guess !== r.now && <span className="muted small"> {r.guess}</span>}</> },
    { key: 'pot', label: '천장', title: '진짜 종합 천장 (잠재력). 옆 흐린 글씨는 스카우트 보고 문구', brief: true, value: (r) => r.potRuns,
      cell: (r) => <><span className="grade ed-true">{r.pot}</span>{r.scoutPhrase && <span className="muted small"> {r.scoutPhrase}</span>}</> },
    { key: 'gap', label: '격차', title: '천장 − 지금 (등급)', value: (r) => r.pot - r.now },
    { key: 'ai', label: 'AI 천장', title: 'AI 구단이 보는 천장 (난이도 오차 포함)', value: (r) => r.aiPotRuns, cell: (r) => r.aiPot },
    { key: 'drive', label: '성향', title: '숨은 성장 성향 d (−1~1)', value: (r) => r.drive, cell: (r) => <span title={driveWord(r.drive)}>{fmt(r.drive, 2)}</span> },
    { key: 'timing', label: '시기', title: '성장 시기 τ (해, + = 또래보다 늦게 큼)', lower: true, value: (r) => r.timing, cell: (r) => <span title={timingText(r.timing)}>{fmt(r.timing)}</span> },
    { key: 'trait', label: '특수', title: '숨겨진 특수능력 수', value: (r) => r.traitCount || null, cell: (r) => (r.traitCount ? r.traitCount : '') },
  ];
  const picked = sel ? all.find((r) => r.id === sel) : undefined;

  return (
    <div className="stack">
      <section className="panel">
        <div className="row-between wrap">
          <h2>에디터 <span className="tag">에디터 ({session.editorMark})</span></h2>
          <span className="inline">
            <button type="button" className={`small-btn${tab === 'players' ? '' : ' ghost'}`} onClick={() => setTab('players')}>선수</button>
            <button type="button" className={`small-btn${tab === 'teams' ? '' : ' ghost'}`} onClick={() => setTab('teams')}>구단</button>
            <button type="button" className={`small-btn${tab === 'log' ? '' : ' ghost'}`} onClick={() => setTab('log')}>고친 기록</button>
          </span>
        </div>
        <p className="muted small">숨긴 진짜 값입니다. 선수 이름을 누르면 아래에 고치기 칸이 열립니다. {session.phase === 'season' ? '지금 시즌' : '다음 시즌'} 기준이고, 흐린 글씨는 우리 스카우트 추측입니다. 끄려면 저장·설정에서.</p>
      </section>

      {tab === 'players' && picked && (
        <section className="panel">
          <div className="row-between wrap">
            <h2>{picked.name}</h2>
            <span className="inline">
              {picked.idx !== null && <button type="button" className="small-btn ghost" onClick={() => openPlayer(picked.idx!)}>선수 상세</button>}
              <button type="button" className="small-btn ghost" onClick={() => setSel(null)}>닫기</button>
            </span>
          </div>
          <EditorPlayer id={picked.id} />
        </section>
      )}

      {tab === 'players' && (
        <section className="panel">
          <div className="form-row">
            <label>구단
              <select value={String(who)} onChange={(e) => { const x = e.target.value; setWho(x === 'all' || x === 'free' ? x : Number(x)); }}>
                <option value="all">전체</option>
                {session.league.teams.map((_, i) => <option key={i} value={i}>{session.teamInfo(i).name}{i === session.teamIdx ? ' (우리)' : ''}</option>)}
                <option value="free">소속 없음 (시장·후보·해외)</option>
              </select>
            </label>
            <label>구분
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="all">전체</option><option value="hit">타자</option><option value="pit">투수</option>
              </select>
            </label>
            <span className="muted small" role="status">{rows.length}명</span>
          </div>
          <DataTable id="editor-players" cols={cols} rows={rows} rowKey={(r) => r.id} full={full} searchText={(r) => `${r.name} ${r.place} ${r.pos}`}
            rowClass={(r) => (r.id === sel ? 'me' : undefined)} label="에디터 선수 표" />
        </section>
      )}

      {tab === 'log' && <EditLog />}

      {tab === 'teams' && (
        <section className="panel">
          <h2>구단 진짜 전력</h2>
          <div className="scroll flat">
            <table>
              <thead><tr><th>순위</th><th className="l">구단</th><th>전력 (런)</th>{session.phase === 'season' && <th className="l">우리가 보는 전망</th>}</tr></thead>
              <tbody>
                {[...teams].sort((a, b) => a.rank - b.rank).map((t) => (
                  <tr key={t.idx} className={t.idx === session.teamIdx ? 'me' : undefined}>
                    <td>{t.rank}</td>
                    <td className="l"><TeamLink idx={t.idx} /></td>
                    <td>{fmt(t.strength)}</td>
                    {session.phase === 'season' && <td className="l muted small">{t.outlook}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">전력은 구단 선수의 한 시즌 기여 합 (AI 판단과 구단주 목표가 쓰는 값)입니다. 구단 자금·신뢰 고치기는 다음 단계.</p>
        </section>
      )}
    </div>
  );
}

/** 고친 기록 탭: 조작 기록 중 에디터 고침만, 최근 것 먼저 (전 → 후) */
function EditLog() {
  const { session, version } = useGame();
  const recs = useMemo(() => editRecords(session), [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="panel">
      <h2>고친 기록 <span className="muted small">{recs.length}번</span></h2>
      {recs.length === 0 ? <p className="muted">아직 고친 값이 없습니다.</p> : (
        <ol className="editor-log">
          {recs.map((r, i) => (
            <li key={i}>
              <p className="small"><strong>{r.day >= 0 ? formatDate(r.year, r.day, true) : `${r.year}년 오프시즌`}</strong> · {r.names.join(', ')}</p>
              <ul className="small">{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">고친 값은 조작 기록에 남아 같은 시드로 다시 돌려도 같은 날·같은 순서로 들어갑니다.</p>
    </section>
  );
}
