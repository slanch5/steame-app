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
    """
    appids — через кому: 730,550,440
    cc     — код країни (ua, us, pl)

    Повертає словник {appid: price_object | None}

    price_object варіанти:
      {"status": "free"}                        — безкоштовна гра
      {"status": "unavailable"}                 — гра є, але не продається в регіоні
      {"status": "price", "final_formatted": "₴ 549", "initial_formatted": "₴ 549", "discount_percent": 0, ...}
      None                                      — помилка API (мережа / 429 вичерпано)
    """
    ids_list = [i.strip() for i in appids.split(",") if i.strip()]
    if not ids_list:
        raise HTTPException(status_code=400, detail="No appids provided")

    # Не більше 10 одночасних запитів до Steam Store
    semaphore = asyncio.Semaphore(10)

    async def fetch_one(client: httpx.AsyncClient, appid: str) -> tuple[str, dict | None]:
        async with semaphore:
            for attempt in range(1, 4):
                try:
                    r = await client.get(
                        "https://store.steampowered.com/api/appdetails",
                        params={
                            "appids": appid,
                            "cc": cc,
                            "filters": "basic,price_overview",
                        },
                        timeout=15,
                    )

                    # 429 — чекаємо і повторюємо
                    if r.status_code == 429:
                        logging.warning(f"429 for appid {appid}, attempt {attempt}/3")
                        await asyncio.sleep(2 * attempt)
                        continue

                    # Інші HTTP помилки — повертаємо None
                    if r.status_code != 200:
                        logging.warning(f"HTTP {r.status_code} for appid {appid}")
                        return appid, None

                    data = r.json()
                    app_data = data.get(str(appid))

                    # Steam повернув success: false — гра не знайдена
                    if not app_data or not app_data.get("success"):
                        return appid, {"status": "unavailable"}

                    inner = app_data.get("data") or {}

                    # Безкоштовна гра (CS2, TF2, Dota 2 тощо)
                    if inner.get("is_free"):
                        return appid, {"status": "free"}

                    price = inner.get("price_overview")

                    # Гра існує але не продається в цьому регіоні
                    if price is None:
                        return appid, {"status": "unavailable"}

                    # Звичайна ціна або знижка
                    return appid, {
                        "status": "price",
                        "final_formatted": price.get("final_formatted", ""),
                        "initial_formatted": price.get("initial_formatted", ""),
                        "discount_percent": price.get("discount_percent", 0),
                        "final": price.get("final", 0),
                        "currency": price.get("currency", ""),
                    }

                except Exception as e:
                    logging.warning(f"fetch_one error appid={appid} attempt={attempt}: {e}")
                    if attempt < 3:
                        await asyncio.sleep(1)

            # Всі спроби вичерпано
            return appid, None

    async with httpx.AsyncClient() as client:
        tasks = [fetch_one(client, appid) for appid in ids_list]
        results = await asyncio.gather(*tasks)

    return dict(results)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)