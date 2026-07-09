import Hud from './Hud'

export default function LiveCard({
  webcamRef,
  overlayRef,
  reactionLayerRef,
  hud,
  visionStatus,
  liveStarted,
  busy,
  onToggleLive,
}) {
  return (
    <article className="card live-card">
      <div className="video-stack">
        <div className="video-frame">
          <video ref={webcamRef} id="webcam" autoPlay playsInline muted />
          <canvas ref={overlayRef} id="overlay" />
          <div ref={reactionLayerRef} id="reaction-layer" aria-hidden="true" />
        </div>
        <Hud hud={hud} />
      </div>
      <div className="controls">
        <button type="button" onClick={onToggleLive} disabled={busy}>
          {liveStarted ? 'Остановить live-анализ' : 'Запустить live-анализ'}
        </button>
        <span className="status">{visionStatus}</span>
      </div>
    </article>
  )
}
