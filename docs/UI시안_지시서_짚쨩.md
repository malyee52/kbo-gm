# [짚쨩] UI 독립안 1 — 단장의 하루

작성일: 2026-10-22. 비교용 독립 기획안이랍니다. 구현 코드는 변경하지 않으며, 그림은 분위기·배치 참고용이고 실제 화면은 개발 직원이 코드로 만든답니다.

## 1. 설계 목표

처음 접한 그대에게는 ‘지금 할 일과 진행 버튼’, 야구 팬에게는 ‘다음 경기와 팀 흐름’, 세부 기록을 즐기는 그대에게는 ‘선수·비교 표로 이어지는 짧은 길’을 제공하는 안이와요. 한 개의 완성된 메뉴 안을 제안하며, 밝은 기본 홈을 데스크톱·휴대폰으로 비교할 수 있사와요.

## 2. 대분류와 세부 화면

| 대분류 | 세부 화면 | 선택 이유 |
|---|---|---|
| 단장실 | 홈 / 할 일 / 소식 / 이야기 | 결정할 업무와 읽을 소식을 구분하는 시작점이와요. |
| 경기 | 일정·결과 / 경기 준비 / 직접 지휘 | 경기 전·중·후를 하나의 동선으로 잇는답니다. |
| 선수 | 선수단 / 기용표 / 성장 / 입대 | 우리 선수의 현재 운용과 장기 육성을 함께 다루는 곳이와요. |
| 영입 | 선수 찾기 / 트레이드 / 선수 시장 / 계약 | 외부 선수 탐색과 협상을 독립시키는 안이랍니다. |
| 구단 | 개요 / 재정 / 구장·팬 / 감독·코치 / 구단주 / 이력·업적 | 선수 밖의 운영 자원과 이해관계자를 모은답니다. |
| 리그 | 순위 / 개인 기록 / 올스타 / 가을야구 / 시즌 결산 / 기록관 | 현재 경쟁과 과거 기록을 잇는 곳이와요. |

저장·설정·정보·출처·시작 화면은 공통 유틸리티로 분리하겠사와요. 대분류는 항상 같은 위치에 두고, 이용 불가한 세부 화면에는 ‘시즌 종료 후’ 같은 이유를 표시하는 안이랍니다. 현재처럼 메뉴가 통째로 사라져 위치를 다시 찾는 일을 줄이겠사와요.

데스크톱은 왼쪽 폭 192px 탐색 영역과 선택한 분류의 하위 메뉴를 사용하겠사와요. 홈은 한 번에 돌아오는 고정 항목이며, 다른 분류는 마지막 방문 하위 화면을 기억하는 안이와요. 휴대폰은 하단에 단장실·경기·선수·영입·더보기 다섯 항목을 두고, 더보기 안에 구단·리그와 유틸리티를 표시하겠사와요. 화면 상단 경로와 뒤로 가기로 현재 위치를 유지하겠사와요.

### 현재 화면 전체 대응표

