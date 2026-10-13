import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCSV, toCSV } from '../src/csv.js'
import { SAMPLE_CSV } from '../src/sampleData.js'
import { CONFIG } from '../src/config.js'
import { analyze, riskCategory, scoreCustomer, median, percentile, recommendationsMarkdown, visibleColumns } from '../src/analysis.js'

const sample = () => {
  const { headers, rows } = parseCSV(SAMPLE_CSV)
  return analyze(rows, headers)
}
const byId = (a, id) => a.customers.find((c) => c.id === id)

test('CSV parser reads the sample and handles quotes/CRLF/BOM', () => {
  const { headers, rows } = parseCSV(SAMPLE_CSV)
  assert.equal(headers.length, 11)
  assert.equal(rows.length, 15)
  const p = parseCSV('﻿a,b\r\n"x, y","say ""hi"""\r\n')
  assert.deepEqual(p.rows[0], { a: 'x, y', b: 'say "hi"' })
})

test('risk categories use the 0-29 / 30-59 / 60-100 bands', () => {
  assert.equal(riskCategory(0), 'Low Risk')
  assert.equal(riskCategory(29), 'Low Risk')
  assert.equal(riskCategory(30), 'Medium Risk')
  assert.equal(riskCategory(59), 'Medium Risk')
  assert.equal(riskCategory(60), 'High Risk')
  assert.equal(riskCategory(100), 'High Risk')
})

test('score rules add the documented points and cap at 100', () => {
  const ctx = { has: { contract: true, tenure: true, charges: true, payment: true }, medianCharges: 50 }
  const all = scoreCustomer({ contract: 'Month-to-Month', tenure: 3, charges: 99, payment: 'Electronic check' }, ctx)
  assert.equal(all.score, 85)
  assert.equal(all.reasons.length, 4)
  const capped = scoreCustomer(
    { contract: 'Month-to-Month', tenure: 3, charges: 99, payment: 'Electronic check' },
    ctx,
    { ...CONFIG, points: { monthToMonth: 60, shortTenure: 60, highCharges: 15, electronicCheck: 15 } },
  )
  assert.equal(capped.score, 100)
  // exactly 12 months is NOT "below 12"
  assert.equal(scoreCustomer({ contract: '', tenure: 12, charges: null, payment: '' }, ctx).score, 0)
  // a charge equal to the median is NOT "above" it
  assert.equal(scoreCustomer({ contract: '', tenure: null, charges: 50, payment: '' }, ctx).score, 0)
})

test('rules are skipped when their column is missing', () => {
  const a = analyze([{ CustomerID: 'A', TenureMonths: '3' }], ['CustomerID', 'TenureMonths'])
  assert.equal(a.customers[0].score, 25) // only the tenure rule can apply
  assert.ok(a.skippedRules.some((r) => r.includes('contract')))
  assert.deepEqual(visibleColumns(a).map((c) => c.key), ['id', 'tenure', 'segment', 'score', 'risk', 'reasonText'])
})

test('Churn column does not influence scores or segments', () => {
  const { headers, rows } = parseCSV(SAMPLE_CSV)
  const flipped = rows.map((r) => ({ ...r, Churn: r.Churn === 'Yes' ? 'No' : 'Yes' }))
  const a = analyze(rows, headers)
  const b = analyze(flipped, headers)
  assert.deepEqual(a.customers.map((c) => [c.score, c.segment]), b.customers.map((c) => [c.score, c.segment]))
})

test('statistics helpers', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(percentile([0, 10], 0.5), 5)
})

