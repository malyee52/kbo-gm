// 스카우트 (능력치 v2 기획안 19장, 16-7): 영입 > 스카우트. 탭 셋 — 아마추어(드래프트 보드), 프로(다른 구단·시장 선수 추측), 해외(파견·관찰 명단).
// 화면에 나오는 것은 우리 스카우트 팀의 평가뿐이다. 진짜 능력·천장·성장 성향 같은 숨은 값은 보여 주지 않는다 (추측 범위·보고 문구만).
import { useMemo, useState } from 'react';
import { activeLevel, INVEST_EFFECT, INVEST_LABEL, type InvestKind } from '../../league/finance';
import { dollarText } from '../../league/salary';
import { FX_AGENT_EVERY, FX_COST, FX_LIST_MAX, FX_MAX_OUT, FX_OFF_SENDS, FX_REGIONS, FX_WEEKS, regionName, type FxEntry } from '../../league/scoutfx';
import { Pos, useGame } from '../context';
import { DataTable } from '../parts';
import { useShell } from '../shell';
import type { Column } from '../table';
import type { LeaguePlayer } from '../../league/types';

export type ScoutTab = 'amateur' | 'pro' | 'fx';

/** 투자 단계 한 줄 (바꾸기는 경영 > 재정) */
function LevelLine({ kind }: { kind: InvestKind }) {
  const { session } = useGame();
  const off = session.phase === 'offseason';
  const fin = session.league.finance?.[session.teamIdx];
  const lv = off ? fin?.invest[kind] ?? 0 : activeLevel(session.league, session.teamIdx, kind);
  return (
    <p className="muted small">
      {INVEST_LABEL[kind]} <strong>{lv}단계</strong>{off ? ' (다음 시즌 계획)' : ''}: {INVEST_EFFECT[kind][lv]}. 단계는 경영 &gt; 재정에서 오프시즌에 정합니다.
    </p>
  );
}

function Amateur() {
  const { session, version } = useGame();
  const { density } = useShell();
  const board = useMemo(() => session.draftBoard(), [session, version]);
  const byId = useMemo(() => new Map(session.league.players.map((p) => [p.id, p])), [session, version]);
  const next = session.year + 1;
  type Row = { rank: number; tier: string; note: string; p: LeaguePlayer };
  const rows: Row[] = board.map((b) => ({ rank: b.rank, tier: b.tier, note: b.note, p: byId.get(b.id)! })).filter((r) => r.p);
  const cols: Column<Row>[] = [
    { key: 'rank', label: '추천', brief: true, lower: true, value: (r) => r.rank },
    { key: 'name', label: '이름', fixed: true, text: true, value: (r) => r.p.name },
    { key: 'pos', label: '자리', brief: true, value: (r) => (r.p.isPitcher ? 'P' : r.p.pos ?? '-'), cell: (r) => (r.p.isPitcher ? 'P' : <Pos pos={r.p.pos ?? 'DH'} />) },
    { key: 'age', label: '나이', brief: true, lower: true, value: (r) => (r.p.birthYear ? next - r.p.birthYear : null) },
    { key: 'school', label: '학력', brief: true, text: true, value: (r) => (r.p.school === 'HS' ? '고졸' : r.p.school === 'UNIV' ? '대졸' : '-') },
    { key: 'tier', label: '묶음', text: true, value: (r) => r.tier },
    { key: 'note', label: '스카우트 보고', text: true, value: (r) => r.note || '-' },
  ];
  return (
    <div className="stack">
      <LevelLine kind="scout" />
      <p className="muted small">우리 스카우트 팀의 평가입니다. 다른 구단은 저마다 다르게 봅니다. 드래프트에서 자동 지명은 이 보드의 1위를 뽑습니다.</p>
      {rows.length
        ? <DataTable id="scout-board" cols={cols} rows={rows} rowKey={(r) => r.p.id} full={density === 'full'} searchText={(r) => r.p.name} label="드래프트 보드" />
        : <p className="muted">드래프트 보드는 오프시즌 드래프트 단계에서 나옵니다.</p>}
    </div>
  );
}

function Pro() {
  return (
    <div className="stack">
      <LevelLine kind="scoutPro" />
      <p className="muted small">
        다른 구단 선수와 FA·방출 시장 선수의 세부 능력은 우리 스카우트 팀의 추측 범위(예: 55~65)로 보입니다. 기록이 많을수록,
        우리 구단에서 오래 뛸수록, 프로 스카우트 단계가 높을수록 범위가 좁아집니다. 기록(타율·OPS·평균자책 등)은 그대로 보입니다.
      </p>
    </div>
  );
}

