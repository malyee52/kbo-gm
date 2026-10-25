# 화면 메뉴 구조 (UI 대개편 1차, 2026-10-22)

짚쨩 안1 "결정 브리핑"(`plan/ui-mockups-astra` 브랜치 `docs/UI시안_지시서_짚쨩_아스트라.md`)을 따른 메뉴. 코드는 `src/ui/menu.ts`.

- 데스크톱: 왼쪽 세로 메뉴(대분류 6개 + 저장·설정·정보·출처·시작 화면), 위쪽 상태 줄, 대분류 안 하위 화면 목록.
- 휴대폰(768px 이하): 아래 4칸(브리핑·전력·영입·전체) + 아래 고정 진행 버튼. '전체'에 모든 대분류와 공통 도구.
- 메뉴 자리는 시즌이 바뀌어도 그대로다. 지금 열 수 없는 화면은 숨기지 않고 흐리게 + 사유와 열리는 때를 보여 준다(`blockOf`). 기본 모드에서는 '대화'(판타지 전용)만 숨긴다.
- 정보 깊이 '요약 / 상세'는 난이도와 별개인 표시 옵션이고 이 브라우저에 기억한다(`src/ui/shell.tsx`).

## 기존 화면 → 새 메뉴

| 기존 화면·부품 | 새 자리 | 화면 id |
|---|---|---|
| 홈 (Home.tsx, 지움) | 브리핑 > 홈 (Briefing.tsx) | home |
| (새로) 결정함 | 브리핑 > 결정함 (Inbox.tsx, decisions.ts) | inbox |
| 홈의 알림 카드·진행 중인 효과 | 브리핑 > 소식 > 구단 소식 (ClubNews.tsx) | news |
| 기사 (Articles) | 브리핑 > 소식 > 기사 | articles |
| 판타지 (Fantasy, 대화·선택·자유·기억·연대기·AI 설정) | 브리핑 > 대화 (판타지 모드에서만 보임) | fantasy |
| 기자회견 (PressConference) | 브리핑 > 대화 안 (예전 홈 다음 경기 카드에서는 뺐다) | fantasy |
| 경기 전 미팅 (홈 PregameTalk) | 브리핑 > 홈 > 다음 경기 카드 (판타지 모드) | home |
| 자유 모드 행동 (FantasyFree compact) | 브리핑 > 홈 맨 위 (자유 모드) | home |
| 단장 미리보기 (GmPreview) | 대화 안 협상·자유 모드 화면에서 그대로 | fantasy |
| 선수단의 기용 칸(역할 드롭다운)·타순, 1군·2군 이동, AI에게 엔트리·기용 맡기기 | 전력 > 기용 보드 (`LineupBoard.tsx`, 2차): 자리 칸 → 후보 비교 → 변경 묶음 검토 → 적용. 선수 명단은 보기와 육성선수 정식 등록만 | lineup (전력에 들어가면 먼저 열림. 오프시즌 개막 준비 단계에는 개막 날 미리 보기 `OpeningBoard.tsx`로 열리고 고친 것은 개막 때 옮김. 2026-10-23 사용자 결정) |
| 선수단 (Roster) | 전력 > 선수 명단 (기용 보드 다음 칸) | roster |
| 선수 성장 (Growth) | 전력 > 성장 | growth |
| 입대 선택 (SeasonEnd 안 EnlistPanel) | 전력 > 입대 (결산 화면에도 그대로) | enlist |
| 선수 찾기 (Search) | 영입 > 선수 검색, 상태 줄 검색 칸 | search |
| 선수 시장 (Market) | 영입 > 시장 | market |
| 트레이드 (Trade) | 영입 > 트레이드 | trade |
| 오프시즌 (Offseason, 모든 단계) | 영입 > 계약·지명, 브리핑 > 홈의 오프시즌 카드 | offseason |
| 일정·결과 (Schedule, 박스스코어·중계 다시 보기) | 시즌 > 일정·결과 | schedule |
| 순위 (Standings) | 시즌 > 순위 | standings |
| 개인 기록 (Leaders) | 시즌 > 개인 기록 | leaders |
| 올스타전 (AllStar) | 시즌 > 올스타 | allstar |
| 가을야구 (Postseason) | 시즌 > 가을야구 | postseason |
| 시즌 결과 (SeasonEnd) | 시즌 > 결산·시상 > 결산 | season-end |
| 시상식 (Awards) | 시즌 > 결산·시상 > 시상 | awards |
| 구단 개요 (Club) | 경영 > 구단 현황 | club |
| 재정 | 경영 > 재정 | finance |
| 구장·팬 | 경영 > 구장·팬 | stadium |
| 감독·코치 | 경영 > 감독·코치 | staff |
| 구단주 평가 카드, 구단주 면담 (OwnerMeeting, 판타지) | 경영 > 구단주 (구단 현황에도 평가 카드는 그대로) | owner |
| 해고 뒤 영입 제의 (OfferPanel) | 경영 > 구단 현황 맨 위 (결정함에서 연결) | club |
| 연표 (Records) | 아카이브 > 연표 (리그 연표 탭) | records |
| 통산 순위 / 단일 시즌 기록 | 아카이브 > 통산·시즌 > 통산 / 단일 시즌 | rec-career, rec-season |
| 구단 역사 | 아카이브 > 구단 역사 | rec-teams |
| 왕조·라이벌 | 아카이브 > 왕조·라이벌 | rec-dynasty |
| 명예의 전당 | 아카이브 > 명예의 전당 | rec-hof |
| 부임 이력·업적 | 아카이브 > 이력·업적 | club-history |
| 저장·설정 (SaveScreen) | 공통 > 저장·설정 | save |
| 정보·출처 (About) | 공통 > 정보·출처 | about |
| 시작 화면으로 | 공통 > 시작 화면 | — |
| 무작위 이벤트 (EventDialog) | 본문 맨 위 그대로 + 결정함 '사건' | — |
| 진행 요약 (AdvanceSummary), 축하 (Celebration) | 진행 뒤 창 그대로 | — |
| 경기 중계 (GameCast), 직접 지휘 (CommandView) | 다음 경기 뒤 창 그대로 / 진행 설정 > 직접 지휘, 홈 다음 경기 카드(상세) | — |
| 진행 버튼(하루·일주일·한 달·시즌 끝까지), 멈춤 설정 (StopSettings) | 상태 줄 '다음 경기' + '진행 설정', 휴대폰 아래 고정 버튼 | — |
| 선수 상세 (PlayerDetail) | 어디서든 선수 이름을 누르면 열리는 창 그대로 | — |
| 규칙 연표 (Rules, 규칙 알림) | 아카이브 > 연표 (규칙 연표 탭) | rules |
