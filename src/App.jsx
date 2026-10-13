import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CONFIG } from './config.js'
import { parseCSV, toCSV, downloadText } from './csv.js'
import { SAMPLE_CSV } from './sampleData.js'
import {
  analyze,
  buildRecommendations,
  recommendationsMarkdown,
  visibleColumns,
  SEGMENTS,
  RISK_LEVELS,
} from './analysis.js'

const SEGMENT_COLORS = {
  'At-Risk Customers': '#c0392b',
  'New Customers': '#2e86c1',
  'High-Charge Customers': '#d68910',
  'Loyal Customers': '#1e8449',
  'Other Customers': '#7f8c8d',
}
const RISK_COLORS = { 'Low Risk': '#1e8449', 'Medium Risk': '#d68910', 'High Risk': '#c0392b' }

async function fetchDataset() {
  const problems = []
  for (const url of CONFIG.datasetUrls) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.trim().startsWith('<')) throw new Error('received a web page instead of CSV')
      return text
    } catch (e) {
      problems.push(`${url}: ${e.message}`)
    }
  }
  throw new Error(problems.join(' | '))
}

function Chart({ title, data, colors }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="chart">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" interval={0} tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" name="Customers">
              {data.map((d) => (
                <Cell key={d.name} fill={colors[d.name]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export default function App() {
  const [analysis, setAnalysis] = useState(null)
  const [source, setSource] = useState('')
  const [isSample, setIsSample] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  function load(text, label, sample) {
    const { headers, rows } = parseCSV(text)
    setAnalysis(analyze(rows, headers))
    setSource(label)
    setIsSample(sample)
  }

  useEffect(() => {
    let cancelled = false
    fetchDataset()
      .then((text) => {
        if (cancelled) return
        load(text, 'Online dataset (customer_churn_sample.csv)', false)
        setError('')
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            `The online dataset could not be loaded (${e.message}). You can upload your own CSV or use the clearly labeled sample data below.`,
          )
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file
      .text()
      .then((text) => {
        load(text, `Uploaded file: ${file.name}`, false)
        setError('')
      })
      .catch((err) => setError(`Could not read that file: ${err.message}`))
  }

  function useSample() {
    try {
      load(SAMPLE_CSV, 'SAMPLE DATA (built-in 15-row offline copy)', true)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const controls = (
    <div className="controls">
      <label className="btn">
        Upload CSV
        <input type="file" accept=".csv,text/csv" onChange={handleUpload} hidden />
      </label>
      <button className="btn secondary" onClick={useSample}>
        Use sample data
      </button>
    </div>
  )

  if (loading) return <main className="page"><p>Loading dataset...</p></main>

  const cols = analysis ? visibleColumns(analysis) : []
  const recs = analysis ? buildRecommendations(analysis) : []
  const sortedCustomers = analysis ? [...analysis.customers].sort((x, y) => y.score - x.score) : []

  return (
    <main className="page">
      <header>
        <h1>ChurnWise Lite</h1>
        <p className="subtitle">Customer Segmentation &amp; Risk Analysis</p>
        {controls}
      </header>

      {error && <div className="alert error" role="alert">{error}</div>}

      {!analysis && !error && <p>No data loaded.</p>}

      {analysis && (
        <>
          <p className={isSample ? 'alert warn' : 'source'}>
            Data source: <strong>{source}</strong>
            {isSample && ' - this is sample data for demonstration, not your real customers.'}
          </p>

          <div className="alert info">
            <strong>About the score:</strong> the churn-risk score is an illustrative, rule-based prioritization score
            (0-100). It is <em>not</em> a calibrated churn probability, and the known churn label is never used to
            calculate it.
          </div>

          {analysis.skippedRules.length > 0 && (
            <div className="alert warn">
              <strong>Scoring rules not applied to this data:</strong>
              <ul>
                {analysis.skippedRules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <section className="kpis">
            <div className="kpi"><span>Total customers</span><strong>{analysis.summary.total}</strong></div>
            <div className="kpi"><span>Loyal customers</span><strong>{analysis.summary.loyal}</strong></div>
            <div className="kpi"><span>High-risk customers</span><strong>{analysis.summary.highRisk}</strong></div>
            <div className="kpi">
              <span>Average tenure</span>
              <strong>{analysis.summary.avgTenure === null ? 'n/a' : `${analysis.summary.avgTenure.toFixed(1)} mo`}</strong>
            </div>
          </section>

          <div className="charts">
            <Chart
              title="Customer segments"
              data={SEGMENTS.map((s) => ({ name: s.replace(' Customers', ''), count: analysis.summary.segmentCounts[s] }))}
              colors={Object.fromEntries(Object.entries(SEGMENT_COLORS).map(([k, v]) => [k.replace(' Customers', ''), v]))}
            />
            <Chart
              title="Risk categories"
              data={RISK_LEVELS.map((r) => ({ name: r, count: analysis.summary.riskCounts[r] }))}
              colors={RISK_COLORS}
            />
          </div>

          <section className="card">
            <h2>Recommendations</h2>
            <p className="note">
              Starting points for review based on the results above. They are not guaranteed to reduce churn.
            </p>
            <ol>
              {recs.map((r) => (
                <li key={r.title}>
                  <strong>{r.title}</strong> ({r.count} customer{r.count === 1 ? '' : 's'})
                  <br />
                  <span>{r.why}</span>
                </li>
              ))}
            </ol>
            <button
              className="btn"
              onClick={() =>
                downloadText('recommendations.md', recommendationsMarkdown(analysis, source), 'text/markdown;charset=utf-8')
              }
            >
              Download recommendation summary (.md)
            </button>
          </section>

          <section className="card">
            <div className="row">
              <h2>Customers</h2>
              <button
                className="btn"
                onClick={() =>
                  downloadText('customer_segments.csv', toCSV(cols, analysis.customers), 'text/csv;charset=utf-8')
                }
              >
                Download segment table (.csv)
              </button>
            </div>
            <p className="note">
              Sorted by risk score (highest first). Showing {Math.min(sortedCustomers.length, CONFIG.maxTableRows)} of{' '}
              {sortedCustomers.length}; the CSV download contains all rows.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {sortedCustomers.slice(0, CONFIG.maxTableRows).map((c, i) => (
                    <tr key={`${c.id}-${i}`}>
                      {cols.map((col) => (
                        <td key={col.key}>
                          {col.key === 'charges' && c.charges !== null ? c.charges.toFixed(2) : (c[col.key] ?? '') === '' ? '-' : c[col.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <footer>
        <p>
          Limitations: simple rules with assumed thresholds, not validated against outcomes; small datasets give
          unstable medians and percentiles. See the README for details.
        </p>
      </footer>
    </main>
  )
}
