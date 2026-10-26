// Node용 데이터 로더. 검증 스크립트와 테스트에서만 쓴다 (브라우저에서는 loadBrowser.ts).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSeason, type ContractRow, type DataStore, type DefenseData, type DraftRow, type ManagerData, type Meta, type MilitaryRecord, type DefenseAward, type HomeCity, type ParkData, type PitchData, type PlateData, type PlayerMaster, type PpaData, type RawSeason, type RealAward, type LegendTitleRow, type RunningData, type RuleChangeData, type ScheduleData, type SeasonData } from './types';

import { setCalendarSchedule } from './schedule';
export type { DataStore } from './types';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data');

function read<T>(rel: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, rel), 'utf-8')) as T;
}

export function loadDataStore(): DataStore {
  const meta = read<Meta>('meta.json');
  const players = new Map(read<{ players: PlayerMaster[] }>('players.json').players.map((p) => [p.id, p]));
  const cache = new Map<number, SeasonData>();
  const schedule = existsSync(join(DATA_DIR, 'schedule.json')) ? read<ScheduleData>('schedule.json') : undefined;
  setCalendarSchedule(schedule);
  return {
    meta,
    players,
    contracts: read<{ contracts: ContractRow[] }>('contracts.json').contracts,
    drafts: existsSync(join(DATA_DIR, 'drafts.json')) ? read<{ years: Record<string, DraftRow[]> }>('drafts.json').years : undefined,
    traits: existsSync(join(DATA_DIR, 'traits.json')) ? read<{ traits: Record<string, string[]> }>('traits.json').traits : undefined,
    military: existsSync(join(DATA_DIR, 'military.json')) ? read<{ players: Record<string, MilitaryRecord> }>('military.json').players : undefined,
    defenseAwards: existsSync(join(DATA_DIR, 'defense_awards.json')) ? read<{ players: Record<string, DefenseAward[]> }>('defense_awards.json').players : undefined,
    managers: existsSync(join(DATA_DIR, 'managers.json')) ? read<ManagerData>('managers.json') : undefined,
    ruleChanges: existsSync(join(DATA_DIR, 'rule_changes.json')) ? read<RuleChangeData>('rule_changes.json') : undefined,
    homes: existsSync(join(DATA_DIR, 'homes.json')) ? read<{ homes: HomeCity[] }>('homes.json').homes : undefined,
    ppa: existsSync(join(DATA_DIR, 'ppa.json')) ? read<PpaData>('ppa.json') : undefined,
    schedule,
    defense: existsSync(join(DATA_DIR, 'defense.json')) ? read<DefenseData>('defense.json') : undefined,
    pitches: existsSync(join(DATA_DIR, 'pitches.json')) ? read<PitchData>('pitches.json') : undefined,
    plate: existsSync(join(DATA_DIR, 'plate.json')) ? read<PlateData>('plate.json') : undefined,
    parks: existsSync(join(DATA_DIR, 'parks.json')) ? read<ParkData>('parks.json') : undefined,
    running: existsSync(join(DATA_DIR, 'running.json')) ? read<RunningData>('running.json') : undefined,
    realAwards: existsSync(join(DATA_DIR, 'awards.json')) ? read<{ awards: RealAward[] }>('awards.json').awards : undefined,
    legendTitles: existsSync(join(DATA_DIR, 'legend_titles.json')) ? read<{ legends: LegendTitleRow[] }>('legend_titles.json').legends : undefined,
    season(year) {
      if (!meta.years.includes(year)) return undefined;
      let s = cache.get(year);
      if (!s) {
        s = decodeSeason(read<RawSeason>(`seasons/${year}.json`));
        cache.set(year, s);
      }
      return s;
    },
  };
}
