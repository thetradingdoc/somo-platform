import {
  VideoCameraIcon,
  EyeIcon,
  BeakerIcon,
  MapIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { getToolCardMeta, extractToolBody } from '../lib/toolCardMap.js';
import { urgencyClass } from '../lib/reportFormatters.js';

const ICONS = {
  VideoCameraIcon,
  EyeIcon,
  BeakerIcon,
  MapIcon,
  InformationCircleIcon
};

export default function ToolCard({ payload }) {
  const meta = getToolCardMeta(payload?.name);
  const body = extractToolBody(payload);
  const urgency = payload?.name === 'recommend_care_pathway' ? payload?.result?.urgency : null;
  const Icon = ICONS[meta.icon] || InformationCircleIcon;

  return (
    <div className="hv-tool-card">
      <div className={`hv-tool-icon ${meta.iconClass}`}>
        <Icon className="hv-icon hv-icon--md" aria-hidden="true" />
      </div>
      <div>
        <strong>{meta.title}</strong>
        {urgency && (
          <div className={`hv-urgency-pill ${urgencyClass(urgency)}`}>{urgency}</div>
        )}
        {body && <p className="hv-tool-card-body">{body}</p>}
      </div>
    </div>
  );
}
