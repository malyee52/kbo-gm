// 저장 나누기 (2026-11-25 사용자 결정 Q55): 지난 시즌 몫의 자세한 기록을 해마다 따로 떼어 둔다.
//
// 저장 데이터(GameSave, 형식 3)는 그대로이고, 브라우저 저장소에 넣는 방법만 바뀐다 (game/storage.ts).
// - 본 칸(main): 지금 시즌과 그 뒤 몫, 그리고 연도로 가를 수 없는 상태. 자동 저장마다 다시 쓴다.
// - 기록 칸(detail, 해마다 하나): 지금 시즌보다 앞 해의 항목 (아래 PATHS: 선수 시즌 기록·부상 이력, 소식, 조작 기록, 장부,
//   칭호, 시상, 올스타, 떠난 선수·은퇴, 이벤트 기록, 구단 재정 결산·구단주 면담, 팬 기록, 연표, 시장 이동, AI 트레이드, 감독 교체). 해가 지나면 거의 바뀌지 않아
//   저장소는 글이 바뀐 칸만 다시 쓴다.
// 뗀 항목은 배열 안의 원래 자리(번호)와 함께 둔다. 합칠 때(joinSave) 그 자리에 다시 끼우므로 순서가 섞인 배열도 원래 저장과
// 글자 하나까지 같다 (tests/heavy-save.test.ts). 불러오기·재현·기록 화면은 합친 저장만 본다.
import type { GameSave } from './session';

/** 나눈 저장의 표지 (저장 기록에 붙는다). 해마다 기록 칸의 지문 */
export interface SplitMark {
  v: 1;
  /** 기록 칸 연도 → 지문 (detailHash) */
  years: Record<string, string>;
}

/** 해마다의 기록 칸 */
export interface SaveDetail {
  year: number;
  /** 배열 위치(JSON 글로 쓴 경로 조각) → 뗀 항목과 원래 자리 번호 (오름차순) */
  arrays: Record<string, { at: number[]; items: unknown[] }>;
}

type Obj = Record<string, unknown>;

/**
 * 떼는 배열과 연도 칸. '*'는 배열의 모든 원소: 원소마다 id가 있고 겹치지 않으면 id로(선수), 아니면 번호로(구단) 가리킨다.
 * 새 해마다 쌓이는 배열을 더하면 여기 적는다.
 */
