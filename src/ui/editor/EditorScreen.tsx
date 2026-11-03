// 에디터 화면 (아카이브 > 에디터, docs/에디터_기획안.md 6.2): 모든 선수의 진짜 값 표(체크 일괄 고침, E3), 구단 진짜 전력·고치기(E3),
// 선수 만들기(오프시즌)·리그 규정(E4), 고친 기록 (E2).
// 진짜 값은 본문 색 등급, 우리 스카우트 추측은 옆의 흐린 글씨.
import { useMemo, useState } from 'react';
import { driveWord, editorBulkOps, editorPreview, editorRows, timingText, type BulkKind, type EditorRow } from '../../game/editor';
import { DataTable } from '../parts';
import type { Column } from '../table';
import { TeamLink, useGame } from '../context';
import { useShell } from '../shell';
import { EditorPlayer } from './EditorPlayer';
import { EditorTeams } from './EditorTeams';
import { EditorCreate } from './EditorCreate';
import { EditorRules } from './EditorRules';
import { editRecords } from '../../game/editOps';
import { formatDate } from '../../game/calendar';

type Kind = 'all' | 'hit' | 'pit';
type Who = 'all' | 'free' | number;

const fmt = (x: number, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);

export function EditorScreen() {
  const { session, version, go, openPlayer } = useGame();
  const { density } = useShell();
  const full = density === 'full';
  const [tab, setTab] = useState<'players' | 'teams' | 'create' | 'rules' | 'log'>('players');
  const [who, setWho] = useState<Who>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [sel, setSel] = useState<string | null>(null);
  const on = session.editorOn;
  const all = useMemo(() => editorRows(session) ?? [], [session, version, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
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

  const toggle = (id: string) => { const n = new Set(checked); if (n.has(id)) n.delete(id); else n.add(id); setChecked(n); };
  const cols: Column<EditorRow>[] = [
    { key: 'chk', label: '고름', fixed: true, title: '일괄 고침에 넣을 선수', value: (r) => Number(checked.has(r.id)),
      cell: (r) => <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${r.name} 고르기`} /> },
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
            <button type="button" className={`small-btn${tab === 'create' ? '' : ' ghost'}`} onClick={() => setTab('create')}>만들기</button>
            <button type="button" className={`small-btn${tab === 'rules' ? '' : ' ghost'}`} onClick={() => setTab('rules')}>규정</button>
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
          <BulkEdit checked={checked} setChecked={setChecked} shown={rows} />
          <DataTable id="editor-players" cols={cols} rows={rows} rowKey={(r) => r.id} full={full} searchText={(r) => `${r.name} ${r.place} ${r.pos}`}
            rowClass={(r) => (r.id === sel ? 'me' : undefined)} label="에디터 선수 표" />
        </section>
      )}

      {tab === 'log' && <EditLog />}

      {tab === 'teams' && <EditorTeams />}

      {tab === 'create' && <EditorCreate />}

      {tab === 'rules' && <EditorRules />}
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

const BULK_LABEL: Record<BulkKind, string> = { pot: '천장 ± (등급)', now: '지금 능력 = (등급)', drive: '성장 성향 = (d)', heal: '부상 낫게 하기' };

/** 체크한 선수 일괄 고침 (기획안 6.2): 묶음 전체가 조작 하나로 남는다. 바뀌지 않는 선수(천장 끝·부상 아님 등)는 뺀다 */
function BulkEdit({ checked, setChecked, shown }: { checked: Set<string>; setChecked: (s: Set<string>) => void; shown: EditorRow[] }) {
  const { session, version, changed, autosave } = useGame();
  const [kind, setKind] = useState<BulkKind>('pot');
  const [value, setValue] = useState('5');
  const [note, setNote] = useState<{ text: string; warn: string[] } | null>(null);
  const v = kind === 'heal' ? 0 : Number(value);
  const ops = useMemo(() => (checked.size && Number.isFinite(v) && value.trim() !== '' ? editorBulkOps(session, [...checked], kind, v) : []),
    [session, version, checked, kind, v, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = useMemo(() => (ops.length ? editorPreview(session, ops) : null), [session, ops, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const SHOW = 8;
  const save = () => {
    const r = session.editPlayer(ops);
    setNote({ text: r.message, warn: r.warnings });
    // 한 번 적용하면 체크를 푼다 (같은 묶음을 두 번 누르는 실수 막기)
    if (r.ok) { setChecked(new Set()); changed(); void autosave(); }
  };
  return (
    <div className="editor-bulk">
      <div className="form-row wrap">
        <span className="small"><strong>체크 {checked.size}명</strong></span>
        <button type="button" className="small-btn ghost" onClick={() => setChecked(new Set([...checked, ...shown.map((r) => r.id)]))}>보이는 {shown.length}명 모두</button>
        <button type="button" className="small-btn ghost" disabled={!checked.size} onClick={() => setChecked(new Set())}>체크 풀기</button>
        <label>일괄
          <select value={kind} onChange={(e) => { const k = e.target.value as BulkKind; setKind(k); setValue(k === 'pot' ? '5' : k === 'now' ? '60' : k === 'drive' ? '0.5' : ''); }}>
            {(Object.keys(BULK_LABEL) as BulkKind[]).map((k) => <option key={k} value={k}>{BULK_LABEL[k]}</option>)}
          </select>
        </label>
        {kind !== 'heal' && <input type="number" step={kind === 'drive' ? 0.05 : 1} value={value} onChange={(e) => setValue(e.target.value)} aria-label="일괄 값" />}
        <button type="button" className="small-btn" disabled={!pv || !!pv.error || !!session.gameLock} onClick={save}>적용</button>
      </div>
      {checked.size > 0 && (
        <div className="editor-preview" role="status">
          {!ops.length ? <p className="muted small">체크한 선수 가운데 바뀌는 선수가 없습니다.</p> : pv?.error ? <p className="warn-line small">{pv.error}</p> : pv && (
            <>
              <p className="small">{pv.names.length}명 · {pv.lines.length}가지 (조작 하나로 남습니다)</p>
              <ul className="small">{pv.lines.slice(0, SHOW).map((l) => <li key={l}>{l}</li>)}{pv.lines.length > SHOW && <li className="muted">외 {pv.lines.length - SHOW}줄</li>}</ul>
              {pv.warnings.map((w) => <p key={w} className="warn-line small">규정 넘김: {w}</p>)}
            </>
          )}
        </div>
      )}
      {session.gameLock && <p className="muted small">{session.gameLock}</p>}
      {note && (
        <div role="status">
          <p className="note small">{note.text}</p>
          {note.warn.map((w) => <p key={w} className="warn-line small">규정 넘김: {w}</p>)}
        </div>
      )}
    </div>
  );
}
