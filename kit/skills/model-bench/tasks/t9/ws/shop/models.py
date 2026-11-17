from dataclasses import dataclass, field


@dataclass
class Item:
    id: int
    name: str
    price: float
    created: int
    tags: list = field(default_factory=list)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "price": self.price, "created": self.created, "tags": list(self.tags)}
