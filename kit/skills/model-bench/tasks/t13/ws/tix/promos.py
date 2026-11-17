from .errors import PromoError
from .models import Promo
from .money import pct_of


class PromoBook:
    def __init__(self):
        self.promos = {}

    def add(self, code, percent=None, amount=None, max_uses=None):
        if (percent is None) == (amount is None):
            raise ValueError("give percent or amount")
        if percent is not None and not 0 < percent <= 100:
            raise ValueError("percent must be 1..100")
        self.promos[code.upper()] = Promo(code.upper(), percent, amount, max_uses)

    def get(self, code):
        p = self.promos.get(code.strip().upper())
        if p is None:
            raise PromoError(f"unknown code {code}")
        return p

    def check(self, code):
        p = self.get(code)
        if p.max_uses is not None and p.uses >= p.max_uses:
            raise PromoError(f"{p.code} is used up")
        return p

    def consume(self, code):
        self.get(code).uses += 1

    def discount(self, code, subtotal):
        p = self.get(code)
        off = pct_of(subtotal, p.percent) if p.percent is not None else p.amount
        return min(off, subtotal)
