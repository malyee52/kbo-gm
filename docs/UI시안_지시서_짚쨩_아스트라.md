[짚쨩] UI 시안 지시서 — 안1 「결정 브리핑」
=================================================

2026-10-22 · 독립 기획 · 브랜치 plan/ui-mockups-astra

이 문서는 분위기·배치 참고용 시안이와요. 실제 화면은 개발 직원이 코드로 구현하는 대상이며, 수치와 선수 이름은 시연용이랍니다. 다른 직원의 시안은 열람하지 않았사와요.

## 1. 설계 방향

첫 질문을 “어느 메뉴에 들어갈까”에서 “지금 무엇을 결정할까”로 바꾸는 안이랍니다. 홈의 결정 카드에서 해당 선수·기한·선택지를 연결하고, 숫자를 더 보고 싶은 그대는 같은 맥락에서 상세 표를 펼칠 수 있사와요.

큰 메뉴는 **브리핑 / 전력 / 영입 / 시즌 / 경영 / 아카이브** 여섯 개랍니다. 전력은 보유 선수, 영입은 외부 자원, 시즌은 현재 경쟁, 아카이브는 누적 역사라는 구분이와요. 시즌이 바뀌어도 메뉴 위치는 고정하며, 이용 불가 기능은 사유와 이용 가능한 시점을 표시하겠사와요.

| 대분류 | 하위 화면 | 들어가는 이유 |
|---|---|---|
| 브리핑 | 홈, 결정함, 소식, 대화 | 지금 확인하고 결정할 일 |
| 전력 | 선수 명단, 기용 보드, 성장, 입대 | 우리 선수의 현재와 미래 |
| 영입 | 선수 검색, 시장, 트레이드, 계약·지명 | 전력 보강과 계약 처리 |
| 시즌 | 일정·결과, 순위, 개인 기록, 올스타, 가을야구, 결산·시상 | 진행 중인 대회와 성과 |
| 경영 | 구단 현황, 재정, 구장·팬, 감독·코치, 구단주 | 구단 운영 자원과 관계 |
| 아카이브 | 연표, 통산·시즌, 구단 역사, 왕조·라이벌, 명예의 전당, 이력·업적 | 여러 시즌의 기억 |
| 공통 도구 | 검색, 선수 상세, 저장·설정, 정보·출처, 시작 화면 | 어느 메뉴에서든 접근 |

모바일 하단은 브리핑·전력·영입·전체 네 칸이와요. 전체에는 여섯 대분류와 공통 도구가 모두 들어가며, 숨겨진 세 대분류에 결정 건수가 있으면 전체에도 합산 배지를 보여 주겠사와요. 대분류 진입 후에는 하위 목록을 한 번에 보여 주고, 선택한 하위 화면 이름을 상단에 유지하겠사와요.

## 2. 홈: 읽는 순서와 배치

데스크톱 1440×900 기준 왼쪽 184px 메뉴, 본문 좌우 여백 32px, 상단 상태 줄, 본문 2열 구조랍니다. 본문 왼쪽은 결정과 경기, 오른쪽은 리그 맥락이와요. 한 화면에 모든 지표를 밀어 넣지 않겠사와요.

| 순서 | 블록 | 보여 줄 내용과 동작 |
|---|---|---|
| 0 | 상태 줄 | 구단 텍스트·색 띠, 게임 날짜, 순위·승패, 전역 검색, 저장 상태 |
| 1 | 확인할 일 | 실제 미처리 항목만 긴급도·기한 순, 대표 3개와 전체 건수. 항목 클릭 시 근거와 선택지가 있는 결정함 상세 |
| 2 | 다음 경기 | 상대, 일정, 선발, 최근 경기 결과. 기용 확인과 다음 경기, 진행 설정 |
| 3 | 전력 변화 | 엔트리 공백·컨디션·성장 등 변화한 선수부터 최대 3명, 해당 선수로 연결 |
| 4 | 경쟁 상황 | 우리 팀 주변 순위와 경기 차. 전체 순위로 연결 |
| 5 | 일정과 소식 | 다음 일정, 지난 경기, 읽지 않은 구단 소식. 기사에는 별도 결정 배지를 붙이지 않음 |

