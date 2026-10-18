(() => {
  const { SIZES, MODES, WIN_LENGTH, findWinner, emptyCells, chooseMove, tally, percentages } = TTT;

  // Note: the human-vs-human mode is stored as "friend" (so saved scores from
  // earlier versions still match). It is shown to the user as "Human".
  const THEMES = ["classic", "schoolbook", "dark"];
  const FONTS = ["standard", "modern"];
  const DEFAULTS = { mode: "hard", size: 3, theme: "classic", font: "standard" };
  const MODE_LABELS = { easy: "Easy computer", hard: "Hard computer", friend: "Human" };
  const MODE_NAMES = { easy: "Easy computer", hard: "Hard computer", friend: "Human opponent" };
  const MAX_HISTORY = 20;
  const AI_DELAY = 450;
  const REPLAY_DELAY = 1000;

  const $ = (id) => document.getElementById(id);
  const boardEl = $("board");
  const statusEl = $("status");
  const captionEl = $("caption");
  const goalEl = $("goal");
  const tallyEl = $("tally");
  const newBtn = $("new-game");
  const replayBtn = $("replay");

  // ---------- state ----------
  let settings = { ...DEFAULTS };
  let history = {};          // { "hard-3": [{ r: "W"|"L"|"D", t: ms }, ...up to 20] }
  let lastGame = null;       // { size, mode, moves: [cellIndex...], result }
  let game = null;           // the live game
  let replay = null;         // { ...lastGame, step, done } while replaying
  let aiTimer = null;
  let replayTimer = null;
  let freshCell = null;      // cell whose mark should animate on next render
  const filters = { size: "all", mode: "all" };

  // ---------- storage (chrome.storage in the extension, localStorage as a fallback) ----------
  const hasChrome = () => typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  const store = {
    async get(keys) {
      if (hasChrome()) return chrome.storage.local.get(keys);
      const out = {};
      for (const k of keys) {
        try {
          const v = localStorage.getItem("ttt." + k);
          if (v !== null) out[k] = JSON.parse(v);
        } catch (_) {}
      }
      return out;
    },
    async set(obj) {
      if (hasChrome()) return chrome.storage.local.set(obj);
      for (const [k, v] of Object.entries(obj)) {
        try { localStorage.setItem("ttt." + k, JSON.stringify(v)); } catch (_) {}
      }
    },
  };
  const persist = (obj) => store.set(obj).catch((e) => console.warn("Could not save", e));

  // ---------- loading and validating saved data ----------
  function cleanSettings(s) {
    s = s || {};
    const theme = s.theme === "default" ? "schoolbook" : s.theme;   // 0.0.2 called schoolbook "default"
    return {
      mode: MODES.includes(s.mode) ? s.mode : DEFAULTS.mode,
      size: SIZES.includes(Number(s.size)) ? Number(s.size) : DEFAULTS.size,
      theme: THEMES.includes(theme) ? theme : DEFAULTS.theme,
      font: FONTS.includes(s.font) ? s.font : DEFAULTS.font,
    };
  }

  function cleanHistory(h) {
    const out = {};
    if (!h || typeof h !== "object") return out;
    for (const [key, arr] of Object.entries(h)) {
      const m = /^(easy|hard|friend)-(3|5|7)$/.exec(key);
      if (!m || !Array.isArray(arr)) continue;
      out[key] = arr
        .filter((e) => e && ["W", "L", "D"].includes(e.r))
        .map((e) => ({ r: e.r, t: Number(e.t) || 0 }))
        .slice(-MAX_HISTORY);
    }
    return out;
  }

  function cleanLastGame(g) {
    if (!g || !SIZES.includes(g.size) || !MODES.includes(g.mode) || !Array.isArray(g.moves)) return null;
    const cells = g.size * g.size;
    const ok = g.moves.length > 0 && g.moves.length <= cells &&
      g.moves.every((m) => Number.isInteger(m) && m >= 0 && m < cells) &&
      new Set(g.moves).size === g.moves.length;
    return ok ? { size: g.size, mode: g.mode, moves: g.moves.slice(), result: g.result } : null;
  }

  // ---------- helpers ----------
  const gridName = (n) => `${n}×${n}`;
  const caption = (mode, size) => `${MODE_NAMES[mode]} on ${gridName(size)}`;

  function applyLook() {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.font = settings.font;
  }

  function resultText(mode, mark) {
    if (mark === "draw") return "It’s a draw.";
    if (mode === "friend") return `${mark} wins!`;
    return mark === "X" ? "You win!" : "Computer wins.";
  }

  /** A pointer showing the mark about to be played, in the current theme's colours. */
  function cursorFor(mark) {
    const css = getComputedStyle(document.documentElement);
    const colour = css.getPropertyValue(mark === "X" ? "--x" : "--o").trim();
    const halo = css.getPropertyValue("--surface").trim();
    const shape = mark === "X"
      ? '<path d="M8 8L24 24M24 8L8 24"/>'
      : '<circle cx="16" cy="16" r="9"/>';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke-linecap="round">' +
      `<g stroke="${halo}" stroke-width="8">${shape}</g><g stroke="${colour}" stroke-width="4">${shape}</g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, pointer`;
  }

  // ---------- the live game ----------
  function newGame() {
    clearTimeout(aiTimer);
    game = {
      size: settings.size,
      mode: settings.mode,
      board: Array(settings.size * settings.size).fill(null),
      turn: "X",
      over: false,
      winLine: null,
      result: null,
      moves: [],
      busy: false,
    };
    freshCell = null;
  }

  function play(i) {
    const g = game;
    if (g.over || g.busy || g.board[i]) return;
    g.board[i] = g.turn;
    g.moves.push(i);
    freshCell = i;

    const w = findWinner(g.board, g.size);
    if (w) {
      g.over = true;
      g.winLine = w.line;
      g.result = w.mark;
      finishGame(w.mark === "X" ? "W" : "L", w.mark);
    } else if (!emptyCells(g.board).length) {
      g.over = true;
      g.result = "draw";
      finishGame("D", "draw");
    } else {
      g.turn = g.turn === "X" ? "O" : "X";
    }
    render();

    if (!g.over && g.mode !== "friend" && g.turn === "O") {
      g.busy = true;
      render();
      aiTimer = setTimeout(() => {
        g.busy = false;
        play(chooseMove(g.mode, g.board, g.size));
      }, AI_DELAY);
    }
  }

  function finishGame(r, resultMark) {
    const key = `${game.mode}-${game.size}`;
    history[key] = (history[key] || []).concat({ r, t: Date.now() }).slice(-MAX_HISTORY);
    lastGame = { size: game.size, mode: game.mode, moves: game.moves.slice(), result: resultMark };
    persist({ history, lastGame });
  }

  // ---------- replay ----------
  function startReplay() {
    if (!lastGame || (game && game.busy)) return;
    clearTimeout(replayTimer);
    replay = { ...lastGame, step: 0, done: false };
    freshCell = null;
    render();
    scheduleReplayStep();
  }

  function scheduleReplayStep() {
    replayTimer = setTimeout(() => {
      if (!replay) return;
      replay.step++;
      freshCell = replay.moves[replay.step - 1];
      if (replay.step >= replay.moves.length) replay.done = true;
      else scheduleReplayStep();
      render();
    }, REPLAY_DELAY);
  }

  function exitReplay() {
    clearTimeout(replayTimer);
    replay = null;
  }

  function replayView() {
    const r = replay;
    const board = Array(r.size * r.size).fill(null);
    for (let s = 0; s < r.step; s++) board[r.moves[s]] = s % 2 === 0 ? "X" : "O";
    const w = r.done ? findWinner(board, r.size) : null;
    let status;
    if (r.done) status = `Replay finished. ${resultText(r.mode, r.result)}`;
    else if (r.step === 0) status = `Replay: ${r.moves.length} moves`;
    else status = `Replay: move ${r.step} of ${r.moves.length}`;
    return {
      size: r.size, board, winLine: w ? w.line : null, interactive: false,
      status, caption: `Replay of ${caption(r.mode, r.size)}`,
    };
  }

  function liveView() {
    const g = game;
    let status;
    if (g.over) status = resultText(g.mode, g.result);
    else if (g.mode === "friend") status = `${g.turn}’s turn`;
    else status = g.turn === "X" ? "Your turn (X)" : "Computer is thinking…";
    return {
      size: g.size, board: g.board, winLine: g.winLine, interactive: !g.over && !g.busy,
      status, caption: caption(g.mode, g.size),
    };
  }

  // ---------- rendering: play tab ----------
  const X_SVG =
    '<svg class="x" viewBox="0 0 100 100" aria-hidden="true">' +
    '<path d="M12 12 L88 88" pathLength="1"/><path d="M88 12 L12 88" pathLength="1"/></svg>';
  const O_SVG =
    '<svg class="o" viewBox="0 0 100 100" aria-hidden="true">' +
    '<circle cx="50" cy="50" r="38" pathLength="1" transform="rotate(-90 50 50)"/></svg>';

  function renderBoard(v) {
    const n = v.size;
    boardEl.innerHTML = "";
    boardEl.dataset.n = n;
    boardEl.style.setProperty("--n", n);
    // While it's someone's turn, the pointer shows the mark they're about to play.
    boardEl.style.cursor = v.interactive ? cursorFor(game.turn) : "";
    v.board.forEach((mark, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      if (i % n === n - 1) cell.classList.add("edge-r");
      if (Math.floor(i / n) === n - 1) cell.classList.add("edge-b");
      cell.setAttribute("aria-label", `Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}, ${mark || "empty"}`);
      if (mark) {
        cell.innerHTML = mark === "X" ? X_SVG : O_SVG;
        if (i === freshCell) cell.classList.add("fresh");
      }
      if (v.winLine && v.winLine.includes(i)) cell.classList.add("win");
      cell.disabled = !v.interactive || !!mark;
      cell.addEventListener("click", () => play(i));
      boardEl.appendChild(cell);
    });
    freshCell = null;   // animate each new mark once only
  }

  function renderTally() {
    const g = game;
    const c = tally(history[`${g.mode}-${g.size}`] || []);
    const names = g.mode === "friend"
      ? { W: "X won", D: "Drawn", L: "O won" }
      : { W: "Won", D: "Drawn", L: "Lost" };
    tallyEl.innerHTML = ["W", "D", "L"]
      .map((k) => `<div class="t-${k}"><b>${c[k]}</b>${names[k]}</div>`)
      .join("");
  }

  function renderPlay() {
    const v = replay ? replayView() : liveView();
    renderBoard(v);
    statusEl.textContent = v.status;
    captionEl.textContent = v.caption;
    goalEl.textContent = `Get ${WIN_LENGTH[v.size]} in a row to win`;
    renderTally();
    replayBtn.textContent = replay ? "Exit replay" : "Replay last game";
    replayBtn.disabled = !replay && (!lastGame || game.busy);
  }

  // ---------- rendering: pie charts ----------
  function pt(deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [(50 + 46 * Math.cos(rad)).toFixed(2), (50 + 46 * Math.sin(rad)).toFixed(2)];
  }

  function pieInner(c, total) {
    if (!total) {
      return '<circle class="pie-empty" cx="50" cy="50" r="45"/>' +
        '<text class="pie-text" x="50" y="54" text-anchor="middle">No games</text>';
    }
    const keys = ["W", "L", "D"].filter((k) => c[k] > 0);
    if (keys.length === 1) return `<circle class="fill-${keys[0]}" cx="50" cy="50" r="46"/>`;
    let angle = 0;
    return keys.map((k) => {
      const sweep = (c[k] / total) * 360;
      const [x0, y0] = pt(angle);
      const [x1, y1] = pt(angle + sweep);
      angle += sweep;
      return `<path class="fill-${k}" d="M50 50 L${x0} ${y0} A46 46 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1} Z"/>`;
    }).join("");
  }

  function statsMarkup(c, human) {
    const total = c.W + c.L + c.D;
    const pct = percentages(c);
    const names = human ? { W: "X won", L: "O won", D: "Drawn" } : { W: "Won", L: "Lost", D: "Drawn" };
    const summary = total
      ? ["W", "L", "D"].map((k) => `${names[k]} ${pct[k]}%`).join(", ")
      : "No games played yet";
    const legend = ["W", "L", "D"].map((k) =>
      `<li><span class="sw sw-${k}"></span>${names[k]} <span class="pct">${pct[k]}%</span> <span class="n">(${c[k]})</span></li>`
    ).join("");
    return `<div class="stats"><svg class="pie" viewBox="0 0 100 100" role="img" aria-label="${summary}">` +
      `${pieInner(c, total)}</svg><ul class="legend">${legend}</ul></div>`;
  }

  // ---------- options tab ----------
  function radioGroup(name, legend, options, current, onChange) {
    const fs = document.createElement("fieldset");
    fs.className = "group";
    const lg = document.createElement("legend");
    lg.textContent = legend;
    fs.appendChild(lg);
    const row = document.createElement("div");
    row.className = "pills";
    for (const o of options) {
      const id = `${name}-${o.value}`;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.id = id;
      input.value = o.value;
      input.checked = String(o.value) === String(current);
      input.addEventListener("change", () => { if (input.checked) onChange(o.value); });
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = o.label;
      row.append(input, label);
    }
    fs.appendChild(row);
    return fs;
  }

  function updateSetting(key, value) {
    if (settings[key] === value) return;
    settings[key] = value;
    persist({ settings });          // saved immediately
    if (key === "theme" || key === "font") {
      applyLook();
    } else {
      exitReplay();
      newGame();
    }
    renderAll();
  }

  function buildOptions() {
    $("options-groups").append(
      radioGroup("opt-mode", "Opponent",
        MODES.map((m) => ({ value: m, label: MODE_LABELS[m] })),
        settings.mode, (v) => updateSetting("mode", v)),
      radioGroup("opt-size", "Grid size",
        SIZES.map((s) => ({ value: s, label: gridName(s) })),
        settings.size, (v) => updateSetting("size", Number(v))),
      radioGroup("opt-theme", "Theme",
        [{ value: "classic", label: "Classic blue" }, { value: "schoolbook", label: "Schoolbook" }, { value: "dark", label: "Dark" }],
        settings.theme, (v) => updateSetting("theme", v)),
      radioGroup("opt-font", "Font",
        [{ value: "standard", label: "Standard" }, { value: "modern", label: "Poppins" }],
        settings.font, (v) => updateSetting("font", v))
    );
  }

  function renderOptions() {
    $("win-hint").textContent = `Win by getting ${WIN_LENGTH[settings.size]} in a row on a ${gridName(settings.size)} grid.`;
    const c = tally(history[`${settings.mode}-${settings.size}`] || []);
    $("options-stats").innerHTML = statsMarkup(c, settings.mode === "friend");
  }

  // ---------- history tab ----------
  function entriesFor(mode, size) {
    const out = [];
    for (const [key, arr] of Object.entries(history)) {
      const [m, s] = key.split("-");
      if ((mode === "all" || mode === m) && (size === "all" || size === s)) {
        for (const e of arr) out.push({ ...e, mode: m, size: s });
      }
    }
    return out;
  }

  function buildHistory() {
    $("history-matrix").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-kind]");
      if (!b) return;
      const kind = b.dataset.kind;
      if (kind === "row" || kind === "cell") filters.mode = b.dataset.mode;
      if (kind === "col" || kind === "cell") filters.size = b.dataset.size;
      const key = b.dataset.key;
      renderHistory();
      const again = $("history-matrix").querySelector(`[data-key="${key}"]`);
      if (again) again.focus();    // keep keyboard position after the redraw
    });

    const clearBtn = $("clear-scores");
    let armed = false;
    let armTimer = null;
    const disarm = () => {
      armed = false;
      clearTimeout(armTimer);
      clearBtn.classList.remove("armed");
      clearBtn.textContent = "Clear all scores";
    };
    clearBtn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        clearBtn.classList.add("armed");
        clearBtn.textContent = "Tap again to confirm";
        armTimer = setTimeout(disarm, 3000);
        return;
      }
      disarm();
      history = {};
      persist({ history });
      renderAll();
    });
  }

  function renderMatrix() {
    const sizes = ["all", ...SIZES.map(String)];
    const modes = ["all", ...MODES];
    let html = "<span></span>";
    for (const s of sizes) {
      const label = s === "all" ? "All" : gridName(Number(s));
      const aria = s === "all" ? "All grid sizes" : `${label} grid`;
      html += `<button type="button" class="mh col" data-kind="col" data-size="${s}" data-key="col:${s}" ` +
        `aria-pressed="${filters.size === s}" aria-label="${aria}">${label}</button>`;
    }
    for (const m of modes) {
      const rowLabel = m === "all" ? "All" : MODE_LABELS[m];
      const rowAria = m === "all" ? "All opponents" : MODE_LABELS[m];
      html += `<button type="button" class="mh row" data-kind="row" data-mode="${m}" data-key="row:${m}" ` +
        `aria-pressed="${filters.mode === m}" aria-label="${rowAria}">${rowLabel}</button>`;
      for (const s of sizes) {
        const c = tally(entriesFor(m, s));
        const total = c.W + c.L + c.D;
        const bar = ["W", "L", "D"].filter((k) => c[k]).map((k) => `<i class="b-${k}" style="flex:${c[k]} 1 0"></i>`).join("");
        const who = m === "all" ? "All opponents" : MODE_LABELS[m];
        const grid = s === "all" ? "all grid sizes" : gridName(Number(s));
        const aria = `${who}, ${grid}: ` + (total ? `${total} game${total === 1 ? "" : "s"}, ${c.W} won, ${c.L} lost, ${c.D} drawn` : "no games");
        const selected = filters.mode === m && filters.size === s;
        html += `<button type="button" class="mcell" data-kind="cell" data-mode="${m}" data-size="${s}" data-key="cell:${m}:${s}" ` +
          `aria-pressed="${selected}" aria-label="${aria}"><span class="mcount">${total || "–"}</span><span class="mbar">${bar}</span></button>`;
      }
    }
    $("history-matrix").innerHTML = html;
  }

  function renderHistory() {
    renderMatrix();

    const entries = entriesFor(filters.mode, filters.size);
    const c = tally(entries);
    const total = c.W + c.L + c.D;
    const who = filters.mode === "all" ? "All opponents" : MODE_NAMES[filters.mode];
    const grid = filters.size === "all" ? "all grid sizes" : gridName(Number(filters.size));
    $("history-title").textContent = `${who}, ${grid}: ${total} game${total === 1 ? "" : "s"}`;
    $("history-stats").innerHTML = statsMarkup(c, filters.mode === "friend");

    const human = filters.mode === "friend";
    const letters = human ? { W: "X", L: "O", D: "D" } : { W: "W", L: "L", D: "D" };
    const words = human ? { W: "X won", L: "O won", D: "Drawn" } : { W: "Won", L: "Lost", D: "Drawn" };
    entries.sort((a, b) => b.t - a.t);
    $("history-recent").innerHTML = entries.slice(0, 20).map((e) => {
      const tip = `${words[e.r]}, ${MODE_NAMES[e.mode]} on ${gridName(Number(e.size))}`;
      return `<span class="chip chip-${e.r}" title="${tip}" aria-label="${tip}">${letters[e.r]}</span>`;
    }).join("");
  }

  // ---------- tabs ----------
  function buildTabs() {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const select = (name) => {
      for (const t of tabs) {
        const on = t.dataset.tab === name;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        $("panel-" + t.dataset.tab).hidden = !on;
      }
      renderAll();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t.dataset.tab));
      t.addEventListener("keydown", (e) => {
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        const next = tabs[(i + d + tabs.length) % tabs.length];
        next.focus();
        select(next.dataset.tab);
      });
    });
    captionEl.addEventListener("click", () => select("options"));
  }

  // ---------- wiring ----------
  function render() { renderPlay(); }

  function renderAll() {
    renderPlay();
    renderOptions();
    renderHistory();
  }

  newBtn.addEventListener("click", () => { exitReplay(); newGame(); renderAll(); });
  replayBtn.addEventListener("click", () => {
    if (replay) { exitReplay(); render(); } else startReplay();
  });

  async function init() {
    let data = {};
    try { data = await store.get(["settings", "history", "lastGame"]); } catch (_) {}
    settings = cleanSettings(data.settings);     // falls back to Hard, 3x3, Classic blue, Standard font
    history = cleanHistory(data.history);
    lastGame = cleanLastGame(data.lastGame);
    // first run, or settings saved by an older version: write the cleaned-up values back
    if (JSON.stringify(data.settings) !== JSON.stringify(settings)) persist({ settings });

    applyLook();
    buildTabs();
    buildOptions();
    buildHistory();
    newGame();
    renderAll();
    document.documentElement.dataset.ready = "1";
  }

  init();
})();
