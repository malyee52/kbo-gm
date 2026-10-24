// 모든 시험 파일 앞에서 한 번: 환경 맞춤 디스크 캐시를 끼운다 (tools/calCache.ts, 끄기는 KBO_CAL_CACHE=0).
// 맞춤 값은 캐시를 거쳐도 같으므로(tests/cal-cache.test.ts) 시험 결과는 바뀌지 않고, 같은 월드·시드를 다시 맞추는 시간만 준다.
import { installCalCache } from '../tools/calCache';

installCalCache();