결정함은 새로운 사건을 생성하는 장치가 아니라 기존 처리 대상의 모아보기랍니다. 현재 데이터에 기한이 없다면 날짜를 지어내지 않고 “시즌 종료 전” 같은 실제 단계 조건을 쓰거나 기한 표시를 생략하겠사와요. 미처리 항목이 없으면 “확인 완료”와 다음 경기를 앞으로 올리겠사와요.

휴대폰 390×844에서는 상태 → 확인할 일 3행 → 다음 경기 → 전력 변화 → 접힌 순위 순으로 세로 배치하겠사와요. 진행 버튼과 4칸 메뉴는 하단 고정, 본문에는 고정 영역 높이와 safe-area만큼 여백을 두겠사와요. 주요 조작은 44px 이상이며 상세 표는 기본 열을 줄이고 별도 전체 표에서만 가로 스크롤을 허용하겠사와요.

| 이용자 | 처음 보이는 정보 | 더 깊게 들어가는 길 |
|---|---|---|
| 초보 | 처리할 일, 필요한 이유 한 문장, 다음 행동 하나 | 야구 용어 도움말·기용 후보 비교 |
| 보통 팬 | 선발·최근 결과·순위 차·주요 선수 변화 | 경기 기록·일정·선수 상세 |
| 하드코어 | 같은 카드의 상세 펼침, 지표 기간·표본 표시 | 열 선택·정렬·필터·비교 표 |

정보 깊이는 난이도 선택과 분리한 “요약 / 상세” 표시 옵션이랍니다. 초보에게 다른 게임 규칙을 적용하지 않으며, 상세에서만 중요한 경고를 보여 주지 않겠사와요. 지원하지 않는 WAR 등의 지표, 숨겨진 특수능력, 확정적 미래 예측은 추가하지 않겠사와요.

## 3. 조작 방식 재설계

**기용 보드:** 야수는 포지션 자리와 주전·대기 명단, 투수는 SP·RP·CP 역할 칸으로 구성하겠사와요. 자리를 누르면 후보가 출전 가능 상태·수비 적합도·최근 기록과 함께 열리고, 후보 선택 → 변경 전후 검토 → 적용 순서랍니다. 드래그는 선택 기능이며 키보드와 클릭만으로도 같은 작업이 가능해야 하겠사와요. 엔트리 이동도 선택 선수들의 변경 묶음을 검토한 뒤 적용하며, 기존 정원·역할 제한을 그대로 검증하겠사와요. 추천 근거는 보이는 능력·상태만 사용하고 추천이 곧 자동 적용되지는 않겠사와요.

**영입 작업대:** 후보 검색과 시장에서 비교 대상을 고르고, 트레이드에서는 양쪽 교환 명단과 정원 변화를 나란히 보겠사와요. 제출 전 요약에서 선수·계약·비용을 확인하며, 거절 사유는 엔진이 실제 제공하는 수준만 표시하겠사와요. 외국인 트레이드나 오프시즌 트레이드 금지 등 기존 규칙을 UI 개편으로 풀지 않겠사와요.

**진행:** 주 버튼은 다음 경기, 보조 메뉴는 하루·일주일·한 달·시즌 끝까지와 멈춤 조건이랍니다. 자동 처리 선택과 예상 진행 범위를 실행 직전 표시하고 기존 동작을 유지하겠사와요. 직접 지휘는 경기 카드의 보조 진입점이며 경기 중 조작을 삭제하지 않겠사와요. 처리 중 중복 입력을 막고 저장 실패는 고정 상태 줄과 본문 경고로 드러내겠사와요.

