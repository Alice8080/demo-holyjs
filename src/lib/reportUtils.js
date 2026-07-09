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
