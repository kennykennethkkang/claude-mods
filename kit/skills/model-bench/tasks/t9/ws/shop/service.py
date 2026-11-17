class NotFound(Exception):
    pass


class ItemService:
    def __init__(self, repo):
        self.repo = repo

    def list_items(self):
        return sorted(self.repo.all(), key=lambda i: (i.created, i.id))

    def get_item(self, item_id):
        item = self.repo.get(item_id)
        if item is None:
            raise NotFound(item_id)
        return item
