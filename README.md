# ChurnWise Lite - Customer Segmentation & Risk Analysis

A small, browser-only dashboard that segments customers and gives each one an explainable, rule-based churn-risk score. Built with React, Vite, JavaScript, Recharts and plain CSS. There is no backend, database, login, paid API or machine learning.

## What it does

- Loads `https://edvyro.in/datasets/customer_churn_sample.csv` on start, and lets you upload your own CSV.
- If the online file cannot be loaded, it shows a message and offers a clearly labeled **sample data** option.
- Assigns each customer one of four segments (plus an "Other" bucket for the remainder) and a 0-100 risk score with a risk category and the reasons behind it.
- Shows total customers, loyal customers, high-risk customers, average tenure, two charts and a customer table. Fields that are missing from a file are hidden.
- Gives data-driven recommendations, and downloads the segment table (`.csv`) and a recommendation summary (`.md`).

## Run it

```bash
npm install
npm run dev      # development server
npm test         # unit tests for the scoring, segments and CSV code
npm run build    # production build into dist/
```

Deploys to Vercel with the standard Vite settings (build command `npm run build`, output directory `dist`).

## Risk score

```
score = min(100, 30*[month-to-month contract] + 25*[tenure < 12 months]
                + 15*[monthly charges > dataset median] + 15*[electronic-check payment])
```

| Score | Category |
| --- | --- |
| 0-29 | Low Risk |
| 30-59 | Medium Risk |
| 60-100 | High Risk |

A rule is applied only if its column exists. The `Churn` column is never used. **This is an illustrative prioritization score, not a calibrated churn probability.**
Full details, segment rules and assumptions: [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Segments (first match wins)

1. At-Risk: score >= 60, or 5+ support tickets
2. New: tenure < 12 months
3. High-Charge: monthly charges at or above the 75th percentile
4. Loyal: tenure >= 24 months and not month-to-month
5. Other: everyone else

All thresholds are in `src/config.js`.

## About the dataset

The supplied file has 11 columns: `CustomerID, Gender, Age, TenureMonths, SubscriptionType, MonthlyCharges, TotalCharges, ContractType, SupportTickets, PaymentMethod, Churn` and 15 rows. Its payment methods are Credit Card, Bank Transfer, UPI and Debit Card, so **the electronic-check rule does not apply to it** (the app reports this). With these rules, no customer in this file reaches High Risk.

The built-in sample data (`src/sampleData.js`) is an offline copy of those 15 rows. Compare it with the source file if exact figures matter.

The app first requests `/dataset.csv`, which `vite.config.js` (development) and `vercel.json` (production) forward to the dataset host, which avoids browser cross-origin limits. If that fails it tries the direct URL.

## Project layout

```
src/config.js      thresholds and point values
src/analysis.js    column detection, scoring, segments, recommendations
src/csv.js         CSV parsing, export and download helper
src/App.jsx        dashboard
src/sampleData.js  offline sample rows
test/              unit tests
docs/METHODOLOGY.md
```

## Limitations

- Rules and thresholds are assumptions and have not been validated against real churn outcomes.
- The score ranks customers for review; it does not predict who will leave.
- Medians and percentiles are unstable on very small files such as the 15-row sample.
- Recommendations are starting points and do not guarantee reduced churn.
- Only the first 200 rows appear in the on-screen table; the CSV download contains every row.
...

## 🌐 Live Demo

**[Click here to visit the live website](https://churn-wise-lite.vercel.app/)**
