# Low-Fidelity UI Wireframes

These are behavioral wireframes, not final visual styling.

## Mobile home

```text
┌────────────────────────────┐
│ BoA Inventory        [WH▾] │
│ Good morning               │
├────────────────────────────┤
│ Tasks requiring attention  │
│  3 approvals   2 receipts  │
│  1 transfer discrepancy    │
├────────────────────────────┤
│ Quick actions              │
│ [Receive] [Requisition]    │
│ [Issue]   [Transfer]       │
├────────────────────────────┤
│ Stock alerts               │
│ 12 low stock               │
│  5 near expiry             │
├────────────────────────────┤
│ Home Inventory Tasks More  │
└────────────────────────────┘
```

## Receipt — mobile

```text
┌────────────────────────────┐
│ ← New receipt      DRAFT   │
│ Warehouse: Main Store      │
├────────────────────────────┤
│ Source & document          │
│ Supplier   [____________]  │
│ Delivery # [____________]  │
│ Project    [____________]  │
├────────────────────────────┤
│ Items                      │
│ Maize seed   SEED-001      │
│ Delivered 100 kg           │
│ [Edit]                     │
│ + Add item                 │
├────────────────────────────┤
│ [Save draft] [Submit]      │
└────────────────────────────┘
```

## Inspection

```text
Item: Maize seed (SEED-001)
Delivered: 100 kg
Accepted: [ 95 ]
Rejected: [  5 ]
Batch:    [ B-2409 ]
Expiry:   [ date ]
Reason for rejection [........]

Accepted + rejected must equal inspected quantity.
[Save] [Complete inspection]
```

## Requisition approval

```text
REQ-2019-0042       UNDER REVIEW
Requester: Extension Directorate
Purpose: Demonstration plots

Item            Request  Available  Approve
Maize seed       80 kg    100 kg    [80]
Fertilizer       50 bag    20 bag   [20]

Funding: Project A
Warnings: Fertilizer partially available

[Reject]              [Approve]
```

## Transfer receipt

```text
TRF-2019-0118       IN TRANSIT
From: Main Warehouse
To:   Equipment Warehouse

Item          Sent   Received   Difference
Pump           10      [10]        0
Hose           50      [48]       -2 !

[Record discrepancy]
[Confirm received quantities]
```

## Blind count

```text
CNT-2019-0021 — Rack A3
Book quantity: HIDDEN

Item: Hybrid maize seed
Code: SEED-001
Batch: B-2409

Physical quantity: [       ] kg

[Save & next]
```

After count submission, authorized variance review may reveal book quantity.

## Desktop pattern

Use a stable left navigation + top context/action bar. Detail pages may use a main content column plus a narrow state/approval/evidence panel. Do not turn every metric into a card.
