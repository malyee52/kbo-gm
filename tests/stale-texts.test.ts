// 틀린 안내문이 다시 들어오지 않게 (2026-11-25 틀린 안내문 카드, 반증 #10·#17).
// 화면 문구는 코드와 같은 규칙을 말해야 한다: 지운 규칙·보이지 않는 값·실제와 다른 효과 이름을 막는다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FOCUS } from '../src/league/camp';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('틀린 안내문', () => {
  it('재정: 없앤 모기업 환원(100억 넘는 몫 절반)을 지금 규칙처럼 쓰지 않고, 지원금 회수는 상수로 적는다', () => {
    const s = src('ui/screens/Finance.tsx');
    expect(s).not.toContain('넘는 몫의 절반을 모기업에 돌려줍니다');
    expect(s).toContain('PARENT_RESERVE');
    expect(s).toContain('PARENT_CLAWBACK');
  });

  it('트레이드·구단: 종합·잠재가 보인다고 쓰지 않는다 (능력치 v2 17.6)', () => {
    for (const p of ['ui/screens/Trade.tsx', 'ui/screens/TeamView.tsx']) {
      const s = src(p);
      expect(s, p).not.toContain('종합·잠재는 보이는 능력');
      expect(s, p).not.toContain('최고 종합');
      expect(s, p).not.toContain('보이는 종합');
    }
  });

  it('감독 후보 연봉은 연봉 지수를 곱한 managerSalaryAt으로 보인다', () => {
    const s = src('ui/screens/Manager.tsx');
    expect(s).toContain('managerSalaryAt(');
    expect(s).not.toMatch(/managerSalary\(i\)/);
  });

  it('코치 빈자리는 시즌 중에도 고를 수 있다', () => {
    expect(src('ui/screens/Coaches.tsx')).not.toContain('오프시즌에 고용');
  });

  it('wRC+는 구장 보정이 있다고 쓴다', () => {
    expect(src('ui/screens/Roster.tsx')).not.toContain('구장 보정이 없습니다');
  });

  it('캠프 def 방향 이름은 실제 효과(타자 성장·부상)대로이고 키는 그대로', () => {
    expect(FOCUS.def.label).not.toMatch(/수비|주루/);
    expect(FOCUS.def.scope).toBe('bat');
    expect(FOCUS.def.injury).toBeLessThan(1);
  });
});
