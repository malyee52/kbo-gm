// 에디터 고치기 칸 (E2 선수 하나, docs/에디터_기획안.md 3.2·6.3): 값을 넣으면 "전 → 후"와 규정 경고(Q5)를 바로 보이고, [고치기] 한 번 = 조작 하나.
// 숨겨진 특수능력은 고치지 않는다 (Q4). 부상은 낫게 하기만 (부상을 넣는 고치기는 없다).
import { useMemo, useState } from 'react';
import { editorPreview, type EditorPlayerView } from '../../game/editor';
import { MILITARY_LABEL, type EditMilitary, type EditOp } from '../../game/editOps';
import { useGame, usePriceIndex } from '../context';

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

export function EditorEdit({ v }: { v: EditorPlayerView }) {
  const { session, version, changed, autosave } = useGame();
  const pi = usePriceIndex();
  const e = v.edit;
  const foreign = v.foreign;
  // 연봉 입력: 국내 억 원(그 해 물가), 외국인 만 달러
  const salaryIn = (man: number) => (foreign ? String(Math.round(man / 10000)) : String(Math.round((man * pi) / 100) / 100));
  const [now, setNow] = useState(String(v.now));
  const [pot, setPot] = useState(String(v.pot));
  const [birth, setBirth] = useState(e.birthYear === null ? '' : String(e.birthYear));
  const [team, setTeam] = useState(String(v.team));
  const [salary, setSalary] = useState(e.salary === null ? '' : salaryIn(e.salary));
  const [until, setUntil] = useState(e.until === null ? '' : String(e.until));
  const [mil, setMil] = useState<EditMilitary | ''>(e.military && e.military in MILITARY_LABEL ? e.military as EditMilitary : '');
  const [heal, setHeal] = useState(false);
  const [note, setNote] = useState<{ text: string; warn: string[] } | null>(null);

  const ops = useMemo(() => {
    const out: EditOp[] = [];
    const id = v.id;
    const n = num(now);
    const p = num(pot);
    const ability: { now?: number; potential?: number } = {};
    if (n !== null && Math.round(n) !== v.now) ability.now = Math.round(n);
    if (p !== null && Math.round(p) !== v.pot) ability.potential = Math.round(p);
    if (ability.now !== undefined || ability.potential !== undefined) out.push({ op: 'ability', player: id, ...ability });
    const b = num(birth);
    if (b !== null && Math.round(b) !== e.birthYear) out.push({ op: 'birth', player: id, birthYear: Math.round(b) });
    const t = Number(team);
    if (t !== v.team) out.push({ op: 'move', player: id, to: t });
    const s = num(salary);
    const u = num(until);
    if (s !== null && u !== null && e.salary !== null && (salaryIn(e.salary) !== salary.trim() || Math.round(u) !== e.until)) {
      // 연봉 칸을 그대로 두고 기간만 바꾸면 지금 연봉 그대로 (억 원 두 자리 반올림이 끼지 않게)
      const man = salaryIn(e.salary) === salary.trim() ? e.salary : foreign ? Math.round(s * 10000) : Math.round((s * 10000) / pi);
      out.push({ op: 'contract', player: id, salary: Math.max(0, man), years: Math.round(u) - e.year + 1 });
    }
    if (mil && mil !== e.military) out.push({ op: 'military', player: id, state: mil });
    if (heal && e.injury) out.push({ op: 'heal', player: id });
    return out;
  }, [v, e, now, pot, birth, team, salary, until, mil, heal, pi, foreign]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = useMemo(() => (ops.length ? editorPreview(session, ops) : null), [session, ops, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const r = session.editPlayer(ops);
    setNote({ text: r.message, warn: r.warnings });
    if (r.ok) { setHeal(false); changed(); void autosave(); }
  };

  return (
    <section className="editor-edit">
      <h3>고치기</h3>
      <div className="form-row wrap">
        <label>지금 능력 <input type="number" min={20} max={80} value={now} onChange={(x) => setNow(x.target.value)} aria-label="지금 능력 등급" /></label>
        <label>천장 <input type="number" min={20} max={80} value={pot} onChange={(x) => setPot(x.target.value)} aria-label="천장 등급" /></label>
        <label>생년 <input type="number" value={birth} onChange={(x) => setBirth(x.target.value)} aria-label="생년" /></label>
        <label>소속
          <select value={team} onChange={(x) => setTeam(x.target.value)}>
            {session.league.teams.map((_, i) => <option key={i} value={i}>{session.teamInfo(i).name}{i === session.teamIdx ? ' (우리)' : ''}</option>)}
            <option value={-1}>소속 없음 (방출)</option>
          </select>
        </label>
      </div>
      {e.salary !== null && (
        <div className="form-row wrap">
          <label>연봉 ({foreign ? '만 달러' : '억 원'}) <input type="number" min={0} step={foreign ? 1 : 0.01} value={salary} onChange={(x) => setSalary(x.target.value)} aria-label="연봉" /></label>
          <label>계약 끝 시즌 <input type="number" min={e.year} max={e.year + 14} value={until} onChange={(x) => setUntil(x.target.value)} aria-label="계약 끝 시즌" /></label>
        </div>
      )}
      <div className="form-row wrap">
        {e.militaryEditable && (
          <label>병역
            <select value={mil} onChange={(x) => setMil(x.target.value as EditMilitary)}>
              {!mil && <option value="">-</option>}
              {(Object.keys(MILITARY_LABEL) as EditMilitary[]).map((k) => <option key={k} value={k}>{MILITARY_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        {!e.militaryEditable && e.militaryText && <span className="muted small">병역: {e.militaryText} (고칠 수 없음)</span>}
        {e.injury
          ? <label className="editor-check"><input type="checkbox" checked={heal} onChange={(x) => setHeal(x.target.checked)} /> 부상 낫게 하기 <span className="muted small">({e.injury.text}, {e.injury.days}일 남음)</span></label>
          : <span className="muted small">부상 없음</span>}
      </div>
      {pv && (
        <div className="editor-preview" role="status">
          {pv.error ? <p className="warn-line small">{pv.error}</p> : (
            <ul className="small">{pv.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          )}
          {pv.warnings.map((w) => <p key={w} className="warn-line small">규정 넘김: {w}</p>)}
        </div>
      )}
      <div className="inline">
        <button type="button" className="small-btn" disabled={!pv || !!pv.error || !!session.gameLock} onClick={save}>고치기</button>
        {session.gameLock && <span className="muted small">{session.gameLock}</span>}
        <span className="muted small">고친 값은 조작 기록에 남아 재현됩니다. 규정을 넘어도 막지 않고 경고만 합니다.</span>
      </div>
      {note && (
        <div role="status">
          <p className="note small">{note.text}</p>
          {note.warn.map((w) => <p key={w} className="warn-line small">규정 넘김: {w}</p>)}
        </div>
      )}
    </section>
  );
}
