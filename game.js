/* Pure game logic: no DOM access, so it can be tested in Node. */
const TTT = (() => {
  const SIZES = [3, 5, 7];
  const MODES = ["easy", "hard", "friend"];
  // How many in a row you need on each grid.
  const WIN_LENGTH = { 3: 3, 5: 4, 7: 5 };

  const windowCache = {};

  /** Every winning line (as arrays of cell indexes) for a grid size. */
  function windows(size) {
    if (windowCache[size]) return windowCache[size];
    const k = WIN_LENGTH[size];
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const out = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        for (const [dr, dc] of dirs) {
          const er = r + dr * (k - 1);
          const ec = c + dc * (k - 1);
          if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
          const line = [];
          for (let i = 0; i < k; i++) line.push((r + dr * i) * size + (c + dc * i));
          out.push(line);
        }
      }
    }
    return (windowCache[size] = out);
  }

  function findWinner(board, size) {
    for (const line of windows(size)) {
      const m = board[line[0]];
      if (m && line.every((i) => board[i] === m)) return { mark: m, line };
    }
    return null;
  }

  function emptyCells(board) {
    const out = [];
    for (let i = 0; i < board.length; i++) if (!board[i]) out.push(i);
    return out;
  }

  const pick = (list, rng) => list[Math.floor(rng() * list.length)];

  /* ---------- 3x3: perfect play (minimax with alpha-beta) ---------- */
  function minimax(b, size, player, depth, alpha, beta) {
    const w = findWinner(b, size);
    if (w) return w.mark === "O" ? 10 - depth : depth - 10;
    let moved = false;
    let best = player === "O" ? -Infinity : Infinity;
    for (let i = 0; i < b.length; i++) {
      if (b[i]) continue;
      moved = true;
      b[i] = player;
      const s = minimax(b, size, player === "O" ? "X" : "O", depth + 1, alpha, beta);
      b[i] = null;
      if (player === "O") { best = Math.max(best, s); alpha = Math.max(alpha, best); }
      else { best = Math.min(best, s); beta = Math.min(beta, best); }
      if (alpha >= beta) break;
    }
    return moved ? best : 0;
  }

  function perfectMove(b, size, rng) {
    let bestScore = -Infinity;
    let choices = [];
    for (const i of emptyCells(b)) {
      b[i] = "O";
      const s = minimax(b, size, "X", 1, -Infinity, Infinity);
      b[i] = null;
      if (s > bestScore) { bestScore = s; choices = [i]; }
      else if (s === bestScore) choices.push(i);
    }
    return pick(choices, rng);
  }

  /* ---------- 5x5 / 7x7: win, block, then score every cell ---------- */
  function heuristicMove(b, size, rng) {
    const empties = emptyCells(b);

    for (const mark of ["O", "X"]) {            // take a win, else block one
      const hits = empties.filter((i) => {
        b[i] = mark;
        const w = findWinner(b, size);
        b[i] = null;
        return w && w.mark === mark;
      });
      if (hits.length) return pick(hits, rng);
    }

    const WEIGHT = [1, 3, 12, 60, 300, 1500];
    const score = new Array(b.length).fill(0);
    for (const line of windows(size)) {
      let o = 0, x = 0;
      for (const i of line) { if (b[i] === "O") o++; else if (b[i] === "X") x++; }
      if (o && x) continue;                      // dead line
      const val = x === 0 ? WEIGHT[o] * 1.1 : WEIGHT[x];
      for (const i of line) if (!b[i]) score[i] += val;
    }
    const mid = (size - 1) / 2;
    let best = -Infinity;
    let choices = [];
    for (const i of empties) {
      const dist = Math.hypot(Math.floor(i / size) - mid, (i % size) - mid);
      const s = score[i] - dist * 0.1;           // gentle pull to the centre
      if (s > best + 1e-9) { best = s; choices = [i]; }
      else if (Math.abs(s - best) <= 1e-9) choices.push(i);
    }
    return pick(choices, rng);
  }

  /** Pick the computer's move (the computer always plays O). */
  function chooseMove(mode, board, size, rng = Math.random) {
    if (mode === "easy") return pick(emptyCells(board), rng);
    return size === 3 ? perfectMove(board, size, rng) : heuristicMove(board, size, rng);
  }

  /* ---------- score helpers ---------- */
  function tally(entries) {
    const c = { W: 0, L: 0, D: 0 };
    for (const e of entries) if (c[e.r] !== undefined) c[e.r]++;
    return c;
  }

  /** Whole-number percentages that always add up to 100. */
  function percentages(counts) {
    const keys = ["W", "L", "D"];
    const total = keys.reduce((s, k) => s + counts[k], 0);
    const out = { W: 0, L: 0, D: 0 };
    if (!total) return out;
    let used = 0;
    const rest = keys.map((k) => {
      const v = (counts[k] * 100) / total;
      out[k] = Math.floor(v);
      used += out[k];
      return { k, f: v - out[k] };
    });
    rest.sort((a, b) => b.f - a.f).slice(0, 100 - used).forEach((r) => out[r.k]++);
    return out;
  }

  return { SIZES, MODES, WIN_LENGTH, windows, findWinner, emptyCells, chooseMove, tally, percentages };
})();

if (typeof module !== "undefined") module.exports = TTT;
