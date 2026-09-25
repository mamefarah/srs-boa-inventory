# ADR-0005: Quantity Precision and Per-UOM Decimal Places

- Status: Proposed (accepted on merge of the M2 PR)
- Date: 2026-09-25
- Owners: BoA-IMS project
- Related rules: INV-022, INV-023; PRD §25; M0_BLOCKER_MATRIX CG-1

## Context

Agricultural inventory includes countable units (bags, sprayers), weights (kg, tonnes) and volumes (litres of pesticide). Some of these need fractional quantities. M1 stored ledger quantities as unconstrained `numeric` so this decision would not be pre-empted.

Floating point is never acceptable for authoritative quantities. PRD §25 requires "deterministic arithmetic" and an "authorized rounding rule" **for conversions**. No approved conversion schedule exists (CG-1), so any rounding rule would be invented.

## Options considered

### A. INTEGER quantities only
Forces sub-units, such as grams, to be modelled as separate UOMs. It cannot represent 2.5 L within a litre base UOM. Rejected.

### B. Unconstrained `numeric`
Exact, but it accepts any number of decimals, so a quantity such as 0.3333333 kg would be accepted with no business meaning.

### C. Fixed storage scale plus per-UOM entry precision, with no rounding (selected)

## Decision

1. **Storage type.** All authoritative quantities use `NUMERIC(20,6)`: ledger `signed_quantity` now, and commitment, count and document quantities as they are introduced. That allows 14 integer digits and 6 fractional digits, and is exact.
2. **Entry precision per UOM.** `uoms.decimal_places` (0–6, default **0**) states how many decimals a quantity in that UOM may carry. Examples: EA = 0, KG = 3, L = 3. This is master-data configuration set by an authorised data steward. It is **not** a Bureau rounding rule.
3. **Reject, never round.** A quantity with more decimals than its UOM allows is **rejected** before it can reach the ledger. The database enforces this with a trigger on `inventory_entries` (`BOA_QUANTITY_PRECISION`). The system never rounds silently.
4. **Changing `decimal_places`.** Increasing it is always allowed. Decreasing it is refused if existing ledger quantities in that UOM would violate the new precision.
5. **Conversions.** `item_uom_conversions` exists but no conversion can become active without verified evidence and an approval reference. Mixed-UOM posting stays blocked (CG-1). Any rounding rule for conversions will come from the approved conversion policy.

6. **Coercion caveat (M2 REDTEAM M2).** Assigning a value to a `NUMERIC(20,6)` column rounds it to 6 decimals *before* any trigger runs. Posting functions (M3+) must therefore accept quantities as unconstrained `numeric` or text, reject non-finite values and anything beyond the UOM's scale, and only then cast. The ledger trigger is a second line of defence, not the only one. `NaN` is rejected by a CHECK constraint.

## Consequences

- Posting functions (M3+) inherit exact arithmetic and a database-enforced precision check.
- The default of 0 decimals is the stricter choice: a steward must deliberately enable fractional entry for a UOM.
- Reports can display quantities using the UOM's `decimal_places`.
- Valuation and currency precision remain separate and undecided (INV-047).

## Verification

`tests/item-master.test.ts` covers the storage type, rejection of excess decimals, the rule against decreasing decimals, and the conversion activation gate.
