from fastapi import FastAPI, HTTPException, Response
from steam import Steam
from decouple import config
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio
import logging


app = FastAPI()

@app.get("/")
def home():
    return {"message": "Steam API is running!"}


# Дозволяємо запити з React (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Підключення до Steam API
KEY = config("STEAM_API_KEY")
steam = Steam(KEY)

# Configure logging
logging.basicConfig(level=logging.INFO)

@app.get("/user/{userid}")
async def get_user_info(userid: str):
   max_retries = 5
   retry_delay = 3  # seconds

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

