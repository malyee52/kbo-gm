"""기획안(KBO_도전형_시나리오_기획안.md) 8장(도전 시나리오: 시즌 도전 S01~S36, 장기 캠페인 C01~C60)과 11장(시즌 선택)의 시놉시스를 src/league/synopses.ts로 옮긴다.

쓰는 법: python tools/build_synopses.py [기획안 경로]
기획안 문구를 고치면 이 스크립트를 다시 돌린다. 머리글 "#### 번호. ..." 아래의 "**상징 인물:**" 줄과 본문 문단을 읽는다.
"""
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'KBO_도전형_시나리오_기획안.md'
text = io.open(src, encoding='utf-8').read()

# 8장(시즌 도전·장기 캠페인)만 (2026-10-12 두 번째 판: 클래식 캠페인은 시즌 도전에 합쳤다)
parts = []
for start, end in (('## 8.', '## 9.'),):
    a = text.index(start)
    b = text.index(end, a)
    parts.append(text[a:b])
body = '\n'.join(parts)

out = {}
for m in re.finditer(r'^#### (S[0-9]{2}|C[0-9]{2})\. [^\n]*\n(.*?)(?=^#{2,4} |\Z)', body, re.S | re.M):
    no, block = m.group(1), m.group(2)
    fig = re.search(r'\*\*상징 인물:\*\*\s*(.+)', block)
    paras = [p.strip() for p in re.split(r'\n\s*\n', block) if p.strip() and not p.strip().startswith('**')]
    out[no] = {'figures': fig.group(1).strip() if fig else '', 'text': ' '.join(paras)}

need = [f'S{i:02d}' for i in range(1, 37)] + [f'C{i:02d}' for i in range(1, 61)]
missing = [n for n in need if n not in out]
if missing:
    sys.exit(f'시놉시스가 없는 번호: {missing}')

lines = [
    '// 도전 시나리오 선택 화면의 시놉시스. tools/build_synopses.py가 기획안(KBO_도전형_시나리오_기획안.md) 8장에서 만든다. 직접 고치지 말 것.',
    '// 실제 역사에서 착안한 창작 소개문이며, 개막 이후의 결과를 확정하지 않는다 (기획안 8장 머리말).',
    '',
    'export interface Synopsis {',
    '  /** 상징 인물 (가운뎃점으로 구분) */',
    '  figures: string;',
    '  text: string;',
    '}',
    '',
    'export const PLAN_SYNOPSIS: Record<string, Synopsis> = {',
]
for n in need:
    lines.append(f'  {json.dumps(n)}: {{ figures: {json.dumps(out[n]["figures"], ensure_ascii=False)}, text: {json.dumps(out[n]["text"], ensure_ascii=False)} }},')
lines.append('};')
lines.append('')

# 11장: 시즌 선택 화면 (#### 연도 — 제목)
a = text.index('## 11.')
seasons = {}
for m in re.finditer(r'^#### (\d{4}) — ([^\n]+)\n(.*?)(?=^#### |^## |\Z)', text[a:], re.S | re.M):
    paras = [p.strip() for p in re.split(r'\n\s*\n', m.group(3)) if p.strip()]
    seasons[int(m.group(1))] = {'title': m.group(2).strip(), 'text': ' '.join(paras)}
miss = [y for y in range(1982, 2027) if y not in seasons]
if miss:
    sys.exit(f'시즌 시놉시스가 없는 해: {miss}')
lines.append('/** 시즌 선택 화면의 시놉시스 (기획안 11장): 그 해 개막 시점의 리그를 바라보는 소개문 */')
lines.append('export const SEASON_SYNOPSIS: Record<number, { title: string; text: string }> = {')
for y in sorted(seasons):
    lines.append(f'  {y}: {{ title: {json.dumps(seasons[y]["title"], ensure_ascii=False)}, text: {json.dumps(seasons[y]["text"], ensure_ascii=False)} }},')
lines.append('};')
lines.append('')
io.open(ROOT / 'src/league/synopses.ts', 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print(f'{len(need)}개 시놉시스를 썼습니다')