| 현재 Screen ID / 내부 패널 | 새 위치 |
|---|---|
| home | 단장실 > 홈 |
| articles | 단장실 > 소식 > 기사 |
| fantasy | 단장실 > 이야기; 진행 대기 선택은 할 일에도 연결 |
| schedule | 경기 > 일정·결과; 경기 클릭 시 박스스코어 |
| roster | 선수 > 선수단; 기존 기용 조작은 선수 > 기용표에서도 연결 |
| trade | 영입 > 트레이드 |
| market | 영입 > 선수 시장 |
| search | 영입 > 선수 찾기 |
| growth | 선수 > 성장 |
| standings | 리그 > 순위 |
| leaders | 리그 > 개인 기록 |
| allstar | 리그 > 올스타 |
| postseason | 리그 > 가을야구; 홈 경기 카드에서도 연결 |
| season-end | 리그 > 시즌 결산 |
| awards | 리그 > 시즌 결산 > 시상식 |
| offseason | 단장실 > 홈의 비시즌 단계 요약; 실제 단계 작업은 영입 > 계약으로 연결 |
| club | 구단 > 개요 |
| finance | 구단 > 재정 |
| stadium | 구단 > 구장·팬 |
| staff | 구단 > 감독·코치 |
| club-history | 구단 > 이력·업적 |
| records | 리그 > 기록관 > 연표 |
| rec-career | 리그 > 기록관 > 통산 순위 |
| rec-season | 리그 > 기록관 > 단일 시즌 |
| rec-teams | 리그 > 기록관 > 구단 역사 |
| rec-dynasty | 리그 > 기록관 > 왕조·라이벌 |
| rec-hof | 리그 > 기록관 > 명예의 전당 |
| save | 공통 > 저장·설정 |
| about | 공통 > 정보·출처 |
| PlayerDetail | 선수 이름에서 공통 상세 패널; 돌아갈 때 필터·스크롤 유지 |
| EnlistPanel (SeasonEnd 내부) | 선수 > 입대; 시즌 결산에서도 같은 패널로 연결 |
| ManagerPanel / CoachPanel (Club 내부) | 구단 > 감독·코치의 하위 탭 |
| OwnerMeeting (Home / Fantasy 내부) | 구단 > 구단주; 결정 필요 시 단장실 > 할 일에 연결 |
| PressConference (Home / Fantasy 내부) | 단장실 > 소식 > 기자회견; 답변 대기는 할 일에 연결 |
| FantasyChat / FantasyMemory / 자유 모드 / 연대기 | 단장실 > 이야기의 대화·기억·자유·연대기 탭 |
| FantasyChoices / FantasyNegotiate / GmPreview | 원래 업무의 내부 선택·협상·판정 패널 유지; 대분류로 승격하지 않는답니다. |
| CommandView / GameCast / EventDialog / AdvanceSummary | 경기 > 직접 지휘 또는 일정·결과에서 열리는 공통 진행 패널; 이벤트는 할 일에서도 연결 |

‘할 일’, ‘경기 준비’, 독립적인 ‘기용표’, ‘계약’은 새 작업 공간이랍니다. 현재 화면 목록은 기능 누락 확인에만 사용하며, 기존 메뉴 이름·화면 경계·조작 방식은 설계 제약으로 삼지 않겠사와요. 아래의 조작은 새 UI 제안이며 아직 구현된 화면인 것처럼 취급하지 않겠사와요. 계약은 게임의 비시즌 단계 순서와 자격 규칙을 보존하겠사와요.

### 2026-10-22 추가 지시 반영: 조작 흐름부터 재설계

**선수 기용 — 명단이 아니라 배치판에서 시작하겠사와요.** 왼쪽에는 C·1B·2B·3B·SS·LF·CF·RF·DH 슬롯, 오른쪽에는 현재 후보 목록을 두겠사와요. 슬롯 선택 → 후보의 공개 기록·출전 가능 여부 비교 → 배치 순서로 조작하며, 데스크톱 드래그는 선택 수단일 뿐 동일 작업을 클릭·키보드·터치로도 제공하겠사와요. 타순은 별도 세로 목록에서 이동 버튼으로 순서를 바꾸고 SP·RP·CP는 투수 탭에서 관리하겠사와요. 라인업 카드에 사진·유니폼은 쓰지 않는답니다.

**엔트리 — 등록과 기용을 한 변경안으로 검토하겠사와요.** 후보 선택 시 ‘등록 필요’와 자격 조건을 먼저 표시하고, 현재/변경 후 인원·외국인 제한·제외되는 선수·실행 가능한 변경을 같은 검토함에서 보여주겠사와요. 즉시 반영하지 않고 ‘변경 검토 → 적용’으로 마무리하며, 불가한 변경에는 구체적인 이유와 해당 슬롯 이동을 제공하겠사와요. 기존 엔진이 허용하는 변경만 제출하고, 일괄 원자적 적용이 불가능한 조작은 순서와 중간 상태를 표시하는 구현 요건이랍니다. 등록 규칙·경기 출전 자격 자체는 바꾸지 않겠사와요.

