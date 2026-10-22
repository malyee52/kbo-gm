# -*- coding: utf-8 -*-
"""2단계: 짝이 맞은 한국어 위키백과 문서 원문을 받아 캐시한다 (이미 받은 것은 건너뜀).

  python tools/wiki/s2_fetch.py [--sample]

Action API로 50개씩 묶어 직렬로 받는다 (규칙은 common.py에 고정). 원문은 ~/kbo-gm-raw/wiki/pages/에만 둔다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402


def main():
    C.stdout_utf8()
    sample = '--sample' in sys.argv
    out_dir, _ = C.out_paths(sample)
    pairs = [r for r in C.read_csv(out_dir / '짝.csv') if r['위키 제목']]
    titles = [r['위키 제목'] for r in pairs]
    http = C.Polite()
    C.log(f'[2단계] 위키백과 원문 받기: 문서 {len(titles)}쪽')
    pages = C.fetch_pages(http, titles, '선수 문서')
    missing = [t for t, r in pages.items() if r.get('missing') or not r.get('content')]
    ok = len(pages) - len(missing)
    if missing:
        C.write_csv(C.RAW_NOTE / ('견본' if sample else '') / '위키_못받음.csv', ['제목'], [[t] for t in missing])
    C.log(f'[2단계 끝] 문서 {ok}쪽 있음 · 없음 {len(missing)}쪽 · 요청 {http.count}번')


if __name__ == '__main__':
    main()
