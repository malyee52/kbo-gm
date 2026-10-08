import { writeFileSync } from 'node:fs';
import { loadDataStore } from '../src/data/loadNode';
import { GameSession } from '../src/game/session';
const store = loadDataStore();
const g = GameSession.create(store, { year: 2012, teamIdx: 0, seed: 'exp-ui' });
g.advance(1000); g.beginOffseason();
g.nextStage(); // FA 1라운드 마감
console.log('stage', g.offseason!.stage, 'round', g.offseason!.fa.round, 'signed to NC', g.offseason!.fa.entries.filter((e) => e.team === 8).length);
writeFileSync('public/audit-save.json', JSON.stringify({ slot: '저장 3', savedAt: new Date().toISOString(), year: g.year, teamName: g.league.teams[g.teamIdx].name, day: g.day, summary: 'audit', data: g.toSave() }));
