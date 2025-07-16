from urllib.parse import urlparse

def extract_vanity_id(url: str) -> str:
    parsed = urlparse(url)
    path_parts = parsed.path.strip("/").split("/")

    if len(path_parts) >= 2:
        if path_parts[0] == "id":
            # Vanity URL: https://steamcommunity.com/id/username
            return path_parts[1]
        elif path_parts[0] == "profiles":
            # Profile URL: https://steamcommunity.com/profiles/steamid64
            return path_parts[1]

    raise ValueError("Invalid Steam URL")
