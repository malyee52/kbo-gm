// 실제 구장 역사 (2026-10-14 사용자 선택): 구단 계보마다 홈 구장이 바뀐 해·이름·수용 인원·돔.
// 쓰는 곳 (stadium.ts):
//  - 새 게임: 시작 연도의 구장 이름·돔만 붙인다. 수용 인원·시설은 그대로 (관중 모델이 지금 값으로 맞춰져 있어서)
//  - 진행 중: 시작 연도 뒤에 실제로 새 구장이 열린 해가 오면 그 구단은 새 구장으로 옮긴다 (지자체가 지은 것으로 보고 비용 없음,
//    시설 100·새 구장 효과). 게임 안에서 신구장을 주문했거나 지은 구단은 실제 구장으로 옮기지 않는다.
// 확인: checked가 true인 것은 2026-10-14 검색으로 확인한 값 (잠실 1982년 7월 개장·지금 23,750석, 고척 16,744석·2015년 개장,
//  대전 새 구장 2025년 개장, 잠실 돔 2032년 3월 개장 예정·30,000석). 나머지 연도·수용 인원은 기억에 기댄 추정이라 확인이 필요하다.
//  구단이 이 구장을 홈으로 쓰기 시작한 해(from)를 적는다 (구장 개장 연도와 다를 수 있다).

export interface RealPark {
  franchise: string;
  /** 이 구단이 홈으로 쓰기 시작한 시즌 */
  from: number;
  name: string;
  capacity: number;
  dome?: boolean;
  checked: boolean;
  /** 아직 열지 않은 계획 (실제 일정이 바뀔 수 있다) */
  planned?: boolean;
}

export const REAL_PARKS: RealPark[] = [
  { franchise: 'LG', from: 1982, name: '잠실야구장', capacity: 23_750, checked: true },
  { franchise: 'LG', from: 2032, name: '잠실 돔구장', capacity: 30_000, dome: true, checked: true, planned: true },
  { franchise: '두산', from: 1982, name: '대전 한밭야구장', capacity: 10_500, checked: false },
  { franchise: '두산', from: 1985, name: '잠실야구장', capacity: 23_750, checked: false },
  { franchise: '두산', from: 2032, name: '잠실 돔구장', capacity: 30_000, dome: true, checked: true, planned: true },
  { franchise: '삼성', from: 1982, name: '대구시민운동장 야구장', capacity: 10_000, checked: false },
  { franchise: '삼성', from: 2016, name: '대구 삼성 라이온즈 파크', capacity: 24_000, checked: false },
  { franchise: 'KIA', from: 1982, name: '광주 무등경기장 야구장', capacity: 12_500, checked: false },
  { franchise: 'KIA', from: 2014, name: '광주-기아 챔피언스 필드', capacity: 20_500, checked: false },
  { franchise: '롯데', from: 1982, name: '부산 구덕야구장', capacity: 20_000, checked: false },
  { franchise: '롯데', from: 1986, name: '부산 사직야구장', capacity: 22_758, checked: false },
  { franchise: '한화', from: 1986, name: '대전 한밭야구장', capacity: 13_000, checked: false },
  { franchise: '한화', from: 2025, name: '대전 한화생명 볼파크', capacity: 17_000, checked: false },
  { franchise: '현대계', from: 1982, name: '인천 숭의야구장', capacity: 12_000, checked: false },
  { franchise: '현대계', from: 2000, name: '수원야구장', capacity: 14_000, checked: false },
  { franchise: 'SSG', from: 2000, name: '인천 숭의야구장', capacity: 12_000, checked: false },
  { franchise: 'SSG', from: 2002, name: '인천 문학야구장', capacity: 23_000, checked: false },
  { franchise: '쌍방울', from: 1990, name: '전주야구장', capacity: 12_000, checked: false },
  { franchise: '히어로즈', from: 2008, name: '목동야구장', capacity: 12_500, checked: false },
  { franchise: '히어로즈', from: 2016, name: '고척 스카이돔', capacity: 16_744, dome: true, checked: true },
  { franchise: 'NC', from: 2012, name: '마산야구장', capacity: 11_000, checked: false },
  { franchise: 'NC', from: 2019, name: '창원 NC 파크', capacity: 17_983, checked: false },
  { franchise: 'KT', from: 2014, name: '수원 kt 위즈 파크', capacity: 18_700, checked: false },
];

/** 그 해 그 구단 계보의 실제 홈 구장 (없으면 undefined) */
export function realParkAt(franchise: string, year: number): RealPark | undefined {
  let out: RealPark | undefined;
  for (const p of REAL_PARKS) if (p.franchise === franchise && p.from <= year && (!out || p.from > out.from)) out = p;
  return out;
}

/** 그 해에 새로 옮기는 실제 구장 (from === year) */
export function realParkOpening(franchise: string, year: number): RealPark | undefined {
  return REAL_PARKS.find((p) => p.franchise === franchise && p.from === year);
}
