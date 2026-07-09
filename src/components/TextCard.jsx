export default function TextCard({ theses, onThesesChange, transcript, asrStatus, nlpStatus }) {
  return (
    <article className="card">
      <h2>Текст</h2>

      <label htmlFor="theses-text">Тезисы / план</label>
      <textarea
        id="theses-text"
        rows={4}
        placeholder="Один тезис на строку"
        value={theses}
        onChange={(event) => onThesesChange(event.target.value)}
      />

      <label htmlFor="transcript-text">Транскрипт / произнесенный текст</label>
      <div
        id="transcript-text"
        className="transcript-view"
        data-placeholder="Распознанная речь появится здесь во время live-анализа"
      >
        {transcript}
      </div>

      {asrStatus ? <p className="status">{asrStatus}</p> : null}
      <p className="status">{nlpStatus}</p>
    </article>
  )
}
