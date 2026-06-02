const STEAM_LOGO =
  "https://upload.wikimedia.org/wikipedia/commons/c/c1/Steam_Logo.png";
const PLACEHOLDER_IMG = "https://via.placeholder.com/50";
const GAMES_PER_PAGE = 100;
const PRICE_CHUNK_SIZE = 100;
const CURRENCY_SYMBOLS = { UAH: "₴", USD: "$", EUR: "€", PLN: "zł" };

const state = {
  priceCache: {},
  allGames: [],
  allFriends: [],
  activeFilter: null,
  renderGamesRef: null,
  sortLettersHandler: null,
  sortTimeHandler: null,
};

const dom = {
  loader: document.querySelector(".loader"),
  steamInput: document.getElementById("steamIdInput"),
  clearbtn: document.querySelector(".clearbtn"),
  resultDiv: document.getElementById("result"),
  submitBtn: document.getElementById("submitBtn"),
  letters: document.querySelector(".letters"),
  time: document.querySelector(".time"),
  form: document.querySelector(".st"),
  btnFree: document.querySelector(".free"),
  btnDiscount: document.querySelector(".discount"),
  btnUnavailable: document.querySelector(".unavailable"),
  btnClearFilter: document.querySelector(".clearfil"),
};

function showLoader() {
  dom.loader.classList.remove("loader--hidden");
}
function hideLoader() {
  dom.loader.classList.add("loader--hidden");
}

function formatPlaytime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatPrice(price) {
  if (price === undefined) return `<span class="price__loading">...</span>`;
  if (price === null) return `<span class="price__error">—</span>`;

  switch (price.status) {
    case "free":
      return `<span class="price__free">🆓 Безкоштовно</span>`;
    case "unavailable":
      return `<span class="price__unavailable">🚫 Недоступна</span>`;
    case "price":
      return price.discount_percent > 0
        ? `<s class="price__original">${price.initial_formatted}</s>
           <strong class="price__final">${price.final_formatted}</strong>
           <span class="price__discount">-${price.discount_percent}%</span>`
        : `<strong class="price__normal">${price.final_formatted}</strong>`;
    default:
      return `<span class="price__error">—</span>`;
  }
}

