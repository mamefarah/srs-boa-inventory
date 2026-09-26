# Roles, Permissions and Segregation of Duties — v3.1

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
