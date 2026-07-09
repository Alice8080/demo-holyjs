import { escapeHtml, formatDuration, metricRow, sentimentLabelRu, toneByHigh } from './reportUtils'

function buildSessionRecommendations(summary, text) {
  const recommendations = []

  if (summary?.hasVision) {
    const { gaze, pose, faceEnergy } = summary.vision
    if (gaze.offCameraPercent > 30) {
      recommendations.push(
        `Взгляд уходил мимо камеры ${gaze.offCameraPercent}% времени — чаще держи глаза на объективе, особенно в ключевых тезисах.`,
      )
    }
    if (pose.unstablePercent > 25) {
      recommendations.push(
        `Поза была нестабильной ${pose.unstablePercent}% времени — выровняй плечи и держи корпус ровно.`,
      )
    }
    if (faceEnergy.avgPercent < 25 || faceEnergy.lowPercent > 50) {
      recommendations.push(
        'Мимика вялая большую часть выступления — добавь энергии лицом и голосом на важных фразах.',
      )
    }
  }

  if (summary?.hasAudio) {
    const audio = summary.audio
    if (audio.loudPercent > 20) {
      recommendations.push(
        `Слишком шумно ${audio.loudPercent}% времени — снизь фоновый шум или используй направленный микрофон.`,
      )
    }
    if (audio.quietPercent > 30) {
      recommendations.push(
        `Сигнал был слишком тихим ${audio.quietPercent}% времени — подойди ближе к микрофону.`,
      )
    }
    if (audio.qualityOkPercent < 70) {
      recommendations.push(
        `Качество микрофона было в норме лишь ${audio.qualityOkPercent}% времени — проверь усиление и позицию микрофона.`,
      )
    }
    if (audio.maxClippingRate > 12) {
      recommendations.push(
        `Пиковый клиппинг достигал ${audio.maxClippingRate}% — снизь gain и говори чуть дальше от микрофона.`,
      )
    }
  }

  if (text?.structure) {
    if (text.structure.thesis_coverage_percent < 65) {
      recommendations.push(
        `Покрытие тезисов ${text.structure.thesis_coverage_percent}% — проговори пропущенные пункты плана.`,
      )
    }
    if (text.structure.clarity_score < 60) {
      recommendations.push(
        'Упрости структуру речи: короче предложения и больше явных маркеров "во-первых / итог".',
      )
    }
    if (text.structure.filler_words_count > 5) {
      recommendations.push(
        `Многовато слов-паразитов (${text.structure.filler_words_count}) — старайся делать паузы вместо "как бы / типа".`,
      )
    }
  }

  if (text?.sentiment?.label === 'negative') {
    recommendations.push('Тон получился скорее негативным — добавь поддерживающие и нейтральные формулировки.')
  }

  if (recommendations.length === 0) {
    recommendations.push('Выступление выглядит сбалансированным. Сохраняй темп, взгляд и структуру.')
  }

  return recommendations
}

function visionCardHtml(summary) {
  if (!summary?.hasVision) {
    return ''
  }

  const { gaze, pose, faceEnergy } = summary.vision
  return `
    <div class="report-card">
      <h4>Видео</h4>
      ${metricRow('Взгляд в камеру', gaze.onCameraPercent, `${gaze.onCameraPercent}% · ${formatDuration(gaze.onCameraSec)}`, toneByHigh(gaze.onCameraPercent))}
      ${metricRow('Стабильная поза', pose.stablePercent, `${pose.stablePercent}%`, toneByHigh(pose.stablePercent))}
      ${metricRow('Активность лица', faceEnergy.avgPercent, `${faceEnergy.avgPercent}%`, toneByHigh(faceEnergy.avgPercent))}
      <p class="report-note">Энергия лица — низкая ${faceEnergy.lowPercent}% / средняя ${faceEnergy.mediumPercent}% / высокая ${faceEnergy.highPercent}%. Мимо камеры: ${gaze.offCameraPercent}% (${formatDuration(gaze.offCameraSec)}).</p>
    </div>`
}

