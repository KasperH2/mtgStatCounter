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

const PLAYER_NAMES = { row: "Kasper", column: "Daniel" };
const TABS = [
  {
    id: "log",
    label: "New game",
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8"/><path d="M8 12h8"/>'
  },
  {
    id: "grid",
    label: "Grid",
    icon: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'
  },
  {
    id: "decks",
    label: "Win rates",
    icon: '<path d="M5 20v-8"/><path d="M12 20V5"/><path d="M19 20v-5"/><path d="M3 20h18"/>'
  }
];

let isDarkMode = false;
let activeEditor = null;
let scoreMinGamesFilter = 5;
let scoreMaxDiffFilter = 2;
let clearMinGamesFilter = 5;
let clearMinDiffFilter = 4;
let fewMaxGamesFilter = 0;
// The grid always shows decks sorted; the saved deck order is kept separately in unsortedOrder.
let sortMode = "rate";
let unsortedOrder = null;
let highlightMode = "ahead";
let accountOpen = false;
let highlightOpen = false;

let activeTab = "log";
let logPick = { rowDeck: null, columnDeck: null };
let decksAxis = "both";
let deckDetail = null;
let sessionLog = [];
let actionToast = "";
let actionToastTimer = null;
const viewScrollTop = {};

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
let liveStatus = "connecting";
let liveWasLost = false;
let gridExpanded = false;
let game = null;
let wakeLock = null;
const lifeDeltaTimers = {};
let passwordMessage = "";
let passwordRecovery = false;
let authNotice = "";
let gridScrollLeft = 0;
let gridScrollTop = 0;

const MAX_FULL_SAVE_RETRIES = 5;
const MAX_CELL_SYNC_RETRIES = 8;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// A phone that sleeps or drops into the background can leave a request hanging forever, which would
// block every later save. Each Supabase request gets a time limit and then counts as failed, so the
// normal retry takes over.
const REQUEST_TIMEOUT_MS = 10000;

// Settles after the time limit even if the request never got to start (for example while it waits
// for the sign-in token), so the app can show the problem and retry.
function timed(query) {
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => {
      controller.abort();
      resolve({ data: null, error: { message: "Request timed out" } });
    }, REQUEST_TIMEOUT_MS);
  });
  const request = Promise.resolve(query.abortSignal(controller.signal)).then(
    (result) => result,
    (error) => ({ data: null, error })
  );
  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timer));
}

function sameInstant(a, b) {
  return Boolean(a && b) && Date.parse(a) === Date.parse(b);
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => resolve(null), ms);
  });
  return Promise.race([Promise.resolve(promise).catch(() => null), timeout]).finally(() => window.clearTimeout(timer));
}

// Refreshes the sign-in token ahead of time, so logging a result never has to wait for a refresh
// right after the phone has been sitting idle. Never blocks anything: it gives up quietly on a time limit.
let sessionRefreshInFlight = false;

async function freshenSession(minMinutesLeft) {
  if (!supabase || !currentUser || sessionRefreshInFlight || !navigator.onLine) return;
  sessionRefreshInFlight = true;
  try {
    const current = await withTimeout(supabase.auth.getSession(), 10000);
    const session = current && current.data ? current.data.session : null;
    if (!session || !session.expires_at) return;
    const msLeft = session.expires_at * 1000 - Date.now();
    if (msLeft < minMinutesLeft * 60000) await withTimeout(supabase.auth.refreshSession(), 20000);
  } finally {
    sessionRefreshInFlight = false;
  }
}

const GAME_SESSION_CHECK_MS = 5 * 60000;
let gameSessionTimer = null;

function startGameSessionKeeper() {
  stopGameSessionKeeper();
  gameSessionTimer = window.setInterval(() => {
    if (game && document.visibilityState === "visible") freshenSession(15);
  }, GAME_SESSION_CHECK_MS);
}

function stopGameSessionKeeper() {
  if (gameSessionTimer) window.clearInterval(gameSessionTimer);
  gameSessionTimer = null;
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
  }, 2000);
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

  liveStatus = "connecting";
  liveWasLost = false;
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
      await loadRemoteTournament();
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
      // Own echoes are applied too, so two devices on the same account stay in step.
      if (hasPendingCellOp(String(row.row_deck), String(row.column_deck))) return;

      applyRemoteCellState(row);
      render();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "tournament_state" }, (payload) => {
      if (payload.new) applyRemoteTournament(payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "deck_layout" }, (payload) => {
      const row = payload.new || payload.old;
      if (row && row.updated_by === currentUser.id) return;
      scheduleRemoteReload();
    });

  const channel = realtimeChannel;
  channel.subscribe((status) => {
    // Ignore late status events from a channel that was already replaced or removed.
    if (channel !== realtimeChannel) return;
    if (status === "SUBSCRIBED") {
      // Realtime does not replay missed events, so catch up after any gap.
      if (liveWasLost) scheduleRemoteReload();
      liveStatus = "live";
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      liveStatus = "offline";
      liveWasLost = true;
    }
    render();
  });
}

function retrySyncNow() {
  if (!currentUser || !supabase) return;

  if (pendingCellOps.length) {
    clearCellSyncRetryTimer();
    processCellSyncQueue();
  }

  if (saveRetryTimer) {
    clearSaveRetryTimer();
    persistRemoteState("saved");
  }

  if (liveStatus !== "live") setupRealtimeSubscription();
  scheduleRemoteReload();
}

function hasUnsavedChanges() {
  return pendingCellOps.length > 0 || saveInFlight || cellSyncInFlight || Boolean(saveTimer) || Boolean(saveRetryTimer);
}

// Full screen only grows the grid to the window; the grid's own controls stay.
function toggleGridFullscreen() {
  gridExpanded = !gridExpanded;
  activeEditor = null;
  render();
}

function exitGridFullscreen() {
  gridExpanded = false;
}

function setActiveTab(tabId) {
  if (tabId !== "grid" && gridExpanded) exitGridFullscreen();
  activeTab = tabId;
  accountOpen = false;
  highlightOpen = false;
  activeEditor = null;
  render();
}

// Player color choices: [strong, soft, ink] for light and dark mode. Strong fills buttons and grid
// cells with a big lead, soft fills smaller leads and the life counter, ink is for text.
const PLAYER_COLORS = {
  blue: { label: "Blue", light: ["#2a78d6", "#9ec5f4", "#1c5cab"], dark: ["#3987e5", "#24456e", "#86b6ef"] },
  orange: { label: "Orange", light: ["#eb6834", "#f6b99a", "#b4441a"], dark: ["#d95926", "#a24a1f", "#f39a72"] },
  green: { label: "Dark green", light: ["#1f7a45", "#a8dcb9", "#145c33"], dark: ["#2b8f53", "#1f6e44", "#7fd3a0"] },
  purple: { label: "Purple", light: ["#7b4fd6", "#cdb8f5", "#5a35a8"], dark: ["#8c66e8", "#5a40a6", "#bba6f5"] },
  red: { label: "Red", light: ["#d23b3b", "#f3b0b0", "#a12424"], dark: ["#d94848", "#8f2b2b", "#f29a9a"] },
  teal: { label: "Teal", light: ["#128585", "#9fdcdc", "#0c6363"], dark: ["#1ea3a3", "#14706f", "#7fd6d6"] },
  pink: { label: "Pink", light: ["#d6458f", "#f4b5d4", "#a52a6a"], dark: ["#e0559c", "#8f2d62", "#f2a3c8"] },
  gold: { label: "Gold", light: ["#c48200", "#f2d58f", "#7f5500"], dark: ["#d99a00", "#80600f", "#f0c766"] }
};
const PLAYER_TOKEN = { row: "kasper", column: "daniel" };
const DEFAULT_PLAYER_COLORS = { row: "blue", column: "orange" };

function loadPlayerColors() {
  try {
    const saved = JSON.parse(window.localStorage.getItem("mtg-colors") || "{}");
    const colors = { ...DEFAULT_PLAYER_COLORS };
    ["row", "column"].forEach((side) => {
      if (PLAYER_COLORS[saved[side]]) colors[side] = saved[side];
    });
    return colors.row === colors.column ? { ...DEFAULT_PLAYER_COLORS } : colors;
  } catch {
    return { ...DEFAULT_PLAYER_COLORS };
  }
}

let playerColors = loadPlayerColors();

function applyPlayerColors() {
  const root = document.documentElement;
  ["row", "column"].forEach((side) => {
    const [strong, soft, ink] = PLAYER_COLORS[playerColors[side]][isDarkMode ? "dark" : "light"];
    const token = PLAYER_TOKEN[side];
    root.style.setProperty(`--${token}`, strong);
    root.style.setProperty(`--${token}-soft`, soft);
    root.style.setProperty(`--${token}-ink`, ink);
  });
}

function setPlayerColor(side, color) {
  const other = side === "row" ? "column" : "row";
  if (!PLAYER_COLORS[color] || playerColors[other] === color) return;
  playerColors = { ...playerColors, [side]: color };
  try {
    window.localStorage.setItem("mtg-colors", JSON.stringify(playerColors));
  } catch {
    // The color still applies for this visit.
  }
  applyPlayerColors();
  render();
}

function loadThemePreference() {
  const saved = window.localStorage.getItem("mtg-theme");
  isDarkMode = saved !== "light";
  document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
  applyPlayerColors();
}

function toggleTheme() {
  isDarkMode = !isDarkMode;
  document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
  window.localStorage.setItem("mtg-theme", isDarkMode ? "dark" : "light");
  applyPlayerColors();
  render();
}

function isAllowedUser(user) {
  if (!user) return false;
  if (!allowedEmails.length) return true;
  return allowedEmails.includes(String(user.email || "").toLowerCase());
}

