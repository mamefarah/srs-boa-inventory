# Canonical UX Patterns

## 1. List → Detail
Search/filter at top; status + warehouse visible. Tap row/card to open detail. Primary action depends on state/permission.

## 2. Create transaction
Identify context first (warehouse, source/destination) → add lines → validate → review summary → save draft/submit. Long forms use sections, not one giant page.

## 3. Draft → Submit → Approve
Draft remains editable. Submit freezes controlled fields except through amendment/cancel rules. Approval view shows requester, purpose, quantities, availability, funding source and exceptions before action.

## 4. Item selection
Search by code/name/alias; show UOM, available quantity and warehouse; warn on restricted/expired/unavailable states. Avoid dropdowns with hundreds of items.

## 5. Receipt
Header evidence → delivered lines → inspection state → acceptance quantities → review → post. Accepted/rejected quantities are visually separated.

## 6. Issue
Show approved vs reserved vs already issued vs remaining. Picking UI defaults FEFO when relevant.

## 7. Transfer
Source and destination are prominent. After dispatch, show IN TRANSIT state and prevent source editing. Destination view compares dispatched vs received line-by-line.

## 8. Blind count
Counter sees identity/location and entry field, not book quantity. After submission, authorized review shows book vs physical vs variance.

## 9. Adjustment/reversal
Use a dedicated high-risk layout: current state, proposed effect, reason, evidence, approval requirement. Never present adjustment as ordinary inline editing.

## 10. Error recovery
Explain what failed, what did/did not post, and next action. Network timeout on a critical posting must check transaction/idempotency status before suggesting retry.

## 11. Mobile navigation
Prioritize: Home, Inventory, Transactions, Tasks/Approvals, More. Role-specific shortcuts may appear on home.

## 12. Global context
When a user is warehouse-scoped, show the active warehouse persistently. Switching warehouse must be deliberate and permission-checked.

## 13. Storekeeper app: sync status and command states (v4.0)

Always show a sync indicator with counts of local drafts, queued, rejected and needs-review items, a "last synced" time and a "Sync now" control. States DRAFT (local), QUEUED, SUBMITTED, POSTED, REJECTED and NEEDS REVIEW must each look different by label and shape, never colour alone. A stock-changing action is never shown as done until the server confirms it. Offline stock is labelled "as of" its last-synced time and is never shown as current. A rejected item stays visible with the server's reason and can be corrected or discarded with a reason. Warn before sign-out or uninstall while items are unsynced.

## 14. iPhone install guidance (v4.0)

When the app runs in a Safari tab instead of the installed Home Screen app, show step-by-step install instructions with pictures in English and Somali, and block field capture until installed. Tell the user the installed app has its own sign-in and that captures must not be made in a Safari tab (PRD IOS-1, IOS-3).

## 15. Admin web (v4.0)

Desktop-first, usable on a tablet. Includes the exception queue for NEEDS REVIEW items and Directorate-head dashboards showing on-hand, committed and available-to-promise separately, pending approvals and unposted physical events (PRD AW-1 to AW-6).
