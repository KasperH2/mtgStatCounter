import "./style.css";
import { allowedEmails, supabase } from "./supabaseClient";

const app = document.querySelector("#app");

const initialState = {
  rowDecks: [
    "Dragons",
    "Spirit",
    "Keyword",
    "Sphinx",
    "Sacrifice",
    "Lifegain",
    "Door",
    "Eldrazi",
    "Vehicle",
    "Knights",
    "Proliferate",
    "Wurm",
    "Deathfed",
    "Token",
    "Funfungus",
    "Bloodrush"
  ],
  columnDecks: [
    "Giants",
    "Humans",
    "+1/+1 Counter",
    "Reanimate",
    "Flicker",
    "Untap",
    "Scry",
    "Delirium",
    "Discard",
    "Nightmare",
    "20/20",
    "Heroic",
    "Zombies",
    "Hand Deck",
    "Activated",
    "Grolnok"
  ],
  cells: [
    [0, 0, 2, -1, 3, 0, -4, 0, 0, 0, 0, 2, 0, -1, -1, 2],
    [2, -1, 0, -1, 1, -1, 0, 2, -5, 0, -1, -3, -3, -1, 0, 1],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, -1, 1, -1, 2, 0, 1, 0],
    [0, 0, -1, 0, -2, 0, -1, 0, 0, 2, 0, -1, 0, 1, 0, 0],
    [1, 1, 1, 0, 4, 0, 2, -5, 0, 1, 0, 1, 0, -1, 0, 0],
    [0, 2, 0, -1, 3, 0, -1, 0, 0, -2, 0, -2, 1, -2, 0, 1],
    [1, 0, 0, 0, 0, -2, 1, 1, 0, 0, 0, 2, -2, 0, 0, 0],
    [0, 1, 1, 1, -1, 0, 4, -2, 2, 1, -1, 1, 2, 1, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 0, -1, 0, -2, 1, 0, 0, -1, -1],
    [1, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, -2, 1],
    [1, 1, 1, 0, 0, 2, 2, 4, 2, 0, 1, 1, 1, 2, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, -1, -1, 0, 2, 1, 0, 1, 1, 0],
    [0, -1, 1, 1, 2, 2, -1, 0, 0, 1, 0, 0, 2, 2, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1, 1],
    [0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, -2, 2],
    [0, 0, 0, -1, 1, 0, -1, 1, 1, 2, 2, 0, 0, 0, -6, 0]
  ]
};

function makeDefaultMatrix() {
  return initialState.cells.map((row) =>
    row.map((score) => ({ score, games: Math.abs(score), updatedAt: null }))
  );
}

const state = {
  rowDecks: [...initialState.rowDecks],
  columnDecks: [...initialState.columnDecks],
  matrix: makeDefaultMatrix()
};

let isDarkMode = false;
let activeEditor = null;
let displayMode = "wins";
let scoreMinGamesFilter = 5;
let scoreMaxDiffFilter = 2;
let gamesMinFilter = 0;
let gamesMaxFilter = 9999;
let sortMode = "none";
let unsortedSnapshot = null;
let highlightMode = "counters";
let accountOpen = false;
let highlightOpen = false;

let currentUser = null;
let isInitializing = true;
let authError = "";
let authBusy = false;
let saveStatus = "idle";
let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;
let saveRetryTimer = null;
let fullSaveRetryCount = 0;
let cellSyncInFlight = false;
let cellSyncRetryTimer = null;
let cellSyncRetryCount = 0;
let pendingCellOps = [];
let realtimeChannel = null;
let remoteReloadTimer = null;

const MAX_FULL_SAVE_RETRIES = 5;
const MAX_CELL_SYNC_RETRIES = 8;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clearSaveRetryTimer() {
  if (saveRetryTimer) {
    window.clearTimeout(saveRetryTimer);
    saveRetryTimer = null;
  }
}

function clearCellSyncRetryTimer() {
  if (cellSyncRetryTimer) {
    window.clearTimeout(cellSyncRetryTimer);
    cellSyncRetryTimer = null;
  }
}

function scheduleSavedIndicatorReset() {
  window.setTimeout(() => {
    if (saveStatus === "saved") {
      saveStatus = "idle";
      render();
    }
  }, 1200);
}

function getCellIndexesByDeckNames(rowDeck, columnDeck) {
  const rowIndex = state.rowDecks.indexOf(rowDeck);
  const colIndex = state.columnDecks.indexOf(columnDeck);
  if (rowIndex === -1 || colIndex === -1) return null;
  return { rowIndex, colIndex };
}

function hasPendingCellOp(rowDeck, columnDeck) {
  return pendingCellOps.some((op) => op.rowDeck === rowDeck && op.columnDeck === columnDeck);
}

function applyRemoteCellState(remoteCell) {
  const indexes = getCellIndexesByDeckNames(String(remoteCell.row_deck), String(remoteCell.column_deck));
  if (!indexes) return;

  const { rowIndex, colIndex } = indexes;
  state.matrix[rowIndex][colIndex] = {
    score: Math.trunc(Number(remoteCell.score || 0)),
    games: Math.max(0, Math.trunc(Number(remoteCell.games || 0))),
    updatedAt: remoteCell.updated_at || state.matrix[rowIndex][colIndex].updatedAt || null
  };
}

