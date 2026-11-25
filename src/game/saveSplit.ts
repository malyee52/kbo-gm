// 저장 나누기 (2026-11-25 사용자 결정 Q55): 지난 시즌 몫의 자세한 기록을 해마다 따로 떼어 둔다.
//
// 저장 데이터(GameSave, 형식 3)는 그대로이고, 브라우저 저장소에 넣는 방법만 바뀐다 (game/storage.ts).
// - 본 칸(main): 지금 시즌과 그 뒤 몫. 자동 저장마다 다시 쓴다.
// - 기록 칸(detail, 해마다 하나): 지금 시즌 앞 해의 선수 시즌 기록(history)·소식·조작 기록·장부·칭호·시상·올스타·떠난 선수.
//   해가 지나면 거의 바뀌지 않아, 저장소는 글이 바뀐 칸만 다시 쓴다.
// 합치면(joinSave) 원래 저장과 글자 하나까지 같다 (tests/save-split.test.ts). 불러오기·재현·기록 화면은 합친 저장만 본다.
//
// 떼는 규칙: 배열의 앞부분에서 연도가 지금 시즌보다 앞이고 연도가 줄지 않는 동안만 뗀다 (순서를 해 순서로 이어 붙이면 그대로 돌아온다).
// 그 규칙에 맞지 않는 항목부터는 본 칸에 남긴다. 그래서 어떤 저장이든 합치면 같다 (떼는 몫이 줄 뿐).
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
  /** 배열 경로 → 그 해 몫 (앞부분에서 뗀 것) */
  arrays: Record<string, unknown[]>;
  /** 선수 묶음('league' | 'finishedLeague') → 선수 id → 그 해 시즌 기록 줄 */
  history: Record<string, Record<string, unknown[]>>;
}

type Obj = Record<string, unknown>;

/** 떼는 배열과 연도 칸 */
const ARRAYS: { path: string[]; key: string }[] = [
  { path: ['news'], key: 'year' },
  { path: ['actions'], key: 'year' },
  ...['league', 'finishedLeague'].flatMap((root) => [
    { path: [root, 'ledger'], key: 'year' },
    { path: [root, 'titles'], key: 'year' },
    { path: [root, 'awards'], key: 'year' },
    { path: [root, 'allStars'], key: 'year' },
    { path: [root, 'archive'], key: 'lastYear' },
  ]),
];
const PLAYER_ROOTS = ['league', 'finishedLeague'];

function at(o: unknown, path: string[]): unknown {
  let v = o;
  for (const k of path) v = v && typeof v === 'object' ? (v as Obj)[k] : undefined;
  return v;
}

/** 앞에서 뗄 수 있는 길이: 연도가 cut보다 앞이고 줄지 않는 동안 */
function prefixLen(arr: unknown[], key: string, cut: number): number {
  let last = -Infinity;
  let i = 0;
  for (; i < arr.length; i++) {
    const it = arr[i];
    const y = it && typeof it === 'object' ? (it as Obj)[key] : undefined;
    if (typeof y !== 'number' || y >= cut || y < last) break;
    last = y;
  }
  return i;
}

/** 지금 시즌: 이 해 앞의 몫만 뗀다 (오프시즌이면 막 끝난 시즌도 본 칸에) */
function cutOf(save: GameSave): number {
  return save.year;
}

/**
 * 저장을 본 칸과 해마다의 기록 칸으로 나눈다. 넣은 저장은 바꾸지 않는다 (얕게 복사하며 바꾼 곳만 새 객체).
 * 형식 1 저장은 나누지 않는다.
 */
