// diff-speed: a fast drop-in for makefun-diff 1.0.0.
//
// run(input) returns exactly what makefun-diff 1.0.0's diffPatch returns for
// every input: make.fun's own patch of { old, new } as one JSON string.
// Same rule, reimplemented from the spec in the kit (RULES.txt) and the
// reference's header comment: split on "\n" only, keep the common prefix
// then the common suffix, Myers greedy search between them with the
// deletion-preferred tie-break, then the makefun-diff/1 patch format with
// up to 3 context lines around each change run.
//
// Speed comes from three changes versus the reference, none of which
// changes the result:
//  1. lines are interned to small integers once, so every comparison in
//     the search is an Int32Array element compare, not a string compare;
//  2. the search keeps only the furthest-x value per diagonal in typed
//     arrays (no path objects, no linked lists, no per-cell allocation),
//     storing one row per depth so the exact script can be recovered by
//     backtracking with the same tie-break;
//  3. the patch is emitted as flat string pieces joined once.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/**
 * Split a text into its lines (each keeping its "\n", except a last line
 * with none) and intern every distinct line to an integer id. The ids are
 * shared between the two texts of one call, so equal lines get equal ids.
 * Returns { lines, ids } with lines[i] the i-th line string and ids[i] its id.
 */
function tokenize(text, intern) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const count = last + (parts[last] !== '' ? 1 : 0);
  const lines = new Array(count);
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    const line = parts[i] + '\n';
    lines[i] = line;
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[i] = id;
  }
  if (parts[last] !== '') {
    const line = parts[last];
    lines[last] = line;
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[last] = id;
  }
  return { lines, ids };
}

/** Push a run, merging with the previous one when it has the same kind. */
function pushRun(runs, kind, count) {
  if (count <= 0) return;
  const prev = runs[runs.length - 1];
  if (prev !== undefined && prev.kind === kind) prev.count += count;
  else runs.push({ kind, count });
}

/**
 * The edit-script runs of the middle region aIds[0..n) into bIds[0..m),
 * after the common prefix/suffix have been trimmed: [{ kind, count }].
 * Replicates makefun-diff's Myers search exactly: for d = 0, 1, ... and
 * each diagonal k = -d..d step 2, the furthest x reached with d edits,
 * deletion preferred on a tie, no move past either end, snakes followed
 * to the end; the first (d, k) reaching both ends wins.
 */
function editRuns(aIds, bIds, n, m) {
  // One row per depth: rows[d][k + d] is the x (old lines consumed) after
  // the snake on diagonal k with d edits, plus one, so 0 means unreachable
  // and no fill pass is needed (a fresh Int32Array is already zero).
  const rows = [];
  let x0 = 0;
  while (x0 < n && x0 < m && aIds[x0] === bIds[x0]) x0++;
  rows.push(new Int32Array([x0 + 1]));
  if (x0 === n && x0 === m) return [];

  let D = -1;
  let kF = 0;
  outer: for (let d = 1; d <= n + m; d++) {
    const prev = rows[d - 1];
    const row = new Int32Array(2 * d + 1);
    rows[d] = row;
    // Diagonal k's deletion source is prev[k + d - 2], its insertion
    // source prev[k + d]; for interior k both are always in range.
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d) {
        // Insertion only: diagonal k+1 at d-1.
        const s = prev[k + d];
        if (s === 0 || s - 1 - (k + 1) >= m) continue;
        x = s - 1;
      } else if (k === d) {
        // Deletion only: diagonal k-1 at d-1.
        const s = prev[k + d - 2];
        if (s === 0 || s - 1 >= n) continue;
        x = s;
      } else {
        const sDel = prev[k + d - 2];
        const sIns = prev[k + d];
        const xDel = sDel !== 0 && sDel - 1 < n ? sDel : -2;
        const xIns = sIns !== 0 && sIns - 1 - (k + 1) < m ? sIns - 1 : -2;
        if (xDel === -2 && xIns === -2) continue;
        x = xDel >= xIns ? xDel : xIns;
      }
      let y = x - k;
      while (x < n && y < m && aIds[x] === bIds[y]) {
        x++;
        y++;
      }
      row[k + d] = x + 1;
      if (x === n && y === m) {
        D = d;
        kF = k;
        break outer;
      }
    }
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack the winning path with the same tie-break, collecting runs
  // in reverse, then flip them.
  const rev = [];
  let x = rows[D][kF + D] - 1;
  let k = kF;
  for (let d = D; d >= 1; d--) {
    const prev = rows[d - 1];
    let prevK;
    let isDel;
    if (k === -d) {
      prevK = k + 1;
      isDel = false;
    } else if (k === d) {
      prevK = k - 1;
      isDel = true;
    } else {
      const sDel = prev[k + d - 2];
      const sIns = prev[k + d];
      const byDel = sDel !== 0 && sDel - 1 < n ? sDel : -2;
      const byIns = sIns !== 0 && sIns - 1 - (k + 1) < m ? sIns - 1 : -2;
      if (byDel >= byIns) {
        prevK = k - 1;
        isDel = true;
      } else {
        prevK = k + 1;
        isDel = false;
      }
    }
    const xPrev = prev[prevK + (d - 1)] - 1;
    const xStep = isDel ? xPrev + 1 : xPrev;
    pushRun(rev, KEEP, x - xStep);
    pushRun(rev, isDel ? DELETE : INSERT, 1);
    x = xPrev;
    k = prevK;
  }
  pushRun(rev, KEEP, x);
  rev.reverse();
  return rev;
}

/** make.fun's own patch of input.old into input.new. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const intern = new Map();
  const a = tokenize(input.old, intern);
  const b = tokenize(input.new, intern);
  const aLines = a.lines;
  const bLines = b.lines;
  const aIds = a.ids;
  const bIds = b.ids;
  const n = aLines.length;
  const m = bLines.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const mid = editRuns(
    aIds.subarray(prefix, n - suffix),
    bIds.subarray(prefix, m - suffix),
    n - prefix - suffix,
    m - prefix - suffix,
  );
  for (let i = 0; i < mid.length; i++) runs.push(mid[i]);
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between
  // two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) {
        const line = aLines[at];
        if (line.charCodeAt(line.length - 1) === 10) out.push('=', line);
        else out.push('=', line, '\n%\n');
      }
      for (let j = 0; j < c.dels; j++) {
        const line = aLines[c.o + j];
        if (line.charCodeAt(line.length - 1) === 10) out.push('-', line);
        else out.push('-', line, '\n%\n');
      }
      for (let j = 0; j < c.ins; j++) {
        const line = bLines[c.p + j];
        if (line.charCodeAt(line.length - 1) === 10) out.push('+', line);
        else out.push('+', line, '\n%\n');
      }
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) {
      const line = aLines[at];
      if (line.charCodeAt(line.length - 1) === 10) out.push('=', line);
      else out.push('=', line, '\n%\n');
    }
  }
  return out.join('');
}