function Abroad() {
  const { session, version, changed, autosave } = useGame();
  const { density } = useShell();
  const [msg, setMsg] = useState<string | null>(null);
  const off = session.phase === 'offseason';
  const fx = session.scoutFx;
  const byId = useMemo(() => new Map(session.league.players.map((p) => [p.id, p])), [session, version]);
  const year = session.year + (off ? 1 : 0);

  const send = (region: (typeof FX_REGIONS)[number]['id']) => {
    const r = session.sendScout(region);
    setMsg(r.message || (r.ok ? '보냈습니다.' : ''));
    if (r.ok) { changed(); void autosave(); }
  };
  const drop = (id: string) => {
    const r = session.dropScouted(id);
    if (r.ok) { changed(); void autosave(); }
    else setMsg(r.message);
  };

  type Row = { e: FxEntry; p: LeaguePlayer; wait?: boolean };
  const rows: Row[] = [...fx.list.map((e) => ({ e, p: byId.get(e.id)! })), ...(fx.wait ? [{ e: fx.wait, p: byId.get(fx.wait.id)!, wait: true }] : [])].filter((r) => r.p);
  const cols: Column<Row>[] = [
    { key: 'name', label: '이름', fixed: true, text: true, value: (r) => r.p.name, cell: (r) => <>{r.p.name}{r.wait ? <span className="muted small"> (대기)</span> : null}</> },
    { key: 'region', label: '지역', brief: true, text: true, value: (r) => (r.p.fx ? regionName(r.p.fx.region) : '-') },
    { key: 'kind', label: '구분', brief: true, text: true, value: (r) => (r.p.asia ? '아시아쿼터' : '일반') },
    { key: 'pos', label: '자리', brief: true, value: (r) => (r.p.isPitcher ? 'P' : r.p.pos ?? '-'), cell: (r) => (r.p.isPitcher ? 'P' : <Pos pos={r.p.pos ?? 'DH'} />) },
    { key: 'age', label: '나이', brief: true, lower: true, value: (r) => (r.p.birthYear ? year - r.p.birthYear : null) },
    { key: 'pay', label: '요구액', brief: true, value: (r) => r.p.contract.salary, cell: (r) => dollarText(r.p.contract.salary) },
    { key: 'watch', label: '관찰', brief: true, title: '그 지역에 스카우트 팀이 나가 있던 주. 길수록 추측 범위가 좁아집니다 (에이전트 추천은 넓게 시작)',
      value: (r) => r.e.weeks, cell: (r) => `${r.e.weeks}주${r.e.agent ? ' · 추천' : ''}` },
    { key: 'note', label: '스카우트 보고', text: true, value: (r) => session.scoutPhrase(r.p.id) ?? '-' },
    { key: 'act', label: '', fixed: true, value: () => null,
      cell: (r) => <button type="button" className="ghost small-btn" onClick={() => drop(r.p.id)} aria-label={`${r.p.name} 명단에서 빼기`}>빼기</button> },
  ];

  const blocked = session.fxSendBlock(FX_REGIONS[0].id);
  return (
    <div className="stack">
      <LevelLine kind="scoutPro" />
      <p className="muted small">
        스카우트 팀을 지역에 보내면 {FX_WEEKS}주 동안 그 지역 후보가 한두 명씩 관찰 명단에 붙습니다 (한 번 {FX_COST / 10000}억 원,
        {off ? ` 오프시즌에는 외국인 단계에서 바로, ${FX_OFF_SENDS}번까지` : ` 동시에 ${FX_MAX_OUT}팀, 외국인 교체 마감까지`}).
        파견이 없어도 에이전트가 {FX_AGENT_EVERY}주마다 한 명을 추천합니다. 명단은 {FX_LIST_MAX}명까지이고, 후보는 몇 달 뒤 다른 리그와 계약해 떠납니다.
        계약은 관찰 명단에 있는 후보만 할 수 있습니다 ({off ? '영입 > 계약·지명의 외국인 단계' : '영입 > 시장'}).
      </p>
      <div className="row wrap">
        {FX_REGIONS.map((r) => {
          const why = session.fxSendBlock(r.id);
          return (
            <button key={r.id} type="button" disabled={!!why} title={why ?? r.note} onClick={() => send(r.id)}>
              {r.name} 파견
            </button>
          );
        })}
      </div>
      <p className="small">
        {off ? `이번 오프시즌 파견 ${fx.sent} / ${FX_OFF_SENDS}번` : fx.out.length
          ? `나가 있는 팀: ${fx.out.map((d) => `${regionName(d.region)} (${d.left}주 남음)`).join(', ')}`
          : '나가 있는 팀이 없습니다.'}
        {blocked && <span className="muted"> · {blocked}</span>}
      </p>
      <ul className="muted small">
        {FX_REGIONS.map((r) => <li key={r.id}>{r.name}: {r.note}</li>)}
      </ul>
      {msg && <p className="small status" role="status">{msg}</p>}
      <DataTable id="scout-fx" cols={cols} rows={rows} rowKey={(r) => r.p.id} full={density === 'full'} searchText={(r) => r.p.name}
        label={`관찰 명단 ${fx.list.length} / ${FX_LIST_MAX}명`} empty="관찰 중인 후보가 없습니다." />
    </div>
  );
}

export function Scout({ tab }: { tab: ScoutTab }) {
  return tab === 'amateur' ? <Amateur /> : tab === 'pro' ? <Pro /> : <Abroad />;
}
