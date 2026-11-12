# CounterPack

Turn your own order records into an organised chargeback evidence pack - free, in your browser, nothing uploaded.

**Use it:** https://izackolson5-cyber.github.io/counterpack/

## What it does

- Pick the dispute category from your processor's notice (the 7 categories in Stripe's published dispute docs).
- An honest checklist of the evidence that category calls for, grouped by Stripe's one-combined-file-per-evidence-type upload types.
- A response summary generated **only** from facts you enter, a timeline built only from dates you provide, and a print-ready pack.

## What it does not do

- **It never invents facts.** Missing pieces show up as `[MISSING - FILL IN BEFORE SUBMITTING]` markers and the pack stays NOT READY until you resolve them.
- **It never claims records are attached when they aren't.** "Marked available by you - still to be attached" is as strong as it gets.
- **It doesn't verify evidence, predict outcomes, or certify** that a response meets card-network rules. It's an organiser, not a lawyer and not a guarantee. The cardholder's bank decides disputes.
- **No accounts, no uploads, no tracking.** Everything runs in your browser; nothing you enter is sent or saved - closing the tab discards it.

## Sources and scope

The evidence categories, file rules (PDF/JPEG/PNG, 4.5 MB combined, page limits) and one-file-per-type structure come from Stripe's published dispute documentation, linked on the page. Shopify sellers respond inside the Shopify admin, which bundles evidence differently - the page links Shopify's own chargeback guides too. Other processors (PayPal, Afterpay, bank gateways) have their own rules; check their docs.

## Run the tests

The evidence logic is a standalone module with a regression suite (89 tests: gap logic, no-fabrication rules, readiness semantics, calculator math, XSS escaping):

```
node test.js
```

## Files

- `index.html` - the page (markup, styles, print stylesheet)
- `app.js` - DOM wiring
- `packlogic.js` - evidence categories, checklist/narrative/pack logic, calculator (no DOM)
- `test.js` - regression suite
