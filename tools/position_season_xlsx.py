"""tools/position_season_check.ts가 낸 CSV → 엑셀 (reports/position-season-check.xlsx).

사용법: python -I -X utf8 tools/position_season_xlsx.py <csv> reports/position-season-check.xlsx
첫 시트 맨 위에 만든 날짜와 기준을 적고, 바뀌는 능력(가장 큰 차의 크기) 큰 순으로 한 줄에 선수-시즌 하나.
"""
import csv
import sys
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

src, dst = sys.argv[1], sys.argv[2]
with open(src, encoding='utf-8', newline='') as f:
    rows = list(csv.reader(f))
head, body = rows[0], rows[1:]
num = {'시즌', '타석', '평가 연도', '가장 큰 차'} | {h for h in head if h.startswith(('지금 ', '대안 ')) and h.split(' ')[1] in ('C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF')}

wb = Workbook()
ws = wb.active
ws.title = '선수-시즌'
ws.append([f'만든 날짜 {date.today().isoformat()} · npx tsx tools/position_season_check.ts --csv … → python tools/position_season_xlsx.py'])
ws.append(['기준: 지금 = 지금 게임 데이터의 그 시즌 포지션, 대안 = ① 2008·2010 하드힛 값 ② 옛 자료집 값 ③ 앞뒤 해 값. '
           '평가 연도(그 시즌 다음 해) 시작 월드에서 그 시즌 값만 바꿔 만든 수비 등급(20~80)을 견준다. 가장 큰 차 = 지금 − 대안 (8자리 중 절댓값이 가장 큰 자리).'])
ws['A1'].font = Font(bold=True)
ws.append([])
ws.append(head)
for c in ws[4]:
    c.font = Font(bold=True)
hot = PatternFill('solid', fgColor='F4CCCC')
for r in body:
    vals = [int(v) if h in num and v not in ('', None) and v.lstrip('-').isdigit() else v for h, v in zip(head, r)]
    ws.append(vals)
    d = vals[head.index('가장 큰 차')]
    if isinstance(d, int) and abs(d) >= 10:
        ws.cell(row=ws.max_row, column=head.index('가장 큰 차') + 1).fill = hot
for i, h in enumerate(head):
    ws.column_dimensions[ws.cell(row=4, column=i + 1).column_letter].width = 22 if h == '근거' else 9 if len(h) <= 5 else 12
ws.freeze_panes = 'D5'
wb.save(dst)
print(f'{len(body)}줄 → {dst}')
