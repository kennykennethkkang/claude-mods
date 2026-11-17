from dataclasses import dataclass, field

PENDING, PAID, CANCELLED = "pending", "paid", "cancelled"


@dataclass
class Section:
    name: str
    capacity: int
    price: int
    sold: int = 0


@dataclass
class Promo:
    code: str
    percent: int | None = None
    amount: int | None = None
    max_uses: int | None = None
    uses: int = 0


@dataclass
class Hold:
    section: str
    qty: int
    expires: float


@dataclass
class Order:
    id: int
    section: str
    qty: int
    unit_price: int
    created: float
    status: str = PENDING
    promo: str | None = None
    discount: int = 0
    fees: int = 0
    total: int = 0
    refunded_qty: int = 0
    refunded_cents: int = 0
    history: list = field(default_factory=list)

    @property
    def subtotal(self):
        return self.qty * self.unit_price
