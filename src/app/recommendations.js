function buildRuleBasedRecommendations(latestSignals) {
  const recommendations = []
  const vision = latestSignals.vision
  const audio = latestSignals.audio
  const text = latestSignals.text

  if (!vision || !audio || !text) {
    return 'Сначала запусти все анализаторы: Vision + Audio + Text.'
  }

  if (!vision.gazeGood) {
    recommendations.push('Чаще смотри прямо в камеру: держи взгляд на объективе хотя бы в ключевых тезисах.')
  }
  if (!vision.pose.isOpen) {
    recommendations.push('Стабилизируй позу: выровняй плечи и избегай наклонов корпуса.')
  }
  if (!vision.gesture.active) {
    recommendations.push('Добавь открытые жесты руками, чтобы речь выглядела живее.')
  }
  if (vision.faceEnergy.level === 'low') {
    recommendations.push('Повышай мимику и энергичность: делай акценты лицом на важных фразах.')
  }

  if (audio.noiseLevel === 'Слишком шумно') {
    recommendations.push('Слишком шумно: уменьши фоновый шум или используй направленный микрофон.')
  }
  if (audio.clippingRate > 12) {
    recommendations.push('Есть клиппинг по микрофону: снизь gain и говори чуть дальше от микрофона.')
  }

  if (text.structure.thesis_coverage_percent < 65) {
    recommendations.push('Покрытие тезисов низкое: проговори пропущенные пункты плана.')
  }
  if (text.structure.clarity_score < 60) {
    recommendations.push('Упрости структуру: короче предложения и больше явных маркеров "во-первых/итог".')
  }
  if (text.sentiment.label === 'negative') {
    recommendations.push('Тон слишком негативный: добавь поддерживающие и нейтральные формулировки.')
  }

  if (recommendations.length === 0) {
    recommendations.push('Выступление выглядит сбалансированным. Сохраняй темп и структуру.')
  }

  return recommendations.map((line, index) => `${index + 1}. ${line}`).join('\n')
}

export function createRecommendationsGenerator({ coachOutput, latestSignals }) {
  async function generateRecommendations() {
    const payload = {
      vision: latestSignals.vision,
      audio: latestSignals.audio,
      text: latestSignals.text,
    }

    const promptApi = window.ai?.languageModel
    if (!promptApi) {
      coachOutput.textContent = buildRuleBasedRecommendations(latestSignals)
      return
    }

    try {
      const session = await promptApi.create({
        systemPrompt:
          'Ты помощник по подготовке доклада. Дай 4-6 практичных рекомендаций на русском в нумерованном списке.',
      })
      const prompt = `Сигналы анализаторов: ${JSON.stringify(payload)}`
      const completion = await session.prompt(prompt)
      coachOutput.textContent = completion
    } catch (error) {
      coachOutput.textContent = `${buildRuleBasedRecommendations(latestSignals)}\n\n(Prompt API fallback: ${error.message})`
    }
  }

  return { generateRecommendations }
}
