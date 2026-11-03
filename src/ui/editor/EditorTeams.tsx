// 에디터 구단 탭 (docs/에디터_기획안.md 6.2, E3): 구단 진짜 전력과 자금·팬 만족도·구단주 신뢰·지명권 고치기.
// 결과(재정 정산·구단주 평가)는 평소 규칙대로 흘러간다. 값을 넣으면 "전 → 후"를 바로 보이고, [고치기] 한 번 = 조작 하나.
import { useMemo, useState } from 'react';
import { editorPicks, editorPreview, editorTeams } from '../../game/editor';
import type { EditOp } from '../../game/editOps';
import { TeamLink, useGame, usePriceIndex, useWon } from '../context';

const fmt = (x: number, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

export function EditorTeams() {
  const { session, version } = useGame();
  const won = useWon();
  const teams = useMemo(() => editorTeams(session) ?? [], [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const signed = (man: number) => (man < 0 ? `−${won(-man)}` : won(man));
  return (
    <>
      <section className="panel">
        <h2>구단 진짜 전력</h2>
        <div className="scroll flat">
          <table>
            <thead><tr><th>순위</th><th className="l">구단</th><th>전력 (런)</th>{session.phase === 'season' && <th className="l">우리가 보는 전망</th>}<th>자금</th><th>팬 만족도</th><th>구단주 신뢰</th></tr></thead>
            <tbody>
              {[...teams].sort((a, b) => a.rank - b.rank).map((t) => (
                <tr key={t.idx} className={t.idx === session.teamIdx ? 'me' : undefined}>
                  <td>{t.rank}</td>
                  <td className="l"><TeamLink idx={t.idx} /></td>
                  <td>{fmt(t.strength)}</td>
                  {session.phase === 'season' && <td className="l muted small">{t.outlook}</td>}
                  <td>{signed(t.cash)}</td>
                  <td>{t.fans === null ? '-' : Math.round(t.fans)}</td>
                  <td>{t.trust === null ? '' : t.trust}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">전력은 구단 선수의 한 시즌 기여 합 (AI 판단과 구단주 목표가 쓰는 값)입니다. 구단주 신뢰는 우리 구단만 있습니다.</p>
      </section>
      <TeamEdit />
      <PickEdit />
    </>
  );
}

/** 자금·팬 만족도·구단주 신뢰 고치기 (구단 하나) */
function TeamEdit() {
  const { session, version, changed, autosave } = useGame();
  const pi = usePriceIndex();
  const teams = useMemo(() => editorTeams(session) ?? [], [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [team, setTeam] = useState(session.teamIdx);
  const t = teams.find((x) => x.idx === team) ?? teams[0];
  // 자금은 억 원 (그 해 물가), 안에서는 만 원 (2026년 물가)
  const eok = (man: number) => String(Math.round((man * pi) / 100) / 100);
  const [cash, setCash] = useState('');
  const [fans, setFans] = useState('');
  const [trust, setTrust] = useState('');
  const [note, setNote] = useState<{ text: string; warn: string[] } | null>(null);
  const ops = useMemo(() => {
    if (!t) return [];
    const out: EditOp[] = [];
    const c = num(cash);
    if (c !== null && cash.trim() !== eok(t.cash)) out.push({ op: 'cash', team: t.idx, amount: Math.round((c * 10000) / pi) - t.cash });
    const f = num(fans);
    if (f !== null && t.fans !== null && Math.round(f) !== Math.round(t.fans)) out.push({ op: 'fans', team: t.idx, delta: f - t.fans });
    const tr = num(trust);
    if (tr !== null && t.trust !== null && Math.round(tr) !== t.trust) out.push({ op: 'trust', value: Math.round(tr) });
    return out;
  }, [t, cash, fans, trust, pi]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = useMemo(() => (ops.length ? editorPreview(session, ops) : null), [session, ops, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return null;
  const pickTeam = (i: number) => { setTeam(i); setCash(''); setFans(''); setTrust(''); };
  const save = () => {
    const r = session.editPlayer(ops);
    setNote({ text: r.message, warn: r.warnings });
    if (r.ok) { setCash(''); setFans(''); setTrust(''); changed(); void autosave(); }
  };
  return (
    <section className="panel editor-edit">
      <h2>구단 고치기</h2>
      <div className="form-row wrap">
        <label>구단
          <select value={t.idx} onChange={(x) => pickTeam(Number(x.target.value))}>
            {teams.map((x) => <option key={x.idx} value={x.idx}>{x.name}{x.idx === session.teamIdx ? ' (우리)' : ''}</option>)}
          </select>
        </label>
        <label>자금 (억 원) <input type="number" step={0.01} placeholder={eok(t.cash)} value={cash} onChange={(x) => setCash(x.target.value)} aria-label="자금" /></label>
        {t.fans !== null && <label>팬 만족도 <input type="number" min={0} max={100} placeholder={String(Math.round(t.fans))} value={fans} onChange={(x) => setFans(x.target.value)} aria-label="팬 만족도" /></label>}
        {t.trust !== null && <label>구단주 신뢰 <input type="number" min={0} max={100} placeholder={String(t.trust)} value={trust} onChange={(x) => setTrust(x.target.value)} aria-label="구단주 신뢰" /></label>}
      </div>
      <p className="muted small">빈 칸은 그대로입니다 (흐린 글씨가 지금 값). 자금은 장부에 '에디터' 줄로 남고, 정산·구단주 평가는 평소 규칙대로 갑니다.</p>
      {pv && (
        <div className="editor-preview" role="status">
          {pv.error ? <p className="warn-line small">{pv.error}</p> : <ul className="small">{pv.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        </div>
      )}
      <div className="inline">
        <button type="button" className="small-btn" disabled={!pv || !!pv.error || !!session.gameLock} onClick={save}>고치기</button>
        {session.gameLock && <span className="muted small">{session.gameLock}</span>}
      </div>
      {note && <p className="note small" role="status">{note.text}</p>}
    </section>
  );
}

/** 지명권 주인 고치기 */
function PickEdit() {
  const { session, version, changed, autosave } = useGame();
  const pk = useMemo(() => editorPicks(session), [session, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(pk?.drafts[0] ?? 0);
  const [round, setRound] = useState(1);
  const [from, setFrom] = useState(session.teamIdx);
  const [to, setTo] = useState(session.teamIdx);
  const [note, setNote] = useState<string | null>(null);
  const ops: EditOp[] = useMemo(() => [{ op: 'pick', draft, round, from, to }], [draft, round, from, to]);
  const pv = useMemo(() => editorPreview(session, ops), [session, ops, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pk) return null;
  const name = (i: number) => session.teamInfo(i).name;
  const save = () => {
    const r = session.editPlayer(ops);
    setNote(r.message);
    if (r.ok) { changed(); void autosave(); }
  };
  return (
    <section className="panel editor-edit">
      <h2>지명권</h2>
      <div className="form-row wrap">
        <label>드래프트
          <select value={draft} onChange={(x) => setDraft(Number(x.target.value))}>
            {pk.drafts.map((d) => <option key={d} value={d}>{d} 입단</option>)}
          </select>
        </label>
        <label>라운드
          <select value={round} onChange={(x) => setRound(Number(x.target.value))}>
            {Array.from({ length: pk.rounds }, (_, i) => i + 1).map((r) => <option key={r} value={r}>{r}라운드</option>)}
          </select>
        </label>
        <label>원래 구단
          <select value={from} onChange={(x) => setFrom(Number(x.target.value))}>
            {pk.teams.map((i) => <option key={i} value={i}>{name(i)}</option>)}
          </select>
        </label>
        <label>새 주인
          <select value={to} onChange={(x) => setTo(Number(x.target.value))}>
            {pk.teams.map((i) => <option key={i} value={i}>{name(i)}</option>)}
          </select>
        </label>
      </div>
      {pv && !pv.error && <ul className="small editor-preview" role="status">{pv.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {pv?.error && <p className="muted small">{pv.error === '바뀌는 값이 없습니다.' ? '지금 주인과 같습니다.' : pv.error}</p>}
      <div className="inline">
        <button type="button" className="small-btn" disabled={!pv || !!pv.error || !!session.gameLock} onClick={save}>고치기</button>
        {note && <span className="note small" role="status">{note}</span>}
      </div>
      <h3>주인이 바뀐 지명권</h3>
      {pk.moved.length === 0 ? <p className="muted small">없음 (모든 구단이 자기 지명권을 가지고 있습니다)</p> : (
        <ul className="small">{pk.moved.map((m) => <li key={`${m.draft}:${m.round}:${m.from}`}>{m.draft} 입단 {m.round}라운드 ({name(m.from)} 원래) → {name(m.owner)}</li>)}</ul>
      )}
      <p className="muted small">트레이드 규정(한 번에 2장·선수와 함께)은 넘어섭니다. 이미 끝난 드래프트는 고칠 수 없습니다.</p>
    </section>
  );
}
