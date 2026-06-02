## Project name
Steam user info

## Description 
Steam User Info displays information about a Steam user's account, including their games, friends, and how much time they've spent playing each game (e.g., 1h 45m).

## How to run

1. Clone the repository:
  ```bash
    git clone https://github.com/slanch5/steame-app
    cd steame-app
  ```
2. Install the required dependencies:
  ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows use `venv\Scripts\activate`
    pip install --upgrade pip
    pip install fastapi uvicorn
    pip install -r requirements.txt
   ```
3. Run the application:
  ```bash
    uvicorn steam.main:app --reload
  ```
4. Open your web browser and navigate to `http://127.0.0.1:8000`


Python version: `3.10+`

## Heroku deploy

The repository includes Heroku deployment files:

- `Procfile` starts the FastAPI app with Uvicorn and the Heroku `$PORT`.
- `.python-version` pins Python `3.13`.
- `app.json` documents the Heroku app, Python buildpack, stack, and required config vars.
- `requirements.txt` is used by the Heroku Python buildpack.

Deploy from the repository root:

```bash
heroku login
heroku create your-steam-app-name --stack heroku-24
heroku config:set STEAM_API_KEY=your_steam_web_api_key
git push heroku main
heroku ps:scale web=1
heroku open
```

Useful checks:

```bash
heroku logs --tail
heroku config
```

## Usage
- Navigate to `/` to see the main page.
- Use the search bar to enter a Steam username.
- The application will display the user's profile information, including their games, friends, and playtime.

## Contributing
Contributions are welcome! Please feel free to submit a pull request or open an issue if you find any bugs or have suggestions for improvements.
