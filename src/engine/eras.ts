// 시대별 투수 기용 (M8). 2000년 이전 KBO는 선발 4인 로테이션에 에이스가 길게 던지고 구원도 겸했다.
// 5인 로테이션을 모든 시대에 쓰면 1985년 득점이 실제보다 11% 높고 상위 5명 투수의 이닝 비중이 0.56(실제 0.77)에 그친다.
// 값은 tools/validate_engine.ts로 1985·1990·1995년 득점과 이닝 집중도를 맞춘 임시값이다 (docs/engine.md 4장).

export interface EraPitching {
  /** 선발 로테이션 인원 */
  rotation: number;
  /** 선발 등판 사이 최소 휴식일 */
  restDays: number;
  /** 선발 한계 투구(상대 타자 수) 배율 */
  limitScale: number;
}

/**
 * 리그 수준 (2026-10-12 사용자 결정 "단계표"): 그 해 KBO의 수준을 2009년 이후 = 1로 둔 배율. 시즌 가치(대체 선수 대비 기여)에 곱해
 * 다른 시대끼리 비교한다. 원년(실업·아마추어 출신) → 해외파·대졸 유입 → 7·8구단 → 외국인 도입(1998) 순으로 올라간다고 본다.
 * 기록만으로는 리그 수준을 가려낼 수 없어(tools/league_quality.ts: 퍼짐·델타 방식 모두 뚜렷한 경향이 없었다) 역사로 정한 값이다.
 * 쓰는 곳: 잠재력의 실제 고점을 시작 연도 리그 기준으로 바꿀 때(league/growth.ts), 화면의 등급(ui/grades.ts), 기준표(tools/war.ts)
 */
export function leagueQuality(year: number): number {
  if (year <= 1982) return 0.8;
  if (year <= 1985) return 0.85;
  if (year <= 1990) return 0.9;
  if (year <= 1997) return 0.93;
  if (year <= 2008) return 0.96;
  return 1;
}

export function eraPitching(year: number): EraPitching {
  // 2026-10-12: 선발·구원을 겸한 에이스가 로테이션에 들어가며(engine/params.ts STARTER_SHARE) 이닝 상위 5명 비중이 실제보다 높아져 1.3 → 1.2, 1.1 → 1.0
  if (year <= 1989) return { rotation: 4, restDays: 4, limitScale: 1.2 };
  if (year <= 1994) return { rotation: 4, restDays: 4, limitScale: 1.0 };
  if (year <= 1999) return { rotation: 5, restDays: 5, limitScale: 1.05 };
  return { rotation: 5, restDays: 5, limitScale: 1 };
}
