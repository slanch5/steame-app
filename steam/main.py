import uvicorn
import asyncio
import logging
import httpx
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from decouple import config
from fastapi.middleware.cors import CORSMiddleware
from steam_web_api import Steam
from steam.lib.runner import get_steam_id
from urllib.parse import unquote

BASE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/css", StaticFiles(directory=str(BASE_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(BASE_DIR / "js")), name="js")
app.mount("/icon", StaticFiles(directory=str(BASE_DIR / "icon")), name="icon")

logging.basicConfig(level=logging.INFO)

KEY = config("STEAM_API_KEY")
steam = Steam(KEY)


@app.get("/")
def home():
    return FileResponse(str(BASE_DIR / "index.html"))


@app.get("/api")
def api_status():
    return {"message": "Steam API is running!"}


@app.get("/user/{encoded_url:path}")
async def get_user_info_path(encoded_url: str):
    decoded_url = unquote(encoded_url)
    return await get_user_info(url=decoded_url)


@app.get("/user")
async def get_user_info(url: str = Query(...)):
    max_retries = 5
    retry_delay = 3

    userid = await get_steam_id(user_url=url, api_key=KEY)

    for attempt in range(1, max_retries + 1):
        try:
            user, friends, games = None, None, None

            for _ in range(max_retries):
                try:
                    user = steam.users.get_user_details(userid)
                    break
                except Exception as e:
                    if "429" in str(e):
                        await asyncio.sleep(retry_delay)
                    else:
                        raise
            if user is None:
                raise Exception("Failed to fetch user details")

            for _ in range(max_retries):
                try:
                    friends = steam.users.get_user_friends_list(userid)
                    break
                except Exception as e:
                    if "429" in str(e):
                        logging.warning(f"429 on friends list, retrying in {retry_delay}s...")
                        await asyncio.sleep(retry_delay)
                    else:
                        raise
            if friends is None:
                raise Exception("Failed to fetch friends list")

            for _ in range(max_retries):
                try:
                    games = steam.users.get_owned_games(userid)
                    break
                except Exception as e:
                    if "429" in str(e):
                        logging.warning(f"429 on owned games, retrying in {retry_delay}s...")
                        await asyncio.sleep(retry_delay)
                    else:
                        raise
            if games is None:
                raise Exception("Failed to fetch owned games")

            return {"user": user, "friends": friends, "games": games}

        except Exception as e:
            if "429" in str(e):
                await asyncio.sleep(retry_delay)
            else:
                logging.error(f"Error fetching data for {userid}: {e}")
                raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=429, detail="Too Many Requests. Please try again later.")


@app.get("/prices")
async def get_games_prices(appids: str = Query(...), cc: str = "ua"):
    ids_list = [i.strip() for i in appids.split(",") if i.strip()]
    if not ids_list:
        raise HTTPException(status_code=400, detail="No appids provided")

    max_retries = 3
    retry_delay = 2
    batch_size = 5

    async def fetch_one(client: httpx.AsyncClient, appid: str) -> tuple[str, dict | None]:
        for attempt in range(1, max_retries + 1):
            try:
                r = await client.get(
                    "https://store.steampowered.com/api/appdetails",
                    params={"appids": appid, "cc": cc, "filters": "price_overview,is_free"},
                    timeout=10,
                )

                # Якщо Steam повертає 429 — чекаємо і повторюємо
                if r.status_code == 429:
                    logging.warning(f"429 on price fetch for {appid}, attempt {attempt}/{max_retries}")
                    if attempt < max_retries:
                        await asyncio.sleep(retry_delay * attempt)
                        continue
                    return appid, None

                r.raise_for_status()
                data = r.json()

                # Steam може повертати ключ як рядок або число — перевіряємо обидва варіанти
                app_data = data.get(str(appid)) or data.get(int(appid) if appid.isdigit() else appid)

                if not app_data or not app_data.get("success"):
                    return appid, None

                inner = app_data.get("data", {})

                if inner.get("is_free"):
                    return appid, {
                        "final_formatted": "Безкоштовно",
                        "initial_formatted": "",
                        "discount_percent": 0,
                    }

                price = inner.get("price_overview")
                if price is None:
                    logging.info(f"No price_overview for appid {appid} (possibly not available in region '{cc}')")

                return appid, price

            except httpx.HTTPStatusError as e:
                logging.warning(f"HTTP error for appid {appid}: {e}")
                if attempt < max_retries:
                    await asyncio.sleep(retry_delay)
                else:
                    return appid, None
            except Exception as e:
                logging.warning(f"Price fetch failed for {appid}: {e}")
                return appid, None

        return appid, None

    results = []

    async with httpx.AsyncClient() as client:
        # Розбиваємо на батчі, щоб не отримати 429 від Steam
        for i in range(0, len(ids_list), batch_size):
            batch = ids_list[i : i + batch_size]
            batch_results = await asyncio.gather(*[fetch_one(client, appid) for appid in batch])
            results.extend(batch_results)

            # Пауза між батчами (крім останнього)
            if i + batch_size < len(ids_list):
                await asyncio.sleep(1)

    return dict(results)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)