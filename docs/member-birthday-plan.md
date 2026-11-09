# Jozo member birthday — implementation checkpoints

Approved design: conversation with owner. One use per member per birthday month per calendar year (Asia/Ho_Chi_Minh), staff-confirmed at successful bill save. Configurable percentage on entire remaining bill, configurable allowed FNB drinks and total quantity. Free lines stay 0 VND. Persist policy/item/actor snapshots. Disable already-used selection; link historical bill; filter birthday/discount bills. Booking TV/decor is unchanged and outside this billing slice.

No commits, pushes, deployments, secrets or production data changes. Preserve old clients without birthday selection. AgentDesk tools unavailable in this session; no website sync claimed.

## Checkpoint 1 — backend (active)
- [ ] Write RED tests for configuration validation, Vietnam calendar boundaries, duplicate annual usage, selection count/allowlist, server-calculated discount and free lines.
- [ ] Extend membership config with `birthday: { enabled, discountPercentage, itemCount, itemIds }`; absent config is disabled.
- [ ] Add staff eligibility and paginated member history endpoints.
- [ ] Extend canonical bill preview/save with `birthdaySelection: { items: [{ itemId, quantity }] }`; only authenticated server actor is snapshotted.
- [ ] Unique partial bill index on birthday member/year key. Persist birthday stock, inventory movements, bill and revenue in a required Mongo transaction, fail closed on standalone Mongo.
- [ ] Extend existing gift-applied report with birthday source, plus free-item and discount filters.
- [ ] Run focused tests, isolated Mongo replica-set persistence tests, build and changed-file lint/format. Write exact API and rollout contract. Stop at verified backend checkpoint for review.

## Checkpoint 2 — admin (after backend review)
- [ ] Reuse membership settings/FNB picker for birthday policy.
- [ ] Staff checkbox disabled according to server eligibility, selected drinks/quantity, canonical preview and save.
- [ ] Member usage history linked to bill; birthday bill label and report filter.
- [ ] Mounted focused tests and admin build. No customer/TV flow implementation in this checkpoint.

## Financial rules
Birthday discount is calculated on the remaining bill after existing promotion/gift/tier discounts, before existing 1,000-VND rounding. Existing promotion stacking behavior is otherwise preserved. Gift drinks are separate 0-VND lines, not reclassified paid order lines. Stock and system-count movement are committed only at bill save. Changes to policy never rewrite historical bill snapshots. Cancellation/refund after finalization does not automatically restore annual usage (no new reversal workflow authorized).
