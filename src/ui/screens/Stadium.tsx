// 구장·팬 (구단 운영 탭, stadium.ts): 우리 구장과 공사 주문, 팬 만족도와 그 변화, 리그 구단 비교.
import { useState } from 'react';
import {
  DOME, downPayment, FENCE_PRESETS, FENCE_WORK, fenceChangeText, fenceWorkCost, fenceText, fenceWorkState, MUNICIPAL, municipalChance, fanFill, fanLevel, fanSponsor, HONEYMOON, installment,
  planFenceWork, REMODEL, seatsAt, stadiumFill, stadiumOptions, ticketScale, underConstruction, yearlyPayment, type ParkSize,
} from '../../league/stadium';
import { DEFAULT_PARAMS, fenceParkEvents, fenceValid, parkIndexOf, type Fence } from '../../engine';
import { TeamName, useGame, useWon } from '../context';
import { ConfirmButton } from '../ConfirmButton';
import { namingAt, namingOffers, stadiumName } from '../../league/naming';
import { realParkSpec } from '../../league/ballparks';
import { isGuessBasis, PARK_BASIS_LABEL, teamParkView, type ParkLeague, type TeamParkView } from '../../game/parkView';
import { leagueBase } from '../../game/saber';
import type { ParkSpec } from '../../data/types';
import { wageIndex } from '../../league/salary';

