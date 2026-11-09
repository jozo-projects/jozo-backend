# Member birthday — backend checkpoint / admin integration contract

Scope: Jozo room bills, not retail/coffee. Admin UI and member-facing birthday copy are not part of this backend checkpoint. Booking-only photo-on-TV/decor remains separate and is not required for the discount/drink.

## Safe activation

No birthday config means disabled. Existing membership config and legacy bills remain valid. No live database migration or configuration update has been run.

`PUT /membership/config` (existing Admin guard) accepts an additive field:

```json
{
  "birthday": {
    "enabled": true,
    "discountPercentage": 10,
    "itemCount": 1,
    "itemIds": ["<24-hex drink SKU id>"]
  }
}
```

10 and 1 are examples, not constants in pricing logic. Percentage must be a finite number 0–100. Count must be an integer 1–100. Selected IDs must be unique active drink SKUs, not parent products with variants. An enabled policy requires at least one drink. Config update preserves all other existing fields. A disabled policy can have an empty item list.

Mongo must support transactions (replica set/mongos). Birthday saves **fail closed**, before inserting a bill, if a real transaction is unavailable. The first birthday save ensures the partial unique `birthday_member_year_unique` index on `birthday.usageKey`; index errors abort saving. Unrelated legacy bills without that field are not subject to the uniqueness constraint. Test this on staging before enabling the policy.

## Staff lookup and disabled states

`GET /membership/members/:id/birthday` — Admin/Staff, normal `{ message, result }` envelope.

`result`:

- `eligible: boolean`, `year: number` (current server time in Asia/Ho_Chi_Minh).
- `reason?: disabled | member_not_found | outside_birthday_month | already_used | no_available_items`.
- `policy?`: validated configured policy.
- `items`: `{ itemId, name, availableQuantity: number | null }[]`; `null` quantity means inventory tracking is disabled.
- `usedBill?`: `{ billId, invoiceCode, appliedAt }`. Available for already-used member/year even if configuration is disabled later or birthday month has passed.

UI: unchecked by default; only staff choice applies the benefit. Disable if not eligible. For `already_used`, show date and link to saved bill. Re-fetch after member change and after save/409. Other disabled reasons must not all say “chưa đến tháng”: outside month may also be after birthday month.

Date of birth uses the stored date-only YYYY-MM-DD calendar. Missing/invalid/future date is ineligible. Client bill timestamps cannot select a different eligibility month/year.

## Preview, print and final save

Staff sends selection only, never %/amount/name/snapshot:

```json
{
  "birthdaySelection": {
    "items": [{ "itemId": "<allowed SKU>", "quantity": 1 }]
  }
}
```

- Existing `GET /bill/:scheduleId`: `birthdaySelection` query is JSON-stringified selection (URL encode normally). Other existing phone/time/promotion params remain unchanged.
- Existing `POST /bill/:scheduleId`: include `birthdaySelection` in JSON body.
- Existing `POST /bill/save`: include `birthdaySelection` in existing bill body. Canonical bill is rebuilt from current schedule/order/config. Staff identity comes from authenticated token, not body `completedBy`.
- Omit `birthdaySelection` entirely when unchecked. Do not send empty/null selection.
- Preview returns additive `birthdaySelection`, server-only `birthday` snapshot and `isBirthdayGift` bill lines. Save must retain the selection, not rely on a forged/copied snapshot. Preview and printing do not reserve/consume the annual turn or decrement birthday stock.

The sum of quantities must equal configured count exactly. No duplicate IDs, unconfigured/inactive/non-drink SKUs, fractional/negative/string quantities, or insufficient inventory. Revalidated at save. Eligible drinks are added as **extra zero-price lines**, not used to silently waive an already-ordered paid drink. This follows the confirmed “thêm món tặng 0đ” flow.

Calculation preserves existing gift/member/promotion rules, then applies birthday % to the entire remaining bill (room + F&B + other canonical charges), before the existing final 1,000-VND floor rounding. No early birthday rounding. Snapshot `discountAmount` is the explicit percentage reduction, excluding final rounding adjustment.

`birthday` snapshot on saved bill:

```text
usageKey, userId, year, appliedAt, confirmedBy,
discountPercentage, discountAmount, itemCount,
items: [{ itemId, name, quantity, inventoryTracked }]
```

Gift lines: `price: 0`, `grossAmount: 0`, `isBirthdayGift: true`, productId, sourceLineRef. Existing bill printing includes those lines and a separate birthday reduction row.

## Persistence and failures

Bill insert, birthday inventory decrement, birthday system-count movement and room revenue close share a real Mongo transaction. Concurrent same-member/year saves: one wins; loser gets 409. Stock is rechecked under transaction and also returns 409 when changed. Failed transaction leaves no bill, no annual turn and no birthday stock movement.

Birthday bills persist `checkoutFollowUp` in the same transaction, initially pending. Points and streak-link processing happen afterward; failures return the saved bill with a membership warning (not a false failed-checkout response) and leave durable pending steps for manual reconciliation. A retry with birthdaySelection for the same schedule returns the already saved birthday bill without repricing, stock movement, revenue insertion or re-running follow-up steps. Automated follow-up retry is not implemented. Current post-save schedule/order steps retain their existing lifecycle. Canceled drafts do not consume. Completed bill refund/void does **not** automatically restore the annual turn; refund policy still requires a product decision. Automatic legacy cleanup excludes birthday bills so it cannot erase usage evidence.

## Member history and bill filter

`GET /membership/members/:id/birthday/history?page=1&limit=20` — Admin/Staff. Page is an integer >=1; limit is 1–100.

`result: { page, limit, totalCount, items }`, descending `birthday.appliedAt`.

Each history item contains `billId`, `invoiceCode`, `roomId`, `scheduleId`, `totalAmount`, and immutable `birthday`. The existing bill-detail endpoint can resolve room details. Current Jozo bill schema does not expose a separate branch identifier; do not invent one in the admin table.

Existing `GET /bill/gift-applied` now accepts `source=birthday`; `kind=discount` includes birthday bills with a positive reduction; `kind=fnb` includes birthday gift bills. Each row includes `birthday`. Summary adds `birthdayBills` and `totalBirthdayDiscountAmount`. Other existing date/search/pagination/source filters are preserved. A row with multiple simultaneous benefit types is classified as birthday, while retaining its existing benefit snapshots.

## Verification boundary

Unit/controller tests use mocks and do not prove production authentication. Route tests exercise mounted Express paths with explicit fixture guards. Persistence tests run a separate MongoMemoryReplSet with generated member IDs, never the developer/application database; fixture data is deleted and the owned replica set stopped in teardown. See `member-birthday-verification.md` for final commands/results and remaining frontend/live gates.
