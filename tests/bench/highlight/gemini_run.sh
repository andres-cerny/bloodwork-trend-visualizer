#!/usr/bin/env bash
# Arms G and MG on Gemini — PAID. Runs from this checkout (it needs tsx in node_modules);
# BW_ROOT names the checkout that holds data/, samples/ and .env (default: this one).
#
#   tests/bench/highlight/gemini_run.sh validate   # 10 photos, both arms, ~$0.20
#   tests/bench/highlight/gemini_run.sh full       # the rest: flattened views of all 133, plus the 33 unflattened angle/twopage shots
#
# BENCH_MAX_USD is one cap over G and MG together (arm_g.ts sums both arms'
# recorded spend), 3 unless set. Answered views are skipped, so "full" after
# "validate" pays only for what is new.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export BW_ROOT="${BW_ROOT:-$PWD}" BENCH_MAX_USD="${BENCH_MAX_USD:-3}"
set -a; source "$BW_ROOT/.env"; set +a
TSX="node node_modules/tsx/dist/cli.mjs"
TEN=19_10_31_p2_flat,2022_07_01_p1_flat,20_06_08_p2_dark,2023_12_19_p1_dark,19_06_12_p1_glare,2024_06_07_p1_glare,2024_10_25_p1_crop,19_10_31_p1_angle,2023_podzim_krev_p2_angle,19_06_12_p1-2_twopage
case "${1:-}" in
  validate)
    for arm in G MG; do $TSX tests/bench/highlight/arm_g.ts $arm flat --only=$TEN; done
    $TSX tests/bench/highlight/score_arms.ts T M G MG --pair=T+M --pair=T+G --pair=M+G --pair=MG+T --only=$TEN ;;
  full)
    for arm in G MG; do
      $TSX tests/bench/highlight/arm_g.ts $arm flat
      $TSX tests/bench/highlight/arm_g.ts $arm orig-geo
    done
    $TSX tests/bench/highlight/score_arms.ts T M G MG --pair=T+M --pair=T+G --pair=M+G --pair=MG+T ;;
  *) echo "usage: $0 validate|full"; exit 2 ;;
esac
