#!/bin/bash
# 10구단 100시즌 평가 판을 heavy2.sh 줄로 돌린다 (tools/eval100.ts). 사용: bash reports/eval100/run_all.sh [시즌 수] [시드 꼬리]
N=${1:-100}; TAIL=${2:-a}
cd "$(dirname "$0")/../.."
for T in KT 삼성 KIA LG 두산 SSG NC 롯데 한화 키움; do
  bash C:/Users/ararp/kbo-gm-raw/heavy2.sh npx tsx tools/eval100.ts --team "$T" --seed "eval-$T-$TAIL" --seasons "$N" --out "reports/eval100/raw/$T-$TAIL.json" > "reports/eval100/log/$T-$TAIL.log" 2>&1 &
  sleep 20
done
wait
