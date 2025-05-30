from fastapi import FastAPI
from steam import Steam
from decouple import config
from fastapi.middleware.cors import CORSMiddleware
import uvicorn


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

@app.get("/user/{userid}")
def get_user_info(userid: str):
    user = steam.users.get_user_details(userid)
    
    friends = steam.users.get_user_friends_list(userid)
    
    games = steam.users.get_owned_games(userid)
    
    return {"user": user, "friends": friends, "games": games}
  

# Запуск сервера
if __name__ == "__main__":
    
    uvicorn.run(app, host="127.0.0.1", port=8000)

