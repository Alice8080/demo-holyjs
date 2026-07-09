import { formatDuration, sentimentLabelRu, toneByHigh } from '../lib/reportUtils'

function MetricRow({ label, percent, valueText, tone }) {
  const width = Math.max(0, Math.min(100, percent))
  return (
    <div className="metric">
      <div className="metric-head">
        <span className="metric-label">{label}</span>
        <span className="metric-value">{valueText}</span>
      </div>
      <div className="metric-bar">
        <span className={`metric-bar-fill tone-${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function VisionCard({ summary }) {
  if (!summary?.hasVision) {
    return null
  }

  const { gaze, pose, faceEnergy } = summary.vision
  return (
    <div className="report-card">
      <h4>Видео</h4>
      <MetricRow
        label="Взгляд в камеру"
        percent={gaze.onCameraPercent}
        valueText={`${gaze.onCameraPercent}% · ${formatDuration(gaze.onCameraSec)}`}
        tone={toneByHigh(gaze.onCameraPercent)}
      />
      <MetricRow
        label="Стабильная поза"
        percent={pose.stablePercent}
        valueText={`${pose.stablePercent}%`}
        tone={toneByHigh(pose.stablePercent)}
      />
      <MetricRow
        label="Активность лица"
        percent={faceEnergy.avgPercent}
        valueText={`${faceEnergy.avgPercent}%`}
        tone={toneByHigh(faceEnergy.avgPercent)}
      />
      <p className="report-note">
        Энергия лица — низкая {faceEnergy.lowPercent}% / средняя {faceEnergy.mediumPercent}% / высокая{' '}
        {faceEnergy.highPercent}%. Мимо камеры: {gaze.offCameraPercent}% ({formatDuration(gaze.offCameraSec)}).
      </p>
    </div>
  )
}

function AudioCard({ summary }) {
  if (!summary?.hasAudio) {
    return null
  }

  const audio = summary.audio
  return (
    <div className="report-card">
      <h4>Микрофон</h4>
      <MetricRow
        label="Громкость в норме"
        percent={audio.normalPercent}
        valueText={`${audio.normalPercent}%`}
        tone={toneByHigh(audio.normalPercent)}
      />
      <MetricRow
        label="Качество сигнала"
        percent={audio.qualityOkPercent}
        valueText={`${audio.qualityOkPercent}%`}
        tone={toneByHigh(audio.qualityOkPercent)}
      />
      <p className="report-note">
        Тихо {audio.quietPercent}% · шумно {audio.loudPercent}%. Средний RMS {audio.avgRms}, пиковый клиппинг{' '}
        {audio.maxClippingRate}%.
      </p>
    </div>
  )
}

function TextReportCard({ text }) {
  if (!text?.structure) {
    return (
      <div className="report-card">
        <h4>Текст и тезисы</h4>
        <p className="report-note">
          Нет данных: добавь тезисы и транскрипт, затем нажми «Анализировать текст».
        </p>
      </div>
    )
  }

  const s = text.structure
  return (
    <div className="report-card">
      <h4>
        Текст и тезисы{' '}
        {text.sentiment ? (
          <span className={`sentiment-chip sentiment-${text.sentiment.label}`}>
            Тональность: {sentimentLabelRu(text.sentiment.label)} · (Достоверность оценки{' '}
            {text.sentiment.confidence_percent}%)
          </span>
        ) : null}
      </h4>
      <MetricRow
        label="Покрытие тезисов"
        percent={s.thesis_coverage_percent}
        valueText={`${s.covered_theses}/${s.total_theses} · ${s.thesis_coverage_percent}%`}
        tone={toneByHigh(s.thesis_coverage_percent)}
      />
      <MetricRow
        label="Ясность речи"
        percent={s.clarity_score}
        valueText={`${s.clarity_score}/100`}
        tone={toneByHigh(s.clarity_score)}
      />
      {Array.isArray(s.coverage_details) && s.coverage_details.length > 0 ? (
        <ul className="thesis-list">
          {s.coverage_details.map((item, index) => (
            <li key={index} className={`thesis-item ${item.covered ? 'covered' : 'missed'}`}>
              <span className="thesis-chip">
                {item.covered ? '✓' : '✗'} {item.coverage}%
              </span>
              <span className="thesis-text">{item.thesis}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="report-note">
        Средняя длина предложения {s.avg_sentence_length} слов · слова-паразиты {s.filler_words_count} · маркеры
        структуры {s.structure_markers_found}.
      </p>
    </div>
  )
}

function RecommendationsCard({ recommendations, llmText }) {
  return (
    <div className="report-card">
      <h4>Рекомендации</h4>
      <ol className="rec-list">
        {recommendations.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ol>
      {llmText ? (
        <div className="report-note report-llm">
          <strong>Рекомендации LLM:</strong>
          <pre>{llmText}</pre>
        </div>
      ) : null}
    </div>
  )
}

export default function Report({ content }) {
  if (typeof content === 'string') {
    return <div className="coach-output">{content}</div>
  }

  const { summary, text, recommendations, llmText } = content
  return (
    <div className="coach-output">
      <div className="report">
        <div className="report-title">
          <span>Итоговый анализ выступления</span>
          {summary ? (
            <span className="report-duration">Длительность live: {formatDuration(summary.durationSec)}</span>
          ) : null}
        </div>
        <VisionCard summary={summary} />
        <AudioCard summary={summary} />
        <TextReportCard text={text} />
        <RecommendationsCard recommendations={recommendations} llmText={llmText} />
      </div>
    </div>
  )
}
