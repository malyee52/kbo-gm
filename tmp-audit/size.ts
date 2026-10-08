import { loadDataStore } from '../src/data/loadNode';
import { GameSession } from '../src/game/session';
const store = loadDataStore();
let g = GameSession.create(store, { year: 2026, teamIdx: 0, seed: 'size' });
const kb = () => (JSON.stringify(g.toSave()).length / 1024).toFixed(0) + 'KB';
console.log('start', kb());
for (let y = 0; y < 5; y++) {
  g.advance(1000);
  console.log(g.year, 'season end', kb());
  g.beginOffseason();
  let guard = 0;
  while (g.offseason!.stage !== 'ready' && guard++ < 50) {
    if (g.owner.offers?.length) g.acceptOffer(g.owner.offers[0]);
    const st = g.offseason!.stage;
    if (st === 'draft') g.autoDraft(); if (st === 'comp') g.autoComp(); if (st === 'release') g.autoRelease();
    g.nextStage();
  }
  const s = g.toSave();
  console.log(g.year, 'off ready', kb(), 'league', (JSON.stringify(s.league).length/1024).toFixed(0), 'finished', (JSON.stringify(s.finishedLeague).length/1024).toFixed(0), 'news', s.news.length, 'actions', s.actions.length);
  const t0 = Date.now(); g.openNextSeason(); console.log('open ms', Date.now() - t0);
}
