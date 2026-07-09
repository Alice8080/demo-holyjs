const HUD_ORDER = ['gaze', 'pose', 'faceEnergy', 'noise', 'quality', 'gesture']

function hudClass(state) {
  if (state === 'good') return 'video-hud-item hud-good'
  if (state === 'bad') return 'video-hud-item hud-bad'
  return 'video-hud-item'
}

export default function Hud({ hud }) {
  return (
    <div className="hud-panel" aria-live="polite">
      {HUD_ORDER.map((key) => (
        <p key={key} className={hudClass(hud[key].state)}>
          {hud[key].text}
        </p>
      ))}
    </div>
  )
}
