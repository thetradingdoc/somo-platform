import KellyAvatar from './KellyAvatar.jsx';

export default function KellyChip({ status, avatarState = 'idle' }) {
  return (
    <div className={`hv-kelly-chip hv-kelly-chip--${avatarState}`} aria-label={`Kelly, ${status}`}>
      <KellyAvatar size="sm" />
      <span className="hv-kelly-chip-label">Kelly</span>
    </div>
  );
}