**오프시즌:** 홈은 그대로 유지하고 경기 카드를 현재 오프시즌 단계·남은 처리 항목으로 대체하겠사와요. 계약·지명은 영입으로, 성장·입대는 전력으로 연결하되 단계 순서는 기존 엔진을 따르겠사와요. 가을야구에서는 시리즈 상황과 다음 경기를 우선하겠사와요.

**제안(게임 규칙 변경, 본 시안의 기본 범위 밖):** 자동 처리의 답변 정책을 사용자가 사건 유형마다 지정하는 기능은 별도 제안이랍니다. 현재의 자동 처리 규칙을 이 문서만으로 바꾸지 않겠사와요. 그 외 본안의 변경은 정보 구조·표현·조작 흐름에 한정하겠사와요.

## 4. 기존 기능 대응표

기준은 origin/main의 GameShell.tsx와 src/ui/screens/ 목록이랍니다. 독립 Screen ID뿐 아니라 하위 화면·대화창도 포함했사와요.

| 기존 화면·파일·진입점 | 새 위치 |
|---|---|
| home / Home | 브리핑 > 홈 |
| articles / Articles | 브리핑 > 소식 |
| fantasy / Fantasy | 브리핑 > 대화 (판타지 모드 표시 유지) |
| FantasyChat, FantasyChoices, FantasyFree | 브리핑 > 대화 > 대화·선택·자유 모드 |
| FantasyNegotiate, FantasyMemory | 브리핑 > 대화 > 협상·기억 |
| roster / Roster | 전력 > 선수 명단 및 기용 보드 |
| growth / Growth | 전력 > 성장 |
| Enlist | 전력 > 입대 (기존 결산 단계와 연결) |
| PlayerDetail | 공통 선수 상세 패널; 모바일 전체 화면 |
| search / Search | 영입 > 선수 검색 |
| market / Market | 영입 > 시장 |
| trade / Trade | 영입 > 트레이드 |
| offseason / Offseason | 브리핑 > 현재 단계 허브; 영입 > 계약·지명; 전력 > 성장·입대 |
| schedule / Schedule | 시즌 > 일정·결과 |
| standings / Standings | 시즌 > 순위 |
| leaders / Leaders | 시즌 > 개인 기록 |
| allstar / AllStar | 시즌 > 올스타 |
| postseason / Postseason | 시즌 > 가을야구 |
| season-end / SeasonEnd | 시즌 > 결산·시상 > 결산 |
| awards / Awards | 시즌 > 결산·시상 > 시상 |
| club / Club | 경영 > 구단 현황 |
| finance / Finance / Club finance 탭 | 경영 > 재정 |
| stadium / Stadium / Club stadium 탭 | 경영 > 구장·팬 |
| staff / Coaches / Manager / Club coach 탭 | 경영 > 감독·코치 |
| OwnerMeeting | 경영 > 구단주; 처리 대상은 결정함에서 연결 |
| PressConference | 브리핑 > 대화 > 기자회견 |
| GmPreview | 브리핑 > 경기 카드 > 단장 미리보기 |
| club-history / Club history 탭 | 아카이브 > 이력·업적 |
| records / Records | 아카이브 > 연표 |
| rec-career / Records career 탭 | 아카이브 > 통산·시즌 > 통산 |
| rec-season / Records season 탭 | 아카이브 > 통산·시즌 > 단일 시즌 |
| rec-teams / Records teams 탭 | 아카이브 > 구단 역사 |
| rec-dynasty / Records dynasty 탭 | 아카이브 > 왕조·라이벌 |
| rec-hof / Records hof 탭 | 아카이브 > 명예의 전당 |
| save / SaveScreen | 공통 > 저장·설정 |
| about / About | 공통 > 정보·출처 |
| EventDialog | 브리핑 > 결정함 상세 및 필수 사건 대화창 |
| AdvanceSummary, Celebration | 진행 뒤 요약·성과 오버레이 유지; 소식·이력으로 재열람 연결 |
| GameCast, CommandView | 경기 카드 / 일정·결과 > 중계·직접 지휘 |
| StopSettings, 시작 화면 돌아가기 | 진행 설정 / 공통 도구 |

