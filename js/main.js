document.addEventListener("DOMContentLoaded", function () {
   document.getElementById("submitBtn").addEventListener("click", async function () {
       const steamId = document.getElementById("steamIdInput").value;
       if (!steamId) {
           alert("Please enter a Steam ID!");
           return;
       }

       function formatPlaytime(minutes) {
           if (minutes === 0) {
               return "Час невизначений";
           }
           const hours = Math.floor(minutes / 60);
           const remainingMinutes = minutes % 60;
           return `${hours}h ${remainingMinutes}m`;
       }

       try {
           const response = await fetch(`http://localhost:8000/user/${steamId}`);
           if (!response.ok) {
               throw new Error("Failed to fetch data");
           }
           const data = await response.json();
           console.log("Fetched data:", data);
           
           const resultDiv = document.getElementById("result");
           resultDiv.innerHTML = "";
           
           const userInfo = document.createElement("div");
           userInfo.innerHTML = `
               <h3 class="">User Info</h3>
               <a href="${data?.user.player.profileurl || '#'}" target="_blank">
                   <img src="${data?.user.player.avatar || 'https://via.placeholder.com/50'}" alt="Avatar" width="50" height="50" style="border-radius: 50%;">
               </a>
               <p><strong>Name:</strong> ${data?.user.player.personaname || "N/A"}</p>
           `;

           const gamesInfo = document.createElement("div");
           gamesInfo.innerHTML = `<h3>Games</h3><p>Total: ${data.games?.game_count || 0}</p>`;
           
           const gamesList = document.createElement("div");
           gamesList.style.display = "grid";
           gamesList.style.gridTemplateColumns = "repeat(auto-fill, minmax(100px, 1fr))";
           gamesList.style.gap = "10px";
           
           let displayedGames = 0;
           const gamesPerPage = 100;

           function loadMoreGames() {
               const remainingGames = data.games.games.length - displayedGames;
               const gamesToShow = Math.min(gamesPerPage, remainingGames);
               
               for (let i = displayedGames; i < displayedGames + gamesToShow; i++) {
                   if (!data.games.games[i]) break;
                   const game = data.games.games[i];
                   const gameItem = document.createElement("div");
                   gameItem.style.textAlign = "center";
                   const playtimeFormatted = formatPlaytime(game.playtime_forever);
                   gameItem.innerHTML = `
                       <img src="https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg" alt="Game Icon" width="50" height="50" style="border-radius: 4px;">
                       <br>
                       ${game.name || "Unknown Game"}
                       <br>
                       ${playtimeFormatted}
                   `;
                   gamesList.appendChild(gameItem);
               }
               displayedGames += gamesToShow;
               if (displayedGames >= data.games.games.length) {
                   moreGamesBtn.style.display = "none";
               }
           }

           const moreGamesBtn = document.createElement("button");
           moreGamesBtn.textContent = "More Games";
           moreGamesBtn.style.padding = "10px 20px";
           moreGamesBtn.style.marginTop = "10px";
           moreGamesBtn.style.backgroundColor = "#007bff";
           moreGamesBtn.style.color = "white";
           moreGamesBtn.style.border = "none";
           moreGamesBtn.style.borderRadius = "5px";
           moreGamesBtn.style.cursor = "pointer";
           moreGamesBtn.addEventListener("mouseenter", () => moreGamesBtn.style.backgroundColor = "#0056b3");
           moreGamesBtn.addEventListener("mouseleave", () => moreGamesBtn.style.backgroundColor = "#007bff");
           moreGamesBtn.addEventListener("click", loadMoreGames);

           gamesInfo.appendChild(gamesList);
           gamesInfo.appendChild(moreGamesBtn);
           
           resultDiv.appendChild(userInfo);
           resultDiv.appendChild(gamesInfo);

           loadMoreGames();
       } catch (error) {
           document.getElementById("result").innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
       }
   });
});
