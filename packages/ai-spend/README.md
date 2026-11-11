# @teamsuzie/ai-spend

AI cost ledger, model price book and budgets.

- `PriceBook`: prices per million input and output tokens, per model, in one currency. Costs are integers in
  micro-units, so sums are exact. `PriceBook.parse(currency, json)` reads configuration and fails loudly on bad input.
- `SpendStore.record(...)`: one entry per model call, charged to a scope (e.g. `{ type: 'matter', id }`) and
  optionally a piece of work (`ref`, e.g. a task). A model without a price is recorded with no cost and reported as
  unpriced, never counted as free.
- Budgets per scope (`total` or calendar `month`, UTC) with a warning level. `block(scope, model)` returns why new
  AI work may not start: the budget is spent, or the model has no price so the budget cannot be kept.
- `report(filter, groupBy)` and `entries(filter)` for cost recovery and billing export.
