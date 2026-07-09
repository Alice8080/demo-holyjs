import { pipeline } from '@xenova/transformers'
import { SENTIMENT_MODELS } from './transformersConfig'

function tokenizeRussianWords(text) {
  return (text.toLowerCase().match(/[а-яёa-z0-9]+/gi) || []).filter((word) => word.length > 2)
}

export function computeTextStructure(theses, transcript) {
  const thesisList = theses
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const transcriptWords = new Set(tokenizeRussianWords(transcript))

  const coverageDetails = thesisList.map((thesis) => {
    const thesisWords = [...new Set(tokenizeRussianWords(thesis))]
    const matched = thesisWords.filter((word) => transcriptWords.has(word)).length
    const ratio = thesisWords.length === 0 ? 0 : matched / thesisWords.length
    return {
      thesis,
      coverage: Number((ratio * 100).toFixed(1)),
      covered: ratio >= 0.35,
    }
  })

  const coveredCount = coverageDetails.filter((item) => item.covered).length
  const thesisCoverage = thesisList.length === 0 ? 0 : coveredCount / thesisList.length

  const sentences = transcript
    .split(/[.!?]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
  const words = tokenizeRussianWords(transcript)
  const avgSentenceLength = sentences.length === 0 ? 0 : words.length / sentences.length

  const fillers = ['как бы', 'типа', 'значит', 'короче', 'в общем', 'ээ', 'эм']
  const transcriptLower = transcript.toLowerCase()
  const fillerHits = fillers.reduce((sum, phrase) => sum + (transcriptLower.split(phrase).length - 1), 0)

  const structureMarkers = ['во-первых', 'во-вторых', 'например', 'далее', 'итак', 'наконец', 'вывод']
  const markerHits = structureMarkers.filter((marker) => transcriptLower.includes(marker)).length

  let clarityScore = 100
  if (avgSentenceLength > 22) clarityScore -= 20
  if (avgSentenceLength < 6 && words.length > 30) clarityScore -= 10
  clarityScore -= Math.min(25, fillerHits * 4)
  clarityScore += Math.min(15, markerHits * 5)
  clarityScore = Math.max(0, Math.min(100, clarityScore))

  return {
    thesis_coverage_percent: Number((thesisCoverage * 100).toFixed(1)),
    covered_theses: coveredCount,
    total_theses: thesisList.length,
    avg_sentence_length: Number(avgSentenceLength.toFixed(1)),
    filler_words_count: fillerHits,
    structure_markers_found: markerHits,
    clarity_score: Number(clarityScore.toFixed(1)),
    coverage_details: coverageDetails,
  }
}

function normalizeSentimentLabel(rawLabel) {
  const normalized = String(rawLabel).trim().toLowerCase()
  if (normalized.includes('negative')) return 'negative'
  if (normalized.includes('neutral')) return 'neutral'
  if (normalized.includes('positive')) return 'positive'

  const starsMatch = normalized.match(/([1-5])\s*star/)
  if (starsMatch) {
    const stars = Number(starsMatch[1])
    if (stars <= 2) return 'negative'
    if (stars === 3) return 'neutral'
    return 'positive'
  }

  return normalized
}

let sentimentPipeline
let sentimentBackend = 'unknown'
let sentimentModelId = 'unknown'

async function initSentimentPipeline(onStatus) {
  if (sentimentPipeline) {
    return sentimentPipeline
  }

  onStatus?.('Текстовая модель: загрузка...')
  const devices = navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']
  const errors = []

  for (const modelId of SENTIMENT_MODELS) {
    for (const device of devices) {
      try {
        onStatus?.(`Текстовая модель: пробуем ${modelId} (${device})...`)
        sentimentPipeline = await pipeline('sentiment-analysis', modelId, { device })
        sentimentBackend = device
        sentimentModelId = modelId
        onStatus?.(`Текстовая модель: готова (${device}, ${modelId})`)
        return sentimentPipeline
      } catch (error) {
        errors.push(`${modelId} on ${device}: ${error.message}`)
      }
    }
  }

  throw new Error(
    `Не удалось загрузить модели sentiment. Вероятно, CDN/Hub вернул HTML вместо JSON. ${errors.join(' | ')}`,
  )
}

export async function analyzeSentiment(transcript, onStatus) {
  const sentiment = await initSentimentPipeline(onStatus)
  const output = await sentiment(transcript)
  const top = output[0]

  return {
    label: normalizeSentimentLabel(top.label),
    confidence_percent: Number((top.score * 100).toFixed(1)),
    model: sentimentModelId,
    backend: sentimentBackend,
  }
}
