// 구단 표시용 색. 로고·엠블럼은 쓰지 않고 이름 옆의 색 표시로만 구단을 구분한다 (기획서 7장).
// 구단 계보(franchise) 기준. 각 구단 대표색의 근사값이며 공식 색상 값은 아니다.

const COLORS: Record<string, string> = {
  KIA: '#c8102e',
  삼성: '#0b5cad',
  LG: '#b5094d',
  두산: '#1a1748',
  KT: '#3b3b3b',
  SSG: '#d21a35',
  NC: '#315288',
  롯데: '#0b2a5b',
  한화: '#f26a1b',
  히어로즈: '#7a1530',
  현대계: '#2f6f9f',
  쌍방울: '#2f7d4a',
};

export function teamColor(franchise: string): string {
  return COLORS[franchise] ?? '#7a847e';
}
