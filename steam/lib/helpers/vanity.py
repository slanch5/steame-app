from urllib.parse import urlparse

def extract_vanity_id(url: str) -> str:
    parsed = urlparse(url)
    path_parts = parsed.path.strip("/").split("/")
    if len(path_parts) >= 2 and path_parts[0] == "id":
        return path_parts[1]
    raise ValueError("Invalid Steam vanity URL")