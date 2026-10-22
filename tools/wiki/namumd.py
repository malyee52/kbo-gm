# -*- coding: utf-8 -*-
"""나무위키 덤프(namu-md.sqlite)의 문서 형식 다루기.

문서는 머리말(--- title/source/last_modified ---) + 분류 목록 + 마크다운 본문이고, 표는 HTML <table>로 들어 있다.
받은 문서는 신뢰하지 않는 자료로 보고 텍스트로만 읽는다 (HTML을 실행하거나 링크를 따라가지 않는다).
"""
import re
import urllib.parse
from html import unescape
from html.parser import HTMLParser


class _Tables(HTMLParser):
    """맨 바깥 표만 모은다. 칸 글에는 안쪽 표의 글도 섞인다. 칸 = (글, rowspan, colspan)"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.tables = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'table':
            self.depth += 1
            if self.depth == 1:
                self.tables.append([])
        elif self.depth == 1 and tag == 'tr':
            self.row = []
            self.tables[-1].append(self.row)
        elif self.depth == 1 and tag in ('td', 'th') and self.row is not None:
            self.cell = [[], int(a.get('rowspan') or 1), int(a.get('colspan') or 1)]
            self.row.append(self.cell)
        elif tag == 'br' and self.cell is not None:
            self.cell[0].append('\n')

    def handle_endtag(self, tag):
        if tag == 'table':
            self.depth -= 1
        elif self.depth == 1 and tag in ('td', 'th'):
            self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell[0].append(data)


def tables(md):
    """HTML 표들 → 각 표는 행 목록, 행은 칸 글 목록 (rowspan·colspan 펼침)"""
    p = _Tables()
    p.feed(md)
    out = []
    for t in p.tables:
        grid = []
        pending = {}
        for row in t:
            cells = [(re.sub(r'[ \t]+', ' ', ''.join(c[0])).strip(), c[1], c[2]) for c in row]
            r, col = [], 0
            while cells or pending.get(col):
                if pending.get(col):
                    n, v = pending[col]
                    r.append(v)
                    pending[col] = (n - 1, v) if n > 1 else None
                    col += 1
                    continue
                v, rs, cs = cells.pop(0)
                for _ in range(cs):
                    r.append(v)
                    if rs > 1:
                        pending[col] = (rs - 1, v)
                    col += 1
            grid.append(r)
        out.append(grid)
    return out


def front(md):
    """머리말 값 {title, source, last_modified, license}"""
    m = re.match(r'---\n(.*?)\n---', md, flags=re.S)
    out = {}
    if m:
        for line in m.group(1).split('\n'):
            if ':' in line:
                k, v = line.split(':', 1)
                out[k.strip()] = v.strip().strip('"')
    return out


def categories(md):
    """'분류' 목록의 이름들"""
    m = re.search(r'\n분류\n\n((?:-\s+\[.*\n)+)', md)
    if not m:
        return []
    return [re.sub(r'^-\s+\[([^\]]*)\].*$', r'\1', l.strip()) for l in m.group(1).strip().split('\n')]


def plain(md):
    """본문 글: 링크·그림·각주 표시·HTML을 걷어 낸다"""
    s = re.sub(r'<table>.*?</table>', ' ', md, flags=re.S)
    s = re.sub(r'<details.*?</details>', ' ', s, flags=re.S)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', s)
    s = re.sub(r'\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)', r'\1', s)
    s = re.sub(r'\[\^[^\]]*\]', '', s)
    s = re.sub(r'\[([^\]]*)\]', r'\1', s)
    s = s.replace('\\', '').replace('**', '')
    return unescape(s)


def sections(md):
    """[(제목, 본문 글)] — '## 1\\. 개요' 꼴 제목, 번호는 뗀다"""
    body = md.split('\n분류\n', 1)[-1]
    body = re.sub(r'^\s*(?:-\s+\[.*\n\s*)+', '', body)  # 분류 목록
    out = []
    pos, title = 0, ''
    for m in re.finditer(r'^#{2,6}\s+(?:[\d.\\]+\s*)?(.*?)\s*$', body, flags=re.M):
        out.append((title, plain(body[pos:m.start()])))
        title = plain(m.group(1)).strip()
        pos = m.end()
    out.append((title, plain(body[pos:])))
    return out


def source_url(title):
    return 'https://namu.wiki/w/' + urllib.parse.quote(title)
