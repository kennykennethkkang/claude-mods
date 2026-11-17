from .models import Item


class Repo:
    def __init__(self):
        self._items = {}
        self._next = 1

    def add(self, name, price, created, tags=()):
        item = Item(self._next, name, price, created, list(tags))
        self._items[item.id] = item
        self._next += 1
        return item

    def get(self, item_id):
        return self._items.get(item_id)

    def all(self):
        return list(self._items.values())