function clearRealtimeSubscription() {
  if (remoteReloadTimer) {
    window.clearTimeout(remoteReloadTimer);
    remoteReloadTimer = null;
  }

  if (realtimeChannel && supabase) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function scheduleRemoteReload() {
  if (!currentUser || !supabase) return;

  if (remoteReloadTimer) {
    window.clearTimeout(remoteReloadTimer);
  }

  remoteReloadTimer = window.setTimeout(async () => {
    remoteReloadTimer = null;

    if (saveInFlight || cellSyncInFlight || pendingCellOps.length || saveTimer) {
      scheduleRemoteReload();
      return;
    }

    try {
      await loadRemoteState();
      render();
    } catch {
      // Ignore transient reload errors; next realtime event or save will resync.
    }
  }, 400);
}

function setupRealtimeSubscription() {
  if (!supabase || !currentUser) return;

  clearRealtimeSubscription();

  realtimeChannel = supabase
    .channel(`matchup-live-${currentUser.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "matchup_cells" }, (payload) => {
      const row = payload.new;
      if (!row) return;
      if (row.updated_by === currentUser.id) return;
      if (hasPendingCellOp(String(row.row_deck), String(row.column_deck))) return;

      applyRemoteCellState(row);
      render();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "deck_layout" }, (payload) => {
      const row = payload.new || payload.old;
      if (row && row.updated_by === currentUser.id) return;
      scheduleRemoteReload();
    })
    .subscribe();
}

function loadThemePreference() {
  const saved = window.localStorage.getItem("mtg-theme");
  isDarkMode = saved === "dark";
  document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
}

function toggleTheme() {
  isDarkMode = !isDarkMode;
  document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
  window.localStorage.setItem("mtg-theme", isDarkMode ? "dark" : "light");
  render();
}

function openAccountPanel() {
  accountOpen = true;
  highlightOpen = false;
  render();
}

function openHighlightPanel() {
  highlightOpen = true;
  accountOpen = false;
  render();
}

function isAllowedUser(user) {
  if (!user) return false;
  if (!allowedEmails.length) return true;
  return allowedEmails.includes(String(user.email || "").toLowerCase());
}

function deckLayoutRows() {
  const nowIso = new Date().toISOString();

  const rowRows = state.rowDecks.map((deckName, position) => ({
    axis: "row",
    position,
    deck_name: deckName,
    updated_by: currentUser.id,
    updated_at: nowIso
  }));

  const columnRows = state.columnDecks.map((deckName, position) => ({
    axis: "column",
    position,
    deck_name: deckName,
    updated_by: currentUser.id,
    updated_at: nowIso
  }));

  return [...rowRows, ...columnRows];
}

function matchupRows() {
  const nowIso = new Date().toISOString();

  return state.rowDecks.flatMap((rowDeck, rowIndex) =>
    state.columnDecks.map((columnDeck, colIndex) => {
      const cell = state.matrix[rowIndex][colIndex];
      return {
        row_deck: rowDeck,
        column_deck: columnDeck,
        score: Math.trunc(Number(cell.score || 0)),
        games: Math.max(0, Math.trunc(Number(cell.games || 0))),
        updated_by: currentUser.id,
        updated_at: nowIso
      };
    })
  );
}

async function loadRemoteState() {
  const [{ data: deckData, error: deckError }, { data: cellData, error: cellError }] = await Promise.all([
    supabase
      .from("deck_layout")
      .select("axis, position, deck_name, updated_at")
      .order("position", { ascending: true }),
    supabase.from("matchup_cells").select("row_deck, column_deck, score, games, updated_at")
  ]);

  if (deckError) throw deckError;
  if (cellError) throw cellError;

  const rowDecks = (deckData || [])
    .filter((row) => row.axis === "row")
    .sort((a, b) => a.position - b.position)
    .map((row) => String(row.deck_name));

  const columnDecks = (deckData || [])
    .filter((row) => row.axis === "column")
    .sort((a, b) => a.position - b.position)
    .map((row) => String(row.deck_name));

  if (!rowDecks.length || !columnDecks.length || !(cellData || []).length) {
    await persistRemoteState("idle");
    return;
  }

  const matrix = rowDecks.map(() => columnDecks.map(() => ({ score: 0, games: 0, updatedAt: null })));
  const cellMap = new Map(
    (cellData || []).map((cell) => [
      `${String(cell.row_deck)}__${String(cell.column_deck)}`,
      {
        score: Math.trunc(Number(cell.score || 0)),
        games: Math.max(0, Math.trunc(Number(cell.games || 0))),
        updatedAt: cell.updated_at || null
      }
    ])
  );

  rowDecks.forEach((rowDeck, rowIndex) => {
    columnDecks.forEach((columnDeck, colIndex) => {
      const key = `${rowDeck}__${columnDeck}`;
      if (cellMap.has(key)) {
        matrix[rowIndex][colIndex] = cellMap.get(key);
      }
    });
  });

  state.rowDecks = rowDecks;
  state.columnDecks = columnDecks;
  state.matrix = matrix;
}

async function persistRemoteState(successStatus = "saved") {
  if (!supabase || !currentUser) return;

  if (saveInFlight) {
    saveQueued = true;
    return;
  }

  saveInFlight = true;
  saveStatus = "saving";
  render();

  clearSaveRetryTimer();

  const maxAttempts = Math.max(1, MAX_FULL_SAVE_RETRIES - fullSaveRetryCount);
  let saveError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { error: deckError } = await supabase.from("deck_layout").upsert(deckLayoutRows(), {
      onConflict: "axis,position"
    });

    if (deckError) {
      saveError = deckError;
    } else {
      const { error: cellError } = await supabase.from("matchup_cells").upsert(matchupRows(), {
        onConflict: "row_deck,column_deck"
      });
      saveError = cellError || null;
    }

    if (!saveError) break;
    await wait(Math.min(1800, 260 * 2 ** (attempt - 1)));
  }

  saveInFlight = false;

  if (saveError) {
    fullSaveRetryCount = Math.min(MAX_FULL_SAVE_RETRIES, fullSaveRetryCount + 1);
    saveStatus = "error";
    render();

    if (!saveRetryTimer) {
      const delayMs = Math.min(7000, 600 * 2 ** (fullSaveRetryCount - 1));
      saveRetryTimer = window.setTimeout(() => {
        saveRetryTimer = null;
        persistRemoteState("saved");
      }, delayMs);
    }

    if (saveQueued) {
      saveQueued = false;
      persistRemoteState("saved");
    }

    return;
  }

  fullSaveRetryCount = 0;

  saveStatus = successStatus;
  render();
  scheduleSavedIndicatorReset();

  if (saveQueued) {
    saveQueued = false;
    persistRemoteState("saved");
  }
}

function scheduleSave() {
  if (!currentUser || !supabase) return;

  saveStatus = "pending";
  render();

  clearSaveRetryTimer();

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    persistRemoteState("saved");
  }, 1000);
}

function queueCellSyncOperation(rowDeck, columnDeck, scoreDelta, gamesDelta) {
  if (!currentUser || !supabase) return;

  pendingCellOps.push({
    rowDeck,
    columnDeck,
    scoreDelta: Math.trunc(Number(scoreDelta || 0)),
    gamesDelta: Math.trunc(Number(gamesDelta || 0))
  });

  saveStatus = "pending";
  render();
  processCellSyncQueue();
}

async function applyCellDeltaWithOptimisticLock(op) {
  for (let attempt = 1; attempt <= MAX_CELL_SYNC_RETRIES; attempt += 1) {
    const { data: currentRows, error: readError } = await supabase
      .from("matchup_cells")
      .select("score, games, updated_at")
      .eq("row_deck", op.rowDeck)
      .eq("column_deck", op.columnDeck)
      .limit(1);

    if (readError) {
      await wait(Math.min(1400, 180 * 2 ** (attempt - 1)));
      continue;
    }

    const current = (currentRows || [])[0] || null;
    const nowIso = new Date().toISOString();

    if (!current) {
      const { error: insertError, data: insertedRows } = await supabase
        .from("matchup_cells")
        .upsert(
          {
            row_deck: op.rowDeck,
            column_deck: op.columnDeck,
            score: op.scoreDelta,
            games: Math.max(0, op.gamesDelta),
            updated_by: currentUser.id,
            updated_at: nowIso
          },
          { onConflict: "row_deck,column_deck" }
        )
        .select("row_deck, column_deck, score, games, updated_at")
        .limit(1);

      if (insertError) {
        await wait(Math.min(1400, 180 * 2 ** (attempt - 1)));
        continue;
      }

      const inserted = (insertedRows || [])[0] || null;
      if (inserted) {
        applyRemoteCellState(inserted);
        return true;
      }

      await wait(Math.min(1400, 180 * 2 ** (attempt - 1)));
      continue;
    }

    const nextScore = Math.trunc(Number(current.score || 0)) + op.scoreDelta;
    const nextGames = Math.max(0, Math.trunc(Number(current.games || 0)) + op.gamesDelta);

    const { data: updatedRows, error: updateError } = await supabase
      .from("matchup_cells")
      .update({
        score: nextScore,
        games: nextGames,
        updated_by: currentUser.id,
        updated_at: nowIso
      })
      .eq("row_deck", op.rowDeck)
      .eq("column_deck", op.columnDeck)
      .eq("updated_at", current.updated_at)
      .select("row_deck, column_deck, score, games, updated_at")
      .limit(1);

    if (updateError) {
      await wait(Math.min(1400, 180 * 2 ** (attempt - 1)));
      continue;
    }

    if ((updatedRows || []).length) {
      applyRemoteCellState(updatedRows[0]);
      return true;
    }

    // Another user updated first; read latest and re-apply delta.
  }

  return false;
}

async function processCellSyncQueue() {
  if (cellSyncInFlight || !pendingCellOps.length || !supabase || !currentUser) return;

  cellSyncInFlight = true;
  clearCellSyncRetryTimer();
  saveStatus = "saving";
  render();

  while (pendingCellOps.length) {
    const currentOp = pendingCellOps[0];
    const success = await applyCellDeltaWithOptimisticLock(currentOp);

    if (!success) {
      cellSyncInFlight = false;
      cellSyncRetryCount = Math.min(MAX_CELL_SYNC_RETRIES, cellSyncRetryCount + 1);
      saveStatus = "error";
      render();

      if (!cellSyncRetryTimer) {
        const delayMs = Math.min(6000, 500 * 2 ** (cellSyncRetryCount - 1));
        cellSyncRetryTimer = window.setTimeout(() => {
          cellSyncRetryTimer = null;
          processCellSyncQueue();
        }, delayMs);
      }

      return;
    }

    pendingCellOps.shift();
  }

  cellSyncInFlight = false;
  cellSyncRetryCount = 0;
  saveStatus = "saved";
  render();
  scheduleSavedIndicatorReset();
}

function getRowTotals() {
  return state.matrix.map((row) => row.reduce((sum, cell) => sum + Number(cell.score || 0), 0));
}

function getColumnTotals() {
  return state.columnDecks.map((_, colIndex) =>
    state.matrix.reduce((sum, row) => sum + Number((row[colIndex] && row[colIndex].score) || 0), 0)
  );
}

function getRowGameTotals() {
  return state.matrix.map((row) => row.reduce((sum, cell) => sum + Number(cell.games || 0), 0));
}

function getColumnGameTotals() {
  return state.columnDecks.map((_, colIndex) =>
    state.matrix.reduce((sum, row) => sum + Number((row[colIndex] && row[colIndex].games) || 0), 0)
  );
}

function scoreClass(value) {
  if (value > 0) return "is-positive";
  if (value < 0) return "is-negative";
  return "is-neutral";
}

function getScoreBackground(score) {
  const abs = Math.abs(score);
  if (abs >= 5) return "var(--heat-red)";
  if (abs === 4) return "var(--heat-orange)";
  if (abs === 3) return "var(--heat-yellow)";
  return "var(--surface)";
}

function getDisplayValue(cellData) {
  return displayMode === "games" ? cellData.games : cellData.score;
}

function getCellBackground(cellData) {
  if (highlightMode === "good") {
    const passScore = Math.abs(cellData.score) <= scoreMaxDiffFilter;
    const passGames = cellData.games >= scoreMinGamesFilter;
    return passScore && passGames ? "var(--heat-highlight)" : "var(--surface)";
  }

  if (highlightMode === "counters") {
    return displayMode === "wins" ? getScoreBackground(cellData.score) : "var(--surface)";
  }

  return "var(--surface)";
}

function toggleHighlightMode(mode) {
  highlightMode = highlightMode === mode ? "none" : mode;
  highlightOpen = true;
  render();
}

function cloneMatrix(matrix) {
  return matrix.map((row) =>
    row.map((cell) => ({ score: cell.score, games: cell.games, updatedAt: cell.updatedAt || null }))
  );
}

function captureUnsortedSnapshot() {
  if (sortMode !== "none" || unsortedSnapshot) return;
  unsortedSnapshot = {
    rowDecks: [...state.rowDecks],
    columnDecks: [...state.columnDecks],
    matrix: cloneMatrix(state.matrix)
  };
}

function clearUnsortedSnapshot() {
  unsortedSnapshot = null;
}

function restoreUnsortedSnapshot() {
  if (!unsortedSnapshot) return false;

  state.rowDecks = [...unsortedSnapshot.rowDecks];
  state.columnDecks = [...unsortedSnapshot.columnDecks];
  state.matrix = cloneMatrix(unsortedSnapshot.matrix);
  clearUnsortedSnapshot();
  activeEditor = null;
  return true;
}

function autoSortByPerformance() {
  const rowTotals = getRowTotals();
  const columnTotals = getColumnTotals();

  const rowOrder = state.rowDecks.map((_, index) => index).sort((a, b) => rowTotals[a] - rowTotals[b]);
  const columnOrder = state.columnDecks
    .map((_, index) => index)
    .sort((a, b) => columnTotals[b] - columnTotals[a]);

  state.rowDecks = rowOrder.map((index) => state.rowDecks[index]);
  state.matrix = rowOrder.map((index) => state.matrix[index]);

  state.columnDecks = columnOrder.map((index) => state.columnDecks[index]);
  state.matrix = state.matrix.map((row) => columnOrder.map((index) => row[index]));

  activeEditor = null;
}

function sortByMostWins() {
  if (sortMode === "wins") {
    sortMode = "none";
    restoreUnsortedSnapshot();
    render();
    return;
  }

  captureUnsortedSnapshot();
  autoSortByPerformance();
  sortMode = "wins";
  render();
}

function sortByMostPlayed() {
  if (sortMode === "games") {
    sortMode = "none";
    restoreUnsortedSnapshot();
    render();
    return;
  }

  captureUnsortedSnapshot();
  const rowGameTotals = getRowGameTotals();
  const columnGameTotals = getColumnGameTotals();

  const rowOrder = state.rowDecks.map((_, index) => index).sort((a, b) => rowGameTotals[b] - rowGameTotals[a]);
  const columnOrder = state.columnDecks
    .map((_, index) => index)
    .sort((a, b) => columnGameTotals[b] - columnGameTotals[a]);

  state.rowDecks = rowOrder.map((index) => state.rowDecks[index]);
  state.matrix = rowOrder.map((index) => state.matrix[index]);

  state.columnDecks = columnOrder.map((index) => state.columnDecks[index]);
  state.matrix = state.matrix.map((row) => columnOrder.map((index) => row[index]));

  activeEditor = null;
  sortMode = "games";
  render();
}

function toggleDisplayMode() {
  displayMode = displayMode === "wins" ? "games" : "wins";
  highlightOpen = false;
  render();
}

function setFilterValue(kind, value) {
  const raw = String(value).trim();

  if (kind === "scoreMaxDiff") {
    if (raw === "") {
      scoreMaxDiffFilter = 2;
    } else {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) return;
      scoreMaxDiffFilter = Math.max(0, Math.trunc(parsed));
    }

    highlightOpen = true;
    render();
    return;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) return;

  if (kind === "scoreMinGames") {
    scoreMinGamesFilter = Math.max(0, Math.trunc(parsed));
  } else if (kind === "gamesMin") {
    gamesMinFilter = Math.max(0, Math.trunc(parsed));
  } else {
    gamesMaxFilter = Math.max(0, Math.trunc(parsed));
  }

  highlightOpen = true;
  render();
}

function updateDeckName(type, index, value) {
  const nextName = value.trim();
  if (!nextName) return;

  if (type === "row") {
    state.rowDecks[index] = nextName;
  } else {
    state.columnDecks[index] = nextName;
  }

  if (sortMode !== "none") {
    sortMode = "none";
    clearUnsortedSnapshot();
  }

  scheduleSave();
  render();
}

function nudgeCellValue(rowIndex, colIndex, key, delta) {
  const cell = state.matrix[rowIndex][colIndex];
  const rowDeck = state.rowDecks[rowIndex];
  const columnDeck = state.columnDecks[colIndex];

  if (key === "score") {
    cell.score += delta;
    cell.games += 1;
    queueCellSyncOperation(rowDeck, columnDeck, delta, 1);
  } else {
    const previousGames = cell.games;
    cell.games = Math.max(0, cell.games + delta);
    const effectiveDelta = cell.games - previousGames;
    if (effectiveDelta !== 0) {
      queueCellSyncOperation(rowDeck, columnDeck, 0, effectiveDelta);
    }
  }

  sortMode = "none";
  clearUnsortedSnapshot();
  render();
}

function setActiveEditor(rowIndex, colIndex) {
  const isSame = activeEditor && activeEditor.row === rowIndex && activeEditor.col === colIndex;
  activeEditor = isSame
    ? null
    : {
        row: rowIndex,
        col: colIndex,
        revealGamesEditor: displayMode !== "games"
      };
  render();
}

function buildHeaderCell(name, type, index) {
  const cell = document.createElement("th");
  cell.className = "deck-heading";

  const input = document.createElement("input");
  input.value = name;
  input.className = `deck-input ${type === "column" ? "column-input" : "row-input"}`;
  if (type === "row") {
    input.size = Math.max(6, name.length);
  }
  input.setAttribute("aria-label", `${type === "row" ? "Row" : "Column"} deck name ${index + 1}`);
  input.addEventListener("change", (event) => updateDeckName(type, index, event.target.value));

  cell.append(input);
  return cell;
}

function buildScoreCell(rowIndex, colIndex, cellData) {
  const isActiveCell = activeEditor && activeEditor.row === rowIndex && activeEditor.col === colIndex;
  const shouldRevealGamesEditor = displayMode !== "games" || (isActiveCell && activeEditor.revealGamesEditor);

  const cell = document.createElement("td");
  cell.className = `score-cell ${scoreClass(cellData.score)}`;
  cell.title = `${state.rowDecks[rowIndex]} vs ${state.columnDecks[colIndex]} | Games played: ${cellData.games}`;
  cell.style.background = getCellBackground(cellData);
  cell.addEventListener("click", (event) => {
    event.stopPropagation();
    setActiveEditor(rowIndex, colIndex);
  });

  const shell = document.createElement("div");
  shell.className = "score-shell";

  const value = document.createElement("div");
  value.className = "score-value";
  value.textContent = String(getDisplayValue(cellData));

  const popover = document.createElement("div");
  popover.className = "cell-popover";
  popover.addEventListener("click", (event) => event.stopPropagation());

  const title = document.createElement("p");
  title.className = "editor-title";
  title.textContent = `${state.rowDecks[rowIndex]} vs. ${state.columnDecks[colIndex]}`;

  const stats = document.createElement("div");
  stats.className = "editor-stats";

  const scoreStat = document.createElement("span");
  scoreStat.className = "editor-stat-chip";
  scoreStat.textContent = `Score: ${cellData.score}`;

  const gamesStat = document.createElement("span");
  gamesStat.className = "editor-stat-chip";
  gamesStat.textContent = `Games: ${cellData.games}`;

  stats.append(scoreStat, gamesStat);

  let editorLabel = null;
  if (displayMode === "wins" || shouldRevealGamesEditor) {
    editorLabel = document.createElement("p");
    editorLabel.className = "editor-mode-label";
    if (displayMode === "wins") {
      editorLabel.textContent = "Edit score";
    } else {
      editorLabel.classList.add("is-warning");
      editorLabel.textContent = "Warning, you are editing number of games played";
    }
  }

  const editorRow = document.createElement("div");
  editorRow.className = "editor-row";

  const revealGamesButton = document.createElement("button");
  revealGamesButton.type = "button";
  revealGamesButton.className = "editor-reveal-button";
  revealGamesButton.textContent = "Edit no. of games played";
  revealGamesButton.addEventListener("click", (event) => {
    event.stopPropagation();
    activeEditor = {
      row: rowIndex,
      col: colIndex,
      revealGamesEditor: true
    };
    render();
  });

  const minusButton = document.createElement("button");
  minusButton.type = "button";
  minusButton.className = "editor-button side-minus";
  minusButton.textContent = "-";
  minusButton.addEventListener("click", () =>
    nudgeCellValue(rowIndex, colIndex, displayMode === "wins" ? "score" : "games", -1)
  );

  const editValue = document.createElement("span");
  editValue.className = "editor-value";
  editValue.textContent = String(displayMode === "wins" ? cellData.score : cellData.games);

  const plusButton = document.createElement("button");
  plusButton.type = "button";
  plusButton.className = "editor-button side-plus";
  plusButton.textContent = "+";
  plusButton.addEventListener("click", () =>
    nudgeCellValue(rowIndex, colIndex, displayMode === "wins" ? "score" : "games", 1)
  );

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "popover-close";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    activeEditor = null;
    render();
  });

  editorRow.append(minusButton, editValue, plusButton);
  popover.append(closeButton, title, stats);
  if (editorLabel) {
    popover.append(editorLabel);
  }
  if (shouldRevealGamesEditor) {
    popover.append(editorRow);
  } else {
    popover.append(revealGamesButton);
  }

  shell.append(value);

  if (isActiveCell) {
    cell.classList.add("is-editing");
    shell.append(popover);
  }

  cell.append(shell);
  return cell;
}

function saveStatusLabel() {
  if (saveStatus === "pending") return "Pending changes";
  if (saveStatus === "saving") return "Saving...";
  if (saveStatus === "saved") return "Saved";
  if (saveStatus === "error") return "Save failed";
  return "Synced";
}

function activeFilterLabel() {
  if (highlightMode === "good") {
    return `Good matchups | max diff <= ${scoreMaxDiffFilter}, games >= ${scoreMinGamesFilter}`;
  }

  if (highlightMode === "counters") {
    return "Counters highlight";
  }

  return "Highlight: none";
}

function positionActiveEditorPopover() {
  const popover = app.querySelector(".cell-popover");
  const activeCell = app.querySelector(".score-cell.is-editing");
  if (!popover || !activeCell) return;

  const cellRect = activeCell.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const margin = 10;

  let left = cellRect.left + cellRect.width / 2 - popRect.width / 2;
  let top = cellRect.top + cellRect.height / 2 - popRect.height / 2;

  left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - popRect.height - margin));

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function renderAuthScreen(configError) {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <h1>MTG Matchup Tracker</h1>
        <p class="auth-sub">Sign in required</p>
        ${
          configError
            ? `<p class="auth-error">Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.</p>`
            : ""
        }
        ${authError ? `<p class="auth-error">${authError}</p>` : ""}
        <form class="auth-form" data-auth-form>
          <label>Email<input type="email" name="email" required /></label>
          <label>Password<input type="password" name="password" required /></label>
          <button type="submit" ${authBusy || configError ? "disabled" : ""}>${
            authBusy ? "Signing in..." : "Sign in"
          }</button>
        </form>
      </section>
    </main>
  `;

  const form = app.querySelector("[data-auth-form]");
  if (form && !configError) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");

      authBusy = true;
      authError = "";
      render();

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        authBusy = false;
        authError = error.message;
        render();
      }
    });
  }
}

