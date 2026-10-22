# UI 시안 지시서 (짚쨩용)

> **초안 — 사용자와 함께 정하는 중** (2026-10-22). 기획안: `docs/UI개편_기획안.md`.
> 시안은 **분위기·배치 참고용**이다. 그림의 글자·숫자·색은 그대로 게임에 들어가지 않는다. 실제 화면은 기획안과 `src/ui/base.css` 토큰으로 만든다.

## 그릴 것 (이번 단계: 메인 화면 + 메뉴 구조만)

| 번호 | 그림 | 크기 |
|---|---|---|
| A-1 | 안 A 부서형: 메뉴 구조 그림 | 1440×900 |
| A-2 | 안 A 부서형: 정규시즌 홈 | 1440×900 |
| B-1 | 안 B 범위형: 메뉴 구조 그림 | 1440×900 |
| B-2 | 안 B 범위형: 정규시즌 홈 | 1440×900 |
| C-1 | 안 C 시간형: 메뉴 구조 그림 | 1440×900 |
| C-2 | 안 C 시간형: 정규시즌 홈 | 1440×900 |
| M-1 | 휴대폰 홈 (세 안 공통 뼈대) | 390×844 |

각 지시문 앞에 아래 **공통 머리말**을 그대로 붙인다. 한 장씩 따로 만든다.

## 공통 머리말 (모든 지시문 앞에 붙임)

```
Purpose: a UI mood/layout reference for a baseball general-manager simulation web game
(Korean pro league setting). This is a reference image only, not a final screen.

Hard rules (must follow):
- No real team logos, emblems, uniforms, mascots, caps, or player photos/faces/silhouettes.
  Teams appear ONLY as a short text label plus a thin vertical color band next to it.
- Use fictional placeholders for names: players as "Player A", "Player B"...;
  teams as 2-3 letter codes like "TMA", "TMB", "TMC". Do not use any real league, team, or player names.
- Inspired by the information architecture of sports management sims, but an original visual design.
  Do NOT replicate Football Manager or Out of the Park Baseball screens, layouts pixel-for-pixel,
  icons, color schemes, fonts, menu names, or branding. Do not imitate any other game or app.
- Korean text: keep it very short (1-4 Korean characters per label) or use a gray placeholder bar
  labeled "text". Long Korean sentences must be gray placeholder bars, not real text.
- Baseball positions use English abbreviations only: C 1B 2B 3B SS LF CF RF DH, pitchers SP RP CP.
- Player ability grades use the 20-80 scouting scale (50 = league-average regular), shown as a number
  with a small horizontal bar. No star ratings, no hidden stats.
- Flat, clean, modern web UI. Sans-serif font similar to Pretendard. Light theme.
  Neutral warm-gray background, white cards with subtle shadow and 14px rounded corners,
  one dark navy header area. The user's team color appears only as an accent (a thin band
  or underline), not as a full background.
- High readability: generous spacing, clear hierarchy, numbers right-aligned in tables.
- No photos, no 3D, no stadium imagery, no stock illustrations.
```

## A-1 안 A 부서형 — 메뉴 구조 그림

```
[common header above]

Draw an information-architecture diagram (not a game screen) on a 1440x900 canvas.
Title at top: "Plan A — Department layout" (English).
Left: a tall vertical sidebar mock with 7 stacked menu items, each a short label + a simple
generic line icon (original, not from any game): Home, Squad, Games, Player Moves,
Club Operations, League, Archive. A small "Story" item below a divider, marked "(fantasy mode only)".
To the right of each sidebar item, draw a connector line to a group box listing its sub-screens
as small pill tags:
- Home: Today, Inbox, Articles
- Squad: Roster, Depth/Lineup, Injuries, Military, Development
- Games: Calendar, Live Game, Box Score, Postseason
- Player Moves: Trades, Free Agents, Foreign, Draft & Picks, Search, Watchlist (dashed = proposal), Move Log
- Club Operations: Owner, Finance, Payroll & Cap, Ballpark & Fans, Manager & Coaches
- League: Standings, Leaders, All-Star, Awards, Season Review
- Archive: Timeline, Career, Single Season, Franchise, Dynasties, Hall of Fame, My Career
Top strip across the canvas: a fixed top bar mock (date, team label with color band, record,
"To-do 2" badge, search box, primary "Next Game" button, gear icon).
Bottom note area: a small legend "solid = existing feature, dashed = proposal".
Style: clean diagram, thin gray connectors, white boxes, navy sidebar.
```

