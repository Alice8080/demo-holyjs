export function buildSessionRecommendations(summary, text) {
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

export async function requestLlmRecommendations(summary, text) {
  const promptApi = window.ai?.languageModel
  if (!promptApi) {
    return ''
  }

  try {
    const session = await promptApi.create({
      systemPrompt:
        'Ты помощник по подготовке доклада. На основе метрик выступления дай 4-6 практичных рекомендаций на русском в нумерованном списке.',
    })
    return await session.prompt(`Метрики выступления: ${JSON.stringify({ summary, text })}`)
  } catch (error) {
    return `Prompt API недоступен: ${error.message}`
  }
}