**영입 — 후보 보드 → 비교 → 제안 구성 → 협상 → 최종 검토 흐름이와요.** 선수 찾기에서 조건을 바꿔 후보를 담고, 최대 세 명의 공개 성적·연봉·계약·포지션을 나란히 비교하겠사와요. 트레이드는 내보낼 선수와 받을 선수를 양쪽에 쌓고 연봉·인원 변화를 요약하겠사와요. 협상 결과는 같은 작업 공간의 이력에 남기고 수락·수정·철회로 이어지게 하겠사와요. 시장·FA·외국인·드래프트 등 실제 단계는 자격에 맞는 후보와 해당 입력으로 전환하며, 재계약·보호명단 등 기존 비시즌 단계도 계약의 단계 목록에서 빠짐없이 접근시키겠사와요. 숨은 가치·수락 확률·진짜 잠재력은 공개하지 않겠사와요.

**숨은 정보 보호와 사건 표시**: 선수 상세·후보 비교·툴팁·정렬·그래프·접근성 이름·미리보기 어디에도 숨은 능력·잠재력·특수능력의 실제 숫자를 노출하지 않겠사와요. 공개 기록과 게임 규칙상 공개 허용된 평가만 구분해 사용하되, 숨은 숫자를 등급·색으로 역산할 수 있는 표시는 넣지 않겠사와요. 실존 선수에게 지어낸 구체적 사건·사생활·발언을 붙이지 않으며 실제 있었던 사건도 재현하지 않겠사와요. 사유를 특정하지 않는 중립 이벤트와 허용된 결장 기간만 표시하고, 실존 여부가 없으면 실존 선수로 취급하겠사와요. 시안의 선수는 모두 가상 예시랍니다.

계약의 단계 목록은 FA → FA 보상선수 → 2차 드래프트·특별 지명 → 외국인 선수 → 신인 드래프트 → 연봉 협상 → 정원 정리 → 개막 준비를 담겠사와요. 해당 시대에 없는 단계는 규칙에 맞게 건너뛰고, 재계약·보호명단·지원금 등 기존 선택을 해당 단계의 작업으로 연결하겠사와요. 외국인 선수의 트레이드 금지 등 확정 규칙도 후보·제안 검증에서 유지하겠사와요.

**게임 규칙 제안 — 본안 적용 범위와 분리**: ‘감독에게 운용 방침을 맡기고 플레이어는 엔트리·영입만 결정하는 단장 전용 모드’는 별도 검토 제안이랍니다. 경기 작전 권한과 자동화 범위를 바꾸므로 본안의 전제로 삼지 않겠사와요. 본안의 직접 지휘 연결은 현재 허용된 권한만 사용하며 새 작전이나 효과를 추가하지 않는답니다. 타순 편집도 게임 모드의 기존 권한 안에서만 활성화하고, 권한 확대가 필요하면 별도의 게임 규칙 제안으로 분리하겠사와요.

## 3. 홈 우선순위와 실제 동선