function audioCardHtml(summary) {
  if (!summary?.hasAudio) {
    return ''
  }

  const audio = summary.audio
  return `
    <div class="report-card">
      <h4>Микрофон</h4>
      ${metricRow('Громкость в норме', audio.normalPercent, `${audio.normalPercent}%`, toneByHigh(audio.normalPercent))}
      ${metricRow('Качество сигнала', audio.qualityOkPercent, `${audio.qualityOkPercent}%`, toneByHigh(audio.qualityOkPercent))}
      <p class="report-note">Тихо ${audio.quietPercent}% · шумно ${audio.loudPercent}%. Средний RMS ${audio.avgRms}, пиковый клиппинг ${audio.maxClippingRate}%.</p>
    </div>`
}

function textCardHtml(text) {
  if (!text?.structure) {
    return `
      <div class="report-card">
        <h4>Текст и тезисы</h4>
        <p class="report-note">Нет данных: добавь тезисы и транскрипт, затем нажми «Анализировать текст».</p>
      </div>`
  }

  const s = text.structure
  const thesisItems = Array.isArray(s.coverage_details)
    ? s.coverage_details
        .map(
          (item) => `
        <li class="thesis-item ${item.covered ? 'covered' : 'missed'}">
          <span class="thesis-chip">${item.covered ? '✓' : '✗'} ${item.coverage}%</span>
          <span class="thesis-text">${escapeHtml(item.thesis)}</span>
        </li>`,
        )
        .join('')
    : ''

  const sentiment = text.sentiment
    ? `<span class="sentiment-chip sentiment-${escapeHtml(text.sentiment.label)}">Тональность: ${escapeHtml(sentimentLabelRu(text.sentiment.label))} · (Достоверность оценки ${text.sentiment.confidence_percent}%)</span>`
    : ''

  return `
    <div class="report-card">
      <h4>Текст и тезисы ${sentiment}</h4>
      ${metricRow('Покрытие тезисов', s.thesis_coverage_percent, `${s.covered_theses}/${s.total_theses} · ${s.thesis_coverage_percent}%`, toneByHigh(s.thesis_coverage_percent))}
      ${metricRow('Ясность речи', s.clarity_score, `${s.clarity_score}/100`, toneByHigh(s.clarity_score))}
      ${thesisItems ? `<ul class="thesis-list">${thesisItems}</ul>` : ''}
      <p class="report-note">Средняя длина предложения ${s.avg_sentence_length} слов · слова-паразиты ${s.filler_words_count} · маркеры структуры ${s.structure_markers_found}.</p>
    </div>`
}

function recommendationsCardHtml(recommendations, llmText) {
  const items = recommendations.map((line) => `<li>${escapeHtml(line)}</li>`).join('')
  const llmBlock = llmText
    ? `<div class="report-note report-llm"><strong>Рекомендации LLM:</strong><pre>${escapeHtml(llmText)}</pre></div>`
    : ''

  return `
    <div class="report-card">
      <h4>Рекомендации</h4>
      <ol class="rec-list">${items}</ol>
      ${llmBlock}
    </div>`
}

function buildReportHtml(summary, text, recommendations, llmText) {
  const durationHtml = summary
    ? `<span class="report-duration">Длительность live: ${formatDuration(summary.durationSec)}</span>`
    : ''

  return `
    <div class="report">
      <div class="report-title">
        <span>Итоговый анализ выступления</span>
        ${durationHtml}
      </div>
      ${visionCardHtml(summary)}
      ${audioCardHtml(summary)}
      ${textCardHtml(text)}
      ${recommendationsCardHtml(recommendations, llmText)}
    </div>`
}

export function createRecommendationsGenerator({ coachOutput, latestSignals, sessionStats }) {
  async function generateRecommendations() {
    const summary = sessionStats?.summarize?.() ?? null
    const text = latestSignals.text

    if (!summary && !text) {
      coachOutput.textContent =
        'Пока нет данных для анализа. Запусти live-анализ и/или проанализируй текст, затем сформируй отчёт.'
      return
    }

    const recommendations = buildSessionRecommendations(summary, text)

    let llmText = ''
    const promptApi = window.ai?.languageModel
    if (promptApi) {
      try {
        const session = await promptApi.create({
          systemPrompt:
            'Ты помощник по подготовке доклада. На основе метрик выступления дай 4-6 практичных рекомендаций на русском в нумерованном списке.',
        })
        llmText = await session.prompt(`Метрики выступления: ${JSON.stringify({ summary, text })}`)
      } catch (error) {
        llmText = `Prompt API недоступен: ${error.message}`
      }
    }

    coachOutput.innerHTML = buildReportHtml(summary, text, recommendations, llmText)
  }

  return { generateRecommendations }
}
