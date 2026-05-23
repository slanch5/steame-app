import uvicorn
import asyncio
import logging
import httpx
import time
import random
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

price_server_cache: dict = {}
CACHE_TTL = 86400  # 24 години

# Browsе-like headers — обходить Akamai
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://store.steampowered.com/",
}

WORKERS   = 2      # більше — Akamai блокує
DELAY_MIN = 1.5    # рандомна пауза між запитами
DELAY_MAX = 2.5

_cooldown_until: float = 0.0


async def set_cooldown(seconds: float) -> None:
    global _cooldown_until
    _cooldown_until = time.time() + seconds
    logging.warning(f"[cooldown] пауза {seconds:.0f}s")
    await asyncio.sleep(seconds)


async def wait_cooldown() -> None:
    remaining = _cooldown_until - time.time()
    if remaining > 0:
        await asyncio.sleep(remaining)


async def fetch_price(client: httpx.AsyncClient, appid: str, cc: str) -> dict | None:
    """
    Прямий httpx запит до Steam Store API з обов'язковим cc= параметром.
    Саме він повертає price_overview — бібліотека його не передавала.
    """
    for attempt in range(1, 5):
        await wait_cooldown()
        try:
            r = await client.get(
                "https://store.steampowered.com/api/appdetails",
                params={
                    "appids": appid,
                    "cc": cc,           # ← ключовий параметр, без нього немає цін
                    "filters": "price_overview,basic",
                },
                headers=HEADERS,
                timeout=20,
            )

            if r.status_code == 429:
                logging.warning(f"[429] {appid} attempt={attempt}")
                await set_cooldown(20 * attempt)
                continue

            if r.status_code == 403:
                logging.warning(f"[403] {appid} attempt={attempt}")
                await set_cooldown(30 * attempt)
                continue

            if r.status_code != 200:
                logging.warning(f"[{r.status_code}] {appid}")
                return None

            data = r.json()
            app_data = data.get(str(appid))

            if not app_data or not app_data.get("success"):
                return {"status": "unavailable"}

            inner = app_data.get("data") or {}

            if inner.get("is_free"):
                return {"status": "free"}

            price = inner.get("price_overview")
            if not price:
                return {"status": "unavailable"}

            return {
                "status":            "price",
                "final_formatted":   price.get("final_formatted", ""),
                "initial_formatted": price.get("initial_formatted", ""),
                "discount_percent":  price.get("discount_percent", 0),
                "final":             price.get("final", 0),
                "currency":          price.get("currency", ""),
            }

        except httpx.TimeoutException:
            logging.warning(f"[timeout] {appid} attempt={attempt}")
            await asyncio.sleep(3 * attempt)
        except Exception as e:
            logging.warning(f"[error] {appid} attempt={attempt}: {e}")
            await asyncio.sleep(2)

    logging.error(f"[failed] {appid} після 4 спроб")
    return None


async def price_worker(
    worker_id: int,
    queue: asyncio.Queue,
    results: dict,
    client: httpx.AsyncClient,
    cc: str,
) -> None:
    while True:
        appid = await queue.get()
        if appid is None:
            queue.task_done()
            break
        try:
            price_data = await fetch_price(client, appid, cc)
            results[appid] = price_data
            price_server_cache[appid] = {"data": price_data, "ts": time.time()}
            status = price_data.get("status") if price_data else "error"
            logging.info(f"[w{worker_id}] {appid} → {status}")
        except Exception as e:
            logging.error(f"[w{worker_id}] unhandled {appid}: {e}")
            results[appid] = None
        finally:
            queue.task_done()
            await asyncio.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


@app.get("/")
def home():
    return FileResponse(str(BASE_DIR / "index.html"))


@app.get("/api")
def api_status():
    return {"message": "Steam API is running!"}


@app.get("/user/{encoded_url:path}")
async def get_user_info_path(encoded_url: str):
    return await get_user_info(url=unquote(encoded_url))


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
                        logging.warning(f"429 on friends, retrying...")
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
                        logging.warning(f"429 on games, retrying...")
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
                logging.error(f"Error for {userid}: {e}")
                raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=429, detail="Too Many Requests.")


@app.get("/prices")
async def get_games_prices(appids: str = Query(...), cc: str = "ua"):
    ids_list = [i.strip() for i in appids.split(",") if i.strip()]
    if not ids_list:
        raise HTTPException(status_code=400, detail="No appids provided")

    result: dict = {}
    to_fetch: list[str] = []
    now = time.time()

    for appid in ids_list:
        cached = price_server_cache.get(appid)
        if cached and (now - cached["ts"]) < CACHE_TTL:
            result[appid] = cached["data"]
        else:
            to_fetch.append(appid)

    if not to_fetch:
        return result

    logging.info(f"[prices] кеш={len(result)}, черга={len(to_fetch)}, cc={cc}")

    queue: asyncio.Queue = asyncio.Queue()
    fetched: dict = {}

    for appid in to_fetch:
        await queue.put(appid)
    for _ in range(WORKERS):
        await queue.put(None)  # sentinels

    async with httpx.AsyncClient() as client:
        workers = [
            asyncio.create_task(price_worker(i, queue, fetched, client, cc))
            for i in range(WORKERS)
        ]
        await asyncio.gather(*workers)

    result.update(fetched)
    return result


@app.delete("/prices/cache")
def clear_price_cache():
    price_server_cache.clear()
    return {"message": "Cache cleared"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)