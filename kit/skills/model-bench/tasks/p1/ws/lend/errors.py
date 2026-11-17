class LendError(Exception):
    pass


class ValidationError(LendError):
    pass


class NotFound(LendError):
    pass


class Conflict(LendError):
    pass


class LimitReached(LendError):
    pass


class Unavailable(LendError):
    pass


class Blocked(LendError):
    pass


class SchemaError(LendError):
    pass
