// 훈련 (능력치 v2 16-4c, 기획안 9.10): 전력 > 성장·훈련 > 훈련.
// 우리 구단 집중 훈련 12명 (1군·2군 합). 능력 훈련 하나(자라는 갈래 집중 또는 자라지 않는 능력)와 수비 자리 하나.
// 효과는 결산 성장 판정 때 한 번이고, 시즌 중에 걸면 그날부터 기간 비례 (league/training.ts). 천장·성장 성향 같은 숨은 값은 보여 주지 않는다.
import { useMemo, useState } from 'react';
import { FIELD_POS, type FieldPos } from '../../engine';
import { drillLabel, drillsFor, TRAIN_SLOTS } from '../../league/training';
import { Pos, useGame } from '../context';
import { DataTable } from '../parts';
import { useShell } from '../shell';
import type { Column } from '../table';
import type { LeaguePlayer } from '../../league/types';

interface Row { p: LeaguePlayer; age: number | null; drill?: string; pos?: FieldPos; on: boolean }

export function Training() {
  const { session, version, changed } = useGame();
  const { density } = useShell();
  const [msg, setMsg] = useState<string | null>(null);
  const off = session.phase === 'offseason';
  const year = session.world.year + (off ? 1 : 0);
  const rows: Row[] = useMemo(() => {
    const plans = new Map(session.training().map((t) => [t.id, t]));
    return session.league.players
      .filter((p) => p.team === session.teamIdx)
      .map((p) => {
        const t = plans.get(p.id);
        return { p, age: p.birthYear ? year - p.birthYear : null, drill: t?.drill, pos: t?.pos, on: !!t };
      })
      .sort((a, b) => Number(b.on) - Number(a.on) || Number(a.p.isPitcher) - Number(b.p.isPitcher) || (a.age ?? 99) - (b.age ?? 99));
  }, [session, version, year]);
  const used = rows.filter((r) => r.on).length;

  const set = (r: Row, plan: { drill?: string; pos?: FieldPos } | null) => {
    const res = session.setTraining(r.p.id, plan && (plan.drill || plan.pos) ? plan : null);
    setMsg(res.message);
    if (res.ok) changed();
  };

  const cols: Column<Row>[] = [
    { key: 'name', label: '이름', fixed: true, text: true, value: (r) => r.p.name },
    { key: 'slot', label: '자리', brief: true, value: (r) => (r.p.isPitcher ? 'P' : r.p.pos ?? 'DH'), cell: (r) => (r.p.isPitcher ? 'P' : <Pos pos={r.p.pos ?? 'DH'} />) },
    { key: 'age', label: '나이', brief: true, lower: true, value: (r) => r.age },
    { key: 'drill', label: '능력 훈련', fixed: true, text: true, title: '자라는 능력은 그쪽 성장 ×1.3·나머지 ×0.9, 자라지 않는 능력은 시즌당 조금씩 (그 나이 평균보다 크게 높아지지는 않음)',
      value: (r) => (r.drill ? drillLabel(r.p.isPitcher, r.drill) : null),
      cell: (r) => (
        <select aria-label={`${r.p.name} 능력 훈련`} value={r.drill ?? ''} onChange={(e) => set(r, { drill: e.target.value || undefined, pos: r.pos })}>
          <option value="">{r.on ? '고르게' : '— (훈련 안 함)'}</option>
          {drillsFor(r.p.isPitcher).map((d) => <option key={d} value={d}>{drillLabel(r.p.isPitcher, d)}</option>)}
        </select>
      ) },
    { key: 'pos', label: '수비 자리', fixed: true, text: true, title: '익힘이 50%가 되면 그 자리를 수비할 수 있습니다. 2군에서 뛰면 그 자리에서도 뜁니다',
      value: (r) => r.pos ?? null,
      cell: (r) => (r.p.isPitcher ? '-' : (
        <select aria-label={`${r.p.name} 수비 자리 훈련`} value={r.pos ?? ''} onChange={(e) => set(r, { drill: r.drill, pos: (e.target.value || undefined) as FieldPos | undefined })}>
          <option value="">없음</option>
          {FIELD_POS.filter((q) => q === r.pos || !r.p.bat?.playable?.includes(q)).map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
      )) },
    { key: 'learn', label: '익힘', brief: true, title: '수비 자리 훈련으로 익힌 정도 (50%면 수비 가능)',
      value: (r) => (r.pos ? r.p.drillPos?.[r.pos] ?? 0 : null), cell: (r) => (r.pos ? `${Math.round(100 * (r.p.drillPos?.[r.pos] ?? 0))}%` : '-') },
    { key: 'act', label: '', fixed: true, value: () => null,
      cell: (r) => (r.on ? <button type="button" className="ghost small-btn" onClick={() => set(r, null)} aria-label={`${r.p.name} 훈련 풀기`}>풀기</button> : null) },
  ];

  return (
    <div className="stack">
      <p className="muted small">
        집중 훈련 <strong>{used} / {TRAIN_SLOTS}명</strong> (1군·2군 합). 효과는 시즌을 마친 뒤 성장 판정 때 한 번 나타납니다.
        {off ? ' 지금 거는 훈련은 다음 시즌 개막부터 셉니다.' : ' 시즌 중에 걸거나 바꾸면 오늘부터 남은 기간만큼만 효과가 납니다.'}
        {' '}타고난 한계를 넘게 키우지는 못합니다. 한계에 가까운 능력일수록 효과가 줄어듭니다.
      </p>
      {msg && <p className="small status" role="status">{msg}</p>}
      <DataTable id="training" cols={cols} rows={rows} rowKey={(r) => r.p.id} full={density === 'full'} searchText={(r) => r.p.name}
        label="집중 훈련" empty="우리 구단 선수가 없습니다." />
    </div>
  );
}
