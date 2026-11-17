This folder holds stockroom, an order and stock service in TypeScript (README.md explains it). Do not edit any file. Answer each question in one line as `A<n>: <answer>`, naming the file and the function or method wherever one applies.

1. When a placed order is cancelled, which function decides which warehouses get the reserved units back, and what does it base that choice on?
2. Where in src/ is `Inventory.release` called (file and method for each call site), and which other public methods reach it only indirectly?
3. Marketing says a code limited to 3 orders shows as used up after only one order went through. Which method increments a code's use count, and which method calls it?
4. Accounting says receipt lines sometimes add up to a cent more or less than the order total. Which file and function compute the per-line discount, which helper call causes the drift, and which helper already in the codebase would keep the lines summing to the total?
5. An order is placed, 16 minutes pass with nobody calling `expireStale`, and the client sends `POST /orders/:id/pay`. What HTTP status comes back and what status is the order left in?
6. A product costs 2500 with one tier `{ minQty: 3, priceCents: 2200 }`. A customer adds 2 units, then adds 1 more. Which function picks the unit price, which method re-runs it on every change, and what unit price do the 3 units end up with?
7. The ops page calls the audit endpoint. Which route is it, which class and method do the check, and which order statuses count as holding reserved stock?
8. A paid order is cancelled. Which event types are appended, in order, and which EventLog method does `reports.sales()` use to find the refund?
