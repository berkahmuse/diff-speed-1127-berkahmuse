[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/berkahmuse/diff-speed-1127-berkahmuse/rank.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/berkahmuse/diff-speed-1127-berkahmuse/reward.svg)](https://make.fun/c/diff-speed-01-run-20261126)

# diff-speed — a faster drop-in for makefun-diff 1.0.0

Entry for [Diff two texts faster, 27 November 2026](https://make.fun/c/diff-speed-01-run-20261126) on make.fun.

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
what makefun-diff 1.0.0 returns for every input: make.fun's own patch of
`{ old, new }` as one JSON string. Same rule, reimplemented from the spec:
split on `\n` only, keep the common prefix then the common suffix, Myers
greedy search between them with the deletion-preferred tie-break, then the
`makefun-diff/1` patch format with up to 3 context lines around each change
run.

Speed comes from three changes versus the reference, none of which changes
the result:

1. lines are interned to small integers once, so every comparison in the
   search is an `Int32Array` element compare, not a string compare;
2. the search keeps only the furthest-x value per diagonal in typed arrays
   (no path objects, no linked lists, no per-cell allocation), storing one
   row per depth so the exact script can be recovered by backtracking with
   the same tie-break;
3. the patch is emitted as flat string pieces joined once.

`main.ts` is the competition driver: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## Local check

On the kit's practice set (4 cases, 21k–31k lines each) this entry's answers
are byte-identical to the practice reference on all 4 cases, and it runs at
about 3.1x the house baseline's CPU time (median ~550 ms vs ~1700 ms for
`run()` over the set on this machine).