export function splitSave(save: GameSave): { main: GameSave; details: SaveDetail[] } {
  if (save.format !== 3 || typeof save.year !== 'number') return { main: save, details: [] };
  const cut = cutOf(save);
  const byYear = new Map<number, SaveDetail>();
  const detail = (y: number) => {
    let d = byYear.get(y);
    if (!d) byYear.set(y, (d = { year: y, arrays: {}, history: {} }));
    return d;
  };
  const main = { ...save } as unknown as Obj;
  // 바꿀 칸의 부모를 얕게 복사해 둔다
  const own = (path: string[]): Obj | null => {
    let cur = main;
    for (const k of path) {
      const v = cur[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const c = { ...(v as Obj) };
      cur[k] = c;
      cur = c;
    }
    return cur;
  };
  for (const { path, key } of ARRAYS) {
    const arr = at(save, path);
    if (!Array.isArray(arr)) continue;
    const n = prefixLen(arr, key, cut);
    if (!n) continue;
    const parent = own(path.slice(0, -1));
    if (!parent) continue;
    parent[path[path.length - 1]] = arr.slice(n);
    const name = path.join('.');
    for (let i = 0; i < n; i++) {
      const y = (arr[i] as Obj)[key] as number;
      (detail(y).arrays[name] ??= []).push(arr[i]);
    }
  }
  for (const root of PLAYER_ROOTS) {
    const players = at(save, [root, 'players']);
    if (!Array.isArray(players)) continue;
    // 같은 id가 둘이면 합칠 때 누구 것인지 모르니 이 묶음은 떼지 않는다
    const ids = new Set<string>();
    if (players.some((p) => { const id = (p as Obj).id as string; if (ids.has(id)) return true; ids.add(id); return false; })) continue;
    let copied: unknown[] | null = null;
    players.forEach((p, i) => {
      const h = (p as Obj).history;
      if (!Array.isArray(h)) return;
      const n = prefixLen(h, 'year', cut);
      if (!n) return;
      if (!copied) {
        const parent = own([root])!;
        copied = [...players];
        parent.players = copied;
      }
      copied[i] = { ...(p as Obj), history: h.slice(n) };
      const id = (p as Obj).id as string;
      for (let k = 0; k < n; k++) {
        const y = (h[k] as Obj).year as number;
        ((detail(y).history[root] ??= {})[id] ??= []).push(h[k]);
      }
    });
  }
  const details = [...byYear.values()].sort((a, b) => a.year - b.year);
  return { main: main as unknown as GameSave, details };
}

/** 본 칸과 기록 칸을 합쳐 원래 저장으로. 넣은 값은 바꾸지 않는다 */
export function joinSave(main: GameSave, details: readonly SaveDetail[]): GameSave {
  if (!details.length) return main;
  const ds = [...details].sort((a, b) => a.year - b.year);
  const out = { ...main } as unknown as Obj;
  const own = (path: string[]): Obj | null => {
    let cur = out;
    for (const k of path) {
      const v = cur[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const c = { ...(v as Obj) };
      cur[k] = c;
      cur = c;
    }
    return cur;
  };
  for (const { path } of ARRAYS) {
    const name = path.join('.');
    const pre = ds.flatMap((d) => d.arrays[name] ?? []);
    if (!pre.length) continue;
    const parent = own(path.slice(0, -1));
    if (!parent) throw new Error(`저장 기록 칸을 합칠 수 없습니다 (${name})`);
    const rest = parent[path[path.length - 1]];
    parent[path[path.length - 1]] = [...pre, ...(Array.isArray(rest) ? rest : [])];
  }
  for (const root of PLAYER_ROOTS) {
    if (!ds.some((d) => d.history[root])) continue;
    const parent = own([root]);
    const players = parent?.players;
    if (!parent || !Array.isArray(players)) continue;
    parent.players = players.map((p) => {
      const id = (p as Obj).id as string;
      const pre = ds.flatMap((d) => d.history[root]?.[id] ?? []);
      if (!pre.length) return p;
      const h = (p as Obj).history;
      return { ...(p as Obj), history: [...pre, ...(Array.isArray(h) ? h : [])] };
    });
  }
  return out as unknown as GameSave;
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