test('sample data: median, cutoff, scores', () => {
  const a = sample()
  assert.equal(a.ctx.medianCharges, 79.99)
  assert.ok(Math.abs(a.ctx.highChargeCutoff - 114.99) < 1e-9)
  const expected = {
    'CUST-1001': 30, 'CUST-1002': 0, 'CUST-1003': 55, 'CUST-1004': 15, 'CUST-1005': 55,
    'CUST-1006': 0, 'CUST-1007': 55, 'CUST-1008': 15, 'CUST-1009': 0, 'CUST-1010': 55,
    'CUST-1011': 15, 'CUST-1012': 30, 'CUST-1013': 0, 'CUST-1014': 55, 'CUST-1015': 15,
  }
  for (const [id, score] of Object.entries(expected)) assert.equal(byId(a, id).score, score, id)
  assert.deepEqual(a.summary.riskCounts, { 'Low Risk': 8, 'Medium Risk': 7, 'High Risk': 0 })
  assert.ok(a.skippedRules.some((r) => r.includes('Electronic-check')))
  assert.ok(Math.abs(a.summary.avgTenure - 18.8) < 1e-9)
})

test('sample data: segment assignments follow the priority order', () => {
  const a = sample()
  const expected = {
    'CUST-1001': 'Other Customers', 'CUST-1002': 'Loyal Customers', 'CUST-1003': 'At-Risk Customers',
    'CUST-1004': 'High-Charge Customers', // would also be loyal, High-Charge has priority
    'CUST-1005': 'New Customers', 'CUST-1006': 'Other Customers', 'CUST-1007': 'At-Risk Customers',
    'CUST-1008': 'High-Charge Customers', 'CUST-1009': 'Other Customers', 'CUST-1010': 'New Customers',
    'CUST-1011': 'High-Charge Customers', 'CUST-1012': 'Other Customers', 'CUST-1013': 'Other Customers',
    'CUST-1014': 'At-Risk Customers', 'CUST-1015': 'High-Charge Customers',
  }
  for (const [id, seg] of Object.entries(expected)) assert.equal(byId(a, id).segment, seg, id)
  const total = Object.values(a.summary.segmentCounts).reduce((x, y) => x + y, 0)
  assert.equal(total, 15) // every customer gets exactly one segment
})

test('At-Risk wins over New when the score reaches the High Risk band', () => {
  const rows = [
    { CustomerID: 'X', TenureMonths: '2', ContractType: 'Month-to-Month', MonthlyCharges: '100', PaymentMethod: 'Electronic check' },
    { CustomerID: 'Y', TenureMonths: '30', ContractType: 'Two Year', MonthlyCharges: '10', PaymentMethod: 'Mailed check' },
    { CustomerID: 'Z', TenureMonths: '30', ContractType: 'Two Year', MonthlyCharges: '20', PaymentMethod: 'Mailed check' },
  ]
  const a = analyze(rows, Object.keys(rows[0]))
  assert.equal(a.customers[0].score, 85)
  assert.equal(a.customers[0].risk, 'High Risk')
  assert.equal(a.customers[0].segment, 'At-Risk Customers')
  assert.equal(a.summary.highRisk, 1)
})

test('CSV export has expected header, row count and escapes formulas', () => {
  const a = sample()
  const out = toCSV(visibleColumns(a), a.customers)
  const lines = out.trim().split('\n')
  assert.equal(lines[0], 'Customer ID,Tenure (months),Contract,Monthly Charges,Segment,Risk Score,Risk Category,Reasons')
  assert.equal(lines.length, 16)
  assert.ok(toCSV([{ key: 'v', label: 'v' }], [{ v: '=1+1' }]).includes("'=1+1"))
  // round trip: what we export can be parsed back
  assert.equal(parseCSV(out).rows.length, 15)
})

test('recommendation markdown contains the key sections and the limitation', () => {
  const md = recommendationsMarkdown(sample(), 'test')
  for (const s of ['# ChurnWise Lite', '## Recommendations', 'Month-to-month', 'not a calibrated churn probability', 'do not guarantee']) {
    assert.ok(md.includes(s) || md.toLowerCase().includes(s.toLowerCase()), s)
  }
})

test('analysis rejects files with no recognizable columns', () => {
  assert.throws(() => analyze([{ foo: '1' }], ['foo']))
})
