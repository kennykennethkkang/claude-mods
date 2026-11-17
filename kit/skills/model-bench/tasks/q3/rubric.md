Planted bugs in billing.py measured against README.md (count one only when the report names the cause):

1. Pagination off by one (list_invoices, line 149): `mine[start:end - 1]` drops the last invoice of every page, so those invoices appear on no page.
2. Webhook failures dropped (apply_refunds, line 198): `except Exception: continue` logs at debug and moves on without adding the event to `self.failed_webhooks`, so a refund that failed to apply is lost for good.
3. Email matching (_norm_email, line 74): uses `.lower()` with no Unicode NFC normalization and no `casefold()`, so a decomposed `Zoë` or a `ß`/`SS` style address does not find the existing customer (and can create a duplicate).
4. DST day boundary (_day_bounds, line 209): the day end is the start plus a fixed 24 hours in UTC, so on a daylight saving change the usage day closes at 23:00 or 01:00 local instead of local midnight; the end should be the next local midnight converted to UTC.
5. Mutable default argument (create_invoice, line 117 and 122): `lines=[]` is shared between calls and `lines.append` adds a processing fee to it, so invoices created without lines pile up fee lines from earlier calls (it also mutates the caller's own list).
6. Check-then-act race in charge (lines 155 to 162): the open status is checked outside the lock and set to paid only after the gateway call, so two workers charging the same invoice at once both pass the check and charge the card twice.
7. Tax rounding (_tax, line 78): `round(subtotal * TAX_RATE)` uses a float rate and Python's round half to even, so exact half cents round down on even values (and float error can flip others) instead of rounding half up; needs Decimal with ROUND_HALF_UP or integer math.
8. Retry double charge (_charge_with_retry, line 169): retries after `GatewayTimeout` call `gateway.charge` again without an idempotency key, so a charge that went through but timed out is taken again; there is also no backoff sleep between tries (RETRY_BASE unused).

A false positive is a reported problem that is not real and not a genuine defect against README.md.
