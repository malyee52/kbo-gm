// 실제 구장 역사 (2026-10-14 사용자 선택): 구단 계보마다 홈 구장이 바뀐 해·이름·수용 인원·돔.
// 쓰는 곳 (stadium.ts):
//  - 새 게임: 시작 연도의 구장 이름·돔만 붙인다. 수용 인원·시설은 그대로 (관중 모델이 지금 값으로 맞춰져 있어서)
//  - 진행 중: 시작 연도 뒤에 실제로 새 구장이 열린 해가 오면 그 구단은 새 구장으로 옮긴다 (지자체가 지은 것으로 보고 비용 없음,
//    시설 100·새 구장 효과). 게임 안에서 신구장을 주문했거나 지은 구단은 실제 구장으로 옮기지 않는다.
//
// 자료는 두 갈래다 (구장효과 기획안 P1, 2026-10-23):
//  - 이름·좌석·확인 표시: parks.json (data-src/구장.csv · 구장_사용.csv, 나무위키 덤프 가공값). useParkData로 넣는다.
//  - 옮기는 해·관중 모델 좌석·돔: 아래 코드 안 표 CODE_PARKS. 경기·관중 결과를 바꾸지 않으려고 P1에서는 그대로 두고,
//    결과가 바뀌는 구장 효과 P5 배포 때 자료로 옮긴다. 자료와 옮기는 해가 다른 곳: LG(자료 1982 동대문 → 1983 잠실, 표는 1982 잠실),
//    NC(자료 2013, 표 2012), KT(자료 2015, 표 2014). 자료에서 구장이 바뀌었는데 표에 옮김이 없는 해는 이름만 바꾼다 (realParkRename).
//  parks.json이 없으면 이름도 코드 안 표를 쓴다.
// 코드 안 표의 확인: checked가 true인 것은 2026-10-14 검색으로 확인한 값 (잠실 1982년 7월 개장·지금 23,750석, 고척 16,744석·2015년 개장,
//  대전 새 구장 2025년 개장, 잠실 돔 2032년 3월 개장 예정·30,000석). 나머지 연도·수용 인원은 기억에 기댄 추정이라 확인이 필요하다.
//  구단이 이 구장을 홈으로 쓰기 시작한 해(from)를 적는다 (구장 개장 연도와 다를 수 있다).

import type { ParkData, ParkSpec } from '../data/types';

export interface RealPark {
  franchise: string;
  /** 이 구단이 홈으로 쓰기 시작한 시즌 (옮기는 해, 코드 안 표) */
  from: number;
  name: string;
  /** 관중 모델이 쓰는 수용 인원 (코드 안 표) */
  capacity: number;
  dome?: boolean;
  checked: boolean;
  /** 아직 열지 않은 계획 (실제 일정이 바뀔 수 있다) */
  planned?: boolean;
  /** parks.json의 구장 ID와 그 해 좌석 (표시용, 자료가 없으면 비어 있다) */
  parkId?: string;
  seats?: number;
}

export const CODE_PARKS: RealPark[] = [
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

/** 자료에서 읽은 그 해 그 계보의 구장 (이름·좌석·확인) */
interface ParkShown {
  parkId: string;
  name: string;
  seats?: number;
  checked: boolean;
}

let parkData: ParkData | undefined;

/**
 * 실제 구장 자료(parks.json)를 쓴다. 리그를 만들거나 월드를 꾸밀 때 store.parks로 부른다 (create.ts·world.ts).
 * 배포 판마다 자료가 하나라 모듈에 한 벌만 둔다. undefined면 코드 안 표의 이름으로 돌아간다.
 */
export function useParkData(data: ParkData | undefined): void {
  parkData = data;
}

/** 그 해 그 구장의 공용 제원 행 (계보 행 = 가벽은 빼고). 그 해 행이 없으면 가장 가까운 행 */
function specAt(data: ParkData, park: string, year: number): ParkSpec | undefined {
  const rows = data.specs.filter((s) => s.id === park && !s.franchise);
  return rows.find((s) => s.from <= year && year <= (s.to ?? Infinity))
    ?? rows.filter((s) => s.from <= year).at(-1) ?? rows[0];
}

/** 자료의 그 해 구장: 그 해를 덮는 사용 행 가운데 가장 늦게 시작한 것 (계획 행이 시작되면 계획 구장) */
function shownAt(franchise: string, year: number): ParkShown | undefined {
  if (!parkData) return undefined;
  let use: ParkData['use'][number] | undefined;
  for (const u of parkData.use) {
    if (u.franchise === franchise && u.from <= year && year <= (u.to ?? Infinity) && (!use || u.from > use.from)) use = u;
  }
  if (!use) return undefined;
  const spec = specAt(parkData, use.park, year);
  return { parkId: use.park, name: spec?.name ?? use.park, ...(spec?.seats != null ? { seats: spec.seats } : {}), checked: use.confirmed === '출처 확인' };
}

/** 그 해 그 구단 계보 주 구장의 제원 행 (구장 화면 정보 칸). 그 구단 홈 경기에만 쓰는 행(잠실 X-존)이 있으면 그 행. 자료가 없으면 undefined */
export function realParkSpec(franchise: string, year: number): ParkSpec | undefined {
  const shown = shownAt(franchise, year);
  if (!parkData || !shown) return undefined;
  const covers = (s: ParkSpec) => s.id === shown.parkId && s.from <= year && year <= (s.to ?? Infinity);
  return parkData.specs.find((s) => covers(s) && s.franchise === franchise) ?? specAt(parkData, shown.parkId, year);
}

/** 코드 안 표의 행에 자료의 이름·좌석·확인을 덧씌운다 (그 해 자료가 없으면 표 그대로) */
function withShown(p: RealPark, year: number): RealPark {
  const shown = shownAt(p.franchise, year);
  return shown ? { ...p, ...shown } : p;
}

/** 지금 쓰는 실제 구장 표 (옮기는 해 기준, 이름은 그 해 자료) */
export function realParks(): RealPark[] {
  return CODE_PARKS.map((p) => withShown(p, p.from));
}

/** 그 해 그 구단 계보의 실제 홈 구장 (없으면 undefined) */
export function realParkAt(franchise: string, year: number): RealPark | undefined {
  let out: RealPark | undefined;
  for (const p of CODE_PARKS) if (p.franchise === franchise && p.from <= year && (!out || p.from > out.from)) out = p;
  return out && withShown(out, year);
}

/** 그 해에 새로 옮기는 실제 구장 (from === year) */
export function realParkOpening(franchise: string, year: number): RealPark | undefined {
  const p = CODE_PARKS.find((q) => q.franchise === franchise && q.from === year);
  return p && withShown(p, year);
}

/**
 * 그 해에 자료의 구장(이름)이 앞 해와 달라졌는데 옮기는 해(realParkOpening)는 아닌 경우: 이름·확인 표시만 바꾼다 (시설·좌석은 그대로).
 * 예: LG 1983 동대문 → 잠실 (코드 안 표는 1982년부터 잠실), 같은 구장의 이름이 바뀐 해.
 */
export function realParkRename(franchise: string, year: number): ParkShown | undefined {
  if (realParkOpening(franchise, year)) return undefined;
  const now = shownAt(franchise, year);
  const before = shownAt(franchise, year - 1);
  return now && (now.parkId !== before?.parkId || now.name !== before?.name) ? now : undefined;
}
