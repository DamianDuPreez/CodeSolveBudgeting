# CodeSolveBudgeting

A budgeting web app that does the manual work for you. Drop in an FNB bank statement (PDF, CSV or OFX). The app reads it, sorts every transaction into a category and updates your monthly budget.

## How it works

- **Everything runs in the browser.** Statements are read on your device and stored in the browser's own database (IndexedDB). Nothing is uploaded, and there is no server or AI service to pay for.
- **Reading files** (`src/lib/parsers/`): OFX and CSV are read directly. PDFs are read with pdf.js and parsed around FNB's statement layout ("05 Jan · description · amount · balance", where "Cr" marks money in). The running balance is used to double-check every amount's sign.
- **Sorting transactions** (`src/lib/categorise.ts`), in this order:
  1. Rules you made
  2. Rules learned from your corrections. Fix one transaction and every other one from that shop follows.
  3. Similarity to shops you already sorted
  4. A built-in list of common South African merchants (Checkers, Engen, Vodacom, Discovery…)
- **Budgeting** (`src/components/BudgetView.tsx`): envelope-style, like YNAB.
  - Income goes into "Left to assign", and you give every rand a category.
  - Each category shows Assigned, Spent and Available. Unspent money rolls over to the next month.
  - "Auto-fill from past spending" sets the budget for you.

## Development

```
npm install
npm run dev      # http://localhost:5173
npm test         # parser and categoriser tests
npm run build    # static site in dist/, can be hosted free (GitHub Pages, Netlify, Cloudflare Pages)
```
