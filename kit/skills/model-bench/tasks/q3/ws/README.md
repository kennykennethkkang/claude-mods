# billing

Invoices, card charges and the daily usage rollup for the subscription service. `billing.py` is used by the web app and by the payment workers (several threads share one `Billing` instance).

Rules:

- Money is integer cents. Sales tax is `TAX_RATE` times the invoice subtotal, rounded half up to the cent, once per invoice.
- Customers are found by email. Emails match after Unicode NFC normalization and case folding, so `Ann@X.com`, `ann@x.com` and the decomposed form of `Zoë@x.com` all find the same customer.
- Every invoice gets a `processing` fee line of `PROCESSING_FEE` cents, and only its own.
- `list_invoices(customer_id, page, per_page)` pages are numbered from 1. Every invoice appears on exactly one page, newest first; `has_more` is true when a later page has items.
- `charge(invoice_id)` charges an open invoice exactly once, even when two workers pick up the same invoice at the same moment. The gateway can time out after it has already taken the money: retries must send the same idempotency key (the invoice id) and wait with exponential backoff (`RETRY_BASE` seconds, doubled each try).
- `apply_refunds(events)` processes gateway refund webhooks. A webhook that fails to apply must stay in `self.failed_webhooks` for a retry; nothing is dropped.
- The usage rollup closes each day at local midnight in the customer's time zone (`Customer.tz`, an IANA name), including on daylight saving changes.
