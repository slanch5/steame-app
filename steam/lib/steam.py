import httpx
from urllib.parse import urlparse
from steam.lib.helpers.vanity import extract_vanity_id


async def get_steam_id(user_url: str, api_key: str):
    # Extract the ID or vanity name from URL
    parsed = urlparse(user_url)
    path_parts = parsed.path.strip("/").split("/")

    if len(path_parts) >= 2:
        if path_parts[0] == "profiles":
            # Profile URL contains Steam ID64 directly
            return path_parts[1]
        elif path_parts[0] == "id":
            # Vanity URL needs to be resolved via API
            vanity_name = path_parts[1]
            async with httpx.AsyncClient() as client:
                url = "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/"
                params = {"key": api_key, "vanityurl": vanity_name}
                response = await client.get(url, params=params)
                data = response.json()
                return data["response"].get("steamid")

    raise ValueError("Invalid Steam URL")