function deckLayoutRows() {
  const nowIso = new Date().toISOString();

  const layout = getLayoutOrder();

  const rowRows = layout.rowDecks.map((deckName, position) => ({
    axis: "row",
    position,
    deck_name: deckName,
    updated_by: currentUser.id,
    updated_at: nowIso
  }));

  const columnRows = layout.columnDecks.map((deckName, position) => ({
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
    timed(supabase.from("deck_layout").select("axis, position, deck_name, updated_at").order("position", { ascending: true })),
    timed(supabase.from("matchup_cells").select("row_deck, column_deck, score, games, updated_at"))
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

  if (sortMode !== "none") {
    unsortedOrder = { rowDecks: [...rowDecks], columnDecks: [...columnDecks] };
    reorderGrid(sortedDeckNames("row", sortMode), sortedDeckNames("column", sortMode));
  }
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
    const { error: deckError } = await timed(
      supabase.from("deck_layout").upsert(deckLayoutRows(), {
        onConflict: "axis,position"
      })
    );

    if (deckError) {
      saveError = deckError;
    } else {
      const { error: cellError } = await timed(
        supabase.from("matchup_cells").upsert(matchupRows(), {
          onConflict: "row_deck,column_deck"
        })
      );
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
    const { data: currentRows, error: readError } = await timed(
      supabase
        .from("matchup_cells")
        .select("row_deck, column_deck, score, games, updated_at")
        .eq("row_deck", op.rowDeck)
        .eq("column_deck", op.columnDeck)
        .limit(1)
    );

    if (readError) {
      await wait(Math.min(1400, 180 * 2 ** (attempt - 1)));
      continue;
    }

    const current = (currentRows || [])[0] || null;

    // If an earlier attempt's write landed but its answer was lost, the row carries the exact time we
    // wrote. Treat that as done instead of adding the game a second time.
    if (current && op.lastWriteAt && sameInstant(current.updated_at, op.lastWriteAt)) {
      applyRemoteCellState(current);
      return true;
    }

    const nowIso = new Date().toISOString();
    op.lastWriteAt = nowIso;

    if (!current) {
      const { error: insertError, data: insertedRows } = await timed(
        supabase
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
          .limit(1)
      );

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

    const { data: updatedRows, error: updateError } = await timed(
      supabase
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
        .limit(1)
    );

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

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

// Stored score is column wins minus row wins: positive means Daniel's deck leads.
function leaderOf(score) {
  if (score < 0) return "row";
  if (score > 0) return "column";
  return null;
}

function getRecord(cellData) {
  const games = Math.max(0, Math.trunc(Number(cellData.games || 0)));
  const score = Math.trunc(Number(cellData.score || 0));
  return {
    games,
    score,
    rowWins: Math.max(0, Math.round((games - score) / 2)),
    columnWins: Math.max(0, Math.round((games + score) / 2))
  };
}

function winRate(wins, losses) {
  const total = wins + losses;
  return total ? Math.round((wins / total) * 100) : null;
}

function formatRate(rate) {
  return rate === null ? "–" : `${rate}%`;
}

function isEvenMatchup(cellData) {
  const { games, score } = getRecord(cellData);
  return games >= scoreMinGamesFilter && Math.abs(score) <= scoreMaxDiffFilter;
}

function isClearMatchup(cellData) {
  const { games, score } = getRecord(cellData);
  return games >= clearMinGamesFilter && Math.abs(score) >= clearMinDiffFilter;
}

function isFewGamesMatchup(cellData) {
  return getRecord(cellData).games <= fewMaxGamesFilter;
}

function deckNameFor(axis, index) {
  return axis === "row" ? state.rowDecks[index] : state.columnDecks[index];
}

function getDeckSummary(axis, index) {
  const opponents = axis === "row" ? state.columnDecks : state.rowDecks;
  let wins = 0;
  let losses = 0;
  let games = 0;

  const matchups = opponents.map((opponent, opponentIndex) => {
    const cellData = axis === "row" ? state.matrix[index][opponentIndex] : state.matrix[opponentIndex][index];
    const record = getRecord(cellData);
    const ownWins = axis === "row" ? record.rowWins : record.columnWins;
    const ownLosses = axis === "row" ? record.columnWins : record.rowWins;
    wins += ownWins;
    losses += ownLosses;
    games += record.games;
    return {
      opponent,
      rowIndex: axis === "row" ? index : opponentIndex,
      colIndex: axis === "row" ? opponentIndex : index,
      cellData,
      wins: ownWins,
      losses: ownLosses,
      games: record.games,
      rate: winRate(ownWins, ownLosses)
    };
  });

  return { name: deckNameFor(axis, index), axis, index, wins, losses, games, rate: winRate(wins, losses), matchups };
}

function pairVerdict(cellData, rowIndex, colIndex) {
  const record = getRecord(cellData);
  const leader = leaderOf(record.score);
  const leaderDeck = leader ? deckNameFor(leader, leader === "row" ? rowIndex : colIndex) : "";

  if (record.games === 0) return { kind: "untested", label: "Untested", leader };
  if (isClearMatchup(cellData)) return { kind: `clear-${leader}`, label: `Clear: ${leaderDeck}`, leader };
  if (isEvenMatchup(cellData)) return { kind: "even", label: "Even", leader };
  if (record.games < clearMinGamesFilter) return { kind: "few", label: "Few games", leader };
  return { kind: "leaning", label: leader ? `Leaning ${leaderDeck}` : "Tied", leader };
}

function deckVerdict(axis, cellData) {
  const record = getRecord(cellData);
  if (record.games === 0) return { kind: "untested", label: "Untested" };
  if (isClearMatchup(cellData)) {
    return leaderOf(record.score) === axis ? { kind: "favored", label: "Favored" } : { kind: "unfavored", label: "Unfavored" };
  }
  if (isEvenMatchup(cellData)) return { kind: "even", label: "Even" };
  if (record.games < clearMinGamesFilter) return { kind: "few", label: "Few games" };
  return { kind: "leaning", label: "Leaning" };
}

function leadText(record, rowIndex, colIndex) {
  if (record.games === 0) return "No games yet";
  const leader = leaderOf(record.score);
  if (!leader) return "Dead even";
  const deck = deckNameFor(leader, leader === "row" ? rowIndex : colIndex);
  const diff = Math.abs(record.score);
  return `${PLAYER_NAMES[leader]}'s ${deck} is ${diff} ${diff === 1 ? "win" : "wins"} ahead`;
}

function splitBarMarkup(rowWins, columnWins) {
  if (!rowWins && !columnWins) return `<div class="split-bar"><i class="is-empty"></i></div>`;
  return `<div class="split-bar">${rowWins ? `<i class="is-row" style="flex:${rowWins}"></i>` : ""}${
    columnWins ? `<i class="is-column" style="flex:${columnWins}"></i>` : ""
  }</div>`;
}

function showToast(message) {
  actionToast = message;
  if (actionToastTimer) window.clearTimeout(actionToastTimer);
  actionToastTimer = window.setTimeout(() => {
    actionToast = "";
    actionToastTimer = null;
    render();
  }, 1800);
}

function recordResult(rowIndex, colIndex, winner) {
  const cell = state.matrix[rowIndex][colIndex];
  const rowDeck = state.rowDecks[rowIndex];
  const columnDeck = state.columnDecks[colIndex];
  const scoreDelta = winner === "column" ? 1 : -1;

  cell.score += scoreDelta;
  cell.games += 1;
  queueCellSyncOperation(rowDeck, columnDeck, scoreDelta, 1);

  sessionLog.unshift({ rowDeck, columnDeck, winner });
  showToast(`Logged: ${PLAYER_NAMES[winner]}'s ${winner === "row" ? rowDeck : columnDeck} won`);
  render();
}

// Takes one win (and so one game) away from a deck in this matchup; games always equal the wins added up.
function removeWin(rowIndex, colIndex, winner) {
  const cell = state.matrix[rowIndex][colIndex];
  const record = getRecord(cell);
  if ((winner === "row" ? record.rowWins : record.columnWins) < 1) return;

  const rowDeck = state.rowDecks[rowIndex];
  const columnDeck = state.columnDecks[colIndex];
  const scoreDelta = winner === "column" ? -1 : 1;
  cell.score += scoreDelta;
  cell.games = Math.max(0, cell.games - 1);
  queueCellSyncOperation(rowDeck, columnDeck, scoreDelta, -1);

  // If that win was logged this session, drop it from the list so Undo can't remove it a second time.
  const logged = sessionLog.findIndex(
    (entry) => entry.rowDeck === rowDeck && entry.columnDeck === columnDeck && entry.winner === winner
  );
  if (logged !== -1) sessionLog.splice(logged, 1);

  showToast(`Removed a win for ${PLAYER_NAMES[winner]}'s ${winner === "row" ? rowDeck : columnDeck}`);
  render();
}

function undoLastResult() {
  const last = sessionLog.shift();
  if (!last) return;

  const indexes = getCellIndexesByDeckNames(last.rowDeck, last.columnDeck);
  if (indexes) {
    const cell = state.matrix[indexes.rowIndex][indexes.colIndex];
    const scoreDelta = last.winner === "column" ? -1 : 1;
    const gamesDelta = cell.games > 0 ? -1 : 0;
    cell.score += scoreDelta;
    cell.games += gamesDelta;
    queueCellSyncOperation(last.rowDeck, last.columnDeck, scoreDelta, gamesDelta);
  }

  showToast("Last game removed");
  render();
}

function getLogIndexes() {
  const rowIndex = Math.max(0, state.rowDecks.indexOf(logPick.rowDeck));
  const colIndex = Math.max(0, state.columnDecks.indexOf(logPick.columnDeck));
  return { rowIndex, colIndex };
}

function openPairInLog(rowIndex, colIndex) {
  logPick = { rowDeck: state.rowDecks[rowIndex], columnDeck: state.columnDecks[colIndex] };
  viewScrollTop.log = 0;
  setActiveTab("log");
}

// Picks a random pair from the least-played ones (fewest games, or one more), never the pair already shown.
function suggestLeastPlayedPair() {
  const current = getLogIndexes();
  const pairs = state.matrix.flatMap((row, rowIndex) =>
    row.map((cellData, colIndex) => ({ rowIndex, colIndex, games: getRecord(cellData).games }))
  );
  const others = pairs.filter((pair) => pair.rowIndex !== current.rowIndex || pair.colIndex !== current.colIndex);
  if (!others.length) return;

  const fewest = Math.min(...others.map((pair) => pair.games));
  const candidates = others.filter((pair) => pair.games <= fewest + 1);
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  logPick = { rowDeck: state.rowDecks[pick.rowIndex], columnDeck: state.columnDecks[pick.colIndex] };
  showToast(pick.games ? `Suggested: played ${pick.games} ${pick.games === 1 ? "time" : "times"}` : "Suggested: never played");
  render();
}

// Diverging scale from Kasper's side: blue when his deck is favored, orange when Daniel's is.
function getAheadPaint(record) {
  const rate = winRate(record.rowWins, record.columnWins);
  if (rate === null) return null;
  if (rate >= 70) return { background: "var(--kasper)", strong: true };
  if (rate > 55) return { background: "var(--kasper-soft)", strong: false };
  if (rate >= 45) return { background: "var(--mid)", strong: false };
  if (rate > 30) return { background: "var(--daniel-soft)", strong: false };
  return { background: "var(--daniel)", strong: true };
}

function getDisplayValue(cellData) {
  const record = getRecord(cellData);
  return record.games ? `${record.rowWins}-${record.columnWins}` : "·";
}

function getCellPaint(cellData) {
  const record = getRecord(cellData);

  if (highlightMode === "ahead") return getAheadPaint(record);

  if (highlightMode === "clear") {
    if (!isClearMatchup(cellData)) return null;
    return leaderOf(record.score) === "row"
      ? { background: "var(--kasper)", strong: true }
      : { background: "var(--daniel)", strong: true };
  }

  if (highlightMode === "few") {
    return isFewGamesMatchup(cellData) ? { background: "var(--few-highlight)", strong: false } : null;
  }

  return null;
}

function toggleHighlightMode(mode) {
  highlightMode = highlightMode === mode ? "none" : mode;
  highlightOpen = true;
  render();
}

// Sorting only reorders decks; the original order is kept by name so live edits are never overwritten.
function reorderGrid(rowOrder, columnOrder) {
  const rowIndexes = rowOrder.map((name) => state.rowDecks.indexOf(name)).filter((index) => index !== -1);
  const columnIndexes = columnOrder.map((name) => state.columnDecks.indexOf(name)).filter((index) => index !== -1);
  if (rowIndexes.length !== state.rowDecks.length || columnIndexes.length !== state.columnDecks.length) return;

  state.matrix = rowIndexes.map((rowIndex) => columnIndexes.map((colIndex) => state.matrix[rowIndex][colIndex]));
  state.rowDecks = rowIndexes.map((index) => state.rowDecks[index]);
  state.columnDecks = columnIndexes.map((index) => state.columnDecks[index]);
}

function clearUnsortedOrder() {
  unsortedOrder = null;
}

function getLayoutOrder() {
  return unsortedOrder || { rowDecks: state.rowDecks, columnDecks: state.columnDecks };
}

function deckSortValue(axis, index, mode) {
  const summary = getDeckSummary(axis, index);
  if (mode === "diff") return summary.wins - summary.losses;
  if (mode === "rate") return summary.rate ?? -1;
  return summary.games;
}

function sortedDeckNames(axis, mode) {
  const decks = axis === "row" ? state.rowDecks : state.columnDecks;
  return decks
    .map((name, index) => ({ name, value: deckSortValue(axis, index, mode), games: getDeckSummary(axis, index).games }))
    .sort((a, b) => b.value - a.value || b.games - a.games)
    .map((deck) => deck.name);
}

function applyGridSort(mode) {
  activeEditor = null;

  if (!unsortedOrder) {
    unsortedOrder = { rowDecks: [...state.rowDecks], columnDecks: [...state.columnDecks] };
  }

  reorderGrid(sortedDeckNames("row", mode), sortedDeckNames("column", mode));
  sortMode = mode;
  render();
}

const SORT_MODES = [
  ["rate", "Win rate"],
  ["diff", "Most wins"],
  ["games", "Most games"]
];

const HIGHLIGHT_MODES = [
  ["ahead", "Who's ahead"],
  ["clear", "Clear winner"],
  ["few", "Few games"]
];

const FILTER_LIMITS = {
  scoreMaxDiff: { min: 0, fallback: 2 },
  scoreMinGames: { min: 0, fallback: 5 },
  clearMinGames: { min: 1, fallback: 5 },
  clearMinDiff: { min: 1, fallback: 4 },
  fewMaxGames: { min: 0, fallback: 0 }
};

function getFilterValue(kind) {
  if (kind === "scoreMaxDiff") return scoreMaxDiffFilter;
  if (kind === "scoreMinGames") return scoreMinGamesFilter;
  if (kind === "clearMinGames") return clearMinGamesFilter;
  if (kind === "clearMinDiff") return clearMinDiffFilter;
  return fewMaxGamesFilter;
}

function assignFilterValue(kind, value) {
  const limits = FILTER_LIMITS[kind];
  const next = Math.max(limits.min, Math.trunc(value));
  if (kind === "scoreMaxDiff") scoreMaxDiffFilter = next;
  else if (kind === "scoreMinGames") scoreMinGamesFilter = next;
  else if (kind === "clearMinGames") clearMinGamesFilter = next;
  else if (kind === "clearMinDiff") clearMinDiffFilter = next;
  else fewMaxGamesFilter = next;
}

function setFilterValue(kind, value) {
  const raw = String(value).trim();
  const parsed = raw === "" ? FILTER_LIMITS[kind].fallback : Number(raw);
  if (Number.isNaN(parsed)) return;

  assignFilterValue(kind, parsed);
  highlightOpen = true;
  render();
}

function updateDeckName(type, index, value) {
  const nextName = value.trim();
  if (!nextName) return;

  const previousName = type === "row" ? state.rowDecks[index] : state.columnDecks[index];
  if (type === "row") {
    state.rowDecks[index] = nextName;
    if (logPick.rowDeck === previousName) logPick.rowDeck = nextName;
  } else {
    state.columnDecks[index] = nextName;
    if (logPick.columnDeck === previousName) logPick.columnDeck = nextName;
  }

  if (unsortedOrder) {
    const list = type === "row" ? unsortedOrder.rowDecks : unsortedOrder.columnDecks;
    const position = list.indexOf(previousName);
    if (position !== -1) list[position] = nextName;
  }

  scheduleSave();
  render();
}

function setActiveEditor(rowIndex, colIndex) {
  const isSame = activeEditor && activeEditor.row === rowIndex && activeEditor.col === colIndex;
  activeEditor = isSame ? null : { row: rowIndex, col: colIndex, removeMode: false };
  render();
}

function buildHeaderCell(name, type, index) {
  const cell = document.createElement("th");
  cell.className = `deck-heading ${type === "column" ? "is-column-deck" : "is-row-deck"}`;

  const input = document.createElement("input");
  input.value = name;
  input.className = `deck-input ${type === "column" ? "column-input" : "row-input"}`;
  // Size each name box to its text, so the name row and column only take the space of the longest name.
  input.size = Math.max(2, name.length);
  input.setAttribute("aria-label", `${PLAYER_NAMES[type]}'s deck name ${index + 1}`);
  input.addEventListener("change", (event) => updateDeckName(type, index, event.target.value));

  cell.append(input);
  return cell;
}

function makeButton(className, text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function buildScoreCell(rowIndex, colIndex, cellData) {
  const isActiveCell = activeEditor && activeEditor.row === rowIndex && activeEditor.col === colIndex;
  const record = getRecord(cellData);
  const rowDeck = state.rowDecks[rowIndex];
  const columnDeck = state.columnDecks[colIndex];

  const cell = document.createElement("td");
  const paint = getCellPaint(cellData);
  cell.className = [
    "score-cell",
    paint && paint.strong ? "is-strong" : "",
    record.games === 0 && !paint ? "is-untested" : ""
  ]
    .filter(Boolean)
    .join(" ");
  cell.title = `${rowDeck} vs ${columnDeck} | ${record.rowWins}-${record.columnWins} | Games played: ${record.games}`;
  if (paint) cell.style.setProperty("--cell-bg", paint.background);
  cell.addEventListener("click", (event) => {
    event.stopPropagation();
    setActiveEditor(rowIndex, colIndex);
  });

  const shell = document.createElement("div");
  shell.className = "score-shell";

  const value = document.createElement("div");
  value.className = "score-value";
  value.textContent = getDisplayValue(cellData);
  shell.append(value);

  if (isActiveCell) {
    const popover = document.createElement("div");
    popover.className = "cell-popover";
    popover.addEventListener("click", (event) => event.stopPropagation());

    const closeButton = makeButton("popover-close", "Close", () => {
      activeEditor = null;
      render();
    });

    const title = document.createElement("p");
    title.className = "editor-title";
    title.textContent = `${rowDeck} vs. ${columnDeck}`;

    const stats = document.createElement("div");
    stats.className = "editor-stats";
    [
      [`${PLAYER_NAMES.row}: ${record.rowWins}`, "is-row"],
      [`${PLAYER_NAMES.column}: ${record.columnWins}`, "is-column"],
      [`Games: ${record.games}`, ""]
    ].forEach(([text, modifier]) => {
      const chip = document.createElement("span");
      chip.className = `editor-stat-chip ${modifier}`;
      chip.textContent = text;
      stats.append(chip);
    });

    // Add or remove wins; the game count follows the wins.
    const removing = activeEditor.removeMode;
    const modeToggle = document.createElement("div");
    modeToggle.className = "segmented editor-mode-toggle";
    [
      [false, "Add win"],
      [true, "Remove win"]
    ].forEach(([mode, text]) => {
      const button = makeButton(mode === removing ? "on" : "", text, () => {
        activeEditor = { row: rowIndex, col: colIndex, removeMode: mode };
        render();
      });
      button.setAttribute("aria-pressed", String(mode === removing));
      modeToggle.append(button);
    });

    const label = document.createElement("p");
    label.className = `editor-mode-label ${removing ? "is-warning" : ""}`;
    label.textContent = removing ? "Take one win away from:" : "Who won?";

    const winRow = document.createElement("div");
    winRow.className = "win-buttons";
    ["row", "column"].forEach((side) => {
      const deck = side === "row" ? rowDeck : columnDeck;
      const wins = side === "row" ? record.rowWins : record.columnWins;
      const button = makeButton(`win-button is-${side} ${removing ? "is-remove" : ""}`, removing ? `− ${deck}` : deck, () =>
        removing ? removeWin(rowIndex, colIndex, side) : recordResult(rowIndex, colIndex, side)
      );
      button.insertAdjacentHTML("beforeend", `<small>${PLAYER_NAMES[side]}${removing ? ` · ${wins} ${wins === 1 ? "win" : "wins"}` : ""}</small>`);
      if (removing && wins < 1) button.disabled = true;
      winRow.append(button);
    });

    popover.append(closeButton, title, stats, modeToggle, label, winRow);

    cell.classList.add("is-editing");
    shell.append(popover);
  }

  cell.append(shell);
  return cell;
}

// One row of color swatches per player; the other player's color can't be picked.
function colorPickerMarkup(side) {
  const other = side === "row" ? "column" : "row";
  const mode = isDarkMode ? "dark" : "light";
  const swatches = Object.entries(PLAYER_COLORS)
    .map(([id, color]) => {
      const selected = playerColors[side] === id;
      const taken = playerColors[other] === id;
      return `<button type="button" class="color-swatch ${selected ? "is-selected" : ""}" style="background:${color[mode][0]}"
        data-player-color="${side}:${id}" aria-label="${PLAYER_NAMES[side]}: ${color.label}${taken ? ` (${PLAYER_NAMES[other]}'s color)` : ""}"
        aria-pressed="${selected}" title="${color.label}" ${taken ? "disabled" : ""}></button>`;
    })
    .join("");
  return `<div class="color-picker"><span class="color-picker-name">${PLAYER_NAMES[side]}</span><div class="color-swatches">${swatches}</div></div>`;
}

// Menu button; holds theme, colors, account and sign out. Sync problems show in the banner instead.
function menuMarkup() {
  return `<div class="menu-anchor">
    <button class="tool-button icon-button ${accountOpen ? "active" : ""}" type="button" data-account-toggle
      aria-label="Menu" title="Menu" aria-expanded="${accountOpen}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>
    </button>
    ${
      accountOpen
        ? `<div class="controls-popover account-popover" data-account-popover>
            <section class="controls-section">
              <p class="controls-title">Display</p>
              <button class="mode-toggle" type="button" data-theme-toggle>${isDarkMode ? "Switch to light mode" : "Switch to dark mode"}</button>
            </section>
            <section class="controls-section">
              <p class="controls-title">Colors</p>
              ${["row", "column"].map(colorPickerMarkup).join("")}
            </section>
            <section class="controls-section">
              <p class="controls-title">Account</p>
              <p class="user-chip">${escapeHtml(currentUser.email)}</p>
              <form class="password-form" data-password-form>
                <label class="filter-field">${passwordRecovery ? "Choose a new password" : "Change password"}
                  <input type="password" name="password" minlength="6" autocomplete="new-password" required />
                </label>
                <button class="mode-toggle" type="submit">Save password</button>
                ${passwordMessage ? `<p class="subtle">${escapeHtml(passwordMessage)}</p>` : ""}
              </form>
              <button class="mode-toggle mode-signout" type="button" data-signout>Sign out</button>
            </section>
          </div>`
        : ""
    }
  </div>`;
}

function syncBannerMarkup({ showProgress = true } = {}) {
  const unsaved = pendingCellOps.length;
  const unsavedText = unsaved === 1 ? "1 change is" : `${unsaved} changes are`;
  let message = "";

  if (!navigator.onLine) {
    message = unsaved
      ? `You're offline. ${unsavedText} waiting on this phone and will be sent when you're back online. Keep the app open until then.`
      : "You're offline. Games can't be saved or received until you're back online.";
  } else if (saveStatus === "error") {
    message = unsaved
      ? `${unsavedText} not saved yet. Retrying automatically.`
      : "Deck changes are not saved yet. Retrying automatically.";
  } else if (liveWasLost && liveStatus !== "live") {
    message = "Live updates paused. Reconnecting. You'll get the other phone's games when it's back.";
  }

  if (!message) {
    if (!showProgress) return "";
    if (saveStatus === "pending" || saveStatus === "saving") {
      return `<div class="sync-banner is-saving" role="status"><span>Saving…</span></div>`;
    }
    if (saveStatus === "saved") return `<div class="sync-banner is-saved" role="status"><span>Saved ✓</span></div>`;
    return "";
  }
  return `<div class="sync-banner" role="alert">
    <span>${message}</span>
    ${navigator.onLine ? '<button type="button" class="banner-button" data-sync-retry>Retry now</button>' : ""}
  </div>`;
}

function activeFilterLabel() {
  const mode = HIGHLIGHT_MODES.find(([id]) => id === highlightMode);
  return mode ? `Color: ${mode[1]}` : "Color: none";
}

function swatch(color) {
  return `<i class="legend-swatch" style="background:${color}" aria-hidden="true"></i>`;
}

function gridLegendMarkup() {
  const colors = {
    ahead: `<span>${PLAYER_NAMES.column} ahead</span>${swatch("var(--daniel)")}${swatch("var(--daniel-soft)")}${swatch(
      "var(--mid)"
    )}${swatch("var(--kasper-soft)")}${swatch("var(--kasper)")}<span>${PLAYER_NAMES.row} ahead</span>`,
    clear: `${swatch("var(--kasper)")}<span>${PLAYER_NAMES.row}'s deck is better</span>${swatch(
      "var(--daniel)"
    )}<span>${PLAYER_NAMES.column}'s deck is better</span><span>(${clearMinGamesFilter}+ games, ${clearMinDiffFilter}+ wins apart)</span>`,
    few: `${swatch("var(--few-highlight)")}<span>${fewMaxGamesFilter} games or fewer</span>`
  }[highlightMode];

  return colors ? `<div class="grid-legend">${colors}</div>` : "";
}

function positionActiveEditorPopover() {
  const popover = app.querySelector(".cell-popover");
  const activeCell = app.querySelector(".score-cell.is-editing");
  if (!popover || !activeCell) return;

  const cellRect = activeCell.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const margin = 10;

  const gridWrap = app.querySelector(".grid-wrap");
  const scrollbarH = gridWrap ? gridWrap.offsetHeight - gridWrap.clientHeight : 0;
  const gridBottom = gridWrap
    ? gridWrap.getBoundingClientRect().bottom - scrollbarH
    : window.innerHeight;

  let left = cellRect.left + cellRect.width / 2 - popRect.width / 2;
  let top = cellRect.top + cellRect.height / 2 - popRect.height / 2;

  left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
  top = Math.max(margin, Math.min(top, gridBottom - popRect.height - margin));

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function captureScrollPositions() {
  const gridWrap = app.querySelector(".grid-wrap");
  if (gridWrap) {
    gridScrollLeft = gridWrap.scrollLeft;
    gridScrollTop = gridWrap.scrollTop;
  }

  const view = app.querySelector("[data-view]");
  if (view) viewScrollTop[view.dataset.view] = view.scrollTop;

  const pickScroll = app.querySelector("[data-pick-scroll]");
  if (pickScroll) tournamentPickScrollTop = pickScroll.scrollTop;
}

function restoreGridScrollPosition() {
  const gridWrap = app.querySelector(".grid-wrap");
  if (!gridWrap) return;
  gridWrap.scrollLeft = gridScrollLeft;
  gridWrap.scrollTop = gridScrollTop;
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
        ${authNotice ? `<p class="auth-notice">${escapeHtml(authNotice)}</p>` : ""}
        <form class="auth-form" data-auth-form>
          <label>Email<input type="email" name="email" required /></label>
          <label>Password<input type="password" name="password" required /></label>
          <button type="submit" ${authBusy || configError ? "disabled" : ""}>${
            authBusy ? "Signing in..." : "Sign in"
          }</button>
          <button type="button" class="link-button" data-forgot-password ${configError ? "disabled" : ""}>Forgot password?</button>
        </form>
      </section>
    </main>
  `;

  const form = app.querySelector("[data-auth-form]");
  const forgotButton = app.querySelector("[data-forgot-password]");
  if (forgotButton && !configError) {
    forgotButton.addEventListener("click", async () => {
      const email = String(new FormData(form).get("email") || "").trim();
      if (!email) {
        authError = "Type your email first, then tap Forgot password.";
        authNotice = "";
        render();
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      authError = error ? error.message : "";
      authNotice = error ? "" : "Check your email for a link to set a new password.";
      render();
    });
  }

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

function playerDot(axis) {
  return `<i class="player-dot is-${axis}" aria-hidden="true"></i>`;
}

function segmentedMarkup(options, current, attribute) {
  return `<div class="segmented" role="tablist">${options
    .map(
      ([value, label]) =>
        `<button type="button" role="tab" aria-selected="${value === current}" class="${
          value === current ? "on" : ""
        }" ${attribute}="${value}">${label}</button>`
    )
    .join("")}</div>`;
}

function renderLogView() {
  if (tournament) return renderTournamentView();
  if (tournamentSetup) return renderTournamentSetup();

  const { rowIndex, colIndex } = getLogIndexes();
  const cellData = state.matrix[rowIndex][colIndex];
  const record = getRecord(cellData);
  const verdict = pairVerdict(cellData, rowIndex, colIndex);

  // Listed A–Z; each option keeps its deck's grid position as its value.
  const options = (decks, selected) =>
    decks
      .map((name, index) => ({ name, index }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
      .map(({ name, index }) => `<option value="${index}" ${index === selected ? "selected" : ""}>${escapeHtml(name)}</option>`)
      .join("");

  return `
    <section class="view-stack">
      <div class="view-head">
        <h2>New game</h2>
        ${menuMarkup()}
      </div>
      <label class="deck-picker">
        <span class="picker-label">${playerDot("row")}${PLAYER_NAMES.row}'s deck</span>
        <select data-log-row>${options(state.rowDecks, rowIndex)}</select>
      </label>
      <p class="vs-mark">vs</p>
      <label class="deck-picker">
        <span class="picker-label">${playerDot("column")}${PLAYER_NAMES.column}'s deck</span>
        <select data-log-column>${options(state.columnDecks, colIndex)}</select>
      </label>

      <article class="card h2h-card">
        <div class="h2h-score">
          <div class="h2h-side"><b class="ink-row">${record.rowWins}</b><span>${PLAYER_NAMES.row}</span></div>
          <div class="h2h-mid">
            <span>${record.games} ${record.games === 1 ? "game" : "games"}</span>
            <span class="verdict-chip is-${verdict.kind}">${escapeHtml(verdict.label)}</span>
          </div>
          <div class="h2h-side"><b class="ink-column">${record.columnWins}</b><span>${PLAYER_NAMES.column}</span></div>
        </div>
        ${splitBarMarkup(record.rowWins, record.columnWins)}
        <p class="h2h-note">${escapeHtml(leadText(record, rowIndex, colIndex))}</p>
      </article>

      <button type="button" class="start-game-button" data-start-game>Start game</button>

      <div class="two-buttons">
        <button type="button" class="ghost-button" data-undo ${sessionLog.length ? "" : "disabled"}>Undo last game</button>
        <button type="button" class="ghost-button" data-suggest>Suggest a matchup</button>
      </div>
      <button type="button" class="ghost-button" data-tournament-open>Tournament mode</button>

      <p class="section-label">This session</p>
      <div class="card list">
        ${
          sessionLog.length
            ? sessionLog
                .map((entry) => {
                  const winnerDeck = entry.winner === "row" ? entry.rowDeck : entry.columnDeck;
                  const loserDeck = entry.winner === "row" ? entry.columnDeck : entry.rowDeck;
                  return `<div class="log-item">${playerDot(entry.winner)}<span>${escapeHtml(winnerDeck)} beat ${escapeHtml(loserDeck)}</span></div>`;
                })
                .join("")
            : `<p class="empty-note">Games you finish from Start game show up here. Undo removes the most recent one.</p>`
        }
      </div>
    </section>
  `;
}

function renderDeckDetail() {
  const index = deckDetail.axis === "row" ? state.rowDecks.indexOf(deckDetail.name) : state.columnDecks.indexOf(deckDetail.name);
  if (index === -1) {
    deckDetail = null;
    return renderDecksView();
  }

  const summary = getDeckSummary(deckDetail.axis, index);
  const matchups = [...summary.matchups].sort(
    (a, b) => (b.games > 0) - (a.games > 0) || (b.rate ?? -1) - (a.rate ?? -1) || b.games - a.games
  );

  return `
    <section class="view-stack">
      <button type="button" class="back-link" data-deck-back>‹ All decks</button>
      <div class="view-head">
        <h2>${escapeHtml(summary.name)}</h2>
        <span class="owner-chip">${playerDot(summary.axis)}${PLAYER_NAMES[summary.axis]}</span>
      </div>
      <div class="stat-tiles">
        <div class="stat-tile"><span>Win rate</span><b>${formatRate(summary.rate)}</b></div>
        <div class="stat-tile"><span>Record</span><b>${summary.wins}–${summary.losses}</b></div>
        <div class="stat-tile"><span>Games</span><b>${summary.games}</b></div>
      </div>
      <p class="section-label">Matchups, best first · tap one to log a game</p>
      <div class="card list">
        ${matchups
          .map((matchup) => {
            const verdict = deckVerdict(summary.axis, matchup.cellData);
            return `<button type="button" class="list-row matchup-row" data-log-pair="${matchup.rowIndex}:${matchup.colIndex}">
              <span class="list-main">
                <span class="list-name">${escapeHtml(matchup.opponent)}</span>
                <span class="list-sub">${matchup.wins}–${matchup.losses} · ${matchup.games} ${matchup.games === 1 ? "game" : "games"}</span>
              </span>
              <span class="verdict-chip is-${verdict.kind}">${verdict.label}</span>
              <span class="list-rate">${formatRate(matchup.rate)}</span>
            </button>`;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderDecksView() {
  if (deckDetail) return renderDeckDetail();

  const axes = decksAxis === "both" ? ["row", "column"] : [decksAxis];
  const showOwner = axes.length > 1;
  const decks = axes
    .flatMap((axis) => (axis === "row" ? state.rowDecks : state.columnDecks).map((_, index) => getDeckSummary(axis, index)))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.games - a.games);

  return `
    <section class="view-stack">
      <div class="view-head">
        <h2>Win rates</h2>
        ${menuMarkup()}
      </div>
      ${segmentedMarkup(
        [
          ["both", "Both"],
          ["row", PLAYER_NAMES.row],
          ["column", PLAYER_NAMES.column]
        ],
        decksAxis,
        "data-decks-axis"
      )}
      <div class="card list">
        ${decks
          .map(
            (deck, rank) => `<button type="button" class="list-row deck-row" data-open-deck="${deck.axis}:${deck.index}">
              <span class="list-rank">${rank + 1}</span>
              <span class="list-main">
                <span class="list-name">${showOwner ? playerDot(deck.axis) : ""}${escapeHtml(deck.name)}</span>
                <span class="list-sub">${showOwner ? `${PLAYER_NAMES[deck.axis]} · ` : ""}${deck.wins}–${deck.losses} · ${deck.games} ${
                  deck.games === 1 ? "game" : "games"
                }</span>
                <span class="rate-bar"><i class="is-${deck.axis}" style="width:${deck.rate ?? 0}%"></i></span>
              </span>
              <span class="list-rate">${formatRate(deck.rate)}</span>
            </button>`
          )
          .join("")}
      </div>
    </section>
  `;
}

function highlightSettingsMarkup() {
  const numberField = (kind, label) =>
    `<label class="filter-field">${label}
      <input type="number" min="${FILTER_LIMITS[kind].min}" value="${getFilterValue(kind)}" data-filter="${kind}" />
    </label>`;

  if (highlightMode === "clear") {
    return `<div class="filter-wrap">${numberField("clearMinGames", "Min number of games >=")}${numberField(
      "clearMinDiff",
      "Min win difference >="
    )}<p class="subtle">Blue: ${PLAYER_NAMES.row}'s deck is better. Orange: ${PLAYER_NAMES.column}'s deck is better.</p></div>`;
  }

  if (highlightMode === "few") {
    return `<div class="filter-wrap">${numberField("fewMaxGames", "Games played <=")}</div>`;
  }

  if (highlightMode === "ahead") {
    return `<p class="subtle">Blue: ${PLAYER_NAMES.row}'s deck leads. Orange: ${PLAYER_NAMES.column}'s deck leads. Darker means a bigger lead, gray is even.</p>`;
  }
  return `<p class="subtle">No colors active</p>`;
}

function renderGridView() {
  // Each deck's own record against all opponents.
  const totalValue = (axis, index) => {
    const summary = getDeckSummary(axis, index);
    return `${summary.wins}-${summary.losses}`;
  };

  const highlightButton = ([mode, label]) =>
    `<button class="mode-toggle mode-filter ${highlightMode === mode ? "active" : ""}" type="button" data-highlight-mode="${mode}">${label}</button>`;

  return `
    <section class="panel">
      <div class="grid-toolbar">
        <div class="grid-tools">
          <button class="tool-button icon-button ${gridExpanded ? "active" : ""}" type="button" data-grid-fullscreen
            aria-pressed="${gridExpanded}" aria-label="${gridExpanded ? "Exit full screen" : "Full screen"}" title="${
              gridExpanded ? "Exit full screen" : "Full screen"
            }">
            <svg viewBox="0 0 24 24" aria-hidden="true">${
              gridExpanded
                ? '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>'
                : '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>'
            }</svg>
          </button>
          <div class="tool-center">
            <button class="tool-button color-button ${highlightOpen ? "active" : ""}" type="button" data-highlight-toggle
              aria-expanded="${highlightOpen}" aria-label="${activeFilterLabel()}">
              <span class="tool-label">${activeFilterLabel().replace("Color: ", "")}</span>
              <span aria-hidden="true">▾</span>
            </button>
            <label class="sort-picker">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16"/><path d="M3 16l4 4 4-4"/><path d="M17 20V4"/><path d="M13 8l4-4 4 4"/></svg>
              <select data-grid-sort aria-label="Sort decks by">
                ${SORT_MODES.map(([mode, label]) => `<option value="${mode}" ${mode === sortMode ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </label>
          </div>
          ${menuMarkup()}
        </div>
        ${
          highlightOpen
            ? `<div class="controls-popover highlight-popover" data-highlight-popover>
                <section class="controls-section">
                  <div class="controls-header">
                    <p class="controls-title">Color cells by</p>
                    <button class="controls-close" type="button" data-highlight-close aria-label="Close color panel">X</button>
                  </div>
                  <div class="controls-actions two-col">
                    ${HIGHLIGHT_MODES.map(highlightButton).join("")}
                  </div>
                  ${highlightSettingsMarkup()}
                </section>
              </div>`
            : ""
        }
      </div>
      ${gridLegendMarkup()}
      <div class="grid-wrap">
        <table class="matchup-table">
          <thead>
            <tr>
              <th class="grid-corner">
                <span>${playerDot("row")}${PLAYER_NAMES.row} ↓</span>
                <span>${playerDot("column")}${PLAYER_NAMES.column} →</span>
              </th>
              ${state.columnDecks.map((_, index) => `<th data-col="${index}"></th>`).join("")}
              <th class="sum-col"><span>Total</span></th>
            </tr>
          </thead>
          <tbody>
            ${state.rowDecks
              .map(
                (_, rowIndex) => `
                <tr data-row="${rowIndex}">
                  <th data-row-header="${rowIndex}"></th>
                  ${state.columnDecks.map((__, colIndex) => `<td data-cell="${rowIndex}-${colIndex}"></td>`).join("")}
                  <td class="sum-cell">${totalValue("row", rowIndex)}</td>
                </tr>
              `
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <th class="sum-row-label">Total</th>
              ${state.columnDecks
                .map((_, colIndex) => `<td class="sum-cell">${totalValue("column", colIndex)}</td>`)
                .join("")}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function bindGridView() {
  state.columnDecks.forEach((name, index) => {
    const placeholder = app.querySelector(`[data-col="${index}"]`);
    if (placeholder) placeholder.replaceWith(buildHeaderCell(name, "column", index));
  });

  state.rowDecks.forEach((name, index) => {
    const placeholder = app.querySelector(`[data-row-header="${index}"]`);
    if (placeholder) placeholder.replaceWith(buildHeaderCell(name, "row", index));
  });

  state.matrix.forEach((row, rowIndex) => {
    row.forEach((cellData, colIndex) => {
      const placeholder = app.querySelector(`[data-cell="${rowIndex}-${colIndex}"]`);
      if (placeholder) placeholder.replaceWith(buildScoreCell(rowIndex, colIndex, cellData));
    });
  });

  onClick("[data-highlight-toggle]", () => {
    highlightOpen = !highlightOpen;
    accountOpen = false;
    render();
  });

  onClick("[data-highlight-close]", () => {
    highlightOpen = false;
    render();
  });

  onClick("[data-grid-fullscreen]", toggleGridFullscreen);
  const sortSelect = app.querySelector("[data-grid-sort]");
  if (sortSelect) {
    sortSelect.addEventListener("click", (event) => event.stopPropagation());
    sortSelect.addEventListener("change", (event) => applyGridSort(event.target.value));
  }
  onClick("[data-highlight-mode]", (el) => toggleHighlightMode(el.dataset.highlightMode));

  app.querySelectorAll("[data-filter]").forEach((input) => {
    input.addEventListener("change", (event) => {
      event.stopPropagation();
      setFilterValue(input.dataset.filter, event.target.value);
    });
  });

  const highlightPopover = app.querySelector("[data-highlight-popover]");
  if (highlightPopover) highlightPopover.addEventListener("click", (event) => event.stopPropagation());

  const gridWrap = app.querySelector(".grid-wrap");
  if (gridWrap) {
    restoreGridScrollPosition();
    gridWrap.addEventListener(
      "scroll",
      () => {
        gridScrollLeft = gridWrap.scrollLeft;
        gridScrollTop = gridWrap.scrollTop;
        if (activeEditor) positionActiveEditorPopover();
      },
      { passive: true }
    );
  }

  if (activeEditor) positionActiveEditorPopover();
}

function renderAtTop() {
  render();
  const view = app.querySelector("[data-view]");
  if (view) view.scrollTop = 0;
}

function onClick(selector, handler) {
  app.querySelectorAll(selector).forEach((el) => {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      handler(el);
    });
  });
}

function bindSharedEvents() {
  onClick("[data-tab]", (el) => setActiveTab(el.dataset.tab));
  onClick("[data-theme-toggle]", toggleTheme);
  onClick("[data-account-toggle]", () => {
    accountOpen = !accountOpen;
    highlightOpen = false;
    render();
  });

  const accountPopover = app.querySelector("[data-account-popover]");
  if (accountPopover) accountPopover.addEventListener("click", (event) => event.stopPropagation());

  onClick("[data-signout]", async () => {
    await supabase.auth.signOut();
  });

  onClick("[data-sync-retry]", retrySyncNow);
  onClick("[data-player-color]", (el) => {
    const [side, color] = el.dataset.playerColor.split(":");
    setPlayerColor(side, color);
  });

  const passwordForm = app.querySelector("[data-password-form]");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = String(new FormData(passwordForm).get("password") || "");
      const { error } = await supabase.auth.updateUser({ password });
      passwordMessage = error ? `Could not change password: ${error.message}` : "Password changed.";
      if (!error) passwordRecovery = false;
      accountOpen = true;
      render();
    });
  }

  onClick("[data-start-game]", () => startGame());
  bindTournamentEvents();
  onClick("[data-undo]", undoLastResult);
  onClick("[data-suggest]", suggestLeastPlayedPair);

  const rowSelect = app.querySelector("[data-log-row]");
  if (rowSelect) {
    rowSelect.addEventListener("change", (event) => {
      logPick.rowDeck = state.rowDecks[Number(event.target.value)];
      logPick.columnDeck = state.columnDecks[getLogIndexes().colIndex];
      render();
    });
  }

  const columnSelect = app.querySelector("[data-log-column]");
  if (columnSelect) {
    columnSelect.addEventListener("change", (event) => {
      logPick.columnDeck = state.columnDecks[Number(event.target.value)];
      logPick.rowDeck = state.rowDecks[getLogIndexes().rowIndex];
      render();
    });
  }

  onClick("[data-decks-axis]", (el) => {
    decksAxis = el.dataset.decksAxis;
    render();
  });
  onClick("[data-open-deck]", (el) => {
    const [axis, index] = el.dataset.openDeck.split(":");
    deckDetail = { axis, name: deckNameFor(axis, Number(index)) };
    renderAtTop();
  });
  onClick("[data-deck-back]", () => {
    deckDetail = null;
    renderAtTop();
  });
  onClick("[data-log-pair]", (el) => {
    const [rowIndex, colIndex] = el.dataset.logPair.split(":").map(Number);
    openPairInLog(rowIndex, colIndex);
  });


  const shell = app.querySelector(".app-shell");
  if (shell) {
    shell.addEventListener("click", () => {
      if (!accountOpen && !highlightOpen && !activeEditor) return;
      accountOpen = false;
      highlightOpen = false;
      activeEditor = null;
      render();
    });
  }
}

// ---------- Tournament ----------
// Each player ticks the same number of decks. Decks are ranked once by win rate, lowest or highest first.
// Each game uses one deck per player from the first decks in that order still in (how many is chosen at setup), drawn
// at random or chosen by the players. The losing (or, in "winner is out" mode, the winning) deck leaves;
// in loser-out mode the winner can keep their deck. The first player with no decks left ends it.

const DEFAULT_TOURNAMENT_DRAW_SIZE = 5;
const TOURNAMENT_MODES = [
  ["loser", "Loser is out"],
  ["winner", "Winner is out"]
];
const TOURNAMENT_AFTER = [
  ["both", "Both get new decks"],
  ["stays", "Winner keeps their deck"]
];
const TOURNAMENT_REVEAL = [
  ["open", "Show choices right away"],
  ["hidden", "Hide until both have chosen"]
];
const TOURNAMENT_DIRECTIONS = [
  ["low", "Lowest win rate"],
  ["high", "Highest win rate"]
];
const TOURNAMENT_PICKS = [
  ["random", "Random"],
  ["choose", "Choose yourselves"]
];

let tournamentSetup = null;
let tournament = loadTournament();
let tournamentEndArmed = false;
let tournamentPickScrollTop = 0;
let tournamentRemote = "unknown";
let tournamentSync = "idle";
let tournamentPushTimer = null;

function otherSide(side) {
  return side === "row" ? "column" : "row";
}

function loadTournament() {
  try {
    const saved = JSON.parse(window.localStorage.getItem("mtg-tournament") || "null");
    return saved && saved.order && saved.out ? saved : null;
  } catch {
    return null;
  }
}

function writeLocalTournament() {
  try {
    if (tournament) window.localStorage.setItem("mtg-tournament", JSON.stringify(tournament));
    else window.localStorage.removeItem("mtg-tournament");
  } catch {
    // The tournament still runs for this visit.
  }
}

// Every change is kept on this device and shared through Supabase (one row, id 1), so the other
// phone sees it and either phone can carry on later. Without the table it stays on this device.
function saveTournament() {
  if (tournament) tournament.updatedAt = new Date().toISOString();
  writeLocalTournament();
  pushTournament();
}

function isMissingTable(error) {
  const text = `${error.code || ""} ${error.message || ""}`;
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(text);
}

async function pushTournament() {
  if (!supabase || !currentUser || tournamentRemote === "unavailable") return;
  if (tournamentPushTimer) {
    window.clearTimeout(tournamentPushTimer);
    tournamentPushTimer = null;
  }

  tournamentSync = "saving";
  const { error } = await timed(
    supabase.from("tournament_state").upsert(
      {
        id: 1,
        data: tournament,
        updated_by: currentUser.id,
        updated_at: tournament ? tournament.updatedAt : new Date().toISOString()
      },
      { onConflict: "id" }
    )
  );

  if (!error) {
    tournamentRemote = "available";
    tournamentSync = "saved";
  } else if (isMissingTable(error)) {
    tournamentRemote = "unavailable";
    tournamentSync = "local";
  } else {
    tournamentSync = "error";
    tournamentPushTimer = window.setTimeout(pushTournament, 4000);
  }
  render();
}

// Takes the shared tournament unless this device has a newer change that is still on its way up.
function applyRemoteTournament(row) {
  const remoteTime = Date.parse(row.updated_at || 0) || 0;
  const localTime = tournament && tournament.updatedAt ? Date.parse(tournament.updatedAt) || 0 : 0;
  if (tournament && localTime > remoteTime) return;

  tournament = row.data || null;
  if (!tournament) tournamentEndArmed = false;
  writeLocalTournament();
  render();
}

async function loadRemoteTournament() {
  if (!supabase || !currentUser) return;
  const { data, error } = await timed(supabase.from("tournament_state").select("data, updated_at").eq("id", 1).maybeSingle());

  if (error) {
    if (isMissingTable(error)) {
      tournamentRemote = "unavailable";
      tournamentSync = "local";
    }
    return;
  }

  tournamentRemote = "available";
  if (!data) {
    // First time sharing is available: share a tournament this device already had.
    if (tournament) pushTournament();
    else tournamentSync = "saved";
    return;
  }
  tournamentSync = "saved";
  applyRemoteTournament(data);
}

// Only problems are shown; normal sharing happens silently.
function tournamentSyncNote() {
  if (tournamentRemote === "unavailable") return ["local", "Saved on this phone only. Sharing isn't set up in Supabase yet."];
  if (tournamentSync === "error") return ["error", "Not shared yet. Retrying…"];
  return null;
}

function deckRate(side, name) {
  const decks = side === "row" ? state.rowDecks : state.columnDecks;
  const index = decks.indexOf(name);
  return index === -1 ? null : getDeckSummary(side, index);
}

function byName(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function openTournamentSetup() {
  tournamentPickScrollTop = 0;
  tournamentSetup = {
    mode: "winner",
    after: "both",
    reveal: "open",
    direction: "low",
    pick: "choose",
    drawSize: null,
    picks: { row: [], column: [] }
  };
  renderAtTop();
}

function toggleTournamentPick(side, name) {
  const picks = tournamentSetup.picks[side];
  tournamentSetup.picks[side] = picks.includes(name) ? picks.filter((pick) => pick !== name) : [...picks, name];
  render();
}

function setAllTournamentPicks(side, all) {
  tournamentSetup.picks[side] = all ? [...(side === "row" ? state.rowDecks : state.columnDecks)] : [];
  render();
}

// The draw can use anything from the single first-ranked deck up to all the decks each player brought.
function setupDrawLimit() {
  return Math.min(tournamentSetup.picks.row.length, tournamentSetup.picks.column.length);
}

// Until it is set with − / +, it follows the number of decks picked (0 before anything is picked).
function setupDrawSize() {
  const limit = setupDrawLimit();
  if (tournamentSetup.drawSize === null) return limit;
  return Math.min(tournamentSetup.drawSize, limit);
}

function stepTournamentDraw(delta) {
  const limit = setupDrawLimit();
  if (limit < 1) return;
  tournamentSetup.drawSize = Math.max(1, Math.min(setupDrawSize() + delta, limit));
  render();
}

function deckKey(side) {
  return side === "row" ? "rowDeck" : "columnDeck";
}

function tournamentRemaining(side) {
  return tournament.order[side].filter((name) => !tournament.out[side].includes(name));
}

function tournamentDrawPool(side) {
  return tournamentRemaining(side).slice(0, tournament.drawSize || DEFAULT_TOURNAMENT_DRAW_SIZE);
}

function directionWord(direction) {
  return direction === "high" ? "highest" : "lowest";
}

function tournamentChooses() {
  return tournament.pick === "choose";
}

// Fills in the next game's decks. The side in keepSide keeps its deck; the others are drawn at random,
// or left empty for the player to choose.
function fillTournamentMatchup(keepSide) {
  ["row", "column"].forEach((side) => {
    if (side === keepSide) return;
    const pool = tournamentDrawPool(side);
    // With only one deck to pick from there is nothing to choose, so it is filled in either way.
    tournament.current[deckKey(side)] = tournamentChooses() && pool.length > 1 ? null : pool[Math.floor(Math.random() * pool.length)];
  });
}

function startTournament() {
  const { picks, mode, after, pick, reveal, direction } = tournamentSetup;
  if (!picks.row.length || picks.row.length !== picks.column.length) return;

  // Win rates are read once, here; the order and the rates shown stay fixed for the whole tournament.
  // Lowest or highest win rate first; decks with no games count as lowest, so in "highest" they come last.
  const startRates = { row: {}, column: {} };
  ["row", "column"].forEach((side) => {
    picks[side].forEach((name) => {
      startRates[side][name] = deckRate(side, name)?.rate ?? null;
    });
  });
  const rateFor = (side, name) => startRates[side][name] ?? -1;
  const rank = (side) =>
    [...picks[side]].sort((a, b) =>
      (direction === "high" ? rateFor(side, b) - rateFor(side, a) : rateFor(side, a) - rateFor(side, b)) || byName(a, b)
    );

  tournament = {
    mode,
    pick,
    direction,
    winnerStays: mode === "loser" && after === "stays",
    hideChoices: pick === "choose" && reveal === "hidden",
    startRates,
    drawSize: setupDrawSize(),
    order: { row: rank("row"), column: rank("column") },
    out: { row: [], column: [] },
    current: { rowDeck: null, columnDeck: null },
    kept: null,
    history: [],
    champion: null
  };
  fillTournamentMatchup(null);
  tournamentSetup = null;
  tournamentEndArmed = false;
  saveTournament();
  renderAtTop();
}

// Called when a tournament game's winner is logged.
function advanceTournament(winner) {
  if (!tournament || !tournament.current) return;
  const { rowDeck, columnDeck } = tournament.current;
  const outSide = tournament.mode === "loser" ? otherSide(winner) : winner;
  const outDeck = outSide === "row" ? rowDeck : columnDeck;

  tournament.out[outSide].push(outDeck);
  tournament.history.unshift({ rowDeck, columnDeck, winner, outSide, outDeck, keptBefore: tournament.kept || null });

  if (!tournamentRemaining(outSide).length) {
    // Loser is out: the player who still has decks wins. Winner is out: the player whose decks all won.
    tournament.champion = tournament.mode === "loser" ? otherSide(outSide) : outSide;
    tournament.current = null;
    tournament.kept = null;
  } else if (tournament.winnerStays) {
    // The winner plays on with the same deck; only the loser gets a new one.
    tournament.kept = winner;
    tournament.current = { rowDeck: winner === "row" ? rowDeck : null, columnDeck: winner === "column" ? columnDeck : null };
    fillTournamentMatchup(winner);
  } else {
    tournament.kept = null;
    tournament.current = { rowDeck: null, columnDeck: null };
    fillTournamentMatchup(null);
  }
  saveTournament();
}

function undoTournamentGame() {
  tournamentEndArmed = false;
  const last = tournament && tournament.history[0];
  if (!last) return;

  tournament.history.shift();
  tournament.out[last.outSide] = tournament.out[last.outSide].filter((name) => name !== last.outDeck);
  tournament.champion = null;
  tournament.current = { rowDeck: last.rowDeck, columnDeck: last.columnDeck };
  tournament.kept = last.keptBefore || null;
  saveTournament();

  // Also take the result back out of the stats, if it is still the most recent game logged here.
  const logged = sessionLog[0];
  if (logged && logged.rowDeck === last.rowDeck && logged.columnDeck === last.columnDeck && logged.winner === last.winner) {
    undoLastResult();
    return;
  }
  showToast("Tournament step undone. The result stays in the stats.");
  render();
}

function redrawTournamentMatchup() {
  tournamentEndArmed = false;
  fillTournamentMatchup(tournament.kept);
  saveTournament();
  render();
}

// From the second game on, the winner of the last game chooses first (when both players choose).
// With hidden choices nobody sees the other's pick, so the order doesn't matter and both choose freely.
function tournamentFirstChooser() {
  const t = tournament;
  if (!tournamentChooses() || t.hideChoices || t.kept || !t.current || !t.history.length) return null;
  const winner = t.history[0].winner;
  return t.current[deckKey(winner)] ? null : winner;
}

function canChooseTournamentDeck(side) {
  const t = tournament;
  if (!t.current || t.kept === side || t.current[deckKey(side)]) return false;
  const first = tournamentFirstChooser();
  return !first || first === side;
}

// While choices are hidden, a chosen deck stays secret until the other player has chosen too.
function tournamentChoiceHidden(side) {
  const t = tournament;
  if (!t.hideChoices || !t.current || t.kept === side) return false;
  return Boolean(t.current[deckKey(side)]) && !t.current[deckKey(otherSide(side))];
}

function chooseRandomTournamentDeck(side) {
  const pool = tournamentDrawPool(side);
  chooseTournamentDeck(side, pool[Math.floor(Math.random() * pool.length)]);
}

function chooseTournamentDeck(side, name) {
  tournamentEndArmed = false;
  if (!canChooseTournamentDeck(side) || !tournamentDrawPool(side).includes(name)) return;
  tournament.current[deckKey(side)] = name;
  saveTournament();
  render();
}

function changeTournamentChoice(side) {
  tournamentEndArmed = false;
  if (!tournament.current || tournament.kept === side) return;
  tournament.current[deckKey(side)] = null;
  saveTournament();
  render();
}

function endTournament() {
  if (!tournamentEndArmed) {
    tournamentEndArmed = true;
    render();
    return;
  }
  tournament = null;
  tournamentEndArmed = false;
  saveTournament();
  renderAtTop();
}

function startTournamentGame() {
  tournamentEndArmed = false;
  if (!tournament || !tournament.current || !tournament.current.rowDeck || !tournament.current.columnDeck) return;
  startGame(tournament.current.rowDeck, tournament.current.columnDeck, true);
}

function tournamentModeNote(mode) {
  return mode === "loser"
    ? "The losing deck leaves. A player wins when the other has no decks left."
    : "The winning deck leaves. A player wins when all their decks have won.";
}

function renderTournamentSetup() {
  const { picks, mode, after, pick } = tournamentSetup;
  const rowCount = picks.row.length;
  const columnCount = picks.column.length;
  const ready = rowCount > 0 && rowCount === columnCount;
  const drawSize = setupDrawSize();
  const drawLimit = setupDrawLimit();

  const checklist = (side) => {
    const decks = [...(side === "row" ? state.rowDecks : state.columnDecks)].sort(byName);
    return `<div class="card list">${decks
      .map((name) => {
        const summary = deckRate(side, name);
        const checked = picks[side].includes(name);
        return `<label class="list-row pick-row ${checked ? "is-picked" : ""}">
          <input type="checkbox" data-tournament-pick="${side}" value="${escapeHtml(name)}" ${checked ? "checked" : ""} />
          <span class="list-name">${escapeHtml(name)}</span>
          <span class="list-sub">${summary ? formatRate(summary.rate) : "–"}</span>
        </label>`;
      })
      .join("")}</div>`;
  };

  const playerBlock = (side) => `
    <div class="pick-head">
      <p class="section-label">${playerDot(side)}${PLAYER_NAMES[side]}'s decks · ${picks[side].length} picked</p>
      <div class="pick-shortcuts">
        <button type="button" class="link-button" data-tournament-all="${side}">All</button>
        <button type="button" class="link-button" data-tournament-none="${side}">None</button>
      </div>
    </div>
    ${checklist(side)}`;

  const status = ready
    ? `${rowCount} decks each. Ready to start.`
    : rowCount === 0 && columnCount === 0
      ? "Tick the decks each of you wants to bring."
      : `Pick the same number of decks: ${PLAYER_NAMES.row} ${rowCount}, ${PLAYER_NAMES.column} ${columnCount}.`;

  const edge = directionWord(tournamentSetup.direction);
  const firstDecks = drawSize === 1 ? `${edge}-ranked deck` : `${drawSize} ${edge}-ranked decks`;
  const pickNote = drawSize === 0
    ? "Follows how many decks you each pick below. Lower it with − if you want fewer to pick from."
    : pick === "choose"
      ? drawSize === 1
        ? `You each play your ${edge}-ranked deck still in.`
        : `You each choose your deck yourselves from your ${firstDecks} still in.`
      : drawSize === 1
        ? `Each game uses each player's ${edge}-ranked deck still in.`
        : `Each game draws at random from each player's ${firstDecks} still in.`;

  return `
    <section class="view-stack tournament-setup">
      <div class="view-head">
        <h2>Tournament</h2>
        ${menuMarkup()}
      </div>
      <div class="pick-scroll" data-pick-scroll>
        ${segmentedMarkup(TOURNAMENT_MODES, mode, "data-tournament-mode")}
        <p class="view-note">${tournamentModeNote(mode)}</p>
        ${
          mode === "loser"
            ? `<p class="section-label">After each game</p>
              ${segmentedMarkup(TOURNAMENT_AFTER, after, "data-tournament-after")}
              <p class="view-note">${
                after === "stays"
                  ? "The winner plays on with the same deck. Only the loser gets a new deck."
                  : "Both players get a new deck for every game."
              }</p>`
            : ""
        }
        <p class="section-label">How decks are picked</p>
        ${segmentedMarkup(TOURNAMENT_PICKS, pick, "data-tournament-pick-mode")}
        ${
          pick === "choose"
            ? `${segmentedMarkup(TOURNAMENT_REVEAL, tournamentSetup.reveal, "data-tournament-reveal")}
              <p class="view-note">${
                tournamentSetup.reveal === "hidden"
                  ? "Your choice stays secret until the other player has chosen too, so you can both choose at the same time."
                  : "You see each other's choice right away. From the second game on, the last winner chooses first."
              }</p>`
            : ""
        }
        <p class="section-label">Start from</p>
        ${segmentedMarkup(TOURNAMENT_DIRECTIONS, tournamentSetup.direction, "data-tournament-direction")}
        <div class="card stepper-card">
          <span class="stepper-label">From the ${edge}</span>
          <div class="draw-stepper">
            <button type="button" data-tournament-draw-step="-1" aria-label="Fewer decks to pick from" ${drawSize <= 1 ? "disabled" : ""}>−</button>
            <b>${drawSize}</b>
            <button type="button" data-tournament-draw-step="1" aria-label="More decks to pick from" ${drawSize >= drawLimit ? "disabled" : ""}>+</button>
          </div>
        </div>
        <p class="view-note">${pickNote}</p>
        ${playerBlock("row")}
        ${playerBlock("column")}
      </div>
      <div class="tournament-footer">
        <p class="view-note ${ready ? "" : "is-warning-note"}">${status}</p>
        <button type="button" class="start-game-button" data-tournament-start ${ready ? "" : "disabled"}>Start tournament</button>
        <button type="button" class="ghost-button" data-tournament-cancel>Cancel</button>
      </div>
    </section>
  `;
}

function renderTournamentView() {
  const t = tournament;
  const modeLabel = TOURNAMENT_MODES.find(([id]) => id === t.mode)[1];
  const chooses = tournamentChooses();
  const startRateOf = (side, name) => (t.startRates ? t.startRates[side][name] ?? null : null);

  // Each deck's wins and losses within this tournament, from its own game history.
  const tournamentRecord = (side, name) => {
    let wins = 0;
    let losses = 0;
    t.history.forEach((game) => {
      if (game[deckKey(side)] !== name) return;
      if (game.winner === side) wins += 1;
      else losses += 1;
    });
    return { wins, losses };
  };

  const deckList = (side) => {
    const pool = tournamentDrawPool(side);
    const playing = t.current && !tournamentChoiceHidden(side) ? t.current[deckKey(side)] : null;
    return `<div class="card list">${t.order[side]
      .map((name, rank) => {
        const out = t.out[side].includes(name);
        const status = out
          ? ["out", "Out"]
          : name === playing
            ? t.kept === side
              ? ["playing", "Stays"]
              : ["playing", "Playing"]
            : pool.includes(name)
              ? ["draw", chooses ? "Can be chosen" : "In the draw"]
              : ["waiting", "Waiting"];
        const here = tournamentRecord(side, name);
        return `<div class="list-row tournament-deck is-${status[0]}">
          <span class="list-main"><span class="list-name">${rank + 1}. ${escapeHtml(name)}</span>
            <span class="list-sub">${here.wins}–${here.losses} here · ${formatRate(startRateOf(side, name))} at start</span></span>
          <span class="verdict-chip is-${status[0]}">${status[1]}</span>
        </div>`;
      })
      .join("")}</div>`;
  };

  // One player's part of the next game: their deck, or the decks they can choose from.
  const sideBlock = (side) => {
    const deck = t.current[deckKey(side)];
    if (deck && tournamentChoiceHidden(side)) {
      return `<div class="next-side">
        <span class="next-deck is-secret">${playerDot(side)}${PLAYER_NAMES[side]} has chosen ✓</span>
        <span class="next-note">Shown when ${PLAYER_NAMES[otherSide(side)]} has chosen too</span>
        <button type="button" class="link-button" data-tournament-change="${side}">Change</button>
      </div>`;
    }
    if (!deck && !canChooseTournamentDeck(side)) {
      return `<div class="next-side">
        <p class="section-label">${playerDot(side)}${PLAYER_NAMES[side]}</p>
        <span class="next-note is-waiting">Waiting for ${PLAYER_NAMES[otherSide(side)]} to choose first (won last game)</span>
      </div>`;
    }
    if (deck) {
      const canChange = chooses && t.kept !== side;
      return `<div class="next-side">
        <span class="next-deck ink-${side}">${playerDot(side)}${escapeHtml(deck)}</span>
        ${t.kept === side ? `<span class="next-note">Won last game, plays on</span>` : ""}
        ${canChange ? `<button type="button" class="link-button" data-tournament-change="${side}">Change</button>` : ""}
      </div>`;
    }
    // Once the opponent's deck is known (chosen openly, or kept by the last winner), each option shows
    // its record against that deck instead of the start win rate.
    const opponentDeck = t.current[deckKey(otherSide(side))];
    const versus = opponentDeck && !tournamentChoiceHidden(otherSide(side)) ? opponentDeck : null;
    const optionNote = (name) => {
      if (!versus) return `${formatRate(startRateOf(side, name))} at start`;
      const indexes = side === "row" ? getCellIndexesByDeckNames(name, versus) : getCellIndexesByDeckNames(versus, name);
      const record = indexes ? getRecord(state.matrix[indexes.rowIndex][indexes.colIndex]) : null;
      if (!record || !record.games) return `No games vs ${escapeHtml(versus)}`;
      const own = side === "row" ? record.rowWins : record.columnWins;
      const theirs = side === "row" ? record.columnWins : record.rowWins;
      return `${own}–${theirs} vs ${escapeHtml(versus)}`;
    };
    const grid = `<div class="choose-grid">${tournamentDrawPool(side)
      .map(
        (name) => `<button type="button" class="choose-button" data-tournament-choose="${side}" data-deck="${escapeHtml(name)}">
          <span>${escapeHtml(name)}</span><small>${optionNote(name)}</small>
        </button>`
      )
      .join("")}</div>`;
    const randomButton = `<button type="button" class="random-pick" data-tournament-random="${side}">Random deck</button>`;
    // Random sits on the outside (above the top list, below the bottom one), so the two sets of decks
    // meet around "vs" and are easy to compare.
    return `<div class="next-side">
      <p class="section-label">${playerDot(side)}${PLAYER_NAMES[side]}: choose a deck${tournamentFirstChooser() === side ? " (you won, you choose first)" : ""}</p>
      ${side === "row" ? `${randomButton}${grid}` : `${grid}${randomButton}`}
    </div>`;
  };

  // Each deck's overall win rate when the tournament started, and now.
  const winRateChangesMarkup = () => {
    const block = (side) => `<p class="section-label">${playerDot(side)}${PLAYER_NAMES[side]}'s decks</p>
      <div class="card list">${t.order[side]
        .map((name) => {
          const before = startRateOf(side, name);
          const summary = deckRate(side, name);
          const now = summary ? summary.rate : null;
          const change = before !== null && now !== null ? now - before : null;
          const changeText = change === null ? "" : change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : "±0";
          const changeClass = change > 0 ? "is-up" : change < 0 ? "is-down" : "is-same";
          return `<div class="list-row rate-change-row">
            <span class="list-name">${escapeHtml(name)}</span>
            <span class="rate-change">${formatRate(before)} → ${formatRate(now)}</span>
            <span class="rate-delta ${changeClass}">${changeText}</span>
          </div>`;
        })
        .join("")}</div>`;
    return `<p class="section-label">Win rate changes</p>${block("row")}${block("column")}`;
  };

  let main;
  if (t.champion) {
    main = `<article class="card champion-card is-${t.champion}">
      <p class="section-label">Tournament winner</p>
      <p class="champion-name">${PLAYER_NAMES[t.champion]}</p>
      <p class="view-note">${t.history.length} games played · ${modeLabel.toLowerCase()}</p>
    </article>
    ${winRateChangesMarkup()}`;
  } else {
    const { rowDeck, columnDeck } = t.current;
    const ready = Boolean(rowDeck && columnDeck);
    const indexes = ready ? getCellIndexesByDeckNames(rowDeck, columnDeck) : null;
    const record = indexes ? getRecord(state.matrix[indexes.rowIndex][indexes.colIndex]) : null;
    const redrawLabel = t.kept ? `Draw another deck for ${PLAYER_NAMES[otherSide(t.kept)]}` : "Draw another matchup";
    main = `<article class="card h2h-card next-card">
      <p class="section-label">Next game</p>
      ${sideBlock("row")}
      <span class="vs-mark">vs</span>
      ${sideBlock("column")}
      ${record ? `${splitBarMarkup(record.rowWins, record.columnWins)}<p class="h2h-note">${record.rowWins}–${record.columnWins} so far</p>` : ""}
    </article>
    <button type="button" class="start-game-button" data-tournament-play ${ready ? "" : "disabled"}>${
      ready ? "Start game" : "Choose both decks to start"
    }</button>
    ${chooses ? "" : `<button type="button" class="ghost-button" data-tournament-redraw>${redrawLabel}</button>`}`;
  }

  const history = t.history.length
    ? `<p class="section-label">Games</p>
      <div class="card list">${t.history
        .map((game) => {
          const winnerDeck = game.winner === "row" ? game.rowDeck : game.columnDeck;
          const loserDeck = game.winner === "row" ? game.columnDeck : game.rowDeck;
          return `<div class="log-item">${playerDot(game.winner)}<span>${escapeHtml(winnerDeck)} beat ${escapeHtml(loserDeck)}</span></div>`;
        })
        .join("")}</div>`
    : "";

  const rules = [
    modeLabel,
    t.winnerStays ? "winner keeps deck" : "",
    t.hideChoices ? "hidden choices" : "",
    `${chooses ? "chosen" : "random"} from ${directionWord(t.direction)} ${t.drawSize || DEFAULT_TOURNAMENT_DRAW_SIZE}`
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <section class="view-stack">
      <div class="view-head">
        <h2>Tournament</h2>
        ${menuMarkup()}
      </div>
      ${tournamentSyncNote() ? `<p class="save-state is-${tournamentSyncNote()[0]}">${tournamentSyncNote()[1]}</p>` : ""}
      <p class="view-note">${rules}</p>
      <p class="view-note">${PLAYER_NAMES.row} ${tournamentRemaining("row").length} left · ${PLAYER_NAMES.column} ${
        tournamentRemaining("column").length
      } left</p>
      ${main}
      <p class="section-label">${playerDot("row")}${PLAYER_NAMES.row}'s decks, ${directionWord(t.direction)} win rate first</p>
      ${deckList("row")}
      <p class="section-label">${playerDot("column")}${PLAYER_NAMES.column}'s decks, ${directionWord(t.direction)} win rate first</p>
      ${deckList("column")}
      ${history}
      <div class="two-buttons">
        <button type="button" class="ghost-button" data-tournament-undo ${t.history.length ? "" : "disabled"}>Undo last game</button>
        <button type="button" class="ghost-button ${tournamentEndArmed ? "is-danger" : ""}" data-tournament-end>${
          tournamentEndArmed ? "Tap again to end" : t.champion ? "Finish tournament" : "End tournament"
        }</button>
      </div>
    </section>
  `;
}

function bindTournamentEvents() {
  onClick("[data-tournament-open]", openTournamentSetup);
  onClick("[data-tournament-draw-step]", (el) => stepTournamentDraw(Number(el.dataset.tournamentDrawStep)));
  onClick("[data-tournament-mode]", (el) => {
    tournamentSetup.mode = el.dataset.tournamentMode;
    render();
  });
  onClick("[data-tournament-after]", (el) => {
    tournamentSetup.after = el.dataset.tournamentAfter;
    render();
  });
  onClick("[data-tournament-direction]", (el) => {
    tournamentSetup.direction = el.dataset.tournamentDirection;
    render();
  });
  onClick("[data-tournament-reveal]", (el) => {
    tournamentSetup.reveal = el.dataset.tournamentReveal;
    render();
  });
  onClick("[data-tournament-random]", (el) => chooseRandomTournamentDeck(el.dataset.tournamentRandom));
  onClick("[data-tournament-pick-mode]", (el) => {
    tournamentSetup.pick = el.dataset.tournamentPickMode;
    render();
  });
  onClick("[data-tournament-all]", (el) => setAllTournamentPicks(el.dataset.tournamentAll, true));
  onClick("[data-tournament-none]", (el) => setAllTournamentPicks(el.dataset.tournamentNone, false));
  onClick("[data-tournament-start]", startTournament);
  onClick("[data-tournament-cancel]", () => {
    tournamentSetup = null;
    renderAtTop();
  });
  onClick("[data-tournament-play]", startTournamentGame);
  onClick("[data-tournament-redraw]", redrawTournamentMatchup);
  onClick("[data-tournament-choose]", (el) => chooseTournamentDeck(el.dataset.tournamentChoose, el.dataset.deck));
  onClick("[data-tournament-change]", (el) => changeTournamentChoice(el.dataset.tournamentChange));
  onClick("[data-tournament-undo]", undoTournamentGame);
  onClick("[data-tournament-end]", endTournament);

  app.querySelectorAll("[data-tournament-pick]").forEach((input) => {
    input.addEventListener("change", () => toggleTournamentPick(input.dataset.tournamentPick, input.value));
  });
}

// ---------- Life counter ----------

async function keepScreenOn() {
  if (!navigator.wakeLock || (wakeLock && !wakeLock.released)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

function releaseScreen() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

function newGameState(rowDeck, columnDeck, inTournament = false) {
  return {
    rowDeck,
    columnDeck,
    inTournament,
    life: { row: 20, column: 20 },
    delta: { row: 0, column: 0 },
    menuOpen: false,
    logged: null
  };
}

function startGame(rowDeck, columnDeck, inTournament = false) {
  if (!rowDeck || !columnDeck) {
    const { rowIndex, colIndex } = getLogIndexes();
    rowDeck = state.rowDecks[rowIndex];
    columnDeck = state.columnDecks[colIndex];
  }
  game = newGameState(rowDeck, columnDeck, inTournament);
  accountOpen = false;
  render();

  freshenSession(55);
  startGameSessionKeeper();

  keepScreenOn();
  // Hide the browser bars where allowed (not on iPhone); the counter fills the window either way.
  const root = document.documentElement;
  if (root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
}

// Browsers drop full screen when you leave for another app or tab; the game menu can bring it back.
function canUseFullscreen() {
  return Boolean(document.documentElement.requestFullscreen && document.exitFullscreen);
}

function toggleGameFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  game.menuOpen = false;
  render();
  keepScreenOn();
  document.documentElement.requestFullscreen().catch(() => {});
}

function restartGame() {
  game = newGameState(game.rowDeck, game.columnDeck, game.inTournament);
  render();
}

function closeGame() {
  if (!game.inTournament) logPick = { rowDeck: game.rowDeck, columnDeck: game.columnDeck };
  game = null;
  releaseScreen();
  stopGameSessionKeeper();
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  render();
}

// Holding a − / + side for 0.5 s changes life by 10, once per hold.
const LIFE_HOLD_MS = 500;
let lifeHold = null;
let suppressLifeClickUntil = 0;

function startLifeHold(side, direction) {
  stopLifeHold();
  lifeHold = {
    timer: window.setTimeout(() => {
      if (!game || !lifeHold) return;
      lifeHold.fired = true;
      // The tap that ends this hold must not add ±1 on top.
      suppressLifeClickUntil = Infinity;
      changeLife(side, direction * 10);
      if (navigator.vibrate) navigator.vibrate(15);
    }, LIFE_HOLD_MS)
  };
}

function stopLifeHold() {
  if (!lifeHold) return;
  window.clearTimeout(lifeHold.timer);
  if (lifeHold.fired) suppressLifeClickUntil = Date.now() + 400;
  lifeHold = null;
}

function changeLife(side, amount) {
  game.life[side] += amount;
  game.delta[side] += amount;

  // Show the running change ("+5", "−3") until nobody has tapped that side for 4 seconds.
  window.clearTimeout(lifeDeltaTimers[side]);
  lifeDeltaTimers[side] = window.setTimeout(() => {
    if (!game) return;
    game.delta[side] = 0;
    render();
  }, 4000);

  render();
}

function logGameWinner(winner) {
  const indexes = getCellIndexesByDeckNames(game.rowDeck, game.columnDeck);
  if (!indexes) {
    showToast("These decks were renamed. Close the game and log it from New game.");
    render();
    return;
  }

  game.logged = winner;
  if (game.inTournament) advanceTournament(winner);
  recordResult(indexes.rowIndex, indexes.colIndex, winner);
}

function lifeHalfMarkup(side) {
  const deck = side === "row" ? game.rowDeck : game.columnDeck;
  const delta = game.delta[side];
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : "";
  const name = PLAYER_NAMES[side];

  return `<section class="life-half is-${side}" aria-label="${name}'s life">
    <button type="button" class="life-button" data-life="${side}" data-amount="-1" aria-label="${name}: lose 1 life">−</button>
    <div class="life-center">
      <p class="life-owner">${playerDot(side)}${name} · ${escapeHtml(deck)}</p>
      <p class="life-total" aria-live="polite">${game.life[side]}</p>
      <p class="life-delta">${deltaText}</p>
    </div>
    <button type="button" class="life-button" data-life="${side}" data-amount="1" aria-label="${name}: gain 1 life">+</button>
  </section>`;
}

// Whether the game just logged from the life counter has been stored in Supabase yet.
function loggedSaveState() {
  if (hasPendingCellOp(game.rowDeck, game.columnDeck)) {
    if (!navigator.onLine) return { kind: "error", label: "Not saved yet: you're offline. It's sent when you're back online." };
    if (saveStatus === "error") return { kind: "error", label: "Not saved yet. Retrying…" };
    return { kind: "saving", label: "Saving…" };
  }
  return { kind: "saved", label: "Saved ✓" };
}

function gameMenuMarkup() {
  if (!game.menuOpen) return "";

  const deckOf = (side) => escapeHtml(side === "row" ? game.rowDeck : game.columnDeck);
  const champion = game.inTournament && tournament && tournament.champion;
  const save = game.logged ? loggedSaveState() : null;
  const waiting = save && save.kind === "saving";
  const failed = save && save.kind === "error";
  // While saving, moving on is blocked (usually under a second); after a failure it is allowed but
  // says plainly that the save is still pending.
  const moveOn = (label) => (failed ? `${label} anyway (keeps retrying)` : label);
  const holdAttr = waiting ? "disabled" : "";
  const result = game.logged
    ? `<p class="game-menu-note">${playerDot(game.logged)}Logged: ${PLAYER_NAMES[game.logged]}'s ${deckOf(game.logged)} won</p>
      <p class="save-state is-big is-${save.kind}" role="status">${save.label}</p>${
        champion ? `<p class="game-menu-note is-champion">${playerDot(champion)}${PLAYER_NAMES[champion]} wins the tournament</p>` : ""
      }`
    : `<p class="section-label">Who won?</p>
      <div class="win-buttons">
        <button type="button" class="win-button is-row" data-game-win="row">${deckOf("row")}<small>${PLAYER_NAMES.row}</small></button>
        <button type="button" class="win-button is-column" data-game-win="column">${deckOf("column")}<small>${PLAYER_NAMES.column}</small></button>
      </div>`;

  return `<div class="game-menu-backdrop" data-game-backdrop>
    <div class="game-menu" role="dialog" aria-label="Game menu">
      ${syncBannerMarkup({ showProgress: false })}
      <div class="game-menu-result">${result}</div>
      <div class="game-menu-actions">${
        game.inTournament && game.logged
          ? `<button type="button" class="ghost-button is-wide" data-game-close ${holdAttr}>${moveOn(champion ? "See the tournament" : "Next matchup")}</button>`
          : `${
            canUseFullscreen()
              ? `<button type="button" class="ghost-button" data-game-resume>Back to game</button>
        <button type="button" class="ghost-button" data-game-fullscreen>${document.fullscreenElement ? "Exit full screen" : "Full screen"}</button>`
              : `<button type="button" class="ghost-button is-wide" data-game-resume>Back to game</button>`
          }
        <button type="button" class="ghost-button" data-game-restart ${holdAttr}>${game.logged ? moveOn("Rematch") : "Restart game"}</button>
        <button type="button" class="ghost-button" data-game-close ${holdAttr}>${game.logged ? moveOn(game.inTournament ? "Back to tournament" : "Close game") : game.inTournament ? "Back to tournament" : "Close game"}</button>`
      }
      </div>
    </div>
  </div>`;
}

function renderGameScreen() {
  app.innerHTML = `
    <div class="game-screen">
      ${lifeHalfMarkup("column")}
      <div class="game-seam">
        <button type="button" class="game-menu-button" data-game-menu aria-label="Game menu" aria-expanded="${game.menuOpen}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>
        </button>
      </div>
      ${lifeHalfMarkup("row")}
      ${gameMenuMarkup()}
      ${actionToast && !game.menuOpen ? `<p class="toast game-toast" role="status">${escapeHtml(actionToast)}</p>` : ""}
    </div>
  `;

  // A tap is ±1; the click that ends a hold is ignored, since the hold already counted ±10.
  onClick("[data-life]", (el) => {
    if (Date.now() < suppressLifeClickUntil) return;
    changeLife(el.dataset.life, Number(el.dataset.amount));
  });
  onClick("[data-game-menu]", () => {
    game.menuOpen = !game.menuOpen;
    if (game.menuOpen) freshenSession(10);
    render();
  });
  onClick("[data-game-win]", (el) => logGameWinner(el.dataset.gameWin));
  onClick("[data-game-restart]", restartGame);
  onClick("[data-game-close]", closeGame);
  onClick("[data-game-resume]", () => {
    game.menuOpen = false;
    render();
  });
  onClick("[data-game-fullscreen]", toggleGameFullscreen);
  onClick("[data-sync-retry]", retrySyncNow);

  const backdrop = app.querySelector("[data-game-backdrop]");
  if (backdrop) {
    backdrop.addEventListener("click", (event) => {
      if (event.target !== backdrop) return;
      game.menuOpen = false;
      render();
    });
  }
}

function renderAppScreen() {
  if (game) {
    renderGameScreen();
    return;
  }

  const views = {
    log: renderLogView,
    decks: renderDecksView,
    grid: renderGridView
  };

  app.innerHTML = `
    <div class="app-shell ${activeTab === "grid" && gridExpanded ? "is-expanded" : ""}">
      <header class="app-header">${syncBannerMarkup()}</header>
      <main class="app-view ${activeTab === "grid" ? "is-grid" : ""} ${
        activeTab === "log" && tournamentSetup && !tournament ? "is-fixed" : ""
      }" data-view="${activeTab}">
        ${views[activeTab]()}
      </main>
      ${actionToast ? `<p class="toast" role="status">${escapeHtml(actionToast)}</p>` : ""}
      <nav class="tab-bar" aria-label="Sections">
        ${TABS.map(
          (tab) =>
            `<button type="button" class="tab-button ${tab.id === activeTab ? "on" : ""}" data-tab="${tab.id}" ${
              tab.id === activeTab ? 'aria-current="page"' : ""
            } aria-label="${tab.label}" title="${tab.label}"><svg viewBox="0 0 24 24" aria-hidden="true">${tab.icon}</svg></button>`
        ).join("")}
      </nav>
    </div>
  `;

  const view = app.querySelector("[data-view]");
  if (view) view.scrollTop = viewScrollTop[activeTab] || 0;
  const pickScroll = app.querySelector("[data-pick-scroll]");
  if (pickScroll) pickScroll.scrollTop = tournamentPickScrollTop;

  if (activeTab === "grid") bindGridView();
  bindSharedEvents();
}

function render() {
  captureScrollPositions();

  if (isInitializing) {
    app.innerHTML = `<main class="auth-shell"><section class="auth-card"><p>Loading...</p></section></main>`;
    return;
  }

  if (!currentUser) {
    renderAuthScreen(!supabase);
    return;
  }

  // Background sync redraws the screen; keep a half-typed password and its focus.
  const passwordInput = app.querySelector("[data-password-form] input");
  const typedPassword = passwordInput ? passwordInput.value : "";
  const passwordFocused = passwordInput && document.activeElement === passwordInput;

  renderAppScreen();

  const nextPasswordInput = app.querySelector("[data-password-form] input");
  if (nextPasswordInput && typedPassword) nextPasswordInput.value = typedPassword;
  if (nextPasswordInput && passwordFocused) nextPasswordInput.focus();
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
    sessionLog = [];
    game = null;
    stopGameSessionKeeper();
    tournamentSetup = null;
    releaseScreen();
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
  clearUnsortedOrder();

  try {
    await loadRemoteState();
    await loadRemoteTournament();
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

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      passwordRecovery = true;
      accountOpen = true;
      passwordMessage = "Choose a new password below.";
    }
    await handleSession(session);
  });

  // Phones pause pages in the background; catch up and flush unsaved games when it comes back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    retrySyncNow();
    // The browser drops the screen wake lock when the page is hidden.
    if (game) {
      keepScreenOn();
      freshenSession(15);
    }
  });
  window.addEventListener("online", () => {
    retrySyncNow();
    render();
  });
  window.addEventListener("offline", render);
  document.addEventListener("pointerdown", (event) => {
    const button = event.target instanceof Element ? event.target.closest("[data-life]") : null;
    if (button && game) startLifeHold(button.dataset.life, Math.sign(Number(button.dataset.amount)));
  });
  ["pointerup", "pointercancel", "blur"].forEach((name) => window.addEventListener(name, stopLifeHold));
  document.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-life]")) event.preventDefault();
  });
  // Keep the game menu's full screen button label in step with the browser.
  document.addEventListener("fullscreenchange", () => {
    if (game && game.menuOpen) render();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  isInitializing = false;
  render();
}

initApp();
