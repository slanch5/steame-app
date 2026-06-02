import uvicorn
import asyncio
import logging
import httpx
import time
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
CACHE_TTL = 86400  


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

BATCH_SIZE = 100

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


def parse_price(appid: str, data: dict) -> dict | None:
    app_data = data.get(str(appid))

    if not app_data or not app_data.get("success"):
        return {"status": "unavailable"}

    inner = app_data.get("data")

    if not inner:
        return {"status": "free"}

    if isinstance(inner, dict) and inner.get("is_free"):
        return {"status": "free"}

    price = inner.get("price_overview") if isinstance(inner, dict) else None
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


async def fetch_prices_batch(
    client: httpx.AsyncClient,
    appids: list[str],
    cc: str,
) -> dict[str, dict | None]:
    """
    Steam Store API accepts multiple appids in one comma-separated parameter.
    This keeps one API request per visible batch instead of one request per game.
    """
    ids_param = ",".join(appids)
    for attempt in range(1, 5):
        await wait_cooldown()
        try:
            r = await client.get(
                "https://store.steampowered.com/api/appdetails",
                params={
                    "appids": ids_param,
                    "cc": cc,          
                    "filters": "price_overview",
                },
                headers=HEADERS,
                timeout=20,
            )

            if r.status_code == 429:
                logging.warning(f"[429] batch={len(appids)} attempt={attempt}")
                await set_cooldown(20 * attempt)
                continue

            if r.status_code == 403:
                logging.warning(f"[403] batch={len(appids)} attempt={attempt}")
                await set_cooldown(30 * attempt)
                continue

            if r.status_code != 200:
                logging.warning(f"[{r.status_code}] batch={len(appids)}")
                return {appid: None for appid in appids}

            data = r.json()
            return {appid: parse_price(appid, data) for appid in appids}

        except httpx.TimeoutException:
            logging.warning(f"[timeout] batch={len(appids)} attempt={attempt}")
            await asyncio.sleep(3 * attempt)
        except Exception as e:
            logging.warning(f"[error] batch={len(appids)} attempt={attempt}: {e}")
            await asyncio.sleep(2)

    logging.error(f"[failed] batch={len(appids)} після 4 спроб")
    return {appid: None for appid in appids}


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
        cache_key = f"{cc}:{appid}"
        cached = price_server_cache.get(cache_key)
        if cached and (now - cached["ts"]) < CACHE_TTL:
            result[appid] = cached["data"]
        else:
            to_fetch.append(appid)

    if not to_fetch:
        return result

    logging.info(f"[prices] кеш={len(result)}, fetch={len(to_fetch)}, cc={cc}")

    async with httpx.AsyncClient() as client:
        for i in range(0, len(to_fetch), BATCH_SIZE):
            batch = to_fetch[i : i + BATCH_SIZE]
            fetched = await fetch_prices_batch(client, batch, cc)
            for appid, price_data in fetched.items():
                result[appid] = price_data
                price_server_cache[f"{cc}:{appid}"] = {
                    "data": price_data,
                    "ts": time.time(),
                }
            logging.info(f"[prices] batch={len(batch)} done")

    return result


@app.delete("/prices/cache")
def clear_price_cache():
    price_server_cache.clear()
    return {"message": "Cache cleared"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
