import { CONFIG as DEFAULT_CONFIG } from './config.js'

export const SEGMENTS = ['At-Risk Customers', 'New Customers', 'High-Charge Customers', 'Loyal Customers', 'Other Customers']
export const RISK_LEVELS = ['Low Risk', 'Medium Risk', 'High Risk']

// Accepted header names (compared after lowercasing and removing spaces/punctuation).
const ALIASES = {
  id: ['customerid', 'custid', 'id'],
  tenure: ['tenuremonths', 'tenure', 'months'],
  contract: ['contracttype', 'contract'],
  charges: ['monthlycharges', 'monthlycharge', 'charges'],
  payment: ['paymentmethod', 'payment'],
  tickets: ['supporttickets', 'tickets'],
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function detectColumns(headers) {
  const byNorm = {}
  headers.forEach((h) => {
    byNorm[norm(h)] = h
  })
  const cols = {}
  for (const [key, names] of Object.entries(ALIASES)) {
    const hit = names.find((n) => byNorm[n])
    if (hit) cols[key] = byNorm[hit]
  }
  return cols
}

function toNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const n = Number(String(value).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Linear-interpolation percentile, p between 0 and 1.
export function percentile(values, p) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

export function riskCategory(score, config = DEFAULT_CONFIG) {
  if (score >= config.riskBands.high) return 'High Risk'
  if (score >= config.riskBands.medium) return 'Medium Risk'
  return 'Low Risk'
}

// Risk score. The Churn column is NEVER read here.
export function scoreCustomer(c, ctx, config = DEFAULT_CONFIG) {
  const p = config.points
  let score = 0
  const reasons = []

  if (ctx.has.contract && c.contract && norm(c.contract) === 'monthtomonth') {
    score += p.monthToMonth
    reasons.push(`Month-to-month contract (+${p.monthToMonth})`)
  }
  if (ctx.has.tenure && c.tenure !== null && c.tenure < config.shortTenureMonths) {
    score += p.shortTenure
    reasons.push(`Tenure below ${config.shortTenureMonths} months (+${p.shortTenure})`)
  }
  if (ctx.has.charges && c.charges !== null && ctx.medianCharges !== null && c.charges > ctx.medianCharges) {
    score += p.highCharges
    reasons.push(`Monthly charges above dataset median (+${p.highCharges})`)
  }
  if (ctx.has.payment && c.payment && norm(c.payment) === 'electroniccheck') {
    score += p.electronicCheck
    reasons.push(`Electronic-check payment (+${p.electronicCheck})`)
  }

  score = Math.min(score, config.maxScore)
  return { score, risk: riskCategory(score, config), reasons }
}

// Segment priority (first match wins): At-Risk > New > High-Charge > Loyal > Other.
export function assignSegment(c, ctx, score, config = DEFAULT_CONFIG) {
  const s = config.segments

  if (ctx.has.tenure || ctx.has.contract || ctx.has.charges || ctx.has.payment) {
    if (score >= s.atRiskMinScore) return 'At-Risk Customers'
  }
  if (ctx.has.tickets && c.tickets !== null && c.tickets >= s.atRiskMinTickets) return 'At-Risk Customers'

  if (ctx.has.tenure && c.tenure !== null && c.tenure < s.newTenureMonths) return 'New Customers'

  if (ctx.has.charges && c.charges !== null && ctx.highChargeCutoff !== null && c.charges >= ctx.highChargeCutoff) {
    return 'High-Charge Customers'
  }

  const notMonthly = !(ctx.has.contract && norm(c.contract) === 'monthtomonth')
  if (ctx.has.tenure && c.tenure !== null && c.tenure >= s.loyalTenureMonths && notMonthly) return 'Loyal Customers'

  return 'Other Customers'
}

export function analyze(rows, headers, config = DEFAULT_CONFIG) {
  const columns = detectColumns(headers)
  if (Object.keys(columns).length === 0) {
    throw new Error(
      'None of the expected columns were found (e.g. CustomerID, TenureMonths, ContractType, MonthlyCharges). Check the header row.',
    )
  }
  const has = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, Boolean(columns[k])]))

  const base = rows.map((r, i) => ({
    id: has.id && r[columns.id] ? r[columns.id] : `Row ${i + 1}`,
    tenure: has.tenure ? toNumber(r[columns.tenure]) : null,
    contract: has.contract ? r[columns.contract] : '',
    charges: has.charges ? toNumber(r[columns.charges]) : null,
    payment: has.payment ? r[columns.payment] : '',
    tickets: has.tickets ? toNumber(r[columns.tickets]) : null,
  }))

  const chargeValues = base.map((c) => c.charges).filter((v) => v !== null)
  const ctx = {
    has,
    medianCharges: median(chargeValues),
    highChargeCutoff: percentile(chargeValues, config.segments.highChargePercentile),
  }

  const paymentSeen = has.payment && base.some((c) => norm(c.payment) === 'electroniccheck')

  const customers = base.map((c) => {
    const { score, risk, reasons } = scoreCustomer(c, ctx, config)
    const segment = assignSegment(c, ctx, score, config)
    return { ...c, score, risk, reasons, reasonText: reasons.join('; ') || 'No risk rules matched', segment }
  })

  const segmentCounts = Object.fromEntries(SEGMENTS.map((s) => [s, 0]))
  const riskCounts = Object.fromEntries(RISK_LEVELS.map((r) => [r, 0]))
  customers.forEach((c) => {
    segmentCounts[c.segment]++
    riskCounts[c.risk]++
  })
  const tenures = customers.map((c) => c.tenure).filter((v) => v !== null)

  // Rules that could not contribute to scores for this file, so the page can say so honestly.
  const skippedRules = []
  if (!has.contract) skippedRules.push('Month-to-month contract (no contract column)')
  if (!has.tenure) skippedRules.push('Tenure below 12 months (no tenure column)')
  if (!has.charges) skippedRules.push('Monthly charges above median (no monthly-charges column)')
  if (!has.payment) skippedRules.push('Electronic-check payment (no payment column)')
  else if (!paymentSeen) skippedRules.push('Electronic-check payment (column exists but no customer uses it)')

  return {
    columns,
    ctx,
    customers,
    skippedRules,
    summary: {
      total: customers.length,
      loyal: segmentCounts['Loyal Customers'],
      highRisk: riskCounts['High Risk'],
      avgTenure: tenures.length ? tenures.reduce((a, b) => a + b, 0) / tenures.length : null,
      segmentCounts,
      riskCounts,
    },
  }
}

