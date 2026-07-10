import { formatDuration, toneByHigh } from '../lib/reportUtils'

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

function RecommendationsCard({ recommendations }) {
  return (
    <div className="report-card">
      <h4>Рекомендации</h4>
      <ol className="rec-list">
        {recommendations.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ol>
    </div>
  )
}

export default function Report({ content }) {
  if (typeof content === 'string') {
    return <div className="coach-output">{content}</div>
  }

  const { summary, recommendations } = content
  return (
    <div className="coach-output">
      <div className="report">
        <div className="report-title">
          <span>Итоговый анализ выступления</span>
          <span className="report-meta">
            {summary ? (
              <span className="report-duration">Длительность live: {formatDuration(summary.durationSec)}</span>
            ) : null}
          </span>
        </div>
        <VisionCard summary={summary} />
        <AudioCard summary={summary} />
        <RecommendationsCard recommendations={recommendations} />
      </div>
    </div>
  )
}