새 “결정함”, 비교 패널, 요약/상세 옵션은 UI 구현 대상이며 이미 존재하는 화면이라고 주장하는 것은 아니랍니다. 실제 연결이 없는 파일도 기능 목록에서 누락하지 않도록 목적지를 정했사와요.

## 5. 시각 규칙과 상태

Pretendard를 본문·메뉴·숫자에 사용하고 숫자는 tabular-nums로 맞추겠사와요. 제목 24–28px, 본문 14–16px, 부가 정보 12px 이상을 목표로 하며, 스크린샷 글자는 정확한 구현용 폰트 샘플이 아니랍니다.

기존 base.css의 --bg, --panel, --panel-2, --fg, --muted, --line, --accent, --warn-*, --error-* 역할을 유지하는 방향이와요. 라이트는 따뜻한 회백 배경과 흰 패널, 다크는 #0e1420 배경과 #172033 패널을 기준으로 잡았사와요. 팀 색 띠는 --team으로 분리하고 행동 버튼은 충분한 대비를 확보하겠사와요. 실제 구현 시 직접 색 값을 컴포넌트에 흩뿌리지 않고 토큰을 사용해야 하겠사와요.

선택 상태는 색뿐 아니라 굵은 글자·선·현재 위치 표시로 구별하겠사와요. 부상·컨디션·슬럼프·출전 불만은 실존 선수에게도 표시할 수 있다는 2026-10-22 지시를 따르되, 본 시안에는 가상 이름만 사용하겠사와요. 범죄·음주·도박·폭력·약물·성 관련·괴롭힘·징계·사생활 폭로·실제 사건 재현은 넣지 않겠사와요.

데이터 없음은 0과 구별한 ‘—’ 및 사유, 진행 중은 상태 문구, 시즌 전은 개막 준비, 시즌 종료는 결산, 모드 미사용은 비활성 사유로 나타내겠사와요. 상세 패널을 닫으면 원래 목록의 선택·스크롤 위치와 키보드 초점을 복원하겠사와요.

## 6. 참고한 방식과 독자적 적용