// Recommendations are computed from the results. Each one says why it applies and what it does NOT promise.
export function buildRecommendations(a, config = DEFAULT_CONFIG) {
  const { customers, ctx, summary } = a
  const pct = (n) => (summary.total ? Math.round((n / summary.total) * 100) : 0)
  const recs = []

  if (ctx.has.tenure) {
    const n = customers.filter((c) => c.risk === 'High Risk' && c.tenure !== null && c.tenure < config.shortTenureMonths).length
    recs.push({
      title: 'Review high-risk customers with short tenure',
      count: n,
      why:
        n > 0
          ? `${n} customer(s) are rated High Risk and have been customers for under ${config.shortTenureMonths} months. Early-life customers who also match several risk rules are a sensible place to start a manual review.`
          : `No customers are both High Risk and under ${config.shortTenureMonths} months of tenure in this data, so no one needs this review right now. The ${summary.riskCounts['Medium Risk']} Medium Risk customer(s) may still be worth a look.`,
    })
  }

  if (ctx.has.contract) {
    const n = customers.filter((c) => norm(c.contract) === 'monthtomonth').length
    recs.push({
      title: 'Investigate customers on month-to-month contracts',
      count: n,
      why: `${n} customer(s) (${pct(n)}%) are on month-to-month contracts, which can be cancelled at any time. This rule adds the most points in the score, so it is worth finding out why these customers have not moved to longer plans.`,
    })
  }

  if (ctx.has.charges) {
    const n = summary.segmentCounts['High-Charge Customers']
    recs.push({
      title: 'Review pricing concerns among high-charge customers',
      count: n,
      why: `${n} customer(s) are in the High-Charge segment (monthly charges at or above ${ctx.highChargeCutoff?.toFixed(2)}). Higher bills can prompt customers to reconsider, so check whether the price matches the value they receive. Customers who fall into the At-Risk segment first are counted there, not here.`,
    })
  }

  if (ctx.has.tenure) {
    const n = summary.segmentCounts['New Customers']
    recs.push({
      title: 'Improve onboarding for new customers',
      count: n,
      why: `${n} customer(s) are in the New segment (under ${config.segments.newTenureMonths} months). The first months set the relationship, so a clear welcome and check-in process is relevant for them. Customers who fall into the At-Risk segment first are counted there, not here.`,
    })
  }

  if (ctx.has.tickets) {
    const n = customers.filter((c) => c.tickets !== null && c.tickets >= config.segments.atRiskMinTickets).length
    recs.push({
      title: 'Follow up on customers with many support tickets',
      count: n,
      why: `${n} customer(s) raised at least ${config.segments.atRiskMinTickets} support tickets. Repeated issues can signal dissatisfaction, so a proactive follow-up on their open problems is relevant.`,
    })
  }

  return recs
}

