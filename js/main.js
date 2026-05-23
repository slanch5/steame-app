document.addEventListener("DOMContentLoaded", function () {
  const loader = document.querySelector(".loader");
  const steamInput = document.getElementById("steamIdInput");
  const clearbtn = document.querySelector(".clearbtn");
  const resultDiv = document.getElementById("result");
  const submitBtn = document.getElementById("submitBtn");
  const letters = document.querySelector(".letters");
  const time = document.querySelector(".time");
  const form = document.querySelector(".st");

  const btnFree = document.querySelector(".free");
  const btnDiscount = document.querySelector(".discount");
  const btnUnavailable = document.querySelector(".unavailable");
  const btnClearFilter = document.querySelector(".clearfil");

  const priceCache = {};

  let sortLettersHandler = null;
  let sortTimeHandler = null;
  let activeFilter = null;
  let allGames = [];
  let renderGamesRef = null;

  function hideLoader() {
    loader.classList.add("loader--hidden");
  }

  function showLoader() {
    loader.classList.remove("loader--hidden");
  }

  clearbtn.addEventListener("click", () => {
    steamInput.value = "";
  });

  steamInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitBtn.click();
    }
  });

  function formatPlaytime(minutes) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  function formatPrice(price) {
    if (price === undefined) {
      return `<span class="price__loading">...</span>`;
    }
    if (price === null) {
      return `<span class="price__error">—</span>`;
    }
    switch (price.status) {
      case "free":
        return `<span class="price__free">🆓 Безкоштовно</span>`;
      case "unavailable":
        return `<span class="price__unavailable">🚫 Недоступна</span>`;
      case "price":
        if (price.discount_percent > 0) {
          return `
            <s class="price__original">${price.initial_formatted}</s>
            <strong class="price__final">${price.final_formatted}</strong>
            <span class="price__discount">-${price.discount_percent}%</span>
          `;
        }
        return `<strong class="price__normal">${price.final_formatted}</strong>`;
      default:
        return `<span class="price__error">—</span>`;
    }
  }

  // ── ПІДРАХУНОК ВИТРАТ ────────────────────────────────────────────────────
  function updateTotalSpent() {
    const spentEl = document.getElementById("total-spent");
    const spentCountEl = document.getElementById("total-spent-count");
    if (!spentEl || !spentCountEl) return;

    let totalKopecks = 0; // сума в мінімальних одиницях (копійки/центи)
    let currency = "";
    let countedGames = 0; // ігор з відомою ціною
    let loadedGames = 0; // ігор завантажено всього

    for (const game of allGames) {
      const price = priceCache[String(game.appid)];
      if (price === undefined) continue; // ще не завантажено

      loadedGames++;

      if (price?.status === "price" && price.final > 0) {
        // price.final — ціна в копійках (Steam зберігає як ціле число)
        totalKopecks += price.final;
        countedGames++;
        if (!currency) currency = price.currency || "";
      }
    }

    // Форматуємо суму
    const total = (totalKopecks / 100).toFixed(2);
    const currencySymbols = { UAH: "₴", USD: "$", EUR: "€", PLN: "zł" };
    const symbol = currencySymbols[currency] || currency;

    const pct =
      allGames.length > 0
        ? Math.round((loadedGames / allGames.length) * 100)
        : 0;

    spentEl.textContent = countedGames > 0 ? `${symbol} ${total}` : "...";

    spentCountEl.textContent = `за ${countedGames} платних ігор (завантажено ${pct}% цін)`;
  }
  // ─────────────────────────────────────────────────────────────────────────

  function matchesPriceFilter(appid) {
    if (!activeFilter) return true;
    const price = priceCache[String(appid)];
    if (price === undefined) return true;
    switch (activeFilter) {
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
    [btnFree, btnDiscount, btnUnavailable].forEach((btn) => {
      if (btn) btn.classList.remove("active");
    });
    if (activeFilter === "free" && btnFree) btnFree.classList.add("active");
    if (activeFilter === "discount" && btnDiscount)
      btnDiscount.classList.add("active");
    if (activeFilter === "unavailable" && btnUnavailable)
      btnUnavailable.classList.add("active");
  }

  async function fetchPricesAndUpdate(appids) {
    const missing = appids.filter((id) => !(String(id) in priceCache));
    if (missing.length === 0) return;

    const chunks = [];
    for (let i = 0; i < missing.length; i += 20) {
      chunks.push(missing.slice(i, i + 20));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const res = await fetch(`/prices?appids=${chunk.join(",")}&cc=ua`);
          if (!res.ok) {
            chunk.forEach((id) => (priceCache[String(id)] = null));
            return;
          }

          const data = await res.json();
          Object.assign(priceCache, data);
          Object.entries(data).forEach(([appid, price]) => {
            const game = allGames.find((g) => String(g.appid) === appid);
            const name = game?.name || appid;
            if (!price) {
              console.log(`❌ ${name} — помилка API`);
            } else if (price.status === "free") {
              console.log(`🆓 ${name} — Безкоштовно`);
            } else if (price.status === "unavailable") {
              console.log(`🚫 ${name} — Недоступна`);
            } else if (price.status === "price") {
              const discount =
                price.discount_percent > 0
                  ? ` (-${price.discount_percent}%)`
                  : "";
              console.log(`💰 ${name} — ${price.final_formatted}${discount}`);
            }
          });

          chunk.forEach((id) => {
            const priceEl = document.querySelector(
              `.game-price[data-appid="${id}"]`,
            );
            if (priceEl) {
              priceEl.innerHTML = formatPrice(priceCache[String(id)]);
            }

            if (activeFilter) {
              const gameItem = priceEl?.closest("a.game-item");
              if (gameItem) {
                gameItem.style.display = matchesPriceFilter(id) ? "" : "none";
              }
            }
          });

          // Оновлюємо суму витрат після кожного батчу
          updateTotalSpent();
        } catch (err) {
          console.error("Price batch fetch error:", err);
          chunk.forEach((id) => (priceCache[String(id)] = null));
        }
      }),
    );
  }

  function setupFilterButton(btn, filterName) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      activeFilter = activeFilter === filterName ? null : filterName;
      updateFilterButtons();
      if (renderGamesRef) renderGamesRef();
    });
  }

  setupFilterButton(btnFree, "free");
  setupFilterButton(btnDiscount, "discount");
  setupFilterButton(btnUnavailable, "unavailable");

  if (btnClearFilter) {
    btnClearFilter.addEventListener("click", () => {
      activeFilter = null;
      updateFilterButtons();
      if (renderGamesRef) renderGamesRef();
    });
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const steamId = document.getElementById("steamIdInput").value.trim();

    if (!steamId) {
      Swal.fire({
        title: "steam user info",
        text: "Ви не ввели steam link",
        imageUrl:
          "https://upload.wikimedia.org/wikipedia/commons/c/c1/Steam_Logo.png",
        imageWidth: 100,
        imageHeight: 100,
        imageAlt: "Custom image",
        color: "#007bff",
        confirmButtonColor: "#007bff",
        backdrop: `rgba(255, 255, 255, 0.5)`,
        timer: 2000,
        timerProgressBar: true,
      });
      return;
    }

    if (sortLettersHandler)
      letters.removeEventListener("click", sortLettersHandler);
    if (sortTimeHandler) time.removeEventListener("click", sortTimeHandler);

    activeFilter = null;
    renderGamesRef = null;
    updateFilterButtons();
    showLoader();

    try {
      const response = await fetch(`/user?url=${encodeURIComponent(steamId)}`);
      const data = await response.json();
      console.log(data);
      hideLoader();

      if (!response.ok) {
        if (response.status === 500) {
          Swal.fire({
            title: "steam user info",
            text: "Акаунт приватний",
            imageUrl:
              "https://upload.wikimedia.org/wikipedia/commons/c/c1/Steam_Logo.png",
            imageWidth: 100,
            imageHeight: 100,
            imageAlt: "Custom image",
            color: "#007bff",
            confirmButtonColor: "#007bff",
            backdrop: `rgba(255, 255, 255, 0.5)`,
            timer: 2000,
            timerProgressBar: true,
          });
        }
        return;
      }

      Swal.fire({
        title: "steam user info",
        text: "Дані отримано",
        imageUrl:
          "https://upload.wikimedia.org/wikipedia/commons/c/c1/Steam_Logo.png",
        imageWidth: 100,
        imageHeight: 100,
        imageAlt: "Custom image",
        color: "#007bff",
        confirmButtonColor: "#007bff",
        backdrop: `rgba(255, 255, 255, 0.5)`,
        timer: 2000,
        timerProgressBar: true,
      });

      resultDiv.innerHTML = "";
      allGames = data.games.games;

      // --- TOTAL PLAYTIME ---
      const totalPlaytime = allGames.reduce(
        (total, game) => total + game.playtime_forever,
        0,
      );
      const totalPlaytimeDiv = document.createElement("div");
      totalPlaytimeDiv.innerHTML = `<h3 class="total-playtime">Загальний час у іграх: ${formatPlaytime(totalPlaytime)}</h3>`;
      resultDiv.appendChild(totalPlaytimeDiv);

      // --- TOTAL SPENT ---
      const totalSpentDiv = document.createElement("div");
      totalSpentDiv.classList.add("total-spent");
      totalSpentDiv.innerHTML = `
        <h3 class="total-spent__title">💸 Витрачено на ігри:
          <span id="total-spent">...</span>
        </h3>
        <p id="total-spent-count" class="total-spent__sub"></p>
      `;
      resultDiv.appendChild(totalSpentDiv);

      // --- USER INFO ---
      const userInfo = document.createElement("div");
      userInfo.classList.add("userinfo");
      userInfo.innerHTML = `
        <h3>User Info</h3>
        <a href="${data.user.player.profileurl || "#"}" target="_blank">
          <img src="${data.user.player.avatar || "https://via.placeholder.com/50"}" class="img__user">
        </a>
        <p><strong>Name:</strong> ${data.user.player.personaname || "N/A"}</p>
      `;

      // --- FRIENDS INFO ---
      const friendsInfo = document.createElement("div");
      friendsInfo.classList.add("friendsInfo");
      friendsInfo.innerHTML = `<h3>Friends</h3><p>Total: ${data.friends?.friends?.length || 0}</p>`;

      if (data.friends?.friends?.length) {
        const friendsList = document.createElement("div");
        friendsList.classList.add("games-grid");
        data.friends.friends.forEach((friend) => {
          const friendItem = document.createElement("div");
          friendItem.classList.add("friend-item", "fade-in");
          friendItem.innerHTML = `
            <img src="${friend.avatar || "https://via.placeholder.com/50"}" alt="Avatar" width="50" height="50"><br>
            <a href="https://steamcommunity.com/profiles/${friend.steamid}" target="_blank">
              ${friend.personaname || "Unknown"}
            </a>
          `;
          friendsList.appendChild(friendItem);
        });
        friendsInfo.appendChild(friendsList);
      }

      // --- GAMES INFO ---
      const gamesInfo = document.createElement("div");
      gamesInfo.classList.add("gamesInfo");
      gamesInfo.innerHTML = `<h3>Games</h3><p>Total: ${data.games?.game_count || 0}</p>`;

      if (data.games?.game_count > 0) {
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Ведіть назву гри.";
        searchInput.classList.add("search-input");

        const gamesList = document.createElement("div");
        gamesList.classList.add("games-grid");

        const moreGamesBtn = document.createElement("button");
        moreGamesBtn.textContent = "Показати ще";
        moreGamesBtn.classList.add("more-games-btn");

        let displayedGames = 0;
        const gamesPerPage = 100;
        let filteredGames = [...allGames];

        function renderGameCard(game) {
          const gameItem = document.createElement("a");
          gameItem.href = `https://store.steampowered.com/app/${game.appid}/`;
          gameItem.target = "_blank";
          gameItem.classList.add("game-item");

          const playtimeFormatted = formatPlaytime(game.playtime_forever);
          const imgSrc = game.img_icon_url
            ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
            : "https://via.placeholder.com/50";

          const cachedPrice =
            String(game.appid) in priceCache
              ? priceCache[String(game.appid)]
              : undefined;

          gameItem.innerHTML = `
            <img src="${imgSrc}" alt="Game Icon" width="50" height="50"><br>
            ${game.name || "Unknown Game"}<br>
            <p class="playtime">${playtimeFormatted}</p>
            <p class="game-price" data-appid="${game.appid}">${formatPrice(cachedPrice)}</p>
          `;

          if (activeFilter && String(game.appid) in priceCache) {
            gameItem.style.display = matchesPriceFilter(game.appid)
              ? ""
              : "none";
          }

          return gameItem;
        }

        function renderGames() {
          gamesList.innerHTML = "";
          displayedGames = 0;

          if (activeFilter) {
            filteredGames.forEach((game) => {
              if (game) gamesList.appendChild(renderGameCard(game));
            });
            displayedGames = filteredGames.length;
            moreGamesBtn.style.display = "none";
            fetchPricesAndUpdate(filteredGames.map((g) => g.appid));
          } else {
            loadMoreGames();
          }
        }

        renderGamesRef = renderGames;

        function loadMoreGames() {
          const remainingGames = filteredGames.length - displayedGames;
          if (remainingGames <= 0) return;

          const gamesToShow = Math.min(gamesPerPage, remainingGames);
          const batch = filteredGames.slice(
            displayedGames,
            displayedGames + gamesToShow,
          );

          batch.forEach((game) => {
            if (game) gamesList.appendChild(renderGameCard(game));
          });

          displayedGames += gamesToShow;
          moreGamesBtn.style.display =
            displayedGames >= filteredGames.length ? "none" : "block";

          fetchPricesAndUpdate(batch.map((g) => g.appid));
        }

        function sortGamesAlphabetically() {
          filteredGames.sort((a, b) =>
            a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
          );
          renderGames();
        }

        function sortGamesByTime() {
          filteredGames.sort((a, b) => b.playtime_forever - a.playtime_forever);
          renderGames();
        }

        sortLettersHandler = sortGamesAlphabetically;
        sortTimeHandler = sortGamesByTime;

        letters.addEventListener("click", sortLettersHandler);
        time.addEventListener("click", sortTimeHandler);

        searchInput.addEventListener("input", () => {
          const query = searchInput.value.toLowerCase();
          filteredGames = allGames.filter((game) =>
            game.name.toLowerCase().includes(query),
          );

          const existingNotFound = document.getElementById("notFoundMsg");
          if (existingNotFound) existingNotFound.remove();

          if (filteredGames.length === 0) {
            gamesList.innerHTML = `<div id="notFoundMsg" class="not-found-message">такої гри немає</div>`;
            moreGamesBtn.style.display = "none";
          } else {
            renderGames();
          }
        });

        moreGamesBtn.addEventListener("click", loadMoreGames);

        const topGame = allGames.reduce(
          (max, game) =>
            game.playtime_forever > max.playtime_forever ? game : max,
          allGames[0],
        );

        const topGameImg = topGame.img_icon_url
          ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${topGame.appid}/${topGame.img_icon_url}.jpg`
          : "https://placehold.co/50x50";

        const topGameDiv = document.createElement("div");
        topGameDiv.classList.add("top-game");
        topGameDiv.innerHTML = `
          <h4>Найбільше часу проведено у:</h4>
          <img src="${topGameImg}" alt="Top Game Icon" width="50" height="50"><br>
          <strong>${topGame.name}</strong><br>
          <p>${formatPlaytime(topGame.playtime_forever)}</p>
        `;

        const buttonWrapper = document.createElement("div");
        buttonWrapper.classList.add("centered");
        buttonWrapper.appendChild(moreGamesBtn);

        gamesInfo.appendChild(topGameDiv);
        gamesInfo.appendChild(searchInput);
        gamesInfo.appendChild(gamesList);
        gamesInfo.appendChild(buttonWrapper);

        renderGames();
      }

      resultDiv.appendChild(userInfo);
      resultDiv.appendChild(friendsInfo);
      resultDiv.appendChild(gamesInfo);
    } catch (error) {
      console.error("Fetch error:", error);
      hideLoader();
    }
  });
});
