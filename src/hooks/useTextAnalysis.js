import { analyzeSentiment, computeTextStructure } from '../lib/textAnalysis'

/**
 * Анализ текста: тональность (Transformers.js) + структура тезисов.
 * Возвращает null, если транскрипт пустой.
 */
export function useTextAnalysis({ setNlpStatus }) {
  async function analyzeText(theses, transcript) {
    const cleanTranscript = transcript.trim()
    if (!cleanTranscript) {
      return null
    }

    const sentiment = await analyzeSentiment(cleanTranscript, setNlpStatus)
    const structure = computeTextStructure(theses.trim(), cleanTranscript)

    return { sentiment, structure }
  }

  return { analyzeText }
}
