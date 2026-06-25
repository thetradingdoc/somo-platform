const ICON_SRC = '/assets/brand/somo-icon.png';

export default function KellyHeader({ status, avatarState = 'idle' }) {
  return (
    <div className={`hv-kelly-header hv-kelly-header--${avatarState}`}>
      <div className="hv-kelly-header-avatar">
        <div className="hv-k-ring hv-k-ring--sm" />
        <div className="hv-k-ring2 hv-k-ring2--sm" />
        <img src={ICON_SRC} alt="" aria-hidden="true" className="hv-kelly-header-icon" />
      </div>
      <div className="hv-kelly-header-text">
        <span className="hv-kelly-header-name">Kelly · AI health assistant</span>
        <span className="hv-kelly-header-status">{status}</span>
      </div>
    </div>
  );
}
