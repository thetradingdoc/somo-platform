export default function SymptomNotesPanel({ notes, collapsed, onToggle }) {
  if (!notes?.length) return null;

  return (
    <div className={`hv-symptom-notes ${collapsed ? 'collapsed' : ''}`}>
      <button type="button" className="hv-symptom-notes-toggle" onClick={onToggle}>
        Session notes
        <span className="hv-symptom-notes-count">{notes.length}</span>
      </button>
      {!collapsed && (
        <ul className="hv-symptom-notes-list">
          {notes.map((n) => (
            <li key={`${n.label}-${n.value}`}>
              <span className="hv-note-label">{n.label}</span>
              <span className="hv-note-value">{n.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
