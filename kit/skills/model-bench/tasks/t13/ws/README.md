# tix

Ticket sales for small venues, in memory. The box office app only talks to `tix.api.BoxOffice`.

Rules the app and finance depend on:

- Money is integer cents everywhere.
- A section has a capacity. `available(section)` is capacity minus sold seats minus seats in holds that have not expired. It is never negative and never above capacity.
- Creating an order holds its seats for `HOLD_SECONDS` (600). An expired hold no longer counts against availability.
- Checking out an order whose hold expired works only if its seats are still available at that moment; otherwise it raises `SoldOut` and the order stays pending. Checking out an order whose hold is still live always works.
- Promo codes take a percent or a fixed amount off the subtotal and may have `max_uses`. A use is consumed only when an order using the code checks out. Applying a code that is used up raises `PromoError`. If the code got used up between apply and checkout, checkout raises `PromoError`, nothing is charged, and the order stays pending with its hold.
- Percent discounts round half up to the cent. A discount never exceeds the subtotal.
- Fees are `FEE_CENTS` per ticket and are never discounted. `total = subtotal - discount + fees`.
- `refund(order, qty)` refunds `qty` tickets of a paid order and frees their seats. A ticket's share is the order total split evenly, with leftover cents going to the earliest tickets refunded, so refunding every ticket one at a time adds up to exactly the total paid. Once every ticket is refunded the order is cancelled.
- `cancel(order)` on a pending order drops its hold; on a paid order it refunds the tickets not yet refunded and returns that amount. Cancelling a cancelled order does nothing and returns 0.
- `sales()` reports per section: seats sold now, gross taken at checkout, refunded, and net (gross minus refunded).
