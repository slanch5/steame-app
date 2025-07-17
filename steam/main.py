import uvicorn
import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from decouple import config
from fastapi.middleware.cors import CORSMiddleware
from steam_web_api import Steam
from steam.lib.steam import get_steam_id
from urllib.parse import unquote

app = FastAPI()

# Get the parent directory path
BASE_DIR = Path(__file__).resolve().parent.parent
# Mount static files with correct paths
app.mount("/css", StaticFiles(directory=str(BASE_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(BASE_DIR / "js")), name="js")
app.mount("/icon", StaticFiles(directory=str(BASE_DIR / "icon")), name="icon")

@app.get("/")
def home():
    return FileResponse(str(BASE_DIR / "index.html"))

@app.get("/api")
def api_status():
    return {"message": "Steam API is running!"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

KEY = config("STEAM_API_KEY")
steam = Steam(KEY)

# Configure logging
logging.basicConfig(level=logging.INFO)

@app.get("/user/{encoded_url:path}")
async def get_user_info_path(encoded_url: str):
    decoded_url = unquote(encoded_url)
    return await get_user_info(url=decoded_url)

@app.get("/user")
async def get_user_info(url: str = Query(...)):
   max_retries = 5
   retry_delay = 3  # seconds
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


# Запуск сервера
if __name__ == "__main__":
    
    uvicorn.run(app, host="127.0.0.1", port=8000)
