document.addEventListener("DOMContentLoaded", function () {
  const loader = document.querySelector(".loader");
  const steamInput = document.getElementById("steamIdInput");
  const clearbtn = document.querySelector(".clearbtn");
  const resultDiv = document.getElementById("result");
  const submitBtn = document.getElementById("submitBtn"); // 🔥 додав

  function hideLoader() {
    loader.classList.add("loader--hidden");
  }

  function showLoader() {
    loader.classList.remove("loader--hidden");
  }

  clearbtn.addEventListener("click", () => {
    steamInput.value = "";
  });

  // 🔥 Якщо юзер натиснув Enter в інпуті → клікаємо кнопку
  steamInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // блокує дефолтне відправлення форми
      submitBtn.click();
    }
  });

  function formatPlaytime(minutes) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  submitBtn.addEventListener("click", async function () {
    const steamId = document.getElementById("steamIdInput").value.trim();

    if (!steamId) {
      Swal.fire({
        icon: "error",
        title: "Oops...",
        text: "Ви не ввели свій Steam link",
        footer: "",
      });
      return;
    }

    showLoader();

    try {
      const response = await fetch(`http://localhost:8000/user/${steamId}`);
      const data = await response.json();
      hideLoader();
      console.log(data);
      if (!response.ok) {
        if (response.status === 500) {
          Swal.fire({
            icon: "error",
            title: "Oops...",
            text: "Акаунт приватний",
            footer: "",
          });
        }
        return;
      }

      Swal.fire({
        title: "Дані отримано",
        text: "Перейдемо до вашого профілю",
        icon: "success",
      });

      resultDiv.innerHTML = "";

      // --- USER INFO ---
      const userInfo = document.createElement("div");
      userInfo.classList.add("userinfo");
      userInfo.innerHTML = `
        <h3>User Info</h3>
        <a href="${data.user.player.profileurl || "#"}" target="_blank">
          <img src="${
            data.user.player.avatar || "https://via.placeholder.com/50"
          }" class="img__user">
        </a>
        <p><strong>Name:</strong> ${data.user.player.personaname || "N/A"}</p>
      `;

      // --- FRIENDS INFO ---
      const friendsInfo = document.createElement("div");
      friendsInfo.classList.add("friendsInfo");
      friendsInfo.innerHTML = `<h3>Friends</h3><p>Total: ${
        data.friends?.friends?.length || 0
      }</p>`;

      if (data.friends?.friends?.length) {
        const friendsList = document.createElement("div");
        friendsList.classList.add("games-grid");

        data.friends.friends.forEach((friend) => {
          const friendItem = document.createElement("div");
          friendItem.classList.add("friend-item", "fade-in");
          friendItem.innerHTML = `
            <img src="${
              friend.avatar || "https://via.placeholder.com/50"
            }" alt="Avatar" width="50" height="50"><br>
            <a href="https://steamcommunity.com/profiles/${
              friend.steamid
            }" target="_blank">
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
      gamesInfo.innerHTML = `<h3>Games</h3><p>Total: ${
        data.games?.game_count || 0
      }</p>`;

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
        let filteredGames = [...data.games.games];

        function renderGames() {
          gamesList.innerHTML = "";
          displayedGames = 0;
          loadMoreGames();
        }

        function loadMoreGames() {
          const remainingGames = filteredGames.length - displayedGames;
          const gamesToShow = Math.min(gamesPerPage, remainingGames);

          for (let i = displayedGames; i < displayedGames + gamesToShow; i++) {
            const game = filteredGames[i];
            if (!game) break;

            const gameItem = document.createElement("a");
            gameItem.href = `https://store.steampowered.com/agecheck/app/${game.appid}/`;
            gameItem.target = "_blank";
            gameItem.classList.add("game-item");

            const playtimeFormatted = formatPlaytime(game.playtime_forever);
            const imgSrc = game.img_icon_url
              ? `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
              : "https://via.placeholder.com/50";

            gameItem.innerHTML = `
              <img src="${imgSrc}" alt="Game Icon" width="50" height="50"><br>
              ${game.name || "Unknown Game"}<br>
              <p>${playtimeFormatted}</p>
            `;

            gamesList.appendChild(gameItem);
          }

          displayedGames += gamesToShow;
          moreGamesBtn.style.display =
            displayedGames >= filteredGames.length ? "none" : "block";
        }

        searchInput.addEventListener("input", () => {
          const query = searchInput.value.toLowerCase();
          filteredGames = data.games.games.filter((game) =>
            game.name.toLowerCase().includes(query)
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

        const topGame = data.games.games.reduce(
          (max, game) =>
            game.playtime_forever > max.playtime_forever ? game : max,
          data.games.games[0]
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
