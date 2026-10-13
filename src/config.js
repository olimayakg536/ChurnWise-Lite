// All thresholds live here so they are easy to find and change.
// See docs/METHODOLOGY.md for the reasoning behind each value.

export const CONFIG = {
  // ---- Risk score: points added when a rule matches (max possible = 85 with these rules; capped at 100) ----
  points: {
    monthToMonth: 30,
    shortTenure: 25,
    highCharges: 15, // monthly charges above the dataset median
    electronicCheck: 15,
  },
  shortTenureMonths: 12, // "tenure below 12 months"
  maxScore: 100,

  // ---- Risk categories (score ranges, inclusive lower bound) ----
  riskBands: {
    medium: 30, // 30-59 Medium
    high: 60, // 60-100 High; below 30 is Low
  },

  // ---- Segments (checked in the priority order listed in segment.js) ----
  segments: {
    atRiskMinScore: 60, // risk score at or above this (the High Risk band) -> At-Risk
    atRiskMinTickets: 5, // support tickets at or above this -> At-Risk (only if column exists)
    newTenureMonths: 12, // tenure below this -> New
    highChargePercentile: 0.75, // monthly charges at or above this percentile -> High-Charge
    loyalTenureMonths: 24, // tenure at or above this (and not month-to-month) -> Loyal
  },

  // ---- Data loading ----
  // Same-origin path first (rewritten to the dataset host by vite.config.js / vercel.json, avoids CORS),
  // then the direct URL as a fallback.
  datasetUrls: ['/dataset.csv', 'https://edvyro.in/datasets/customer_churn_sample.csv'],
  maxTableRows: 200,
}
