// 에디터 고치기 칸 (E2 선수 하나, E3 갈래·갈래 천장·성향·시기, docs/에디터_기획안.md 3.2·6.3): 값을 넣으면 "전 → 후"와 규정 경고(Q5)를 바로 보이고, [고치기] 한 번 = 조작 하나.
// 숨겨진 특수능력은 고치지 않는다 (Q4). 부상은 낫게 하기만 (부상을 넣는 고치기는 없다).
import { useMemo, useState } from 'react';
import { driveWord, editorPreview, timingText, type EditorPlayerView } from '../../game/editor';
import { MILITARY_LABEL, type EditMilitary, type EditOp } from '../../game/editOps';
import { useGame, usePriceIndex } from '../context';

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

export type EditNote = { text: string; warn: string[] } | null;

/** onSaved: 고친 뒤 부모가 칸을 새 값으로 다시 연다 (갈래 등급은 눈금이 조금 움직여 넣은 값과 1 차이 날 수 있다) */
export function EditorEdit({ v, note, onSaved }: { v: EditorPlayerView; note: EditNote; onSaved: (n: EditNote, ok: boolean) => void }) {
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
  // E3 갈래 등급 (지금·천장)과 성장 성향·시기
  const [bNow, setBNow] = useState<Record<string, string>>(() => Object.fromEntries(v.branches.map((b) => [b.key, String(b.value)])));
  const [bCeil, setBCeil] = useState<Record<string, string>>(() => Object.fromEntries(v.branches.map((b) => [b.key, String(b.ceil)])));
  const [drive, setDrive] = useState(v.drive.toFixed(2));
  const [timing, setTiming] = useState(v.timing.toFixed(2));

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
    const nowGrade: Record<string, number> = {};
    const ceilGrade: Record<string, number> = {};
    for (const b of v.branches) {
      const bn = num(bNow[b.key] ?? '');
      if (bn !== null && Math.round(bn) !== b.value) nowGrade[b.key] = Math.round(bn);
      const bc = num(bCeil[b.key] ?? '');
      if (bc !== null && Math.round(bc) !== b.ceil) ceilGrade[b.key] = Math.round(bc);
    }
    if (Object.keys(nowGrade).length || Object.keys(ceilGrade).length) {
      out.push({ op: 'branch', player: id, ...(Object.keys(nowGrade).length ? { nowGrade } : {}), ...(Object.keys(ceilGrade).length ? { ceilGrade } : {}) });
    }
    const d = num(drive);
    const tau = num(timing);
    const grow: { drive?: number; timing?: number } = {};
    if (d !== null && d.toFixed(2) !== v.drive.toFixed(2)) grow.drive = d;
    if (tau !== null && tau.toFixed(2) !== v.timing.toFixed(2)) grow.timing = tau;
    if (grow.drive !== undefined || grow.timing !== undefined) out.push({ op: 'grow', player: id, ...grow });
    return out;
  }, [v, e, now, pot, birth, team, salary, until, mil, heal, pi, foreign, bNow, bCeil, drive, timing]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = useMemo(() => (ops.length ? editorPreview(session, ops) : null), [session, ops, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const r = session.editPlayer(ops);
    onSaved({ text: r.message, warn: r.warnings }, r.ok);
    if (r.ok) { changed(); void autosave(); }
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
      {v.branches.length > 0 && (
        <div className="scroll flat">
          <table className="editor-grades editor-branches">
            <thead><tr><th className="l">갈래</th><th>지금</th><th>천장</th></tr></thead>
            <tbody>
              {v.branches.map((b) => (
                <tr key={b.key}>
                  <td className="l">{b.label}</td>
                  <td><input type="number" min={20} max={80} value={bNow[b.key] ?? ''} onChange={(x) => setBNow({ ...bNow, [b.key]: x.target.value })} aria-label={`${b.label} 지금 등급`} /></td>
                  <td><input type="number" min={20} max={80} value={bCeil[b.key] ?? ''} onChange={(x) => setBCeil({ ...bCeil, [b.key]: x.target.value })} aria-label={`${b.label} 천장 등급`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-row wrap">
        <label>성장 성향 d <input type="number" min={-1} max={1} step={0.05} value={drive} onChange={(x) => setDrive(x.target.value)} aria-label="성장 성향" /></label>
        <span className="muted small">{num(drive) !== null ? driveWord(Math.max(-1, Math.min(1, num(drive)!))) : ''}</span>
        <label>성장 시기 τ (해) <input type="number" step={0.25} value={timing} onChange={(x) => setTiming(x.target.value)} aria-label="성장 시기" /></label>
        <span className="muted small">{num(timing) !== null ? timingText(num(timing)!) : ''}</span>
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
