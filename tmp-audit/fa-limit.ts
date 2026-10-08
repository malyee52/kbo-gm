// 감사: 한 라운드에 외부 FA 3명 이상 제시하면 한도(2명)를 넘는가
import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
import { MAX_FA_SIGNINGS } from '../src/league/offseason';
const store = loadDataStore();
const FAST = { ...DEFAULT_PARAMS, pilotSeasons: 1 };
const t = store.season(2026)!.teams.findIndex((x) => x.name === '키움');
const g = GameSession.create(store, { year: 2026, teamIdx: t, seed: 'audit-fa' }, FAST);
g.advance(1000);
g.beginOffseason();
const off = g.offseason!;
const ext = off.fa.entries.filter((e) => e.from !== t && e.status === 'open').slice(-6);
for (const e of ext) console.log(e.id, g.leaguePlayer(e.id)!.name, e.ask, g.offerFa(e.id, Math.round(e.ask * 1.3), e.years).message);
g.nextStage();
const signed = off.fa.entries.filter((e) => e.team === t && e.from !== t);
console.log('limit', MAX_FA_SIGNINGS, 'signed external', signed.length, 'signings[t]', off.fa.signings[t]);
