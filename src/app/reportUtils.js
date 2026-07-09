export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function toneByHigh(percent) {
  if (percent >= 70) return 'good'
  if (percent >= 40) return 'warn'
  return 'bad'
}

const SENTIMENT_LABELS_RU = {
  positive: 'позитивная',
  neutral: 'нейтральная',
  negative: 'негативная',
}

export function sentimentLabelRu(label) {
  return SENTIMENT_LABELS_RU[label] ?? label
}

export function formatDuration(totalSec) {
  const safeSec = Math.max(0, Math.round(totalSec))
  const minutes = Math.floor(safeSec / 60)
  const seconds = safeSec % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function metricRow(label, percent, valueText, tone) {
  const width = Math.max(0, Math.min(100, percent))
  return `
    <div class="metric">
      <div class="metric-head">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="metric-value">${escapeHtml(valueText)}</span>
      </div>
      <div class="metric-bar"><span class="metric-bar-fill tone-${tone}" style="width:${width}%"></span></div>
    </div>`
}
