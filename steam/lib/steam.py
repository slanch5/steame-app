import httpx
from steam.lib.helpers.vanity import extract_vanity_id


async def get_steam_id(user_url: str, api_key: str):
    async with httpx.AsyncClient() as client:
        url = "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/"
        vanity_url = extract_vanity_id(user_url)
        params = {"key": api_key, "vanityurl": vanity_url}
        response = await client.get(url, params=params)
        data = response.json()
        return data["response"].get("steamid")