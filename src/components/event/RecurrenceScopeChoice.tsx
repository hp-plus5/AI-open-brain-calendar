// Dialog shown when the user clicks a recurring event, asking whether to edit
// just this occurrence or the entire series.

export type EditScope = 'this' | 'series'

interface RecurrenceScopeChoiceProps {
  onChoose: (scope: EditScope) => void
  onClose:  () => void
}

export default function RecurrenceScopeChoice({ onChoose, onClose }: RecurrenceScopeChoiceProps) {
  return (
    <div className="modal-overlay">
      <div className="modal recurrence-choice-modal">
        <div className="modal-header">
          <h2>Edit recurring event</h2>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="recurrence-choice-option" onClick={() => onChoose('this')}>
            <div>
              <div className="recurrence-choice-option-title">This event</div>
              <div className="recurrence-choice-option-desc">
                Only this occurrence is changed. Other instances stay the same.
              </div>
            </div>
          </div>
          <div className="recurrence-choice-option" onClick={() => onChoose('series')}>
            <div>
              <div className="recurrence-choice-option-title">All events in the series</div>
              <div className="recurrence-choice-option-desc">
                Every occurrence is updated, including past and future ones.
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
