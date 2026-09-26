#!/usr/bin/env bash
# C4, the Gemini half — PAID (docs/plans/photo-capture.md, C4).
#
#   tests/bench/photo_flat_gemini.sh validate   # 10 pages, one of each condition mix, ≈ USD 0.15
#   tests/bench/photo_flat_gemini.sh full       # the rest of the 133, ≈ USD 1.80 in all
#   tests/bench/photo_flat_gemini.sh score      # free: the before/after tables and the pairs
#
# Run from the checkout that holds tests/bench/results/subagent/photo_flatlit
# (photo_dump.ts writes it into the checkout it runs in). BW_MAIN names the
# checkout with data/ and .env (default: this one). BENCH_MAX_USD is enforced in
# photo_flat_gemini.ts over every call this arm has recorded, 9 unless set.
# Pages already answered are skipped: `full` after `validate` pays only for the rest.
set -euo pipefail
cd "$(dirname "$0")/../.."
export BW_MAIN="${BW_MAIN:-$PWD}" BENCH_MAX_USD="${BENCH_MAX_USD:-9}"
TEN=sim__19_10_31_p2_flat,sim__2022_07_01_p1_flat,sim__20_06_08_p2_dark,sim__2023_12_19_p1_dark,sim__19_06_12_p1_glare,sim__2024_06_07_p1_glare,sim__2024_10_25_p1_crop,sim__19_10_31_p1_angle,sim__2023_podzim_krev_p2_angle,sim__19_06_12_p1-2_twopage
score() {
  BENCH_CLASSES=photo_flatlit npx vitest run --config tests/bench/vitest.config.ts tests/bench/subagent_score_images.bench.ts
}
case "${1:-}" in
  validate|full)
    set -a; source "$BW_MAIN/.env"; set +a
    if [ "$1" = validate ]; then npx vite-node tests/bench/photo_flat_gemini.ts --only=$TEN
    else npx vite-node tests/bench/photo_flat_gemini.ts; fi
    score ;;
  score) score ;;
  *) echo "usage: $0 validate|full|score"; exit 2 ;;
esac