1. **고정 머리말**: 구단명·색 띠, 게임 날짜, 순위·승패, 저장 상태, 유일한 강조 버튼 ‘다음 경기’를 두겠사와요. ‘더 진행’에 하루·일주일·한 달·시즌 끝까지와 멈춤 설정을 넣겠사와요. 현재의 시즌 끝까지 자동 선택 동작은 실행 직전 범위·자동 응답 여부를 명시하는 확인창에서 설명하겠사와요.
2. **할 일**: 기한과 필수 여부를 기준으로 정렬하고 최대 두 건만 미리 보여주겠사와요. 각 행은 이유·영향·기한·확인 버튼을 가지며 필수/참고를 글자로 함께 표시한답니다. 구단주 응답, 판타지 선택, 비시즌 단계 등 실제 대기 상태에서만 생성하겠사와요. 없는 업무를 임의로 만들지 않겠사와요.
3. **다음 경기**: 상대·홈/원정·날짜·시간·예상 SP를 보여주며 ‘기용표’와 ‘직접 지휘’로 연결하겠사와요. 경기 전 대화는 접힌 보조 영역으로 옮기겠사와요. 진행 버튼을 이 카드에 중복하지 않는답니다.
4. **경쟁 맥락**: 데스크톱 오른쪽에 우리 팀 주변 다섯 팀의 순위·승패·게임 차를 표시하겠사와요. 우리 팀은 색 띠와 ‘우리 팀’ 표식을 함께 쓰는 안이와요.
5. **최근 경기와 구단 현황**: 최근 다섯 경기의 승·패·무와 점수, 최근 10경기 성적, 자금·구단주 목표를 배치하겠사와요. 결과를 누르면 해당 박스스코어로 이동한답니다.
6. **상세 펼치기**: 기본 홈 아래에 OPS·ERA 등 집계 가능한 지표를 선택적으로 펼치겠사와요. 지표 약어의 뜻·계산 범위는 툴팁으로 설명하고, 선수·리그의 필터 표로 연결하겠사와요. 미지원 고급 지표를 있는 것처럼 노출하지 않겠사와요.

| 이용자 | 첫 화면에서 얻는 것 | 다음 동선 |
|---|---|---|
| 초보 | 먼저 처리할 일, 다음 상대, 진행 버튼을 찾는답니다. | 할 일 > 이유 확인 > 해당 업무 > 홈 |
| 보통 야구 팬 | 예상 SP, 최근 점수, 순위 경쟁을 읽는답니다. | 다음 경기 > 기용표 또는 최근 경기 > 박스스코어 |
| 하드코어 | 기본 홈을 유지하면서 상세 수치와 필터 표에 접근한답니다. | 상세 > 해당 지표 > 선수/리그 표 > 선수 상세 |

### 상태별 홈과 진행 규칙

- 필수 응답 대기: 진행 버튼을 비활성화하고 ‘응답 필요’를 표시하며 첫 업무로 이동시키겠사와요.
- 할 일 없음: 영역을 축소해 ‘대기 업무 없음’을 표시하고 다음 경기를 앞으로 당기겠사와요.
- 휴식일: 실제 다음 경기 날짜와 건너뛸 일수를 표시하겠사와요.
- 비시즌: 다음 경기 자리에 현재 단계·마감·다음 단계 조건을 표시하고 ‘단계 확인’으로 해당 계약 화면을 열겠사와요. 경기 진행 버튼은 두지 않는답니다.
- 가을야구: 해당 시리즈·전적·다음 경기를 표시하고 기존 가을야구 진행과 연결하겠사와요.
- 시즌 종료 / 탈락: 시즌 결산과 다음 시즌 준비를 표시하며 없는 경기를 만들지 않겠사와요.
- 데이터 없음: 0이나 빈 그래프 대신 ‘경기 전’·‘기록 없음’을 표시하겠사와요. 저장 실패는 머리말 근처에 재시도 동작과 함께 유지하겠사와요.

## 4. 크기·테마·접근성

데스크톱 1440×900은 탐색 영역 192px, 머리말 72px, 본문 여백 32px, 카드 사이 24px를 기준으로 잡겠사와요. 1100px 아래에서는 2열을 1열로 바꾸고, 768px 아래에서는 하단 탐색으로 전환하겠사와요.

휴대폰 390×844는 좌우 16px 여백, 한 열, 할 일 두 행 → 다음 경기 → 최근 세 경기 → 접힌 순위·상세 순서랍니다. 진행 막대와 하단 탐색의 높이 및 safe-area만큼 본문 아래 여백을 확보하며, 가로 스크롤 없이 표는 요약 목록으로 바꾸겠사와요. 전체 순위와 상세는 탭 한 번으로 여는 안이와요.

