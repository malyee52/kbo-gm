// 에디터: 성장 곡선 미리보기 (docs/에디터_기획안.md 6.3·7장 E4). 진짜 성장 판정 식의 기대값(난수 없음, game/editor.ts editorGrowthCurve)을
// 앞으로 몇 해 그린다. 한 줄 그림이라 범례 없이 제목이 이름을 대신하고, 점마다 마우스를 올리면 값이 보이며, 아래 표로도 같은 값을 보인다.
import { useMemo, useState } from 'react';
import { editorGrowthCurve } from '../../game/editor';
import { useGame } from '../context';

const SHARES: { v: number; label: string }[] = [
  { v: 1, label: '1군 주전' },
  { v: 0.5, label: '1군 백업' },
  { v: 0.1, label: '거의 못 뜀' },
];

const W = 360;
const H = 150;
const PAD = { l: 30, r: 12, t: 12, b: 24 };

export function EditorCurve({ id }: { id: string }) {
  const { session, version } = useGame();
  const [share, setShare] = useState(1);
  const [hover, setHover] = useState<number | null>(null);
  const c = useMemo(() => editorGrowthCurve(session, id, share), [session, id, share, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <p className="muted small">나이를 몰라 성장 곡선을 그릴 수 없습니다.</p>;
  const pts = c.points;
  const gs = [...pts.map((p) => p.grade), c.pot];
  const lo = Math.max(20, Math.floor((Math.min(...gs) - 3) / 5) * 5);
  const hi = Math.min(80, Math.ceil((Math.max(...gs) + 3) / 5) * 5);
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(1, pts.length - 1);
  const y = (g: number) => PAD.t + ((hi - g) * (H - PAD.t - PAD.b)) / Math.max(1, hi - lo);
  const ticks: number[] = [];
  for (let g = lo; g <= hi; g += hi - lo > 20 ? 10 : 5) ticks.push(g);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.grade).toFixed(1)}`).join(' ');
  const h = hover !== null ? pts[hover] : null;
  const fmt = (r: number) => (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(1);
  return (
    <section className="editor-curve">
      <div className="row-between wrap">
        <h3>성장 곡선 미리보기 <span className="muted small">(기대값, 지금 눈금 등급)</span></h3>
        <label className="small">출전 기회
          <select value={share} onChange={(e) => setShare(Number(e.target.value))}>
            {SHARES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="curve-svg" role="img"
        aria-label={`성장 곡선: ${pts.map((p) => `${p.year}년 ${p.grade}`).join(', ')}, 천장 ${c.pot}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} className="curve-grid" />
            <text x={PAD.l - 6} y={y(g) + 3.5} className="curve-axis" textAnchor="end">{g}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(c.pot)} y2={y(c.pot)} className="curve-ceil" />
        <text x={W - PAD.r} y={y(c.pot) - 4} className="curve-axis" textAnchor="end">천장 {c.pot}</text>
        {pts.map((p, i) => <text key={p.year} x={x(i)} y={H - 6} className="curve-axis" textAnchor="middle">{i === 0 ? '지금' : `${p.age}세`}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="curve-cross" />}
        <path d={path} className="curve-line" />
        {pts.map((p, i) => (
          <g key={p.year} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
            <rect x={x(i) - 18} y={PAD.t} width={36} height={H - PAD.t - PAD.b} fill="transparent" />
            <circle cx={x(i)} cy={y(p.grade)} r={4} className="curve-dot" />
          </g>
        ))}
      </svg>
      <p className="small curve-tip" role="status">
        {h ? <><strong>{h.year}년 {h.age}세</strong> 등급 {h.grade} · 기여 {fmt(h.runs)}런</> : <span className="muted">점에 마우스를 올리면 값이 보입니다.</span>}
      </p>
      <div className="scroll flat">
        <table className="editor-curve-table">
          <thead><tr><th className="l">시즌</th>{pts.map((p) => <th key={p.year}>{p.year}</th>)}</tr></thead>
          <tbody>
            <tr><td className="l">나이</td>{pts.map((p) => <td key={p.year}>{p.age}</td>)}</tr>
            <tr><td className="l">등급</td>{pts.map((p) => <td key={p.year}><strong>{p.grade}</strong></td>)}</tr>
            <tr><td className="l muted">기여(런)</td>{pts.map((p) => <td key={p.year} className="muted small">{fmt(p.runs)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">결산 성장 판정과 같은 식에서 운을 빼고 터지는 해를 확률만큼 섞은 값입니다 (성장 성향·시기·노쇠 포함). 코치·육성 투자·2군 활약·부상·훈련·입대·은퇴는 넣지 않았습니다.</p>
    </section>
  );
}
