# Roles, Permissions and Segregation of Duties

## Roles

### System Administrator
User/configuration management. Does not automatically approve inventory transactions.

### Inventory/Property Manager
Oversight, master-data review, selected approvals, reconciliation and period close subject to delegated authority.

### Storekeeper
Assigned warehouse operations: draft receipt, process approved issue, prepare/receive transfer, returns and count participation.

### Requesting Directorate User
Create and track requisitions; acknowledge receipt where required.

### Directorate Approver
Approve/reject requisitions within delegated scope.

### Inventory Approver
Approve configured transfer/adjustment/count/reversal/disposal actions within authority.

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
