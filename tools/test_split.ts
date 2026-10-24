// 무거운 시험 파일 목록 만들기: vitest JSON 보고서에서 파일별 걸린 시간을 읽어 기준(초) 이상인 파일을 tests/heavy.json에 쓴다.
// 빠른 묶음(npm run test:fast, vitest.fast.config.ts)은 이 목록을 뺀 나머지다. 새 시험 파일은 목록을 다시 만들기 전까지 빠른 묶음에 든다.
// 사용법:  npx vitest run --reporter=json --outputFile=reports/test-times.json
//          npx tsx tools/test_split.ts reports/test-times.json [--over 60]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const file = process.argv[2];
if (!file) throw new Error('vitest JSON 보고서 경로를 주세요');
const i = process.argv.indexOf('--over');
const over = i >= 0 ? Number(process.argv[i + 1]) : 60;
const report = JSON.parse(readFileSync(file, 'utf-8')) as { testResults: { name: string; startTime: number; endTime: number }[] };
const rows = report.testResults.map((r) => ({ file: basename(r.name), sec: Math.round((r.endTime - r.startTime) / 1000) }));
const heavy = rows.filter((r) => r.sec >= over).sort((a, b) => b.sec - a.sec);
writeFileSync('tests/heavy.json', JSON.stringify({
  note: `tools/test_split.ts로 만듦: 전체 시험에서 ${over}초 이상 걸린 파일 (빠른 묶음에서 뺀다). seconds는 그때 걸린 초 (다른 작업과 함께 돌린 PC 기준)`,
  over,
  files: heavy.map((r) => r.file),
  seconds: Object.fromEntries(heavy.map((r) => [r.file, r.sec])),
}, null, 2) + '\n');
console.log(`무거운 파일 ${heavy.length}개 / 전체 ${rows.length}개 (기준 ${over}초)`);
