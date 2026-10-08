import { loadDataStore } from '../src/data/loadNode';
import { DEFAULT_PARAMS } from '../src/engine';
import { GameSession } from '../src/game/session';
const store = loadDataStore();
const g = GameSession.create(store, { year: 2012, teamIdx: 0, seed: 'exp-ui' }, { ...DEFAULT_PARAMS, pilotSeasons: 1 });
g.advance(1000); g.beginOffseason();
const off = g.offseason!;
const nWorld = g.world.teams.length;
console.log('world teams', nWorld, 'league teams', g.league.teams.length, g.league.teams.map((t) => t.name).join(','));
const faToNew = off.fa.entries.filter((e) => e.team !== undefined && e.team >= nWorld);
let guard = 0;
while (off.stage !== 'draft' && guard++ < 20) { if (off.stage === 'comp') g.autoComp(); g.nextStage(); }
const faToNew2 = g.offseason!.fa.entries.filter((e) => e.team !== undefined && e.team >= nWorld);
console.log('FA signed to new team:', faToNew2.map((e) => g.leaguePlayer(e.id)?.name));
const d = g.offseason!.draft!;
console.log('stage', g.offseason!.stage, 'picks so far', d.picks.length, 'last 8 teams', d.picks.slice(-8).map((p) => p.team), 'new team picks in last 8:', d.picks.slice(-8).some((p) => p.team >= nWorld));
console.log('foreign signed by new team', g.offseason!.log.filter((l) => l.stage === 'foreign' && l.text.startsWith(g.league.teams[nWorld].name)).length);