export function recommendationsMarkdown(a, sourceLabel, config = DEFAULT_CONFIG) {
  const { summary, ctx, skippedRules } = a
  const recs = buildRecommendations(a, config)
  const lines = []
  lines.push('# ChurnWise Lite - Recommendation Summary', '')
  lines.push(`Data source: ${sourceLabel}`, '')
  lines.push('## Results at a glance', '')
  lines.push(`- Total customers: ${summary.total}`)
  lines.push(`- Loyal customers: ${summary.loyal}`)
  lines.push(`- High-risk customers: ${summary.highRisk}`)
  lines.push(`- Average tenure: ${summary.avgTenure === null ? 'n/a' : summary.avgTenure.toFixed(1) + ' months'}`)
  if (ctx.medianCharges !== null) lines.push(`- Median monthly charges: ${ctx.medianCharges.toFixed(2)}`)
  lines.push('')
  lines.push('### Segments', '')
  SEGMENTS.forEach((s) => lines.push(`- ${s}: ${summary.segmentCounts[s]}`))
  lines.push('', '### Risk categories', '')
  RISK_LEVELS.forEach((r) => lines.push(`- ${r}: ${summary.riskCounts[r]}`))
  lines.push('', '## Recommendations', '')
  recs.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.title}** (${r.count} customer(s))`, `   - Why: ${r.why}`)
  })
  if (skippedRules.length) {
    lines.push('', '## Scoring rules not applied to this data', '')
    skippedRules.forEach((s) => lines.push(`- ${s}`))
  }
  lines.push(
    '',
    '## Limitations',
    '',
    '- The risk score is an illustrative prioritization score, not a calibrated churn probability.',
    '- The thresholds are simple assumptions and were not tuned or validated against churn outcomes.',
    '- These recommendations are starting points for review. They do not guarantee any reduction in churn.',
    '',
  )
  return lines.join('\n')
}

export const TABLE_COLUMNS = [
  { key: 'id', label: 'Customer ID', needs: 'id' },
  { key: 'tenure', label: 'Tenure (months)', needs: 'tenure' },
  { key: 'contract', label: 'Contract', needs: 'contract' },
  { key: 'charges', label: 'Monthly Charges', needs: 'charges' },
  { key: 'segment', label: 'Segment', needs: null },
  { key: 'score', label: 'Risk Score', needs: null },
  { key: 'risk', label: 'Risk Category', needs: null },
  { key: 'reasonText', label: 'Reasons', needs: null },
]

export function visibleColumns(a) {
  return TABLE_COLUMNS.filter((c) => !c.needs || a.ctx.has[c.needs])
}
