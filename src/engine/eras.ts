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

export function eraPitching(year: number): EraPitching {
  if (year <= 1989) return { rotation: 4, restDays: 4, limitScale: 1.3 };
  if (year <= 1994) return { rotation: 4, restDays: 4, limitScale: 1.1 };
  if (year <= 1999) return { rotation: 5, restDays: 5, limitScale: 1.05 };
  return { rotation: 5, restDays: 5, limitScale: 1 };
}
