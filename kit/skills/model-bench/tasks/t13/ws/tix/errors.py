class TixError(Exception):
    pass


class SoldOut(TixError):
    pass


class PromoError(TixError):
    pass


class OrderError(TixError):
    pass
