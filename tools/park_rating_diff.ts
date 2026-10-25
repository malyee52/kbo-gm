// 옛 해 구장 대리값(구장효과 기획안 P5)이 능력에 주는 영향: 같은 해 월드를 구장 제원(parks.json) 없이(= P5 전, 2015년 이전 중립)와
// 있이 만들어 능력을 "전 → 후"로 견준다. 그 해 직전 시즌 기록이 많은 타자·투수를 구단마다 몇 명씩.
// 타자 홈런·2루타는 리그 대비 배율(1 = 리그 평균), 투수는 피홈런·피안타 배율 (작을수록 좋음), 득점 가치는 batValue·pitValue.
// 사용법:  npx tsx tools/park_rating_diff.ts [--cases 2010:LG,2010:두산,1996:LG,1986:롯데,1998:쌍방울,2001:현대계,2003:SSG] [--n 4] [--out reports/park-rating-diff.md]
import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { batValue, pitValue, worldForYear } from '../src/engine';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const store = loadDataStore();
const cases = (arg('cases') ?? '2010:LG,2010:두산,1996:LG,1986:롯데,1998:쌍방울,2001:현대계,2003:SSG').split(',').map((c) => c.split(':'));
const n = Number(arg('n') ?? 4);
const out = arg('out');
const lines: string[] = [];
const emit = (s: string) => { lines.push(s); console.log(s); };
const f3 = (x: number) => x.toFixed(3);
const f1 = (x: number) => x.toFixed(4);

emit('| 시작 해 | 계보 | 선수 | 타·투 | 홈런 배율 | 2루타 배율 | 안타·피안타 배율 | 득점 가치 |');
emit('|---|---|---|---|---|---|---|---|');
const worlds = new Map<number, [ReturnType<typeof worldForYear>, ReturnType<typeof worldForYear>]>();
for (const [ys, fr] of cases) {
  const y = Number(ys);
  if (!worlds.has(y)) worlds.set(y, [worldForYear({ ...store, parks: undefined }, y), worldForYear(store, y)]);
  const [before, after] = worlds.get(y)!;
  const prev = store.season(y - 1);
  const team = prev?.teams.find((t) => t.franchise === fr)?.name;
  const lg = after.league;
  if (!prev || !team) continue;
  const bats = prev.bat.filter((r) => r.team === team).sort((a, b) => b.pa - a.pa).slice(0, n).map((r) => r.id);
  const pits = prev.pit.filter((r) => r.team === team).sort((a, b) => b.tbf - a.tbf).slice(0, Math.max(1, n >> 1)).map((r) => r.id);
  for (const id of bats) {
    const b = before.players.find((p) => p.id === id && p.bat);
    const a = after.players.find((p) => p.id === id && p.bat);
    if (!a || !b) continue;
    emit(`| ${y} | ${fr} | ${a.name} | 타 | ${f3(b.bat!.hr)} → ${f3(a.bat!.hr)} | ${f3(b.bat!.d2)} → ${f3(a.bat!.d2)} | ${f3(b.bat!.s1)} → ${f3(a.bat!.s1)} | ${f1(batValue(b.bat!, lg))} → ${f1(batValue(a.bat!, lg))} |`);
  }
  for (const id of pits) {
    const b = before.players.find((p) => p.id === id && p.pit);
    const a = after.players.find((p) => p.id === id && p.pit);
    if (!a || !b) continue;
    emit(`| ${y} | ${fr} | ${a.name} | 투 | ${f3(b.pit!.hr)} → ${f3(a.pit!.hr)} | - | ${f3(b.pit!.hit)} → ${f3(a.pit!.hit)} | ${f1(pitValue(b.pit!, lg))} → ${f1(pitValue(a.pit!, lg))} |`);
  }
}
if (out) writeFileSync(out, ['# 옛 해 구장 대리값의 능력 영향 (전 → 후)', '', `\`npx tsx tools/park_rating_diff.ts --cases ${cases.map((c) => c.join(':')).join(',')} --n ${n}\``, '', ...lines, ''].join('\n'));