- **FM의 Inbox에서 관련 소식과 결정이 모이는 방식 →** 이 게임은 소식과 실제 미처리 결정을 나눠 홈 상단에 결정 3개만 우선 표시하겠사와요. 근거: [Sports Interactive, FM2024 Inbox and News](https://community.sports-interactive.com/sigames-manual/football-manager-2024/inbox-and-news-r4956/) (2026-10-22 확인). 외형·아이콘·브랜딩은 참고 대상이 아니랍니다.
- **OOTP의 Manager’s Office가 구단 상황과 필요한 작업으로 안내하는 방식 →** 이 게임은 역할별 6개 메뉴와 선수 맥락 패널을 연결하고, 경기와 결정의 다음 행동을 한 화면에서 보여 주겠사와요. 근거: [OOTP 공식 Wiki, Manager’s Office](https://wiki.ootpdevelopments.com/index.php?title=OOTP_Baseball%3AScreens_and_Menus%2FManager_Menu%2FManager%27s_Office) (2026-10-22 확인).
- 위 문서에 없는 최신 버전 화면이나 세부 상호작용을 확인한 것으로 쓰지 않았사와요. 기용 보드·6분류·모바일 동선은 본 독립안의 설계랍니다.

## 7. 그림용 영어 프롬프트

제작은 내장 image_gen으로 진행하며, 각 프롬프트에 권리·텍스트·포지션 제약을 반복해 포함했사와요. 생성된 그림은 배치 참고이며 실제 메뉴명과 동작의 기준은 본문 표랍니다.

### 7.1 데스크톱 메인 — 1440×900, 라이트

```text
Use case: ui-mockup. Create one polished flat desktop application screenshot exactly 1440x900 pixels, no device frame, for a Korean baseball general manager game. Concept: Decision Briefing. Editorial calm white and warm off-white surface, graphite text, thin rules, restrained burgundy action accent, generous whitespace; no photography. Left sidebar width 184 with six short labels 브리핑, 전력, 영입, 시즌, 경영, 아카이브; 브리핑 selected. Bottom sidebar 저장 and 설정. Top horizontal header with KBO 단장, team KIA as text plus plain burgundy strip, date 2026.06.18, search field, 3위 and 36–29. Main x=216 with title 브리핑 and small date. Below title a slim row of three decision cards labeled 엔트리, 계약, 면담, short status badges 1,2,1, gray description lines and 보기 buttons. Underneath two columns: left 720px wide main next-match card with text KIA vs LG, 18:30, two plain team color strips and fictional starting pitchers 한도윤 SP vs 윤태겸 SP, compact 5-game form strip, prominent burgundy 다음 경기 button plus small 기용 확인 and 진행 설정 actions. Under this a 전력 변화 section with 3 fictional player rows, positions SS SP CF, numeric data and tiny trend lines, basic/detail tabs 요약 상세. Right 280px column compact 순위 table with five teams KIA LG 삼성 KT 한화 (plain text only), wins losses game-behind numbers and highlighted KIA row; below short 소식 section with gray placeholder lines. Footer main a 7-day 일정 strip. Big readable headings, polished realistic web UI, no marketing copy. No real KBO club logos, emblems, uniforms or mascots. No real player photos or faces. Teams represented only by written names and plain color strips. Player names must be fictional: 한도윤, 윤태겸, 서이준. inspired by the information architecture of sports management sims, but original visual design; do not replicate Football Manager or OOTP screens, icons, color schemes, or branding. Keep Korean text short, mainly menu labels; represent long sentences as gray placeholder lines (텍스트 자리), never paragraphs. Positions use English abbreviations C 1B 2B 3B SS LF CF RF DH, SP RP CP. This is a mood and layout reference mockup, not an implemented application. Pretendard typography. All statistics illustrative.
```

### 7.2 휴대폰 메인 — 390×844, 다크

```text
Use case: ui-mockup. Create one polished flat mobile application screenshot exactly 390x844 pixels, no device bezel, for Korean baseball GM game. Same Decision Briefing concept with DARK theme: near-black navy background #0e1420, panels #172033, white #eef2f8, muted #9aa7bc, amber action #ffb547. Pretendard, excellent legibility, very short Korean labels. Top small KBO 단장, KIA text with burgundy strip, 3위 36–29, date 06.18. Title 브리핑. Single-column content with 16px margins: first compact decision section 확인할 일 with 3 horizontal list rows 엔트리 1, 계약 2, 면담 1; each right chevron. Next large next-match panel KIA vs LG 18:30; pitchers 한도윤 SP and 윤태겸 SP without images, short gray lines and 기용 확인 secondary button. Next compact 전력 변화 two player rows 서이준 SS and 윤태겸 SP with small numeric metrics. Below an expandable 순위 row. Sticky bottom region above navigation has full width amber 다음 경기 button and small 진행 설정 action; bottom navigation exactly 브리핑 전력 영입 전체 with simple original line icons, first selected. Leave sufficient bottom padding so no content under sticky controls. No dense desktop tables, no horizontal scrolling. No real KBO club logos, emblems, uniforms or mascots. No real player photos or faces. Teams represented only by written names and plain color strips. Player names must be fictional: 한도윤, 윤태겸, 서이준. inspired by the information architecture of sports management sims, but original visual design; do not replicate Football Manager or OOTP screens, icons, color schemes, or branding. Keep Korean text short, mainly menu labels; represent long sentences as gray placeholder lines (텍스트 자리), never paragraphs. Positions use English abbreviations C 1B 2B 3B SS LF CF RF DH, SP RP CP. This is a mood and layout reference mockup, not an implemented application. Pretendard typography. All statistics illustrative.
```

### 7.3 메뉴 구조 — 1440×900

```text
Use case: infographic-diagram. Create one crisp landscape 1440x900 information architecture poster for Korean baseball GM game, warm white background graphite text restrained burgundy accents, no decorative imagery. Title 메뉴 구조 and subtitle 안1 · 결정 브리핑. Six evenly spaced equal vertical columns, each a top-level category with connected stacked subpage boxes. Column 1 브리핑: 홈, 결정함, 소식, 대화. Column 2 전력: 선수 명단, 기용 보드, 성장, 입대. Column 3 영입: 선수 검색, 시장, 트레이드, 계약·지명. Column 4 시즌: 일정·결과, 순위, 개인 기록, 올스타, 가을야구, 결산·시상. Column 5 경영: 구단 현황, 재정, 구장·팬, 감독·코치, 구단주. Column 6 아카이브: 연표, 통산·시즌, 구단 역사, 왕조·라이벌, 명예의 전당, 이력·업적. At bottom a separate horizontal utility rail labeled 공통 with boxes 검색, 선수 상세, 저장·설정, 정보·출처; next rail 모바일 with 브리핑 전력 영입 전체. Clear topology, straight thin connector lines, generous typography spacing, absolutely no long prose. Small footer mood/layout reference represented by gray lines. No real KBO club logos, emblems, uniforms or mascots. No real player photos or faces. Teams represented only by written names and plain color strips. Player names must be fictional: 한도윤, 윤태겸, 서이준. inspired by the information architecture of sports management sims, but original visual design; do not replicate Football Manager or OOTP screens, icons, color schemes, or branding. Keep Korean text short, mainly menu labels; represent long sentences as gray placeholder lines (텍스트 자리), never paragraphs. Positions use English abbreviations C 1B 2B 3B SS LF CF RF DH, SP RP CP. This is a mood and layout reference mockup, not an implemented application. Pretendard typography. All statistics illustrative.
```

## 8. 산출물과 검토 기준

- mockups/astra/안1_메인_데스크톱.png
- mockups/astra/안1_메인_휴대폰.png
- mockups/astra/안1_메뉴구조.png

위 그림은 로컬 산출물이며 커밋하지 않겠사와요. 한 안의 데스크톱·휴대폰·구조도 3장을 기준으로 검토하겠사와요. 코드 수정과 PR·main 병합은 범위에 없사와요.

생성 그림 검수 메모: 세 그림 모두 실존 얼굴·로고 없이 생성되었사와요. 원본을 요청한 픽셀 크기로 리샘플링했으며, 데스크톱 순위표의 순번·승패·경기 차, 선수별 포지션·성적, 두 화면의 날짜 요일에는 시연 수치 불일치가 있사와요. 모바일의 기용 확인 버튼은 우리 팀용 하나만 구현하고, 상대 칸은 상세 보기로 구별해야 하겠사와요. 일부 긴 자리표시자가 회색 선 대신 글자로 생성되었고 구조도에 예시 세부 정보가 덧붙었으므로, 실제 하위 메뉴 범위는 1·4절 표를 기준으로 삼겠사와요. 정확한 수치·문구·최소 터치 크기는 구현 단계에서 별도 검증하는 대상이랍니다.

구현 검토 시 ① 처음 들어와 다음 행동을 찾는지 ② 모바일에서도 전체 메뉴에 닿는지 ③ 상세 정보를 펼쳐도 선택한 선수 맥락이 유지되는지 ④ 시즌 전환 때 기능이 사라진 것으로 오해하지 않는지 ⑤ 상태·색각·키보드·저장 실패가 드러나는지 확인해야 하겠사와요.
