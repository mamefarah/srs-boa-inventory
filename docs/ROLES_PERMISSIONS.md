# Roles, Permissions and Segregation of Duties — v4.0

## Roles

### System Administrator
User/configuration management. Does not automatically approve inventory transactions and is not treated as an official paper signatory solely because of system administration privilege.

### Inventory/Property Manager
Oversight, master-data review, selected approvals, reconciliation and period close subject to delegated authority.

### Storekeeper
Assigned warehouse operations: draft receipt, process approved issue, prepare/receive transfer, returns and count participation.

### Requesting Directorate User
Create and track requisitions; acknowledge receipt where required.

### Directorate Approver
Approve/reject requisitions within delegated scope.

### Inventory Approver
Technical capability to perform configured approval transitions after required authorization evidence is obtained/recorded. This role name does not itself establish the official government paper signatory.

### Procurement/Finance Viewer
Read procurement/source/value reports. No ordinary stock posting.

### Auditor
Read-only access to inventory, documents, approvals, ledger, period close and audit history.

## Implemented technical capabilities (M5 requisitions)

System capabilities, not official job titles or paper signatory authority:

- `READ_REQUISITIONS` — read requisitions and lines within warehouse scope.
- `PREPARE_REQUISITIONS` — draft, edit and submit requisitions, and cancel drafts, within warehouse scope (role: `REQUESTER`).
- `APPROVE_REQUISITIONS` — decide (approve / partially approve / reject), return a submitted requisition to draft, and cancel a submitted or decided one (role: `REQUISITION_APPROVER`). No inventory-posting authority.

Enforced in the database: the decider may not be the person who prepared or submitted the requisition, and an identity holding access-administration permissions may not also hold these operational permissions (extension of the M3/M4 separation-of-duties rule). `READ_STOCK` holders may additionally read commitments inside their warehouse scope so stock views show committed and available-to-promise quantities correctly. See ADR-0010.

## Implemented technical capabilities (M6 issues, slice 1)

System capabilities, not official job titles or paper signatory authority:

- `READ_ISSUES` — read issues, lines and issue-voucher references within warehouse scope.
- `PREPARE_ISSUES` — create and cancel DRAFT issues against decided requisitions and add voucher references.
- `POST_ISSUES` — post a DRAFT issue as a ledger transaction (role: `ISSUE_OPERATOR`, which also reads requisitions, stock, items and warehouses). No approval authority.

Enforced in the database: the application role has `SELECT` only on issue tables; the three `boa_issue_*` functions check the permission and the warehouse scope. An identity holding access-administration permissions may not also hold these (INV-029). Whether the issuer must differ from the requester or decider is **not** required by the controlled documents and is an open policy question (ADR-0016 A2). See ADR-0016.

## Implemented technical capabilities (M7 transfers, slice 1)

System capabilities, not official job titles or paper signatory authority:

- `READ_TRANSFERS` — read transfers and lines when the source **or** destination warehouse is in scope.
- `PREPARE_TRANSFERS` — create, submit and cancel DRAFT transfers out of an assigned source warehouse (role: `TRANSFER_OPERATOR`). No stock effect.
- `APPROVE_TRANSFERS` — approve submitted transfers out of an assigned source warehouse, reserving the stock, and cancel submitted or approved ones (role: `TRANSFER_APPROVER`). No inventory-posting authority.

Enforced in the database: SELECT-only grants; the approver may not be the preparer or submitter; an access administrator may not hold these (INV-029). Who may approve by value or item class is open (ADR-0017 T1). See ADR-0017.

## Permission model

Permission = role + action + warehouse scope + transaction scope + authority limit.

Examples:
- `receipt.create`
- `receipt.inspect`
- `issue.post`
- `transfer.dispatch`
- `transfer.receive`
- `count.submit`
- `adjustment.approve`
- `period.close`
- `period.reopen`
- `audit.read`

## Segregation rules

- Requester should not approve own request when policy requires separation.
- Storekeeper should not approve own restricted adjustment.
- Source dispatcher should not silently confirm destination receipt.
- Count entry and variance approval should be separate where staffing permits.
- Administrator privileges and business approval authority are distinct.

Where staffing prevents ideal segregation, document compensating controls such as supervisor review, two-person count, blind count, periodic independent reconciliation and enhanced audit review.


## v3.1 hard-copy approval rule

- Official signed source documents remain in hard copy for government filing/audit.
- BoA-IMS records the paper preparer/checker/approver/recipient names and titles where applicable.
- The authenticated system user performing a workflow transition is recorded separately.
- A system `APPROVED` action is not a legal digital signature and does not replace the handwritten government approval.
- Where current regional title/routing detail is unavailable, technical roles remain neutral and configurable. Current federal procedure may guide the operating workflow, but federal provenance must be retained and the official regional mapping may later override it.

## v4.0 channel mapping (PRD Part A section 3.2)

Roles stay software capabilities, not official titles. v4.0 only assigns each role a primary client.

| Person | Client | Notes |
|---|---|---|
| Storekeeper | Storekeeper app (personal Android phone or iPhone, offline-capable) | Receipts, inspection capture, issues, transfers, returns, count entry, stock view. |
| General Service case team | Admin web | The owner's term; official name and duties are not yet mapped (PRD O1). Review of phone-captured documents, exception queue, count and adjustment review. |
| Directorate head | Admin web | Approval authority to be set from the regional approval matrix (PRD O1). |
| Requester | Admin web | Channel proposed in PRD O2; not yet confirmed. |
| System administrator, auditor | Admin web | As before. |

Offline capture does not widen permissions. The server checks authorisation and warehouse scope at sync time using the user's rights at that moment (SYN-6). A deactivated user's queued commands are refused (INV-M08). Resolver of NEEDS REVIEW items is undecided (PRD O6) and must not be assumed.