function getGameImageUrl(appid, imgHash) {
  return imgHash
    ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${imgHash}.jpg`
    : PLACEHOLDER_IMG;
}

function showAlert(text, timer = 2000) {
  Swal.fire({
    title: "steam user info",
    text,
    imageUrl: STEAM_LOGO,
    imageWidth: 100,
    imageHeight: 100,
    imageAlt: "Steam logo",
    color: "#007bff",
    confirmButtonColor: "#007bff",
    backdrop: "rgba(255, 255, 255, 0.5)",
    timer,
    timerProgressBar: true,
  });
}

function matchesPriceFilter(appid) {
  if (!state.activeFilter) return true;
  const price = state.priceCache[String(appid)];
  if (price === undefined) return true;

  switch (state.activeFilter) {
    case "free":
      return price?.status === "free";
    case "discount":
      return price?.status === "price" && price.discount_percent > 0;
    case "unavailable":
      return price?.status === "unavailable";
    default:
      return true;
  }
}

function updateFilterButtons() {
  const map = {
    free: dom.btnFree,
    discount: dom.btnDiscount,
    unavailable: dom.btnUnavailable,
  };

  Object.values(map).forEach((btn) => btn?.classList.remove("active"));

  const activeBtn = map[state.activeFilter];
  activeBtn?.classList.add("active");
}

function setupFilterButton(btn, filterName) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    state.activeFilter = state.activeFilter === filterName ? null : filterName;
    updateFilterButtons();
    state.renderGamesRef?.();
  });
}

function updateTotalSpent() {
  const spentEl = document.getElementById("total-spent");
  const spentCountEl = document.getElementById("total-spent-count");
  if (!spentEl || !spentCountEl) return;

  let totalMinUnits = 0;
  let currency = "";
  let countedGames = 0;
  let loadedGames = 0;

  for (const game of state.allGames) {
    const price = state.priceCache[String(game.appid)];
    if (price === undefined) continue;

    loadedGames++;

    if (price?.status === "price" && price.final > 0) {
      totalMinUnits += price.final;
      countedGames++;
      if (!currency) currency = price.currency || "";
    }
  }

  const total = totalMinUnits / 100;
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const pct =
    state.allGames.length > 0
      ? Math.round((loadedGames / state.allGames.length) * 100)
      : 0;

  spentEl.textContent = countedGames > 0 ? `${symbol} ${total}` : "...";
  spentCountEl.textContent = `за ${countedGames} платних ігор (завантажено ${pct}% цін)`;
}

function logPriceResult(appid, price) {
  const game = state.allGames.find((g) => String(g.appid) === appid);
  const name = game?.name || appid;

  if (!price) console.log(`❌ ${name} — помилка API`);
  else if (price.status === "free") console.log(`🆓 ${name} — Безкоштовно`);
  else if (price.status === "unavailable")
    console.log(`🚫 ${name} — Недоступна`);
  else if (price.status === "price") {
    const discount =
      price.discount_percent > 0 ? ` (-${price.discount_percent}%)` : "";
    console.log(`💰 ${name} — ${price.final_formatted}${discount}`);
  }
}

function applyPriceToCard(id) {
  const priceEl = document.querySelector(`.game-price[data-appid="${id}"]`);
  if (!priceEl) return;

  priceEl.innerHTML = formatPrice(state.priceCache[String(id)]);

  if (state.activeFilter) {
    const gameItem = priceEl.closest("a.game-item");
    if (gameItem) {
      gameItem.style.display = matchesPriceFilter(id) ? "" : "none";
    }
  }
}

async function fetchPricesChunk(chunk) {
  try {
    const res = await fetch(`/prices?appids=${chunk.join(",")}&cc=ua`);
    if (!res.ok) {
      chunk.forEach((id) => (state.priceCache[String(id)] = null));
      return;
    }

    const data = await res.json();
    Object.assign(state.priceCache, data);

    Object.entries(data).forEach(([appid, price]) =>
      logPriceResult(appid, price),
    );
    chunk.forEach((id) => applyPriceToCard(id));

    updateTotalSpent();
  } catch (err) {
    console.error("Price fetch error:", err);
    chunk.forEach((id) => (state.priceCache[String(id)] = null));
  }
}

async function fetchPricesAndUpdate(appids) {
  const missing = appids.filter((id) => !(String(id) in state.priceCache));
  if (missing.length === 0) return;

  for (let i = 0; i < missing.length; i += PRICE_CHUNK_SIZE) {
    await fetchPricesChunk(missing.slice(i, i + PRICE_CHUNK_SIZE));
  }
}

function createGameCard(game) {
  const cachedPrice =
    String(game.appid) in state.priceCache
      ? state.priceCache[String(game.appid)]
      : undefined;

  const card = document.createElement("a");
  card.href = `https://store.steampowered.com/app/${game.appid}/`;
  card.target = "_blank";
  card.classList.add("game-item");
  card.innerHTML = `
    <img src="${getGameImageUrl(game.appid, game.img_icon_url)}" alt="Game Icon" width="50" height="50"><br>
    ${game.name || "Unknown Game"}<br>
    <p class="playtime">${formatPlaytime(game.playtime_forever)}</p>
    <p class="game-price" data-appid="${game.appid}">${formatPrice(cachedPrice)}</p>
  `;

  if (state.activeFilter && String(game.appid) in state.priceCache) {
    card.style.display = matchesPriceFilter(game.appid) ? "" : "none";
  }

  return card;
}

