from .errors import SoldOut, OrderError
from .models import Section, Hold

HOLD_SECONDS = 600


class Inventory:
    def __init__(self, clock):
        self.clock = clock
        self.sections = {}
        self.holds = {}  # order id -> Hold

    def add_section(self, name, capacity, price):
        if name in self.sections:
            raise ValueError(f"section {name} exists")
        if capacity < 0 or price < 0:
            raise ValueError("capacity and price must be >= 0")
        self.sections[name] = Section(name, capacity, price)

    def section(self, name):
        try:
            return self.sections[name]
        except KeyError:
            raise OrderError(f"no section {name}") from None

    def active(self, hold):
        return hold.expires > self.clock.now()

    def held(self, name):
        return sum(h.qty for h in self.holds.values() if h.section == name and self.active(h))

    def available(self, name):
        s = self.section(name)
        return s.capacity - s.sold - self.held(name)

    def hold(self, order_id, name, qty):
        if qty < 1:
            raise OrderError("qty must be >= 1")
        if self.available(name) < qty:
            raise SoldOut(f"{name}: {self.available(name)} left")
        self.holds[order_id] = Hold(name, qty, self.clock.now() + HOLD_SECONDS)

    def hold_live(self, order_id):
        h = self.holds.get(order_id)
        return h is not None and self.active(h)

    def drop_hold(self, order_id):
        self.holds.pop(order_id, None)

    def confirm(self, order_id):
        """Turn the order's hold into sold seats."""
        h = self.holds.get(order_id)
        if h is None:
            raise OrderError(f"order {order_id} has no hold")
        self.section(h.section).sold += h.qty
        del self.holds[order_id]

    def release(self, name, qty):
        self.section(name).sold -= qty