## A-2 안 A 부서형 — 정규시즌 홈

```
[common header above]

A desktop web app home screen, 1440x900, for a baseball GM game in mid-season.
Layout:
- Left: dark navy vertical sidebar (about 200px) with 7 short menu labels; "Home" is selected
  (highlighted with the team accent color). A small "collapse" chevron at the bottom.
- Top bar across the remaining width: date placeholder, team label "TMA" with a thin navy color band,
  record "48-39-2", rank "3rd", "4.5 GB", a red badge "2" for to-do items, a search field,
  a prominent "Next Game ▶" button with a small dropdown arrow, a gear icon.
- Main area, 3-column card grid:
  1) Top-left wide card "To-do": two rows with an orange "!" marker, each a gray placeholder text bar
     and a small action button.
  2) Below it, the largest card "Inbox": 6 message rows with unread dots, a small filter chip row
     (4 chips), and "see all".
  3) Right column top card "Next Game": two team labels with color bands facing each other ("vs"),
     two pitcher placeholders "Player A" vs "Player B" with tiny stat text, "head-to-head 6-4",
     an "expand" link.
  4) Right column second card "Team at a glance": big "3rd" number, a short status pill
     (green, placeholder text), a row of 10 small W/L dots.
  5) Bottom row: small card "Recent games" (3 score lines with W/L chips),
     small card "Standings" (5 rows around our team, our row highlighted),
     small card "Player buzz" (one hot player, one cold player).
  6) A thin full-width strip at the bottom: owner trust progress bar, cash amount, season goal pill.
Mood: calm, organized office dashboard; the inbox feels central.
```

## B-1 안 B 범위형 — 메뉴 구조 그림

```
[common header above]

Draw an information-architecture diagram (not a game screen) on a 1440x900 canvas.
Title at top: "Plan B — Scope layout: Our Team / Market / League" (English).
Top: a horizontal menu bar mock with 6 tabs: Home, Our Team, Market, League, Club Business, History.
Below each tab, a vertical column of sub-screen pill tags:
- Home: Today, Inbox, Articles
- Our Team: Roster, Depth/Lineup, Schedule & Results, Box Score, Injuries & Military, Development & Camp, Team Stats
- Market: Trades, Free Agents, Foreign, Draft & Picks, Search, Watchlist (dashed)
- League: Standings, Leaders, League Schedule, Postseason, All-Star, Awards, Season Review, Move Log, Team Viewer (dashed)
- Club Business: Owner, Finance, Payroll & Cap, Ballpark & Fans, Manager & Coaches
- History: Timeline, Career, Single Season, Franchise, Dynasties, Hall of Fame, My Career
Draw a side callout from "Team Viewer (dashed)": a small mock showing a team picker (TMA..TMJ chips)
that opens the same "Our Team" layout for any other team, with edit buttons grayed out.
Three colored zones behind the columns: "ours" (Our Team), "outside" (Market), "everyone" (League),
using soft tints. Legend: solid = existing, dashed = proposal.
```

## B-2 안 B 범위형 — 정규시즌 홈

```
[common header above]

A desktop web app home screen, 1440x900, baseball GM game mid-season.
Layout:
- Header (dark navy, two rows): row 1 has team label "TMA" with color band, record "48-39-2",
  "3rd", "4.5 GB" in large numerals on the left; date placeholder, "To-do 2" badge, search field,
  "Next Game ▶" button and gear on the right. Row 2 is a horizontal tab bar with 6 short tabs;
  "Home" selected with an accent underline.
- Main area:
  1) Full-width thin "To-do" strip with two items, each with an orange marker and a small button.
  2) Row of two large cards: "Next Game" (two team labels with color bands, pitcher matchup
     "Player A" vs "Player B" with W-L and ERA-like small numbers, expand link) and
     "Team at a glance" (a KPI row: rank, record, win %, run differential "+41";
     a row of 10 W/L dots; a small "games above playoff line +6.0"; an expandable
     "advanced team stats" line with two small rank pills).
  3) Row of three medium cards: "Standings" (5 rows, ours highlighted), "Recent games" (3 lines),
     "Inbox" (5 rows with filter chips).
  4) Row of two cards: "Player buzz" (hot/cold player rows with tiny sparkline),
     "Club status" (owner trust bar, cash, cap room bar).
Mood: a fan's dashboard, our team's numbers are the hero.
```

