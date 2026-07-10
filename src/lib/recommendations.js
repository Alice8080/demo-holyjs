export function buildSessionRecommendations(summary) {
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

  if (recommendations.length === 0) {
    recommendations.push('Выступление выглядит сбалансированным. Сохраняй темп, взгляд и структуру.')
  }

  return recommendations
}