function renderTableScreen() {
  const rowTotals = getRowTotals();
  const columnTotals = getColumnTotals();
  const rowGameTotals = getRowGameTotals();
  const columnGameTotals = getColumnGameTotals();

  app.innerHTML = `
    <main class="page-shell">
      <section class="panel">
        <div class="grid-wrap">
          <table class="matchup-table">
            <thead>
              <tr>
                <th class="corner-cell ${accountOpen || highlightOpen ? "controls-open" : ""}">
                  <span>Row \\ Column</span>
                  <div class="top-mini-actions">
                    <button class="mode-toggle mode-account-small ${accountOpen ? "active" : ""}" type="button" data-account-toggle>
                      Account
                    </button>
                    <button class="theme-toggle mode-theme-small" type="button" data-theme-toggle>
                      ${isDarkMode ? "Light" : "Dark"}
                    </button>
                  </div>
                  <button class="mode-toggle mode-view mode-main" type="button" data-display-toggle>
                    ${displayMode === "games" ? "Mode: # of games" : "Mode: Score"}
                  </button>
                  <button class="mode-toggle mode-highlight-main ${highlightOpen ? "active" : ""}" type="button" data-highlight-toggle>
                    Highlight
                  </button>
                  <p class="view-mode-chip">${activeFilterLabel()}</p>
                  <div class="sort-mini-wrap">
                    <button class="sort-mini ${sortMode === "wins" ? "active" : ""}" type="button" data-wins-sort title="Sort by most wins">W</button>
                    <button class="sort-mini ${sortMode === "games" ? "active" : ""}" type="button" data-games-sort title="Sort by most played">G</button>
                  </div>
                  ${
                    accountOpen
                      ? `<div class="controls-popover account-popover" data-account-popover>
                          <section class="controls-section">
                            <p class="controls-title">Account</p>
                            <p class="user-chip">${currentUser.email}</p>
                            <p class="save-chip ${saveStatus}">${saveStatusLabel()}</p>
                            <div class="controls-actions two-col">
                              <button class="mode-toggle mode-signout" type="button" data-signout>
                                Sign out
                              </button>
                            </div>
                          </section>
                        </div>`
                      : ""
                  }
                  ${
                    highlightOpen
                      ? `<div class="controls-popover highlight-popover" data-highlight-popover>
                          <section class="controls-section">
                            <div class="controls-header">
                              <p class="controls-title">Highlight</p>
                              <button class="controls-close" type="button" data-highlight-close aria-label="Close highlight panel">X</button>
                            </div>
                            <div class="controls-actions two-col">
                              <button class="mode-toggle mode-filter ${
                                highlightMode === "good" ? "active" : ""
                              }" type="button" data-highlight-good>
                                Good matchups
                              </button>
                              <button class="mode-toggle mode-filter ${
                                highlightMode === "counters" ? "active" : ""
                              }" type="button" data-highlight-counters>
                                Counters
                              </button>
                            </div>
                            ${
                              highlightMode === "good"
                                ? `<div class="filter-wrap">
                                    <label class="filter-field">Max score diff <=
                                      <input type="number" min="0" value="${scoreMaxDiffFilter}" data-filter-score-max-diff />
                                    </label>
                                    <label class="filter-field">Min number of games >=
                                      <input type="number" min="0" value="${scoreMinGamesFilter}" data-filter-score-min-games />
                                    </label>
                                  </div>`
                                : highlightMode === "counters"
                                  ? `<p class="subtle"></p>`
                                  : `<p class="subtle">No highlight active</p>`
                            }
                          </section>
                        </div>`
                      : ""
                  }
                </th>
                ${state.columnDecks.map((_, index) => `<th data-col="${index}"></th>`).join("")}
                <th class="sum-col">Total</th>
              </tr>
            </thead>
            <tbody>
              ${state.rowDecks
                .map(
                  (_, rowIndex) => `
                  <tr data-row="${rowIndex}">
                    <th data-row-header="${rowIndex}"></th>
                    ${state.columnDecks
                      .map((_, colIndex) => `<td data-cell="${rowIndex}-${colIndex}"></td>`)
                      .join("")}
                    <td class="sum-cell right-total-cell ${scoreClass(rowTotals[rowIndex])}">
                      <span class="sum-score">${
                        displayMode === "games" ? rowGameTotals[rowIndex] : rowTotals[rowIndex]
                      }</span>
                    </td>
                  </tr>
                `
                )
                .join("")}
            </tbody>
            <tfoot>
              <tr>
                <th class="sum-row-label">Total</th>
                ${columnTotals
                  .map(
                    (value, colIndex) =>
                      `<td class="sum-cell ${scoreClass(value)}"><span class="sum-score">${
                        displayMode === "games" ? columnGameTotals[colIndex] : value
                      }</span></td>`
                  )
                  .join("")}
                <td class="sum-corner"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </main>
  `;

  state.columnDecks.forEach((name, index) => {
    const placeholder = app.querySelector(`[data-col="${index}"]`);
    if (placeholder) {
      placeholder.replaceWith(buildHeaderCell(name, "column", index));
    }
  });

  state.rowDecks.forEach((name, index) => {
    const placeholder = app.querySelector(`[data-row-header="${index}"]`);
    if (placeholder) {
      placeholder.replaceWith(buildHeaderCell(name, "row", index));
    }
  });

  state.matrix.forEach((row, rowIndex) => {
    row.forEach((cellData, colIndex) => {
      const placeholder = app.querySelector(`[data-cell="${rowIndex}-${colIndex}"]`);
      if (placeholder) {
        placeholder.replaceWith(buildScoreCell(rowIndex, colIndex, cellData));
      }
    });
  });

  const themeToggle = app.querySelector("[data-theme-toggle]");
  if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

  const accountToggle = app.querySelector("[data-account-toggle]");
  if (accountToggle) {
    accountToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      openAccountPanel();
    });
  }

  const highlightToggle = app.querySelector("[data-highlight-toggle]");
  if (highlightToggle) {
    highlightToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      openHighlightPanel();
    });
  }

  const accountPopover = app.querySelector("[data-account-popover]");
  if (accountPopover) {
    accountPopover.addEventListener("click", (event) => event.stopPropagation());
  }

  const highlightPopover = app.querySelector("[data-highlight-popover]");
  if (highlightPopover) {
    highlightPopover.addEventListener("click", (event) => event.stopPropagation());
  }

  const highlightCloseButton = app.querySelector("[data-highlight-close]");
  if (highlightCloseButton) {
    highlightCloseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      highlightOpen = false;
      render();
    });
  }

  const signOutButton = app.querySelector("[data-signout]");
  if (signOutButton) {
    signOutButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await supabase.auth.signOut();
    });
  }

  const displayToggle = app.querySelector("[data-display-toggle]");
  if (displayToggle) {
    displayToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleDisplayMode();
    });
  }

  const gamesSortToggle = app.querySelector("[data-games-sort]");
  if (gamesSortToggle) {
    gamesSortToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      sortByMostPlayed();
    });
  }

  const winsSortToggle = app.querySelector("[data-wins-sort]");
  if (winsSortToggle) {
    winsSortToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      sortByMostWins();
    });
  }

  const goodHighlightToggle = app.querySelector("[data-highlight-good]");
  if (goodHighlightToggle) {
    goodHighlightToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleHighlightMode("good");
    });
  }

  const countersHighlightToggle = app.querySelector("[data-highlight-counters]");
  if (countersHighlightToggle) {
    countersHighlightToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleHighlightMode("counters");
    });
  }

  const scoreMaxDiffInput = app.querySelector("[data-filter-score-max-diff]");
  if (scoreMaxDiffInput) {
    scoreMaxDiffInput.addEventListener("change", (event) => {
      event.stopPropagation();
      setFilterValue("scoreMaxDiff", event.target.value);
    });
  }

  const scoreMinGamesInput = app.querySelector("[data-filter-score-min-games]");
  if (scoreMinGamesInput) {
    scoreMinGamesInput.addEventListener("change", (event) => {
      event.stopPropagation();
      setFilterValue("scoreMinGames", event.target.value);
    });
  }

  const gamesMinInput = app.querySelector("[data-filter-games-min]");
  if (gamesMinInput) {
    gamesMinInput.addEventListener("change", (event) => {
      event.stopPropagation();
      setFilterValue("gamesMin", event.target.value);
    });
  }

  const gamesMaxInput = app.querySelector("[data-filter-games-max]");
  if (gamesMaxInput) {
    gamesMaxInput.addEventListener("change", (event) => {
      event.stopPropagation();
      setFilterValue("gamesMax", event.target.value);
    });
  }

  const gridWrap = app.querySelector(".grid-wrap");
  if (gridWrap) {
    gridWrap.addEventListener(
      "scroll",
      () => {
        if (activeEditor) {
          positionActiveEditorPopover();
        }
      },
      { passive: true }
    );
  }

  const shell = app.querySelector(".page-shell");
  if (shell) {
    shell.addEventListener("click", (event) => {
      const target = event.target;
      const targetEl = target instanceof Element ? target : null;
      if (targetEl && targetEl.closest("[data-highlight-popover]")) return;
      if (targetEl && targetEl.closest("[data-account-popover]")) return;
      if (targetEl && targetEl.closest("[data-highlight-toggle]")) return;
      if (targetEl && targetEl.closest("[data-account-toggle]")) return;
      if (accountOpen || highlightOpen) {
        accountOpen = false;
        highlightOpen = false;
      }
      if (activeEditor) {
        activeEditor = null;
      }
      render();
    });
  }

  if (activeEditor) {
    positionActiveEditorPopover();
  }
}