현재 `base.css` 토큰을 출발점으로 삼겠사와요. 라이트는 bg #f6f5f3 / panel #ffffff / fg #17181b / muted #62666d / line #e7e4e0, 다크는 bg #0e1420 / panel #172033 / fg #eef2f8 / muted #9aa7bc / line #243049를 쓰는 안이랍니다. 내비게이션 #131b2b, 다크 강조 #ffb547를 유지하되 구단색은 이름 옆 띠와 작은 강조에만 쓰겠사와요. 그림 세 장은 라이트 기준이며 다크 완성 시안은 포함하지 않는답니다.

글꼴은 Pretendard, 본문 최소 14px, 주요 숫자 24–32px, 숫자는 tabular로 두겠사와요. 모든 터치 목표는 44px 이상, 키보드 초점은 명확한 외곽선, 강조색과 무관한 글자 대비는 WCAG AA를 구현 시 검증하겠사와요. 숫자만 초록·빨강으로 나누지 않고 승·패와 부호를 함께 표시하겠사와요. 테마와 상세 펼침 선택은 저장하되 초보/고급으로 기능을 잠그지 않겠사와요.

## 5. 참고한 방식과 독립 설계 범위

- **FM24의 수신함 방식 → 이 게임에서는 결정 대기와 읽을 소식을 분리**하겠사와요. 공식 매뉴얼은 자신과 구단에 관련된 중요 정보가 수신함에 모인다고 설명한답니다. 여기서는 홈에 두 건만 요약하고 ‘할 일’과 ‘소식’으로 나눠 직접 업무 화면으로 연결하는 제안이랍니다. [Sports Interactive 공식 FM24 매뉴얼](https://community.sports-interactive.com/sigames-manual/football-manager-2024/inbox-and-news-r4956/)
- **OOTP19의 Manager Home 업무 출발점 방식 → 이 게임에서는 다음 행동을 먼저 배치**하겠사와요. 공식 매뉴얼의 구단 메모·동적인 업무 링크 구조를 참고했사와요. 본안의 여섯 분류, 두 건의 업무 제한, 경기 중심 카드 순서와 모바일 탐색은 독립 설계랍니다. [OOTP19 공식 Manager Home 매뉴얼](https://manuals.ootpdevelopments.com/index.php?man=ootp19&page=help_manager_home_page.home)
- 위 근거는 해당 버전의 문서이며 최신 버전 화면의 설명으로 일반화하지 않겠사와요. 다른 두 게임의 화면 배치·아이콘·색상·브랜딩은 복제하지 않는답니다. 근거 없는 기능 기억은 본안에 사용하지 않았사와요.

## 6. 그림과 영어 프롬프트

그림의 숫자·날짜·선수는 배치 설명을 위한 가상 예시이며 실제 성적이 아니랍니다. 긴 설명은 회색 ‘텍스트 자리’ 선으로 나타내겠사와요. 아래 각 프롬프트는 공통 제약을 포함한 완결형으로 부록에 기록한답니다.

| 파일 | 목적 / 크기 |
|---|---|
| mockups/gpt/안1_메인_데스크톱.png | 홈 배치 / 1440×900 |
| mockups/gpt/안1_메인_휴대폰.png | 모바일 우선순위 / 390×844 |
| mockups/gpt/안1_메뉴구조.png | 전체 분류와 세부 동선 / 1440×900 |

그림은 커밋하지 않으며 본 문서만 커밋하겠사와요. 영어 프롬프트는 아래에 각각 수록하겠사와요.

### 생성·검수 기록

내장 image_gen 도구로 세 장을 생성하고 지정 픽셀 크기로 출력했사와요. 그림에서 로고·유니폼·얼굴·숨은 능력 숫자가 없는지, 여섯 대분류와 휴대폰 하단 탐색이 보이는지 확인했사와요. 구현용 정확한 행동 명세는 본문을 기준으로 삼겠사와요. 생성 그림의 다음 차이는 남아 있답니다.

- 데스크톱의 LG 경기 카드 순위와 오른쪽 순위 표가 일치하지 않는답니다. 모든 숫자·요일·상대는 시각 배치용이며 실제 경기 자료로 사용할 수 없사와요.
- 휴대폰의 ‘확인’ 버튼도 강조색으로 생성되었답니다. 구현 시 보조 버튼으로 낮춰 ‘다음 경기’만 주 강조로 유지하겠사와요.
- 메뉴 구조의 세부 항목 사이 연결선은 소속 관계이와요. 실행 순서를 뜻하지 않는답니다. 그림이 덧붙인 비시즌 ‘트레이드 검토’ 흐름은 허용 기능의 근거가 아니며 실제 단계·시대별 제한은 본문의 계약 단계와 게임 규칙을 따르겠사와요.
- 다크 테마와 기용·협상 상세 화면의 별도 그림은 이번 세 장 범위에 포함하지 않았사와요. 해당 내용은 문서의 구현 지시와 조작 흐름으로 제공한답니다.

### Prompt 1: Desktop home

```text
Use case: ui-mockup. High fidelity original Korean baseball general-manager web game concept. Pretendard-style sans serif, tabular numbers, spacious readable hierarchy. No real KBO logos, emblems, uniforms, mascots, real player photos or faces. Teams represented ONLY by written names and thin color strips. All player names fictional: 도하람, 윤가온. inspired by the information architecture of sports management sims, but original visual design; do not replicate Football Manager or OOTP screens, icons, color schemes, or branding. Korean text must be short, menu labels only; long prose must be gray horizontal placeholder lines representing "텍스트 자리". Positions only C 1B 2B 3B SS LF CF RF DH, SP RP CP. This is an atmosphere and layout reference, actual screens will be implemented by developers. No photography, no people, no decorative stadium render. Crisp flat full-bleed UI, no device mockup. Render exactly 1440x900 landscape desktop main screen. Light theme #f6f5f3 background, white panels #ffffff, ink #17181b, muted #62666d, borders #e7e4e0; deep navy #131b2b left navigation, restrained amber action. Left rail 192px with six primary menu labels in this exact order: 단장실, 경기, 선수, 영입, 구단, 리그. 단장실 selected; below it three secondary items 홈, 할 일, 소식. Bottom rail 저장, 설정. Across top 72px header: KBO 단장, 삼성 written with blue thin color strip, 2026.06.12, 3위, 32–25–1; right amber 다음 경기 primary action and outlined 더 진행. Main content starts at x224. Heading 단장실 with tabs 기본 selected and 상세. Upper full-width narrow action queue headed 할 일 2 with two separated rows, amber 필수 pill and gray placeholder lines plus 확인 button, no invented real text. Below, large next-game panel 700px wide on left and standings panel 264px on right. Next game: 다음 경기, 삼성 versus LG with only name text and thin strips, 18:30, SP 도하람 vs SP 윤가온; outlined 기용표 and 직접 지휘 buttons, no second amber primary action. Right 순위 compact five-row table, my team subtly highlighted. Lower row 최근 경기 five W/L score tiles and 최근 10경기 6–4; adjoining 구단 현황 budget number 28.4억 and two neutral gray placeholder lines. Bottom compact 접기/상세 optional numeric strip OPS .752 ERA 3.81. Keep whole composition polished, legible and calm, generous blank space, 24px gutters, 12px panel radii. All statistics illustrative, not live standings. Never display hidden player ability or potential ratings, numerical scouting attributes, or invented incidents about real players. Only ordinary public match statistics may appear. Fictional player examples only.
```

### Prompt 2: Mobile home

```text
Use case: ui-mockup. High fidelity original Korean baseball general-manager web game concept. Pretendard-style sans serif, tabular numbers, spacious readable hierarchy. No real KBO logos, emblems, uniforms, mascots, real player photos or faces. Teams represented ONLY by written names and thin color strips. All player names fictional: 도하람, 윤가온. inspired by the information architecture of sports management sims, but original visual design; do not replicate Football Manager or OOTP screens, icons, color schemes, or branding. Korean text must be short, menu labels only; long prose must be gray horizontal placeholder lines representing "텍스트 자리". Positions only C 1B 2B 3B SS LF CF RF DH, SP RP CP. This is an atmosphere and layout reference, actual screens will be implemented by developers. No photography, no people, no decorative stadium render. Crisp flat full-bleed UI, no device mockup. Render exactly 390x844 portrait mobile main screen. Same light theme #f6f5f3 white panels navy type, amber primary action. No desktop sidebar. Single column responsive layout with 16px side padding. Top compact header 60px: 삼성 with thin blue strip, 3위 32–25–1, small 저장 indicator. Next 2026.06.12 and title 단장실. Then compact 할 일 2 panel at y128-254 with two rows, 필수 tag, gray prose placeholders and 확인 buttons. Next game panel at y270-460: 다음 경기, 삼성 vs LG (names and color strips only), 18:30, SP 도하람 · SP 윤가온, secondary outlined 기용표 button. Recent results panel y476-584: 최근 경기, three compact 승/패 score tiles 5:2, 2:4, 6:3. Small collapsed 순위 row y600-650 with 3위 and chevron, another row 상세 y658-702. Fixed progress action bar y714-780 with one large amber 다음 경기 button and small outlined 더 진행. Fixed bottom navigation y780-844 with EXACTLY five items 단장실, 경기, 선수, 영입, 더보기. 더보기 contains 구단 and 리그 in actual product, not expanded here. 44px minimum tap targets. No long text, no horizontal scrolling, no overlapping content. Never display hidden player ability or potential ratings, numerical scouting attributes, or invented incidents about real players. Only ordinary public match statistics may appear. Fictional player examples only.
```

### Prompt 3: Menu map

```text
Use case: infographic-diagram. High fidelity original Korean baseball general-manager web game concept. Pretendard-style sans serif, tabular numbers, spacious readable hierarchy. No real KBO logos, emblems, uniforms, mascots, real player photos or faces. Teams represented ONLY by written names and thin color strips. All player names fictional: 도하람, 윤가온. inspired by the information architecture of sports management sims, but original visual design; do not replicate Football Manager or OOTP screens, icons, color schemes, or branding. Korean text must be short, menu labels only; long prose must be gray horizontal placeholder lines representing "텍스트 자리". Positions only C 1B 2B 3B SS LF CF RF DH, SP RP CP. This is an atmosphere and layout reference, actual screens will be implemented by developers. No photography, no people, no decorative stadium render. Crisp flat full-bleed UI, no device mockup. Render a 1440x900 landscape information architecture poster, six-column precise menu map on warm white #f6f5f3 canvas. Top heading 메뉴 구조 and small badge 안 1. Six aligned navy header cards with thin blue/amber accents, columns in exact order: 단장실, 경기, 선수, 영입, 구단, 리그. Each has white stacked submenu cells connected with simple vertical lines. Column 1: 홈, 할 일, 소식, 이야기. Column 2: 일정·결과, 경기 준비, 직접 지휘. Column 3: 선수단, 기용표, 성장, 입대. Column 4: 선수 찾기, 트레이드, 선수 시장, 계약. Column 5: 개요, 재정, 구장·팬, 감독·코치, 구단주, 이력·업적. Column 6: 순위, 개인 기록, 올스타, 가을야구, 시즌 결산, 기록관. Below columns show two horizontal slim contextual navigation strips: 시즌 → 경기 준비 and 비시즌 → 계약 · 성장 · 입대. Footer mini strip 글로벌: 저장 · 설정 · 정보. Bottom right small mobile strip 단장실 | 경기 | 선수 | 영입 | 더보기 and below 더보기 → 구단 · 리그. Do not use long descriptions, photographs, portraits, brand logos, pictorial sports graphics or icons copied from other games. Airy, readable, precise conceptual sitemap. Never display hidden player ability or potential ratings, numerical scouting attributes, or invented incidents about real players. Only ordinary public match statistics may appear. Fictional player examples only.
```

