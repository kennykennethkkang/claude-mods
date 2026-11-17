from .service import NotFound


def handle(service, method, path, query=None):
    query = query or {}
    if method != "GET":
        return {"status": 405, "body": {"error": "method not allowed"}}
    if path == "/items":
        return {"status": 200, "body": {"items": [i.to_dict() for i in service.list_items()]}}
    if path.startswith("/items/"):
        try:
            item = service.get_item(int(path.split("/")[2]))
        except (ValueError, NotFound):
            return {"status": 404, "body": {"error": "not found"}}
        return {"status": 200, "body": item.to_dict()}
    return {"status": 404, "body": {"error": "not found"}}
