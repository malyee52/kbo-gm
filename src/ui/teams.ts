// 구단 표시용 색. 로고·엠블럼은 쓰지 않고 색으로만 구단을 나타낸다 (기획서 7장).
// 2026-10-12 UI 개편: 밝은 모드는 '구단색 몰입'(D), 다크 모드는 '나이트 게임'(A). 사용자가 구단마다 확정한 색이다.
// 각 구단 대표색의 근사값이며 공식 색상 값은 아니다.
//   primary  주색 (밝은 모드 머리 부분 바탕, 띠)
//   on       주색 위 글자색 (한화처럼 밝은 주색은 검정)
//   second   보조색 (버튼, 다크 모드 둘째 띠)
//   tint     밝은 모드의 연한 구단색 (우리 팀 줄 강조), tintText 그 위 글자색
//   dark     다크 모드 강조색 (어두운 바탕 위 글자·숫자·버튼), darkTint 다크 모드 우리 팀 줄 바탕
//   button   밝은 모드 굵은 버튼 바탕(없으면 primary), buttonOn 그 위 글자색

export interface TeamPalette {
  primary: string;
  on: string;
  second: string;
  tint: string;
  tintText: string;
  dark: string;
  darkTint: string;
  button?: string;
  buttonOn?: string;
}

const P = (primary: string, on: string, second: string, tint: string, tintText: string, dark: string, darkTint: string, button?: string, buttonOn?: string): TeamPalette =>
  ({ primary, on, second, tint, tintText, dark, darkTint, ...(button ? { button } : {}), ...(buttonOn ? { buttonOn } : {}) });

/** 지금 구단 (계보 기준) */
const BY_FRANCHISE: Record<string, TeamPalette> = {
  KIA: P('#C8102E', '#FFFFFF', '#06141F', '#FCE4E8', '#8E0A20', '#FF5A6B', '#4A1622', '#06141F', '#FFFFFF'),
  삼성: P('#074CA1', '#FFFFFF', '#A7B0BA', '#E2ECF9', '#053A7B', '#5BA0FF', '#16345C'),
  LG: P('#A50034', '#FFFFFF', '#1A1A1A', '#FBE3EC', '#7A0228', '#FF4F8B', '#4A1430', '#1A1A1A', '#FFFFFF'),
  두산: P('#131230', '#FFFFFF', '#ED1C24', '#E6E6F2', '#131230', '#E4E7FF', '#1E2250', '#ED1C24', '#FFFFFF'),
  KT: P('#1A1A1A', '#FFFFFF', '#E1251B', '#ECECEC', '#1A1A1A', '#F4F4F4', '#2E2E2E', '#E1251B', '#FFFFFF'),
  SSG: P('#CE0E2D', '#FFFFFF', '#FFC72C', '#FCE4E8', '#8E0A20', '#FF4458', '#55111F', '#1A1A1A', '#FFC72C'),
  NC: P('#1D467F', '#FFFFFF', '#C7A079', '#E3EAF5', '#143660', '#D9B88A', '#3A3222', '#C7A079', '#1A1A1A'),
  롯데: P('#041E42', '#FFFFFF', '#D00F31', '#E4E9F2', '#041E42', '#FF8A2A', '#14305C', '#D00F31', '#FFFFFF'),
  한화: P('#F37321', '#1A1A1A', '#1A1A1A', '#FFEBDC', '#8A3A07', '#FFAA33', '#4A2C0C', '#1A1A1A', '#FFFFFF'),
  히어로즈: P('#820024', '#FFFFFF', '#C79A6B', '#F7E1E6', '#820024', '#820024', '#820024'),
  // 사라진 구단 (계보)
  현대계: P('#0F4C81', '#FFFFFF', '#F2B705', '#E1EBF5', '#0B3A63', '#6AA8E6', '#163650'),
  쌍방울: P('#1F7A45', '#FFFFFF', '#E3B505', '#E2F2E8', '#155A33', '#5CC98A', '#173A28'),
};

/** 그 시절 이름이 계보와 다른 색을 쓰던 구단 (구단 이름 기준, 근사값) */
const BY_NAME: Record<string, TeamPalette> = {
  MBC: P('#1450A0', '#FFFFFF', '#F2F2F2', '#E2EBF8', '#0F3C78', '#6AA6F0', '#163555'),
  OB: P('#1B2A6B', '#FFFFFF', '#D71920', '#E5E8F3', '#1B2A6B', '#B9C4FF', '#1E2A55', '#D71920', '#FFFFFF'),
  해태: P('#D2122E', '#FFFFFF', '#111111', '#FCE4E8', '#8E0A20', '#FF5A6B', '#4A1622', '#111111', '#FFFFFF'),
  삼미: P('#1D3F8C', '#FFFFFF', '#F2C200', '#E3E9F6', '#152F68', '#7EA6F2', '#1A2C55', '#F2C200', '#1A1A1A'),
  청보: P('#0E6E8C', '#FFFFFF', '#F28C28', '#E0F0F5', '#0A5268', '#5CC4E6', '#123A48'),
  태평양: P('#0072BC', '#FFFFFF', '#7FC4E8', '#E0EEF8', '#005690', '#5CB4F0', '#13385A'),
  현대: P('#0F4C81', '#FFFFFF', '#F2B705', '#E1EBF5', '#0B3A63', '#6AA8E6', '#163650'),
  빙그레: P('#F26A1B', '#1A1A1A', '#1A1A1A', '#FFEBDC', '#8A3A07', '#FFAA33', '#4A2C0C', '#1A1A1A', '#FFFFFF'),
  SK: P('#E9002D', '#FFFFFF', '#FF7A00', '#FDE3E8', '#9A001E', '#FF5A6E', '#4A1220', '#1A1A1A', '#FFFFFF'),
  우리: P('#7A1530', '#FFFFFF', '#C79A6B', '#F5E1E6', '#7A1530', '#7A1530', '#7A1530'),
  히어로즈: P('#7A1530', '#FFFFFF', '#C79A6B', '#F5E1E6', '#7A1530', '#7A1530', '#7A1530'),
  넥센: P('#820024', '#FFFFFF', '#C79A6B', '#F7E1E6', '#820024', '#820024', '#820024'),
};

const FALLBACK = P('#4A5560', '#FFFFFF', '#9AA5AE', '#E8ECEF', '#2E363D', '#AAB6C0', '#26303A');

/** 구단 색 세트: 그 시절 이름이 따로 있으면 그것, 아니면 계보 */
export function teamPalette(franchise: string, name?: string): TeamPalette {
  return (name && BY_NAME[name]) || BY_FRANCHISE[franchise] || FALLBACK;
}

/** 구단 대표색 하나 (이름 옆 색 표시 등) */
export function teamColor(franchise: string, name?: string): string {
  return teamPalette(franchise, name).primary;
}

/** 화면 틀에 내려 줄 CSS 변수 */
export function teamVars(franchise: string, name?: string): Record<string, string> {
  const t = teamPalette(franchise, name);
  return {
    '--team': t.primary,
    '--team-on': t.on,
    '--team-2': t.second,
    '--team-tint': t.tint,
    '--team-tint-text': t.tintText,
    '--team-dark': t.dark,
    '--team-dark-tint': t.darkTint,
    '--team-button': t.button ?? t.primary,
    '--team-button-on': t.buttonOn ?? t.on,
  };
}