const levelClass = (v: number) => (v >= 75 ? 'g-hi' : v >= 60 ? 'g-up' : v <= 25 ? 'g-lo' : v <= 40 ? 'g-dn' : '');
const pctp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%p`;
/** 구장 배율 → 지수 (100 = 리그 평균) */
const ix = (m: number) => Math.round(m * 100);
/** 지난 시즌과 다르면 "전 → 후" */
const ixChange = (prev: number, now: number) => (ix(prev) !== ix(now) ? `${ix(prev)} → ${ix(now)}` : String(ix(now)));
const m = (v: number | null) => (v == null ? '?' : `${v}`);

/** 평균 거리가 가장 비슷한 실제 구장 (지금 쓰는 구장 제원 행, 기획안 6.4-3) */
function nearestPark(specs: ParkSpec[] | undefined, f: Fence): string | undefined {
  const avg = (f.l + f.c + f.r) / 3;
  let best: { name: string; d: number } | undefined;
  for (const sp of specs ?? []) {
    const { l, c, r } = sp.fence;
    if (sp.to !== null || sp.franchise || l == null || c == null || r == null) continue;
    const d = Math.abs((l + c + r) / 3 - avg);
    if (!best || d < best.d) best = { name: sp.name, d };
  }
  return best?.name;
}

/** 구장 제원 한 줄: 좌·중·우 펜스, 높이, 잔디, 좌석 (parks.json, 나무위키 구장 문서) */
function specLine(sp: ParkSpec): string {
  const f = sp.fence;
  const h = sp.height.lr === sp.height.c || sp.height.c == null ? m(sp.height.lr) : `${m(sp.height.lr)}(좌우)·${m(sp.height.c)}(중앙)`;
  const turf = sp.turf.infield || sp.turf.outfield ? ` · 잔디 ${sp.turf.infield ?? '?'}${sp.turf.outfield && sp.turf.outfield !== sp.turf.infield ? `/${sp.turf.outfield}` : ''}` : '';
  const fence = f.l == null && f.c == null ? '펜스 제원 없음' : `펜스 좌 ${m(f.l)} · 중 ${m(f.c)} · 우 ${m(f.r)}m · 높이 ${h}m`;
  return `${fence}${turf}${sp.dome ? ' · 돔' : ''}${sp.seats ? ` · 좌석 ${sp.seats.toLocaleString()}` : ''}`;
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div className="gbar">
      <span>{label}</span>
      <span className="track" aria-hidden><i className={levelClass(v)} style={{ width: `${v}%` }} /></span>
      <strong>{Math.round(v)}</strong>
    </div>
  );
}

export function StadiumPanel() {
  const { session, store, changed, autosave } = useGame();
  const won = useWon();
  const L = session.league;
  const me = session.teamIdx;
  const off = session.phase === 'offseason';
  // 오프시즌이면 다음 시즌 기준
  const year = off ? session.year + 1 : session.year;
  const s = L.stadiums?.[me];
  const fans = fanLevel(L, me, session.year, off ? undefined : session.day - 1);
  const log = [...(L.fans?.[me]?.log ?? [])].reverse().slice(0, 14);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  // 신구장 펜스 제원 (구장효과 기획안 6.1·6.4): 예시값 버튼으로 채우고 고쳐 쓴다. 높이는 0.1m 단위 정수
  const [fence, setFence] = useState<Fence>(FENCE_PRESETS.neutral.fence);
  const [dome, setDome] = useState(false);
  const [deal, setDeal] = useState<'standard' | 'push'>('standard');

  if (!s) return <section className="panel"><p className="muted">구장 정보가 없습니다 (예전 저장). 다음 결산 뒤에 생깁니다.</p></section>;

  // 구장 지수 (구장효과 기획안 5.5): 경기에 쓰는 배율 그대로 (game/parkView.ts). 신구장 배율만 있을 때 득점 계수는 리그 타석당 득점으로 센다
  const rpa = leagueBase(session.season.bat, session.season.pit).runsPerPa || (L.seasonSaber?.[String(session.year - 1)]?.runsPerPa ?? 0);
  const pl: ParkLeague = { rates: session.world.league, rpa };
  const parkNow = L.teams.map((_, t) => teamParkView(store, L, t, year, pl));
  const parkPrev = L.teams.map((_, t) => teamParkView(store, L, t, year - 1, pl));
  const mine = parkNow[me];
  const spec = (s.done ?? []).some((d) => d.kind === 'new') ? undefined : realParkSpec(L.teams[me].franchise, year);
  // 펜스 내력 (게임 안 펜스 조정·가벽, 기획안 6.7.6-7·6.8.8-7)
  const fenceLog = (s.done ?? []).filter((d) => d.kind === 'fence' || d.kind === 'wall' || d.kind === 'wall-off');
  // 고른 펜스의 예상 구장 지수 (지금 구장 → 새 구장)
  const okFence = fenceValid(fence, DEFAULT_PARAMS.park);
  const planned = okFence ? fenceParkEvents(fence, DEFAULT_PARAMS.park) : undefined;
  const plannedIx = planned ? parkIndexOf({ hr: 1, ev: planned.ev }, DEFAULT_PARAMS.park, pl.rates, pl.rpa) : undefined;
  const R = DEFAULT_PARAMS.park.specFit.range;
  const setF = (k: keyof Fence, v: number) => setFence({ ...fence, [k]: k === 'h' ? Math.round(v * 10) : Math.round(v) });

  const order = (id: string) => {
    const r = session.orderStadium(id, id.startsWith('new') ? { fence, dome, deal } : {});
    setMsg({ text: r.message, error: !r.ok });
    setConfirm(null);
    changed();
    if (r.ok) void autosave();
  };
  const p = s.project;
  const building = p && p.open > session.year;
  const honey = s.opened !== undefined ? HONEYMOON[year - s.opened] ?? 0 : 0;

  return (
    <>
      <section className="panel">
        <h2>{stadiumName(L, me, year) ?? '우리 구장'} <span className="muted small">{s.opened !== undefined ? `${s.opened}년 개장` : '기존 구장'}{s.unchecked ? ' · 실제 구장 자료 확인 필요' : ''}</span></h2>
        <div className="stats">
          <div className="stat"><span className="stat-label">수용 인원</span><strong className="stat-value">{s.capacity.toLocaleString()}석</strong>
            {underConstruction(s, year) && p?.kind === 'remodel' && <span className="small down">{year} 시즌 공사 중 {seatsAt(s, year).toLocaleString()}석만</span>}</div>
          <div className="stat"><span className="stat-label">관중률 보정 (시설{honey ? '·새 구장' : ''})</span><strong className="stat-value">{pctp(stadiumFill(s, year))}</strong></div>
          <div className="stat"><span className="stat-label">객단가</span><strong className="stat-value">×{ticketScale(s).toFixed(2)}</strong></div>
          <div className="stat" title={isGuessBasis(mine.basis) ? '제원으로 짐작한 값' : undefined}><span className="stat-label">구장 지수 ({year} 시즌, {PARK_BASIS_LABEL[mine.basis]})</span>
            <strong className="stat-value">득점 {ix(mine.index.run)} · 홈런 {ix(mine.index.hr)}</strong>
            {ix(parkPrev[me].index.hr) !== ix(mine.index.hr) && <span className="small">홈런 {ixChange(parkPrev[me].index.hr, mine.index.hr)} (지난 시즌 → {year})</span>}
            {s.dome && <span className="small">돔</span>}</div>
        </div>
        {spec && <p className="small">{spec.name}: {specLine(spec)} <span className="muted">({spec.source}{spec.confirmed === '출처 확인' ? '' : ', 미확인'})</span></p>}
        {s.fence && <p className="small">{(s.done ?? []).some((d) => d.kind === 'new') ? '신구장 펜스' : '조정한 펜스'}: {fenceText(s.fence)}</p>}
        {s.wall && <p className="small">가벽 ({s.wall.from} 시즌부터, 우리 홈 경기만): {fenceText(s.wall.fence)}</p>}
        {fenceLog.length > 0 && (
          <ul className="plain small">
            {fenceLog.map((d, k) => (
              <li key={k}><span className="muted">{d.open} 시즌</span> {d.kind === 'fence' ? '펜스 조정' : d.kind === 'wall' ? '가벽 설치' : '가벽 철거'}{d.fence ? ` ${fenceText(d.fence)}` : ''}{d.park ? ` · 홈런 지수 ${ix(d.park.hr)} (짐작)` : ''}</li>
            ))}
          </ul>
        )}
        <Meter label="시설" v={s.quality} />
        <p className="muted small">시설은 해마다 1씩 낡습니다 (바닥 20). 50이 보통이고, 높을수록 관중이 더 들고 입장권을 비싸게 받을 수 있습니다. 신구장은 개장 뒤 세 시즌 동안 관중이 더 듭니다.</p>

        {building && p && (
          <div className="note">
            <strong>{p.kind === 'new' ? '신구장 건설' : '리모델링'} 중</strong>: {p.start}~{p.open - 1} 시즌 공사, {p.open} 시즌 개장 ({p.capacity.toLocaleString()}석).
            {' '}구단 부담 {won(p.cost)} (착공금 {won(downPayment(p.cost))}, 해마다 결산 때 {won(yearlyPayment(p.cost, p.open - p.start))}씩).
            {installment(s, session.year) > 0 && !off && ` 이번 시즌 결산 때 ${won(installment(s, session.year))}을 냅니다.`}
          </div>
        )}

        {off && !building && (
          <>
            <h3>공사 주문 <span className="muted small">{year} 시즌부터 공사</span></h3>
            <div className="form-row">
              <span className="inline">신구장 펜스 예시
                {(Object.keys(FENCE_PRESETS) as ParkSize[]).map((k) => (
                  <button key={k} type="button" className="small-btn" onClick={() => setFence(FENCE_PRESETS[k].fence)}>{FENCE_PRESETS[k].label}</button>
                ))}
              </span>
            </div>
            <div className="form-row">
              <label>좌측 (m)<input type="number" min={R.side[0]} max={R.side[1]} step={1} value={fence.l} onChange={(e) => setF('l', Number(e.target.value))} /></label>
              <label>중앙 (m)<input type="number" min={R.center[0]} max={R.center[1]} step={1} value={fence.c} onChange={(e) => setF('c', Number(e.target.value))} /></label>
              <label>우측 (m)<input type="number" min={R.side[0]} max={R.side[1]} step={1} value={fence.r} onChange={(e) => setF('r', Number(e.target.value))} /></label>
              <label>높이 (m)<input type="number" min={R.height[0]} max={R.height[1]} step={0.5} value={fence.h / 10} onChange={(e) => setF('h', Number(e.target.value))} /></label>
            </div>
            {!okFence && <p className="note error-box">고를 수 있는 범위: 좌·우 {R.side[0]}~{R.side[1]}m, 중앙 {R.center[0]}~{R.center[1]}m (1m 단위), 높이 {R.height[0]}~{R.height[1]}m (0.5m 단위)</p>}
            {planned && plannedIx && (
              <div className="scroll flat">
                <table>
                  <thead><tr><th className="l">신구장 예상 지수 (짐작)</th><th>득점</th><th>홈런</th><th>2루타</th><th>3루타</th><th>좌타 홈런</th><th>우타 홈런</th></tr></thead>
                  <tbody>
                    <tr title="제원으로 짐작한 값">
                      <td className="l">지금 구장 → 새 구장</td>
                      <td>{ix(mine.index.run)} → {ix(plannedIx.run)}</td>
                      <td>{ix(mine.index.hr)} → {ix(plannedIx.hr)}{planned.edge.hr ? ' (범위 끝)' : ''}</td>
                      <td>{ix(mine.index.d2)} → {ix(plannedIx.d2)}{planned.edge.xb ? ' (범위 끝)' : ''}</td>
                      <td>{ix(mine.index.t3)} → {ix(plannedIx.t3)}</td>
                      <td>{ix(mine.index.hrL)} → {ix(plannedIx.hrL)}</td>
                      <td>{ix(mine.index.hrR)} → {ix(plannedIx.hrR)}</td>
                    </tr>
                  </tbody>
                </table>
                {nearestPark(store.parks?.specs, fence) && <p className="muted small">평균 거리가 가장 비슷한 실제 구장: {nearestPark(store.parks?.specs, fence)}</p>}
              </div>
            )}
            <div className="form-row">
              <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={dome} onChange={(e) => setDome(e.target.checked)} /> 돔 (공사비 ×{DOME.cost}, 관중률 +{Math.round(DOME.fill * 100)}%p)</label>
              <label>지자체 협상
                <select value={deal} onChange={(e) => setDeal(e.target.value as 'standard' | 'push')}>
                  <option value="standard">표준 분담 (표 그대로)</option>
                  <option value="push">지원을 더 요구 (성공 {Math.round(municipalChance(L, me, session.year) * 100)}%: 구단 부담 −{Math.round((1 - MUNICIPAL.share) * 100)}%, 실패: 착공 한 시즌 늦어짐·팬 {MUNICIPAL.fanLoss})</option>
                </select>
              </label>
            </div>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">공사</th><th>구단 부담</th><th>착공금</th><th>기간</th><th>해마다</th><th>완공 뒤</th><th className="l">공사 중</th><th /></tr></thead>
                <tbody>
                  {stadiumOptions(wageIndex(session.year + 1, L)).filter((o) => o.kind === 'remodel' || o.kind === 'new').map((o) => {
                    const cost = o.kind === 'new' && dome ? Math.round(o.cost * DOME.cost) : o.cost;
                    return (
                    <tr key={o.id}>
                      <td className="l">{o.label}{o.kind === 'new' && <span className="muted small"> · {fenceText(fence)}{dome ? ' · 돔' : ''}</span>}</td><td>{won(cost)}</td><td>{won(downPayment(cost))}</td><td>{o.years}시즌</td><td>{won(yearlyPayment(cost, o.years))}</td>
                      <td>{o.capacity(s.capacity).toLocaleString()}석 · 시설 {o.kind === 'new' ? 100 : Math.min(90, s.quality - 1 + REMODEL.quality)}</td>
                      <td className="l small">{o.kind === 'remodel' ? `그 시즌 관중석 ${Math.round(REMODEL.closed * 100)}% 못 씀` : '옛 구장을 그대로 씀'}</td>
                      <td>
                        {confirm === o.id
                          ? <span className="inline"><button type="button" className="small-btn danger" onClick={() => order(o.id)}>정말 주문</button><button type="button" className="small-btn" onClick={() => setConfirm(null)}>취소</button></span>
                          : <button type="button" className="small-btn" disabled={o.kind === 'new' && !okFence} onClick={() => setConfirm(o.id)}>주문</button>}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">신구장 펜스는 홈·원정 두 팀 타자 모두의 2루타·3루타·홈런에 곱해집니다 (신구장을 지으면 원래 구장의 구장 효과 대신 이 값만 씁니다).
              펜스가 가까울수록 홈런이 늘고 2루타·3루타가 줄며, 가장 작은 구장(좌·우 {R.side[0]}·중앙 {R.center[0]}m)은 실측 최대인 홈런 지수 147, 가장 큰 구장은 실측 최소인 70쯤입니다.
              높을수록 홈런이 줄고 2루타가 늘며, 좌·우가 다르면 짧은 쪽으로 당겨 치는 타자(좌타는 우측)의 홈런이 늘어납니다. 착공 뒤에는 바꿀 수 없습니다. 신구장은 지자체와 함께 짓는 것으로 보고 구단 몫만 냅니다. 공사비 때문에 적자가 나면 모기업이 메우지만 구단주 신뢰도가 떨어집니다. 수치는 임시값입니다.</p>
          </>
        )}
        {off && <FenceWorkSection now={mine} pl={pl} onDone={(r) => { setMsg({ text: r.message, error: !r.ok }); changed(); if (r.ok) void autosave(); }} />}
        {!off && !building && <p className="muted small">공사는 오프시즌에 주문합니다.</p>}
        <NamingSection year={year} off={off} onDone={(r) => { setMsg({ text: r.message, error: !r.ok }); changed(); if (r.ok) void autosave(); }} />
        {msg && <p className={msg.error ? 'note error-box' : 'note'} role="status">{msg.text}</p>}
      </section>

      <section className="panel">
        <h2>팬 만족도</h2>
        <Meter label="만족도" v={fans} />
        <div className="stats">
          <div className="stat"><span className="stat-label">관중률 보정</span><strong className="stat-value">{pctp(fanFill(fans))}</strong></div>
          <div className="stat"><span className="stat-label">스폰서·상품</span><strong className="stat-value">×{fanSponsor(fans).toFixed(2)}</strong></div>
        </div>
        <p className="muted small">성적·가을야구·우승이 만족도를 올립니다. 우리 구단에서 5시즌 넘게 뛴 주축(프랜차이즈 스타)을 트레이드하거나 FA로 잃으면 크게 떨어지고, FA에서 붙잡으면 오릅니다. 해마다 연고 기본값 쪽으로 조금씩 돌아갑니다.</p>
        {log.length > 0 && (
          <ul className="plain small">
            {log.map((e, k) => (
              <li key={k}><span className={e.delta >= 0 ? 'up' : 'down'}>{e.delta >= 0 ? '+' : '−'}{Math.abs(e.delta).toFixed(1)}</span> <span className="muted">{e.year}{e.day === -2 ? ' 오프시즌' : ''}</span> {e.reason}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>리그 구장·팬</h2>
        <div className="scroll">
          <table>
            <thead><tr><th className="l">구단</th><th>수용 인원</th><th>시설</th><th>돔</th><th>팬 만족도</th><th className="l">공사</th></tr></thead>
            <tbody>
              {L.teams.map((_, t) => {
                const st = L.stadiums?.[t];
                if (!st) return null;
                const pr = st.project && st.project.open > session.year ? st.project : null;
                return (
                  <tr key={t} className={t === me ? 'me' : ''}>
                    <td className="l"><TeamName idx={t} />{stadiumName(L, t, year) && <span className="muted small"> {stadiumName(L, t, year)}</span>}</td><td>{st.capacity.toLocaleString()}</td><td>{st.quality}</td><td>{st.dome ? '돔' : ''}</td>
                    <td>{Math.round(fanLevel(L, t, session.year, off ? undefined : session.day - 1))}</td>
                    <td className="l small">{pr ? `${pr.kind === 'new' ? '신구장' : '리모델링'} ${pr.open} 개장` : st.opened !== undefined ? `${st.opened} 개장` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ParkIndexTable year={year} now={parkNow} prev={parkPrev} />
    </>
  );
}

/**
 * 리그 구장 지수 (구장효과 기획안 5.5, 결정 5): 100 = 리그 평균. 홈·원정 두 팀 타자 모두에게 곱해지는 홈 구장 배율.
 * 지난 시즌과 달라진 칸은 "전 → 후"
 */
function ParkIndexTable({ year, now, prev }: { year: number; now: TeamParkView[]; prev: TeamParkView[] }) {
  const { session } = useGame();
  const L = session.league;
  const me = session.teamIdx;
  const cell = (t: number, k: 'run' | 'hr' | 'd2' | 't3' | 'hrL' | 'hrR') => {
    const v = now[t].index[k];
    const was = prev[t].index[k];
    const b = now[t].basis;
    return <td className={b === 'none' || isGuessBasis(b) ? 'muted' : undefined} title={isGuessBasis(b) ? '제원으로 짐작한 값' : undefined}>{ixChange(was, v)}</td>;
  };
  return (
    <section className="panel">
      <h2>리그 구장 지수 <span className="muted small">{year} 시즌 · 100 = 리그 평균</span></h2>
      <div className="scroll">
        <table>
          <thead><tr><th className="l">구단</th><th>득점</th><th>홈런</th><th>2루타</th><th>3루타</th><th>좌타 홈런</th><th>우타 홈런</th><th className="l">근거</th></tr></thead>
          <tbody>
            {L.teams.map((_, t) => (
              <tr key={t} className={t === me ? 'me' : ''}>
                <td className="l"><TeamName idx={t} />{stadiumName(L, t, year) && <span className="muted small"> {stadiumName(L, t, year)}</span>}</td>
                {cell(t, 'run')}{cell(t, 'hr')}{cell(t, 'd2')}{cell(t, 't3')}{cell(t, 'hrL')}{cell(t, 'hrR')}
                <td className="l small">{PARK_BASIS_LABEL[now[t].basis]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        홈 구장 경기에서 두 팀 타자 모두의 단타·2루타·3루타·홈런에 곱해지는 배율입니다 (삼진·볼넷에는 구장 효과가 없습니다). 실측은 2015년 뒤 하드힛 파크팩터와
        2022~2025 구장 구성 지수로 만든 값입니다. 2014년 이전은 같은 구장이 2015년 뒤까지 이어지면 실측을 옛 해에 그대로 쓰고(펜스가 달랐던 해는 펜스 차이만큼 짐작해 고침),
        사라진 구장과 큰 리모델링 전 구장은 펜스 거리·높이로 짐작해 중립 쪽으로 반쯤 당긴 값입니다 (짐작은 흐린 글씨, 실제를 잘 맞히는 식은 아닙니다). 펜스 제원이 없는 구장은 중립(100)입니다.
        2027년 뒤는 같은 구장-기간의 실측 해 평균을 이어 씁니다 (실제 새 구장도 제원이 확정되기 전에는 쓰던 구장 값). 게임 안에서 펜스를 조정하거나 가벽을 세운 구장은
        실측에 펜스가 바뀐 만큼의 짐작을 곱한 값입니다. 옛 해는 해마다 리그 평균이 100이 되게 맞춥니다. 지난 시즌과 달라진 칸은 "지난 시즌 → {year}"로 보여 줍니다.
        wRC+는 이 득점 지수의 절반(원정 경기는 리그 평균 구장)으로 구장을 보정합니다.
      </p>
    </section>
  );
}

/** 가벽 예시값 (기획안 6.8.2): 실제 X-존을 고를 수 있는 범위로 (높이 2m → 2.5m) */
const WALL_PRESET: Fence = { l: 100, c: 121, r: 100, h: 25 };

/**
 * 펜스 조정 공사·가벽 (구장효과 기획안 6.7.6·6.8.8): 혼자 쓰는 구장은 펜스 조정, 함께 쓰는 구장은 가벽. 오프시즌 안에 끝나 다음 시즌부터.
 * 칸은 지금 펜스로 채워지고, 바뀌는 지수를 "지금 → 조정 뒤"로 보여 준다. 못 할 때는 거절 문구를 미리 보이고 주문 버튼을 막는다
 */
function FenceWorkSection({ now, pl, onDone }: { now: TeamParkView; pl: ParkLeague; onDone: (r: { ok: boolean; message: string }) => void }) {
  const { session } = useGame();
  const won = useWon();
  const L = session.league;
  const me = session.teamIdx;
  const src = session.parkSource();
  const st = fenceWorkState(L, me, session.year, src);
  const wallMode = st.kind === 'wall';
  const [work, setWork] = useState<Fence>(wallMode ? st.wall ?? st.now : st.now);
  const [confirm, setConfirm] = useState<string | null>(null);
  const R = DEFAULT_PARAMS.park.specFit.range;
  // 미리 보기는 자금과 상관없이, 자금이 모자라면 문구를 따로 보이고 주문 버튼을 막는다
  const plan = planFenceWork(L, me, session.year, st.kind, work, Number.MAX_SAFE_INTEGER, src);
  const after = plan.ok ? parkIndexOf({ hr: 1, ev: plan.park }, DEFAULT_PARAMS.park, pl.rates, pl.rpa) : undefined;
  const setW = (k: keyof Fence, v: number) => setWork({ ...work, [k]: k === 'h' ? Math.round(v * 10) : v });
  // 예시값은 고르는 칸만 채운다. 가벽은 원래 펜스보다 짧은 칸만
  const preset = (f: Fence) => setWork(wallMode ? { l: Math.min(f.l, st.now.l), c: Math.min(f.c, st.now.c), r: Math.min(f.r, st.now.r), h: f.h } : f);
  const order = (id: string) => {
    onDone(session.orderStadium(id, id === 'wall-off' ? {} : { fence: work }));
    setConfirm(null);
  };
  const year = session.year + 1;
  // 비용은 그 해 연봉 상승 지수만큼 오른다 (리모델링·신구장과 같은 규칙). 조립·해체는 첫 시즌 값
  const cost = fenceWorkCost(wallMode ? 'wall' : 'fence', wageIndex(year, L));
  const yearly = fenceWorkCost('wall-yearly', wageIndex(year, L));
  const short = session.cashNow() < cost ? `자금이 모자랍니다. ${won(cost)}은 있어야 합니다.` : undefined;
  const partner = st.partner !== undefined ? L.teams[st.partner].name : undefined;
  const button = (id: string, label: string, disabled: boolean) => (confirm === id
    ? <span className="inline"><button type="button" className="small-btn danger" onClick={() => order(id)}>정말 주문</button><button type="button" className="small-btn" onClick={() => setConfirm(null)}>취소</button></span>
    : <button type="button" className="small-btn" disabled={disabled} onClick={() => setConfirm(id)}>{label}</button>);
  return (
    <>
      <h3>{wallMode ? '가벽' : '펜스 조정'} <span className="muted small">오프시즌 안에 끝나 {year} 시즌부터 · {wallMode ? `설치 ${won(cost)} + 서 있는 시즌마다 ${won(yearly)}부터` : `구단 부담 ${won(cost)} (일시불)`}</span></h3>
      <p className="small">지금 펜스: {fenceText(st.now)}{st.wall ? ` · 가벽 ${fenceText(st.wall)}` : ''}{st.history ? ` · 실제 역사의 가벽 (${st.history.name}, ${st.history.from}~${st.history.to})이 섭니다` : ''}</p>
      {wallMode
        ? <p className="muted small">함께 쓰는 구장({partner})이라 펜스 대신 원래 펜스 앞에 가벽을 세웁니다. 가벽은 우리 홈 경기에만 세웁니다. {partner} 홈 경기는 원래 펜스 그대로입니다. 구장 효과는 양 팀 타자에게 같이 들어갑니다.</p>
        : <p className="muted small">실측 구장 효과에 펜스가 바뀐 만큼의 짐작을 곱합니다. 원래 펜스로 되돌리면 실측 값으로 돌아갑니다. 바꾸지 않는 칸은 지금 값 그대로 두면 됩니다 (범위 밖 값도 그대로 둘 수 있습니다).</p>}
      <div className="form-row">
        <span className="inline">예시
          {wallMode
            ? <><button type="button" className="small-btn" onClick={() => preset(WALL_PRESET)}>X-존처럼</button><button type="button" className="small-btn" onClick={() => preset(FENCE_PRESETS.hitter.fence)}>{FENCE_PRESETS.hitter.label}</button></>
            : (Object.keys(FENCE_PRESETS) as ParkSize[]).map((k) => <button key={k} type="button" className="small-btn" onClick={() => preset(FENCE_PRESETS[k].fence)}>{FENCE_PRESETS[k].label}</button>)}
          <button type="button" className="small-btn" onClick={() => setWork(wallMode ? st.wall ?? st.now : st.now)}>지금 펜스</button>
        </span>
      </div>
      <div className="form-row">
        <label>좌측 (m)<input type="number" min={R.side[0]} max={wallMode ? st.now.l : R.side[1]} step={1} value={work.l} onChange={(e) => setW('l', Number(e.target.value))} /></label>
        <label>중앙 (m)<input type="number" min={R.center[0]} max={wallMode ? st.now.c : R.center[1]} step={1} value={work.c} onChange={(e) => setW('c', Number(e.target.value))} /></label>
        <label>우측 (m)<input type="number" min={R.side[0]} max={wallMode ? st.now.r : R.side[1]} step={1} value={work.r} onChange={(e) => setW('r', Number(e.target.value))} /></label>
        <label>높이 (m)<input type="number" min={R.height[0]} max={R.height[1]} step={0.5} value={work.h / 10} onChange={(e) => setW('h', Number(e.target.value))} /></label>
      </div>
      {plan.ok && after
        ? (
          <div className="scroll flat">
            <table>
              <thead><tr><th className="l">{wallMode ? '우리 홈 경기 예상 지수 (짐작)' : '예상 지수 (짐작)'}</th><th>득점</th><th>홈런</th><th>2루타</th><th>3루타</th><th>좌타 홈런</th><th>우타 홈런</th></tr></thead>
              <tbody>
                <tr title="제원으로 짐작한 값">
                  <td className="l">지금 → 조정 뒤</td>
                  <td>{ixChange(now.index.run, after.run)}</td><td>{ixChange(now.index.hr, after.hr)}</td><td>{ixChange(now.index.d2, after.d2)}</td>
                  <td>{ixChange(now.index.t3, after.t3)}</td><td>{ixChange(now.index.hrL, after.hrL)}</td><td>{ixChange(now.index.hrR, after.hrR)}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">펜스 {fenceChangeText(plan.from, work)}</p>
          </div>
        )
        : <p className="note error-box">{plan.ok ? '' : plan.message} {!plan.ok && plan.message.startsWith('고를') ? `고를 수 있는 범위: 좌·우 ${R.side[0]}~${R.side[1]}m, 중앙 ${R.center[0]}~${R.center[1]}m (1m 단위), 높이 ${R.height[0]}~${R.height[1]}m (0.5m 단위)` : ''}</p>}
      {plan.ok && short && <p className="note error-box">{short}</p>}
      {!st.block && <p className="muted small">펜스는 {FENCE_WORK.every}시즌마다 바꿀 수 있습니다: 지금 주문하면 다음은 {year + FENCE_WORK.every} 시즌부터{wallMode ? ' (가벽 철거는 언제든)' : ''}.</p>}
      <div className="form-row">
        {button(st.kind, wallMode ? (st.wall ? '가벽 제원 바꾸기' : '가벽 설치') : '펜스 조정 주문', !plan.ok || !!short)}
        {(st.wall || st.history) && button('wall-off', '가벽 철거 (비용 없음)', false)}
      </div>
    </>
  );
}

/** 구장 명명권 (league/naming.ts): 지금 계약, 오프시즌에는 가상 기업들의 제안 */
function NamingSection({ year, off, onDone }: { year: number; off: boolean; onDone: (r: { ok: boolean; message: string }) => void }) {
  const { session } = useGame();
  const won = useWon();
  const L = session.league;
  const me = session.teamIdx;
  const now = namingAt(L, me, year);
  const offers = off ? namingOffers(L, me, session.year) : [];
  return (
    <>
      <h3>명명권</h3>
      {now
        ? <p className="small">{now.sponsor} 파크 · {now.from}~{now.until} 시즌 · 해마다 {won(now.yearly)} (개막 때 들어옵니다)</p>
        : <p className="muted small">구장 이름을 팔지 않았습니다.{off ? '' : ' 제안은 오프시즌에 받습니다.'}</p>}
      {offers.length > 0 && (
        <div className="scroll flat">
          <table>
            <thead><tr><th className="l">기업 (가상)</th><th>기간</th><th>해마다</th><th>합계</th><th /></tr></thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td className="l">{o.sponsor}</td><td>{o.years}시즌</td><td>{won(o.yearly)}</td><td>{won(o.yearly * o.years)}</td>
                  <td><ConfirmButton label="계약" confirmLabel="정말 계약 (중간에 깰 수 없음)" className="small-btn" onConfirm={() => onDone(session.signNaming(o.id))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {offers.length > 0 && <p className="muted small">제안 금액은 팬 만족도와 시설이 좋을수록 큽니다. 기업 이름은 모두 가상입니다.</p>}
    </>
  );
}