function createFriendCard(friend) {
  const card = document.createElement("div");
  card.classList.add("friend-item", "fade-in");
  card.innerHTML = `
    <img src="${friend.avatar || PLACEHOLDER_IMG}" alt="Avatar" width="50" height="50"><br>
    <a href="https://steamcommunity.com/profiles/${friend.steamid}" target="_blank">
      ${friend.personaname || "Unknown"}
    </a>
  `;
  return card;
}

function buildFriendsSection(friends) {
  const section = document.createElement("div");
  section.classList.add("friendsInfo");
  section.innerHTML = `<h3>Friends</h3><p>Total: ${friends.length}</p>`;

  if (!friends.length) return section;

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Введіть ім'я друга.";
  searchInput.classList.add("search-input");

  const list = document.createElement("div");
  list.classList.add("games-grid");

  function renderFriends(filtered) {
    list.innerHTML = "";
    if (filtered.length === 0) {
      list.innerHTML = `<div class="not-found-message">такого друга немає</div>`;
      return;
    }
    filtered.forEach((f) => list.appendChild(createFriendCard(f)));
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase();
    renderFriends(
      friends.filter((f) => (f.personaname || "").toLowerCase().includes(q)),
    );
  });

  renderFriends(friends);

  section.appendChild(searchInput);
  section.appendChild(list);
  return section;
}

function buildGamesSection(games) {
  const section = document.createElement("div");
  section.classList.add("gamesInfo");
  section.innerHTML = `<h3>Games</h3><p>Total: ${games.length}</p>`;

  if (!games.length) return section;

  // Топ гра
  const topGame = games.reduce(
    (max, g) => (g.playtime_forever > max.playtime_forever ? g : max),
    games[0],
  );
  const topGameDiv = document.createElement("div");
  topGameDiv.classList.add("top-game");
  topGameDiv.innerHTML = `
    <h4>Найбільше часу проведено у:</h4>
    <img src="${getGameImageUrl(topGame.appid, topGame.img_icon_url)}" alt="Top Game" width="50" height="50"><br>
    <strong>${topGame.name}</strong><br>
    <p>${formatPlaytime(topGame.playtime_forever)}</p>
  `;

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Ведіть назву гри.";
  searchInput.classList.add("search-input");

  const gamesList = document.createElement("div");
  gamesList.classList.add("games-grid");

  const moreBtn = document.createElement("button");
  moreBtn.textContent = "Показати ще";
  moreBtn.classList.add("more-games-btn");

  let displayed = 0;
  let filteredGames = [...games];

  function renderGames() {
    gamesList.innerHTML = "";
    displayed = 0;

    if (state.activeFilter) {
      filteredGames.forEach(
        (g) => g && gamesList.appendChild(createGameCard(g)),
      );
      displayed = filteredGames.length;
      moreBtn.style.display = "none";
      fetchPricesAndUpdate(filteredGames.map((g) => g.appid));
    } else {
      loadMoreGames();
    }
  }

  function loadMoreGames() {
    const remaining = filteredGames.length - displayed;
    if (remaining <= 0) return;

    const batch = filteredGames.slice(
      displayed,
      displayed + Math.min(GAMES_PER_PAGE, remaining),
    );
    batch.forEach((g) => g && gamesList.appendChild(createGameCard(g)));

    displayed += batch.length;
    moreBtn.style.display =
      displayed >= filteredGames.length ? "none" : "block";

    fetchPricesAndUpdate(batch.map((g) => g.appid));
  }

  // Зберігаємо ref для фільтрів
  state.renderGamesRef = renderGames;

  // Сортування
  const sortAlpha = () => {
    filteredGames.sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
    renderGames();
  };
  const sortByTime = () => {
    filteredGames.sort((a, b) => b.playtime_forever - a.playtime_forever);
    renderGames();
  };

  // Видаляємо старі обробники і додаємо нові
  if (state.sortLettersHandler)
    dom.letters.removeEventListener("click", state.sortLettersHandler);
  if (state.sortTimeHandler)
    dom.time.removeEventListener("click", state.sortTimeHandler);
  state.sortLettersHandler = sortAlpha;
  state.sortTimeHandler = sortByTime;
  dom.letters.addEventListener("click", sortAlpha);
  dom.time.addEventListener("click", sortByTime);

  // Пошук
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase();
    filteredGames = games.filter((g) => g.name.toLowerCase().includes(q));

    document.getElementById("notFoundMsg")?.remove();

    if (filteredGames.length === 0) {
      gamesList.innerHTML = `<div id="notFoundMsg" class="not-found-message">такої гри немає</div>`;
      moreBtn.style.display = "none";
    } else {
      renderGames();
    }
  });

  moreBtn.addEventListener("click", loadMoreGames);

  const btnWrapper = document.createElement("div");
  btnWrapper.classList.add("centered");
  btnWrapper.appendChild(moreBtn);

  section.appendChild(topGameDiv);
  section.appendChild(searchInput);
  section.appendChild(gamesList);
  section.appendChild(btnWrapper);

  renderGames();
  return section;
}

