// 입대 선택: 정규시즌이 끝난 뒤 결산 전에, 이번 오프시즌에 입대할 우리 구단 선수를 고른다 (시즌 결과 화면의 탭).
import { MILITARY_LAST_AGE, MILITARY_MIN_AGE, MILITARY_RETURN_DAY, MILITARY_TEAM_CAP } from '../../league/careers';
import type { LeaguePlayer } from '../../league/types';
import { Grade, PlayerLink, posName, useGame } from '../context';
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
    const went = session.league.players.filter((p) => p.team === session.teamIdx && p.military?.state === 'serving' && p.military.enlisted === year);
    return (
      <section className="panel">
        <h2>{year} 시즌 뒤 입대</h2>
        {went.length ? <p>{went.map((p) => p.name).join(', ')} ({went.length}명, {year + 2} 시즌 중 복귀)</p> : <p className="muted">이번에 입대한 선수가 없습니다.</p>}
      </section>
    );
  }

  const { cands, recommended, chosen } = session.enlistOptions();
  const picked = new Set(chosen);
  const forced = cands.filter((c) => c.forced).length;
  const room = Math.max(0, MILITARY_TEAM_CAP - forced);
  const optional = chosen.length - forced;
  const set = (ids: string[] | null) => {
    session.setEnlist(ids);
    changed();
    void autosave();
  };
  const toggle = (id: string) => set(picked.has(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  // 우리 구단 병역 현황 (참고)
  const mine = session.league.players.filter((p) => (sim.get(p.id)?.teamIdx ?? p.team) === session.teamIdx && !p.foreign);
  const count = (f: (p: LeaguePlayer) => boolean) => mine.filter(f).length;

  return (
    <div className="stack">
      <section className="panel">
        <h2>입대 선택 <span className="muted small">{year} 시즌 뒤 결산 때 입대</span></h2>
        <p className="muted small">
          입대한 선수는 {year + 1} 시즌 전체를 빠지고 {year + 2} 시즌 개막 뒤 약 {MILITARY_RETURN_DAY}일에 돌아옵니다. 복무 중에는 정원(68명)에 세지 않습니다.
          다음 시즌 {MILITARY_LAST_AGE}세가 되는 미필 선수는 반드시 입대하고, 그 밖에는 강제 입대를 포함해 한 해 {MILITARY_TEAM_CAP}명까지 보낼 수 있습니다 (임시 규칙).
          고르지 않으면 추천대로 입대합니다.
        </p>
        <p className="small">
          선택 {chosen.length}명 (강제 {forced}명 + 선택 {optional}/{room}명)
          {session.enlistChoice ? '' : ' · 지금은 추천대로입니다'}
        </p>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => set(null)} disabled={!session.enlistChoice}>추천대로</button>
          <button type="button" className="ghost" onClick={() => set([])} disabled={optional === 0}>강제 입대만</button>
        </div>
      </section>

      {cands.length === 0 ? (
        <p className="muted">올해 입대할 수 있는 미필 선수가 없습니다 (다음 시즌 {MILITARY_MIN_AGE}세 이상 미필 국내 선수).</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr><th>입대</th><th className="l">선수</th><th>자리</th><th>다음 시즌 나이</th><th>현재</th><th>잠재</th><th className="l">구분</th><th className="l">병역 근거</th></tr>
            </thead>
            <tbody>
              {cands.map((c) => {
                const p = lp.get(c.id)!;
                const sp = sim.get(c.id);
                const on = picked.has(c.id);
                const full = !on && optional >= room;
                const tags = [c.forced ? `강제 (${MILITARY_LAST_AGE}세)` : '', recommended.includes(c.id) && !c.forced ? '추천' : '', p.contract.until > year + 1 ? '다년 계약' : '']
                  .filter(Boolean).join(' · ');
                return (
                  <tr key={c.id} className={on ? 'me' : ''}>
                    <td>
                      <input type="checkbox" checked={on} disabled={c.forced || full} onChange={() => toggle(c.id)}
                        aria-label={`${p.name} 입대`} title={c.forced ? '반드시 입대합니다' : full ? `한 해 ${MILITARY_TEAM_CAP}명까지입니다` : undefined} />
                    </td>
                    <td className="l">{sp ? <PlayerLink p={sp} /> : p.name}</td>
                    <td>{p.isPitcher ? (p.pit!.startShare >= 0.5 ? '선발' : '구원') : posName(p.pos)}</td>
                    <td>{c.age}</td>
                    <td><Grade v={runsGrade(c.runs)} /></td>
                    <td><Grade v={runsGrade(p.scoutPotential ?? p.potential)} /></td>
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
          복무 중 {count((p) => p.military?.state === 'serving')}명 · 미필 {count((p) => p.military?.state === 'pending')}명
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
