# stockroom

Orders and stock for a small shop with several warehouses. Node 24 runs the TypeScript directly (type stripping), so no build and no dependencies. `npm test` runs test/.

## Layout

- `src/util` money helpers, clock, ids, errors
- `src/domain` types and pure pricing and promotion rules
- `src/storage` in-memory tables, stock levels, event log
- `src/service` catalog, inventory, promos, orders, receipts, reports
- `src/http` a small router and the JSON handlers
- `src/app.ts` wires it together: `createApp({ clock })`

## Rules finance and the warehouse rely on

Money
- Amounts are integers in minor units (cents for USD). Rounding is half away from zero.
- Catalog prices are USD cents.

Pricing
- A product can have tiers. The tier with the highest `minQty` that the line qty reaches sets the unit price for every unit in that line.
- Adding a sku that is already on the order merges into the existing line.

Promotions
- One code per order. `percent`: value percent of the subtotal, rounded. `fixed`: value cents off, never more than the subtotal. `bogo`: buy `value` get one free on `sku`, `floor(qty / (value + 1))` free units.
- `minSubtotal`: below it the code gives no discount.
- `maxUses`: a code's uses are the orders holding it that are placed, paid or shipped. A draft holds no use, and a cancelled or expired order gives its use back. Applying a code with no use left is refused (409), and so is placing an order whose code ran out in the meantime. `promos.uses(code)` is that count.

Receipts
- The order discount is split over the lines it applies to (every line, or only the bogo sku) in proportion to line subtotal. Line nets always add up to the order total: leftover cents go to the largest remainders, ties to the earlier line.

Stock
- Each warehouse keeps `onHand` and `reserved` per sku; available is the difference and never goes negative.
- `inventory.transfer` moves free stock between warehouses; reserved units never move.
- Placing reserves every line or nothing, filling from warehouses by priority (lower number first, then id).
- A reservation is returned to, or shipped from, exactly the warehouses it was taken from.

Order lifecycle
- draft, placed, paid, shipped; cancelled and expired are final.
- A placed order holds its stock for `HOLD_MS` (15 minutes). `orders.expireStale()` expires overdue holds. Paying an overdue hold fails with 409 and expires it.
- `pay` is idempotent for the same paymentId. Another paymentId on a paid order is 409.
- `cancel` works on draft, placed and paid orders. Cancelling a paid order refunds its total.

Event log
- Every change appends `{ seq, at, type, orderId, data }`. Types: created, placed, paid, shipped, cancelled, expired, refunded, received, transferred.

Reports
- `reports.sales()`: gross is the total of every order that was ever paid, refunds is every refund, net is gross minus refunds.

## HTTP

`app.handle({ method, path, body })` returns `{ status, body }`. Errors come back as `{ error, message }` with the status of the AppError (400, 404, 409), 405 for a known path with the wrong method, 500 for anything else.

- `POST /products`, `GET /products/:sku`
- `POST /warehouses`, `POST /stock/:warehouse/:sku`, `GET /stock/:sku`, `GET /stock`, `GET /stock.csv`, `POST /stock/transfer`
- `POST /promos`, `GET /promos/:code`
- `POST /orders`, `GET /orders/:id`, `POST /orders/:id/lines`, `PUT /orders/:id/lines/:sku`, `PUT /orders/:id/promo`
- `POST /orders/:id/place`, `/pay`, `/ship`, `/cancel`, `GET /orders/:id/receipt`, `GET /orders/:id/events`
- `GET /reports/sales`, `GET /admin/audit`, `POST /admin/expire`