// ─── Рендер результатів ──────────────────────────────────────────────────────
function renderResults(data) {
  dom.resultDiv.innerHTML = "";
  state.allGames = data.games.games;
  state.allFriends = data.friends?.friends || [];

  // Загальний час
  const totalPlaytime = state.allGames.reduce(
    (acc, g) => acc + g.playtime_forever,
    0,
  );
  const playtimeDiv = document.createElement("div");
  playtimeDiv.innerHTML = `<h3 class="total-playtime">Загальний час у іграх: ${formatPlaytime(totalPlaytime)}</h3>`;
  dom.resultDiv.appendChild(playtimeDiv);

  // Витрати
  const spentDiv = document.createElement("div");
  spentDiv.classList.add("total-spent");
  spentDiv.innerHTML = `
    <h3 class="total-spent__title">💸 Витрачено на ігри: <span id="total-spent">...</span></h3>
    <p id="total-spent-count" class="total-spent__sub"></p>
  `;
  dom.resultDiv.appendChild(spentDiv);

  // User info
  const userInfo = document.createElement("div");
  userInfo.classList.add("userinfo");
  userInfo.innerHTML = `
    <h3>User Info</h3>
    <a href="${data.user.player.profileurl || "#"}" target="_blank">
      <img src="${data.user.player.avatar || PLACEHOLDER_IMG}" class="img__user">
    </a>
    <p><strong>Name:</strong> ${data.user.player.personaname || "N/A"}</p>
  `;

  dom.resultDiv.appendChild(userInfo);
  dom.resultDiv.appendChild(buildFriendsSection(state.allFriends));
  dom.resultDiv.appendChild(buildGamesSection(state.allGames));
}

// ─── Форма: сабміт ───────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const steamId = dom.steamInput.value.trim();

  if (!steamId) {
    showAlert("Ви не ввели steam link");
    return;
  }

  state.activeFilter = null;
  state.renderGamesRef = null;
  updateFilterButtons();
  showLoader();

  try {
    const response = await fetch(`/user?url=${encodeURIComponent(steamId)}`);
    const data = await response.json();
    hideLoader();

    if (!response.ok) {
      showAlert(
        response.status === 500 ? "Акаунт приватний" : "Помилка сервера",
      );
      return;
    }

    showAlert("Дані отримано");
    renderResults(data);
  } catch (err) {
    console.error("Fetch error:", err);
    hideLoader();
  }
}

// ─── Ініціалізація ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  dom.clearbtn.addEventListener("click", () => {
    dom.steamInput.value = "";
  });

  dom.steamInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dom.submitBtn.click();
    }
  });

  setupFilterButton(dom.btnFree, "free");
  setupFilterButton(dom.btnDiscount, "discount");
  setupFilterButton(dom.btnUnavailable, "unavailable");

  dom.btnClearFilter?.addEventListener("click", () => {
    state.activeFilter = null;
    updateFilterButtons();
    state.renderGamesRef?.();
  });

  dom.form.addEventListener("submit", handleSubmit);
});
