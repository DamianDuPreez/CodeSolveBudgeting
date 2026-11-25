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

## Firebase (hosting, sign-in, database)

The app runs without Firebase: no sign-in, and data stays in the browser. Add the Firebase config to turn on sign-in.

1. In the [Firebase console](https://console.firebase.google.com), create a project (the free Spark plan is enough).
2. **Authentication → Sign-in method**: enable **Email/Password** and **Google**.
3. **Firestore Database → Create database**: choose production mode and the `africa-south1` (Johannesburg) region.
4. **Project settings → General → Your apps → Web app**: register a web app and copy its config into `.env.local` (start from `.env.example`).
5. Put your project ID in `.firebaserc`, then deploy:

```sh
npx firebase-tools login
npx firebase-tools deploy
```

That command builds the app, then publishes the site and the Firestore security rules (`firestore.rules`). After the first deploy, open **Authentication → Settings → Authorised domains** and check that your hosting domain is listed.

Security rules: each person can read only their own profile. Each household's data can be read only by its members.