## C-1 안 C 시간형 — 메뉴 구조 그림

```
[common header above]

Draw an information-architecture diagram (not a game screen) on a 1440x900 canvas.
Title at top: "Plan C — Time layout: Today / This Season / Future Team" (English).
Draw a horizontal timeline arrow from left (now) to right (years ahead), then a separate box for
"Club" and a box on the far left for "History" (past), so the 5 top menus are ordered by time:
History (past) | Today (now) | This Season (this year) | Future Team (next years) | Club (foundation, beneath the arrow).
Under each, sub-screen pill tags:
- Today: Home, To-do, Live Game, Inbox, Articles
- This Season: Roster, Depth/Lineup, Schedule & Box Score, Standings, Leaders, Trades (until deadline),
  Market, All-Star, Postseason, Season Review & Awards
- Future Team: Prospects & Minors, Development & Camp, Expiring Contracts / FA prep,
  Military Plan, Draft & Picks, Search, Watchlist (dashed)
- Club: Owner, Finance, Payroll & Cap, Ballpark & Fans, Manager & Coaches
- History: Archive (6 items), Past Seasons, My Career
Side panel: show that in the offseason the "This Season" tab is replaced by "Offseason" containing
8 numbered steps in a row: 1 FA, 2 Compensation, 3 2nd Draft, 4 Foreign, 5 Draft, 6 Salary,
7 Roster Trim, 8 Opening Prep.
Legend: solid = existing, dashed = proposal.
```

## C-2 안 C 시간형 — 정규시즌 홈

```
[common header above]

A desktop web app home screen, 1440x900, baseball GM game mid-season, designed as one vertical reading flow.
Layout:
- Header (dark navy): team label "TMA" with color band, "48-39-2", "3rd"; date placeholder; search;
  "Next Game ▶" button and gear. Below it a tab bar with 5 tabs; "Today" selected and shows a small badge "2".
- Main area is a single centered column (about 1000px wide) of numbered horizontal sections,
  each section separated by a thin rule with a numbered heading:
  1 "To-do": two rows with orange markers, deadline placeholder, action buttons.
  2 "Today": next game line (team labels with color bands, pitcher matchup) with a secondary
    "Next Game ▶" button; below it yesterday's result line with a W chip and "box score" link.
  3 "This week": a compact row of three mini blocks: rank/status pill and last-10 record,
    hot/cold players, returning-from-injury player; under it a compact horizontal standings strip
    of 5 teams.
  4 "News": 5 rows with filter chips.
  5 "Looking ahead" (collapsed): one line of three chips: "expiring contracts 3",
    "military eligible 2", "1st round pick #5 (projected)".
Mood: a calm daily briefing you read top to bottom; very beginner friendly, lots of white space.
```

## M-1 휴대폰 홈

```
[common header above]

A mobile web app home screen, 390x844, baseball GM game mid-season, light theme.
- Compact dark navy top bar: team label "TMA" with color band, "48-39-2", "3rd", gear icon;
  second line: date placeholder on the left, a large "Next Game ▶" button on the right.
- Stacked full-width cards with 12px gaps:
  1) "To-do (2)" card with one visible item (orange marker + placeholder bar) and a chevron.
  2) "Next Game" card: two team labels with color bands, "Player A" vs "Player B".
  3) One-line status card: "3rd", a green status pill, "last 10: 7-3".
  4) "News" card with 3 rows and "all ›".
  5) Partially visible card "Recent games" cut off by the bottom tab bar.
- Bottom tab bar with 5 items (simple original line icons + 2-4 character labels; the last is "More").
- Thumb-friendly: buttons at least 44px tall.
```

## 시안 받은 뒤

- 사용자와 같이 보고, 기획안 9장 "사용자가 정할 것"의 1·2·3번을 고르는 데 쓴다.
- 그림에서 마음에 든 점·안 든 점을 기획안에 적는다 (그림 파일은 저장소에 넣지 않는다. 넣기로 하면 사용자에게 먼저 묻는다).
- 고른 안으로 다음 단계(화면별 시안: 선수단·선수 창·경기·오프시즌 등)를 다시 지시한다.
