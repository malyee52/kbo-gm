// 입대 선택: 정규시즌이 끝난 뒤 결산 전에, 이번 오프시즌에 입대할 우리 구단 선수를 고른다 (시즌 결과 화면의 탭).
import { isStarterSkill } from '../../engine';
import { MILITARY_LAST_AGE, MILITARY_MIN_AGE, serviceName, serviceTerms, UNIT_MAX_AGE } from '../../league/careers';
import type { LeaguePlayer } from '../../league/types';
import { Grade, PlayerLink, Pos, useGame } from '../context';
import { runsGrade } from '../grades';

/** 병역 상태의 근거 (실제 자료 / 짐작 / 게임 신인) */
function basisText(p: LeaguePlayer): string {
  const m = p.military;
  if (!p.real) return '게임이 만든 신인';
  if (m?.basis === 'record') return `실제 자료: ${m.note ?? ''}`;
  if (m?.basis === 'estimate') return `짐작: ${m.note ?? '나이'}`;
  return '실제 자료에 복무·면제 기록 없음';
}

export function EnlistPanel() {
  const { session, changed, autosave } = useGame();
  const year = session.year;
  const lp = new Map(session.league.players.map((p) => [p.id, p]));
  const sim = new Map(session.world.players.map((p) => [p.id, p]));

  if (session.phase !== 'season') {
    // 결산이 끝났으면 이번에 입대한 선수만 보여 준다
    const went = session.league.players.filter((p) => p.team === session.teamIdx && (p.military?.state === 'serving' || p.military?.state === 'homeOnly') && p.military.enlisted === year);
    return (
      <section className="panel">
        <h2>{year} 시즌 뒤 입대</h2>
        {went.length
          ? <p>{went.map((p) => `${p.name}(${serviceName(p.military)}, ${p.military!.returnYear}년 ${p.military!.returnDay ? '시즌 중' : '개막 전'} 복귀)`).join(', ')} ({went.length}명)</p>
          : <p className="muted">이번에 입대한 선수가 없습니다.</p>}
      </section>
    );
  }

  const { cands, recommended, chosen, apply } = session.enlistOptions();
  const picked = new Set(chosen);
  const applying = new Set(apply);
  const forced = cands.filter((c) => c.forced).length;
  const optional = chosen.length - forced;
  const terms = serviceTerms(year);
  const unitSeats = terms.quota.sangmu + terms.quota.police;
  const endText = (e: { year: number; day: number }) => (e.day > 0 ? `${e.year} 시즌 개막 뒤 약 ${e.day}일` : `${e.year} 시즌 개막 전`);
  const save = () => {
    changed();
    void autosave();
  };
  const set = (ids: string[] | null) => {
    session.setEnlist(ids);
    if (ids === null) session.setApply(null);
    save();
  };
  // 한 선수의 입대 형태: 미룸 / 군 야구단 지원 / 현역(보충역이면 보충역)
  const choose = (id: string, v: 'stay' | 'unit' | 'go') => {
    const ids = v === 'stay' ? chosen.filter((x) => x !== id) : picked.has(id) ? chosen : [...chosen, id];
    session.setEnlist(ids);
    const now = session.enlistOptions().apply;
    session.setApply(v === 'unit' ? [...now, id] : now.filter((x) => x !== id));
    save();
  };
  const unitName = terms.quota.police ? '상무·경찰' : '상무';

  // 우리 구단 병역 현황 (참고)
  const mine = session.league.players.filter((p) => (sim.get(p.id)?.teamIdx ?? p.team) === session.teamIdx && !p.foreign);
  const count = (f: (p: LeaguePlayer) => boolean) => mine.filter(f).length;

  return (
    <div className="stack">
      <section className="panel">
        <h2>입대 선택 <span className="muted small">{year} 시즌 뒤 결산 때 입대</span></h2>
        <p className="muted small">
          {year + 1}년 입대 기준입니다.
          {unitSeats > 0
            ? <> 군 야구단({unitName})은 리그 전체 {unitSeats}명을 기록·잠재력과 체력 검사로 뽑습니다 ({UNIT_MAX_AGE}세 이하 지원, 한 구단에서 몇 명 안 됩니다).
              합격하면 {terms.unit.months}개월 동안 퓨처스리그에서 뛰며 자라고 {endText(terms.unit.end)}에 돌아옵니다. 떨어지면 현역으로 입대합니다.</>
            : <> 이 해에는 프로 선수를 받는 군 야구단이 없습니다.</>}
          {' '}현역은 {terms.active.months}개월 동안 경기에 못 나오고 감각이 떨어지며, {endText(terms.active.end)}에 돌아옵니다.
          {terms.homeOnly
            ? <> 보충역(방위병)은 {terms.reserve.months}개월 동안 출퇴근 복무를 하며 홈경기에만 나옵니다 ({endText(terms.reserve.end)}까지).</>
            : <> 보충역({year + 1 <= 2013 ? '공익근무' : '사회복무'})은 {terms.reserve.months}개월 동안 경기에 못 나오고 {endText(terms.reserve.end)}에 돌아옵니다.</>}
          {' '}복무 중에는 정원(68명)에 세지 않습니다 (방위병은 셉니다). 다음 시즌 {MILITARY_LAST_AGE}세가 되는 미필 선수는 반드시 입대합니다.
          고르지 않으면 추천대로 입대합니다. 보충역 판정 비율·선발 점수는 임시 규칙입니다.
        </p>
        <p className="small">
          입대 {chosen.length}명 (강제 {forced}명 + 선택 {optional}명) · {unitName} 지원 {apply.length}명
          {session.enlistChoice || session.applyChoice ? '' : ' · 지금은 추천대로입니다'}
        </p>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => set(null)} disabled={!session.enlistChoice && !session.applyChoice}>추천대로</button>
          <button type="button" className="ghost" onClick={() => set([])} disabled={optional === 0}>강제 입대만</button>
        </div>
      </section>

      {cands.length === 0 ? (
        <p className="muted">올해 입대할 수 있는 미필 선수가 없습니다 (다음 시즌 {MILITARY_MIN_AGE}세 이상 미필 국내 선수).</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr><th className="l">입대</th><th className="l">선수</th><th>자리</th><th>다음 시즌 나이</th><th>현재</th><th>잠재</th><th className="l">구분</th><th className="l">병역 근거</th></tr>
            </thead>
            <tbody>
              {cands.map((c) => {
                const p = lp.get(c.id)!;
                const sp = sim.get(c.id);
                const on = picked.has(c.id);
                const value = !on ? 'stay' : applying.has(c.id) ? 'unit' : 'go';
                const tags = [c.forced ? `강제 (${MILITARY_LAST_AGE}세)` : '', c.reserve ? '보충역 판정' : '', recommended.includes(c.id) && !c.forced ? '추천' : '', p.contract.until > year + 1 ? '다년 계약' : '']
                  .filter(Boolean).join(' · ');
                return (
                  <tr key={c.id} className={on ? 'me' : ''}>
                    <td className="l">
                      <select value={value} onChange={(e) => choose(c.id, e.target.value as 'stay' | 'unit' | 'go')} aria-label={`${p.name} 입대`}>
                        {!c.forced && <option value="stay">미룸</option>}
                        {c.canApply && <option value="unit">{unitName} 지원</option>}
                        <option value="go">{c.reserve ? (terms.homeOnly ? '방위병' : '보충역') : '현역'} 입대</option>
                      </select>
                    </td>
                    <td className="l">{sp ? <PlayerLink p={sp} /> : p.name}</td>
                    <td>{p.isPitcher ? (isStarterSkill(p.pit) ? '선발' : '구원') : <Pos pos={p.pos} />}</td>
                    <td>{c.age}</td>
                    <td><Grade v={runsGrade(c.runs, session.year)} /></td>
                    <td><Grade v={runsGrade(p.scoutPotential ?? p.potential, session.year)} /></td>
                    <td className="l small">{tags || '-'}</td>
                    <td className="l small muted">{basisText(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="panel">
        <h2>우리 구단 병역 현황</h2>
        <p className="small">
          복무 중 {count((p) => p.military?.state === 'serving' || p.military?.state === 'homeOnly')}명 · 미필 {count((p) => p.military?.state === 'pending')}명
          (그중 다음 시즌 {MILITARY_MIN_AGE}세 미만 {count((p) => p.military?.state === 'pending' && !!p.birthYear && year + 1 - p.birthYear < MILITARY_MIN_AGE)}명) ·
          마침 {count((p) => p.military?.state === 'done')}명 · 면제 {count((p) => p.military?.state === 'exempt')}명
        </p>
        <p className="muted small">
          시작 때 병역 상태는 실제 자료로 정했습니다: 2026 선수 프로필 경력의 상무·경찰 복무, 국제대회 금메달 대표팀
          (2002·2010·2014·2018·2022 아시안게임, 2008 올림픽, 2026 아시안게임 새 면제자). 자료에 없는 현역·사회복무는 알 수 없어
          29세 이상이거나 1군 기록이 1~2년 빈 선수는 마친 것으로 짐작했습니다.
        </p>
      </section>
    </div>
  );
}