function render() {
  if (isInitializing) {
    app.innerHTML = `<main class="auth-shell"><section class="auth-card"><p>Loading...</p></section></main>`;
    return;
  }

  if (!currentUser) {
    renderAuthScreen(!supabase);
    return;
  }

  renderTableScreen();
}

async function handleSession(session) {
  const sessionUser = session && session.user ? session.user : null;

  if (!sessionUser) {
    clearRealtimeSubscription();
    clearSaveRetryTimer();
    clearCellSyncRetryTimer();
    currentUser = null;
    authBusy = false;
    authError = "";
    saveStatus = "idle";
    fullSaveRetryCount = 0;
    cellSyncRetryCount = 0;
    saveInFlight = false;
    saveQueued = false;
    cellSyncInFlight = false;
    pendingCellOps = [];
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    render();
    return;
  }

  if (!isAllowedUser(sessionUser)) {
    await supabase.auth.signOut();
    authError = "This account is not allowed to access this app.";
    return;
  }

  currentUser = sessionUser;
  authBusy = false;
  authError = "";
  saveStatus = "idle";
  fullSaveRetryCount = 0;
  cellSyncRetryCount = 0;
  saveInFlight = false;
  saveQueued = false;
  cellSyncInFlight = false;
  pendingCellOps = [];
  clearSaveRetryTimer();
  clearCellSyncRetryTimer();
  clearUnsortedSnapshot();

  try {
    await loadRemoteState();
    setupRealtimeSubscription();
  } catch (error) {
    authError = `Could not load data from Supabase: ${error.message}`;
  }

  render();
}

async function initApp() {
  loadThemePreference();

  if (!supabase) {
    isInitializing = false;
    render();
    return;
  }

  const { data } = await supabase.auth.getSession();
  await handleSession(data.session);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    await handleSession(session);
  });

  isInitializing = false;
  render();
}

initApp();
