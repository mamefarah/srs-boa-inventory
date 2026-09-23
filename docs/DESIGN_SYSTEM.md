# BoA-IMS Design System

## Product character

A calm, trustworthy, operational government system. Prioritize clarity, accuracy and speed over decoration.

Avoid generic AI-dashboard excess: unnecessary gradients, excessive card grids, animation everywhere, tiny data labels and decoration without meaning.

## Design principles

1. Inventory state is visually unmistakable.
2. Warehouse context is always visible.
3. Primary transaction action is obvious.
4. Dangerous actions are separated and explicit.
5. Information density adapts by device.
6. Mobile forms minimize typing.
7. Accessibility is a default requirement.

## Typography

Use a highly legible UI sans-serif with broad language support. Final font choice must be tested with English, Somali and Amharic text. Maintain a restrained type scale and readable line lengths.

## Color semantics

Define tokens, not ad-hoc colors:
- surface/background
- text primary/secondary
- border
- primary action
- success
- warning
- danger
- info

Inventory status must combine text/icon/shape with color. Never encode AVAILABLE vs EXPIRED solely by hue.

## Spacing/layout

Use a consistent 4px-derived spacing scale. Mobile pages use one primary column. Desktop may use split views where the task benefits.

## Components

Standardize:
- App shell/navigation
- Warehouse selector/context badge
- Page header/action bar
- Search/combobox
- Status badge
- Quantity display
- Item identity block (code + name + UOM)
- Data table + mobile card equivalent
- Stepper/state timeline
- Form section
- Approval panel
- Evidence/attachment panel
- Confirmation dialog
- Error summary
- Empty/loading/skeleton states
- Audit timeline

## Interaction

- 44px minimum practical touch targets.
- Visible keyboard focus.
- Confirm irreversible/high-impact actions.
- Do not ask for confirmation on harmless navigation.
- Preserve form values after recoverable errors.
- Use plain action verbs: Save draft, Submit request, Approve, Dispatch, Confirm receipt, Post adjustment.

## Transaction states

Draft records should look editable. Submitted/approved/posted records should become progressively less editable and show status prominently.

## Responsive data

Desktop tables may become grouped mobile cards with the same facts. Never require horizontal scrolling for the primary phone workflow unless the content genuinely cannot be represented otherwise.

## Accessibility

Meet WCAG-aligned contrast and keyboard expectations; associate form labels; expose errors programmatically; support reduced motion; never rely on placeholder text as a label.
