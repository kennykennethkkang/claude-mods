stockroom (this folder) is the order and stock service for a shop with several warehouses. TypeScript run directly by Node 24 (type stripping: no enums, no parameter properties, imports end in `.ts`), no dependencies, `npm test`. README.md has the rules finance and the warehouse rely on; they still hold after your change unless this file says otherwise.

## Reports from the team

1. Accounting: "Receipts don't add up. On some orders the lines come to a cent more or less than the total at the bottom."
2. Warehouse: "After a few cancellations Berlin showed stock we did not have, and Rotterdam has been stuck lower than what is on the shelf ever since."
3. Marketing: "SPRING is limited to 3 orders. The admin page says it is used up, but only one order with it has gone through."

## Feature: currencies

- `orders.create(customer, currency = 'USD')`. The supported currencies and their decimals are the ones in src/util/money.ts; anything else is a 400 (`ValidationError`).
- New `app.fx` with `setRate(currency, rate, effectiveAt)`. `rate` is a decimal string, units of that currency per 1 USD, greater than zero, at most 6 decimal places (`"0.92"`, `"151.37"`); anything else is a `ValidationError`. A currency can have many rates; the one in force at time t is the one with the greatest `effectiveAt <= t`. `fx.rateAt(currency, t)` returns that string; USD is always `"1"`.
- An order locks the rate in force at its creation time: `order.currency` and `order.fxRate` (the string, `"1"` for USD). No rate in force at that time is a `ValidationError` from `create`. Later rate changes never touch an existing order.
- Converted unit price: the tier unit price in USD cents times the rate, in the order currency's minor units, rounded half up. It must be exact: `30` cents at `"1.15"` is `35` EUR cents, not `34`. Line subtotal is that unit price times qty; everything after that (promos, totals, receipts) works in the order currency.
- Promotion amounts (`fixed` value and `minSubtotal`) are USD cents and convert the same way at the order's rate. `percent` and `bogo` need no conversion.
- Receipts report the order's currency. `reports.sales(currency = 'USD')` covers only orders in that currency.
- HTTP: `POST /orders` takes an optional `currency`. `PUT /fx/:currency` with `{ rate, effectiveAt }` returns 200 `{ currency, rate, effectiveAt }`. `GET /reports/sales/:currency`.

## Feature: partial shipments and returns

- Every line gets `shipped` and `returned` counts (start at 0). Every order gets `refunded` (start 0, in the order currency).
- `orders.ship(id, items?)`, items `[{ sku, qty }]`. No items means every unit not yet shipped. Only `paid` and `partially_shipped` orders ship (409 otherwise). A sku not on the order is 400; more than the line has left to ship is 409. Validate the whole request first: an error changes nothing.
- Shipped units leave the warehouses of the order's own allocations, in allocation order, lowering `onHand` and `reserved` there.
- Status becomes `partially_shipped` while some units are still unshipped, `shipped` when none are. The `shipped` event's data is `{ items }`: the units this call shipped, only lines with qty above 0.
- `cancel` is refused (409) once anything has shipped. Cancelling a paid order sets `refunded` to the total.
- `orders.returnItems(id, items, restockTo)` returns `{ refund }`. Only units already shipped and not yet returned can come back (409 if more; 400 for a sku not on the order; 409 if the order is not partially_shipped, shipped or returned). `restockTo` is a warehouse id whose `onHand` gets the units back (404 if unknown, checked before anything changes) or `null` for damaged goods that are not restocked.
- Refund: a line's net is its receipt net. After a return, the line has refunded `floor(net * returned / qty)` in total; this return refunds the difference, so returning every unit refunds the whole net and a fully returned order refunds exactly its total. `refunded` goes up by the refund.
- Status becomes `returned` once every unit of every line has been returned. A `returned` event carries `{ items, refund, restockTo }`.
- Partially shipped, shipped and returned orders still hold a promo use. Sales report refunds include return refunds.
- HTTP: `POST /orders/:id/ship` with optional `{ items }` returns the order. `POST /orders/:id/returns` with `{ items, restockTo }` returns `{ refund, order }`.

Keep the existing API and behaviour working. Add tests in test/ for what you change.
