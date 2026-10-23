// 구장·팬 (구단 운영 탭, stadium.ts): 우리 구장과 공사 주문, 팬 만족도와 그 변화, 리그 구단 비교.
import { useState } from 'react';
import {
  DOME, downPayment, MUNICIPAL, municipalChance, fanFill, fanLevel, fanSponsor, HONEYMOON, installment, PARK_SIZES, REMODEL, seatsAt, stadiumFill, stadiumOptions, ticketScale, underConstruction, yearlyPayment,
  type ParkSize,
} from '../../league/stadium';
import { TeamName, useGame, useWon } from '../context';
import { ConfirmButton } from '../ConfirmButton';
import { namingAt, namingOffers, stadiumName } from '../../league/naming';
import { realParkSpec } from '../../league/ballparks';
import { PARK_BASIS_LABEL, teamParkView, type ParkLeague, type TeamParkView } from '../../game/parkView';
import { leagueBase } from '../../game/saber';
import type { ParkSpec } from '../../data/types';

const levelClass = (v: number) => (v >= 75 ? 'g-hi' : v >= 60 ? 'g-up' : v <= 25 ? 'g-lo' : v <= 40 ? 'g-dn' : '');
const pctp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%p`;
/** 구장 배율 → 지수 (100 = 리그 평균) */
const ix = (m: number) => Math.round(m * 100);
/** 지난 시즌과 다르면 "전 → 후" */
const ixChange = (prev: number, now: number) => (ix(prev) !== ix(now) ? `${ix(prev)} → ${ix(now)}` : String(ix(now)));
const m = (v: number | null) => (v == null ? '?' : `${v}`);

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
  const [size, setSize] = useState<ParkSize>('neutral');
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

  const order = (id: string) => {
    const r = session.orderStadium(id, id.startsWith('new') ? { size, dome, deal } : {});
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
          <div className="stat"><span className="stat-label">구장 지수 ({year} 시즌, {PARK_BASIS_LABEL[mine.basis]})</span>
            <strong className="stat-value">득점 {ix(mine.index.run)} · 홈런 {ix(mine.index.hr)}</strong>
            {ix(parkPrev[me].index.hr) !== ix(mine.index.hr) && <span className="small">홈런 {ixChange(parkPrev[me].index.hr, mine.index.hr)} (지난 시즌 → {year})</span>}
            {s.dome && <span className="small">돔</span>}</div>
        </div>
        {spec && <p className="small">{spec.name}: {specLine(spec)} <span className="muted">({spec.source}{spec.confirmed === '출처 확인' ? '' : ', 미확인'})</span></p>}
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
              <label>신구장 크기
                <select value={size} onChange={(e) => setSize(e.target.value as ParkSize)}>
                  {(Object.keys(PARK_SIZES) as ParkSize[]).map((k) => <option key={k} value={k}>{PARK_SIZES[k].label} · 홈런 ×{PARK_SIZES[k].hr}</option>)}
                </select>
              </label>
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
                  {stadiumOptions().map((o) => {
                    const cost = o.kind === 'new' && dome ? Math.round(o.cost * DOME.cost) : o.cost;
                    return (
                    <tr key={o.id}>
                      <td className="l">{o.label}{o.kind === 'new' && <span className="muted small"> · {PARK_SIZES[size].label}{dome ? ' · 돔' : ''}</span>}</td><td>{won(cost)}</td><td>{won(downPayment(cost))}</td><td>{o.years}시즌</td><td>{won(yearlyPayment(cost, o.years))}</td>
                      <td>{o.capacity(s.capacity).toLocaleString()}석 · 시설 {o.kind === 'new' ? 100 : Math.min(90, s.quality - 1 + REMODEL.quality)}</td>
                      <td className="l small">{o.kind === 'remodel' ? `그 시즌 관중석 ${Math.round(REMODEL.closed * 100)}% 못 씀` : '옛 구장을 그대로 씀'}</td>
                      <td>
                        {confirm === o.id
                          ? <span className="inline"><button type="button" className="small-btn danger" onClick={() => order(o.id)}>정말 주문</button><button type="button" className="small-btn" onClick={() => setConfirm(null)}>취소</button></span>
                          : <button type="button" className="small-btn" onClick={() => setConfirm(o.id)}>주문</button>}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">신구장 크기는 홈·원정 두 팀 타자 모두의 홈런에 그대로 곱해집니다 (신구장을 지으면 원래 구장의 실측 구장 효과 대신 이 배율만 씁니다. 원래 구장은 2015년 뒤 실측 구장 효과를 쓰고, 2014년 이전은 중립입니다). 신구장은 지자체와 함께 짓는 것으로 보고 구단 몫만 냅니다. 공사비 때문에 적자가 나면 모기업이 메우지만 구단주 신뢰도가 떨어집니다. 수치는 임시값입니다.</p>
          </>
        )}
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
    return <td className={now[t].basis === 'none' ? 'muted' : undefined}>{ixChange(was, v)}</td>;
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
        2022~2025 구장 구성 지수로 만든 값이고, 2014년 이전은 자료가 없어 중립(100)입니다. 지난 시즌과 달라진 칸은 "지난 시즌 → {year}"로 보여 줍니다.
        wRC+는 이 득점 지수의 절반(원정 경기는 리그 평균 구장)으로 구장을 보정합니다.
      </p>
    </section>
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
