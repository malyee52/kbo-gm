// 에디터: 선수 만들기 (docs/에디터_기획안.md 3.2·7장 E4, 오프시즌만). 자유 모드 create를 다시 쓴다: 이름 NAME_MAX자, 국적으로 아시아쿼터 대상,
// 투타·포지션·나이·능력·천장·계약·소속. 만든 선수는 늘 가상 선수. "전 → 후" 대신 만들 선수 한 줄과 규정 넘김 경고를 미리 보인다.
import { useMemo, useState } from 'react';
import { editorPreview } from '../../game/editor';
import { EDIT_CREATE_POS, type EditOp } from '../../game/editOps';
import { NAME_MAX, type CreatePos } from '../../fantasy/free';
import { useGame, usePriceIndex } from '../context';

export function EditorCreate() {
  const { session, version, changed, autosave } = useGame();
  const pi = usePriceIndex();
  const season = session.phase === 'season';
  const [name, setName] = useState('');
  const [team, setTeam] = useState(session.teamIdx);
  const [pos, setPos] = useState<CreatePos>('P');
  const [role, setRole] = useState<'SP' | 'RP'>('SP');
  const [age, setAge] = useState('22');
  const [now, setNow] = useState('45');
  const [pot, setPot] = useState('60');
  const [foreign, setForeign] = useState(false);
  const [nation, setNation] = useState('');
  const [military, setMilitary] = useState<'auto' | 'pending' | 'done' | 'exempt'>('auto');
  const [contract, setContract] = useState(false);
  const [salary, setSalary] = useState('0.5');
  const [years, setYears] = useState('3');
  const [note, setNote] = useState<{ text: string; warn: string[] } | null>(null);

  const op = useMemo((): EditOp => ({
    op: 'create', name, team, pos, ...(pos === 'P' ? { role } : {}), age: Number(age), now: Number(now), potential: Number(pot),
    ...(foreign ? { foreign: true, nation } : {}), ...(!foreign && military !== 'auto' ? { military } : {}),
    // 연봉 입력: 국내 억 원(그 해 물가 → 2026년 물가 만 원), 외국인 만 달러
    ...(contract ? { salary: foreign ? Math.round(Number(salary) * 10000) : Math.round((Number(salary) * 10000) / pi), years: Number(years) } : {}),
  }), [name, team, pos, role, age, now, pot, foreign, nation, military, contract, salary, years, pi]);
  const pv = useMemo(() => (name.trim() ? editorPreview(session, [op]) : null), [session, op, version, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const r = session.editPlayer([op]);
    setNote({ text: r.message, warn: r.warnings });
    if (r.ok) { setName(''); changed(); void autosave(); }
  };

  return (
    <section className="panel">
      <h2>선수 만들기</h2>
      {season ? <p className="muted">선수 만들기는 오프시즌에만 됩니다 (시즌 중에는 선수단 빈 자리가 없습니다). 결산 뒤에 다시 여십시오.</p> : (
        <div className="editor-edit">
          <div className="form-row wrap">
            <label>이름 <input type="text" value={name} maxLength={NAME_MAX + 5} onChange={(e) => setName(e.target.value)} aria-label="만들 선수 이름" /></label>
            <span className="muted small">{name.trim().length}/{NAME_MAX}자</span>
            <label>소속
              <select value={team} onChange={(e) => setTeam(Number(e.target.value))}>
                {session.league.teams.map((_, i) => <option key={i} value={i}>{session.teamInfo(i).name}{i === session.teamIdx ? ' (우리)' : ''}</option>)}
              </select>
            </label>
          </div>
          <div className="form-row wrap">
            <label>포지션
              <select value={pos} onChange={(e) => setPos(e.target.value as CreatePos)}>
                {EDIT_CREATE_POS.map((p) => <option key={p} value={p}>{p === 'IF' ? 'IF (내야 아무 자리)' : p === 'OF' ? 'OF (외야 아무 자리)' : p}</option>)}
              </select>
            </label>
            {pos === 'P' && (
              <label>역할
                <select value={role} onChange={(e) => setRole(e.target.value as 'SP' | 'RP')}><option value="SP">선발</option><option value="RP">구원</option></select>
              </label>
            )}
            <label>나이 (다음 시즌) <input type="number" min={17} max={50} value={age} onChange={(e) => setAge(e.target.value)} /></label>
            <label>지금 능력 <input type="number" min={20} max={80} value={now} onChange={(e) => setNow(e.target.value)} /></label>
            <label>천장 <input type="number" min={20} max={80} value={pot} onChange={(e) => setPot(e.target.value)} /></label>
          </div>
          <div className="form-row wrap">
            <label className="editor-check"><input type="checkbox" checked={foreign} onChange={(e) => { setForeign(e.target.checked); setSalary(e.target.checked ? '50' : '0.5'); }} /> 외국인</label>
            {foreign ? (
              <label>국적 <input type="text" value={nation} placeholder="예: 일본·대만·미국" onChange={(e) => setNation(e.target.value)} aria-label="국적" /></label>
            ) : (
              <label>병역
                <select value={military} onChange={(e) => setMilitary(e.target.value as typeof military)}>
                  <option value="auto">나이로 (28세 이상 마침)</option><option value="pending">미필</option><option value="done">마침</option><option value="exempt">면제</option>
                </select>
              </label>
            )}
            <label className="editor-check"><input type="checkbox" checked={contract} onChange={(e) => setContract(e.target.checked)} /> 계약 정하기</label>
            {contract && (
              <>
                <label>연봉 ({foreign ? '만 달러' : '억 원'}) <input type="number" step={foreign ? 1 : 0.1} min={0} value={salary} onChange={(e) => setSalary(e.target.value)} /></label>
                <label>기간 (시즌) <input type="number" min={1} max={15} value={years} onChange={(e) => setYears(e.target.value)} /></label>
              </>
            )}
          </div>
          {pv && (
            <div className="editor-preview" role="status">
              {pv.error ? <p className="warn-line small">{pv.error}</p> : (
                <>
                  <ul className="small">{pv.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                  {pv.warnings.map((w) => <p key={w} className="warn-line small">규정 넘김: {w}</p>)}
                </>
              )}
            </div>
          )}
          <div className="inline">
            <button type="button" disabled={!pv || !!pv.error} onClick={save}>만들기</button>
          </div>
          <p className="muted small">만든 선수는 가상 선수입니다. 국적이 아시아쿼터 대상이면 그 구단 아시아쿼터 자리가 빌 때 아시아쿼터로 들어갑니다. 능력 모양·수비는 그 포지션 가상 선수 틀에서 만들어집니다.</p>
        </div>
      )}
      {note && (
        <div role="status">
          <p className="note small">{note.text}</p>
          {note.warn.map((w) => <p key={w} className="warn-line small">규정 넘김: {w}</p>)}
        </div>
      )}
    </section>
  );
}