const PATHS: { path: string[]; key: string }[] = [
  { path: ['news'], key: 'year' },
  { path: ['actions'], key: 'year' },
  ...['league', 'finishedLeague'].flatMap((root) => [
    { path: [root, 'players', '*', 'history'], key: 'year' },
    { path: [root, 'players', '*', 'injuries'], key: 'year' },
    { path: [root, 'ledger'], key: 'year' },
    { path: [root, 'titles'], key: 'year' },
    { path: [root, 'awards'], key: 'year' },
    { path: [root, 'allStars'], key: 'year' },
    { path: [root, 'archive'], key: 'lastYear' },
    { path: [root, 'retired'], key: 'year' },
    { path: [root, 'events', 'log'], key: 'year' },
    { path: [root, 'events', 'buffs'], key: 'year' },
    { path: [root, 'events', 'forms'], key: 'year' },
    { path: [root, 'events', 'conds'], key: 'year' },
    { path: [root, 'finance', '*', 'history'], key: 'year' },
    { path: [root, 'finance', '*', 'meetings'], key: 'year' },
    { path: [root, 'fans', '*', 'log'], key: 'year' },
    { path: [root, 'yearbook'], key: 'year' },
    { path: [root, 'marketMoves'], key: 'year' },
    { path: [root, 'aiTrades'], key: 'year' },
    { path: [root, 'managerLog'], key: 'year' },
  ]),
];

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** 원소를 id로 가리킬 수 있나 (모두 글자 id가 있고 겹치지 않음) */
function byId(arr: unknown[]): boolean {
  const seen = new Set<string>();
  for (const el of arr) {
    const id = isObj(el) ? el.id : undefined;
    if (typeof id !== 'string' || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * path를 따라 끝의 배열마다 f(배열, 위치)를 부르고, f가 새 배열을 주면 그 길의 부모만 얕게 복사해 바꾼다 (넣은 값은 그대로).
 * 위치는 지나온 조각 목록 (원소는 '@id' 또는 번호 글자)
 */
function mapArrays(node: unknown, path: string[], i: number, loc: string[], f: (arr: unknown[], loc: string[]) => unknown[] | null): unknown {
  if (i === path.length) return Array.isArray(node) ? f(node, loc) ?? node : node;
  const seg = path[i];
  if (seg === '*') {
    if (!Array.isArray(node)) return node;
    const ids = byId(node);
    let out: unknown[] | null = null;
    node.forEach((el, k) => {
      const r = mapArrays(el, path, i + 1, [...loc, ids ? `@${(el as Obj).id as string}` : `${k}`], f);
      if (r !== el) (out ??= [...node])[k] = r;
    });
    return out ?? node;
  }
  if (!isObj(node) || node[seg] === undefined) return node;
  const child = node[seg];
  const r = mapArrays(child, path, i + 1, [...loc, seg], f);
  return r === child ? node : { ...node, [seg]: r };
}

/**
 * 저장을 본 칸과 해마다의 기록 칸으로 나눈다. 넣은 저장은 바꾸지 않는다 (바꾼 길만 새 객체).
 * 형식 1 저장과 연도가 없는 저장은 나누지 않는다.
 */
export function splitSave(save: GameSave): { main: GameSave; details: SaveDetail[] } {
  if (save.format !== 3 || typeof save.year !== 'number') return { main: save, details: [] };
  // 지금 시즌 앞의 해만 뗀다 (오프시즌이면 막 끝난 시즌도 본 칸에)
  const cut = save.year;
  const byYear = new Map<number, SaveDetail>();
  let main: unknown = save;
  for (const { path, key } of PATHS) {
    main = mapArrays(main, path, 0, [], (arr, loc) => {
      const rest: unknown[] = [];
      let took = false;
      const name = JSON.stringify(loc);
      arr.forEach((it, k) => {
        const y = isObj(it) ? it[key] : undefined;
        if (typeof y !== 'number' || y >= cut) { rest.push(it); return; }
        took = true;
        let d = byYear.get(y);
        if (!d) byYear.set(y, (d = { year: y, arrays: {} }));
        const slot = (d.arrays[name] ??= { at: [], items: [] });
        slot.at.push(k);
        slot.items.push(it);
      });
      return took ? rest : null;
    });
  }
  const details = [...byYear.values()].sort((a, b) => a.year - b.year);
  return { main: main as GameSave, details };
}

/** 본 칸과 기록 칸을 합쳐 원래 저장으로. 넣은 값은 바꾸지 않는다. 본 칸에 없는 위치(예: 그 뒤 빠진 선수)의 몫은 버린다 */
export function joinSave(main: GameSave, details: readonly SaveDetail[]): GameSave {
  if (!details.length) return main;
  // 위치 → (자리 번호 → 항목)
  const want = new Map<string, Map<number, unknown>>();
  for (const d of details) {
    for (const [name, { at, items }] of Object.entries(d.arrays)) {
      let m = want.get(name);
      if (!m) want.set(name, (m = new Map()));
      at.forEach((k, j) => {
        if (m!.has(k)) throw new Error('저장 기록 칸이 겹칩니다 (같은 자리에 두 항목)');
        m!.set(k, items[j]);
      });
    }
  }
  let out: unknown = main;
  for (const { path } of PATHS) {
    out = mapArrays(out, path, 0, [], (arr, loc) => {
      const m = want.get(JSON.stringify(loc));
      if (!m) return null;
      const total = arr.length + m.size;
      const res: unknown[] = [];
      let r = 0;
      for (let k = 0; k < total; k++) {
        if (m.has(k)) res.push(m.get(k));
        else if (r < arr.length) res.push(arr[r++]);
        else throw new Error('저장 기록 칸의 자리가 맞지 않습니다');
      }
      return res;
    });
  }
  return out as GameSave;
}

/** 기록 칸의 지문 (글 그대로의 32비트 해시 둘 + 길이). 저장소가 바뀐 칸만 다시 쓰고, 불러올 때 칸이 맞는지 본다 */
export function detailHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${text.length}`;
}
