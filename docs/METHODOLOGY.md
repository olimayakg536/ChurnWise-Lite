# Risk-Scoring & Segmentation Methodology

All numbers below live in `src/config.js`. Changing them there changes the app, the CSV and the Markdown summary.

## 1. Column detection

Headers are matched case-insensitively, ignoring spaces and punctuation.

| Meaning | Accepted names (examples) |
| --- | --- |
| Customer ID | `CustomerID`, `id` |
| Tenure (months) | `TenureMonths`, `tenure` |
| Contract | `ContractType`, `contract` |
| Monthly charges | `MonthlyCharges`, `charges` |
| Payment method | `PaymentMethod`, `payment` |
| Support tickets | `SupportTickets`, `tickets` |

The supplied dataset has: `CustomerID, Gender, Age, TenureMonths, SubscriptionType, MonthlyCharges, TotalCharges, ContractType, SupportTickets, PaymentMethod, Churn`.
The `Churn` column is never read by the score or the segments.

## 2. Churn-risk score (0-100)

Start at 0 and add points for each rule that matches. A rule is applied only if its column exists and the customer has a value for it.

| Rule | Points |
| --- | --- |
| Contract is Month-to-month | +30 |
| Tenure is below 12 months (12 exactly does not count) | +25 |
| Monthly charges are above the dataset median (equal to the median does not count) | +15 |
| Payment method is Electronic check | +15 |

```
score = min(100, 30*[month-to-month] + 25*[tenure < 12] + 15*[charges > median] + 15*[electronic check])
```

With these four rules the maximum is 85, so the cap at 100 only matters if the point values are changed.

| Score | Category |
| --- | --- |
| 0-29 | Low Risk |
| 30-59 | Medium Risk |
| 60-100 | High Risk |

Each customer's row lists the rules that fired, so every score can be traced.

### Limitations of the score

- It is an **illustrative prioritization score, not a calibrated churn probability**. A score of 55 does not mean a 55% chance of churning.
- The point values and thresholds are assumptions. They were not fitted to, or validated against, the churn outcomes.
- The median depends on the file loaded, so the same customer can score differently in a different dataset.
- In the supplied dataset the payment methods are Credit Card, Bank Transfer, UPI and Debit Card, so the electronic-check rule never fires there. The app says so on screen. With the other three rules the highest possible score is 70, so a High Risk result needs month-to-month, short tenure and above-median charges together.

## 3. Segments

Each customer gets exactly one segment. Rules are checked in this order and the first match wins:

1. **At-Risk Customers**: risk score >= 60 (`atRiskMinScore`), or support tickets >= 5 (`atRiskMinTickets`, only if a tickets column exists).
2. **New Customers**: tenure below 12 months (`newTenureMonths`).
3. **High-Charge Customers**: monthly charges at or above the 75th percentile of the file (`highChargePercentile`).
4. **Loyal Customers**: tenure of 24 months or more (`loyalTenureMonths`) and not on a month-to-month contract.
5. **Other Customers**: everyone left over. This is a fifth bucket added so that no customer is left without a segment.

Assumptions worth knowing:

- Because At-Risk is checked first, a customer who is both new and high-risk appears under At-Risk, not New. The same holds for High-Charge versus Loyal: a long-tenure customer with high charges counts as High-Charge.
- The At-Risk score threshold equals the High Risk band so the two stay consistent. The ticket threshold of 5 is a judgment call; at 4 almost every short-tenure customer in the sample became At-Risk and the New segment emptied out.
- The "churn-related indicator" used is the support-ticket count, not the Churn label.

## 4. Recommendations

Generated from the computed counts (see `buildRecommendations` in `src/analysis.js`). Each states how many customers it concerns and why it is relevant. They are starting points for review and do not promise any reduction in churn.
