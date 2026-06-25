import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { MicrophoneIcon as MicrophoneIconSolid } from '@heroicons/react/24/solid';
import { MicrophoneIcon } from '@heroicons/react/24/outline';

export default function SessionInputBar({
  value,
  onChange,
  onSend,
  onMicToggle,
  micOn,
  listening,
  disabled
}) {
  const hasText = Boolean(value?.trim());

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend?.();
    }
    if (e.key === 'Escape') {
      e.target.blur();
    }
  };

  const placeholder = micOn
    ? 'Type or speak…'
    : 'Type a message…';

  return (
    <div className="hv-sess-input-bar">
      <div className="hv-input-row">
        <input
          type="text"
          className="hv-text-input-box"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="Message to Kelly"
        />
        {hasText ? (
          <button
            type="button"
            className="hv-fab-sm send"
            onClick={onSend}
            disabled={disabled}
            aria-label="Send message"
          >
            <PaperAirplaneIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className={`hv-fab-sm ${micOn ? 'mic-on' : 'send'} ${listening ? 'listening' : ''}`}
            onClick={onMicToggle}
            disabled={disabled}
            aria-label={micOn ? 'Microphone on' : 'Turn microphone on'}
            aria-pressed={micOn}
          >
            {micOn ? (
              <MicrophoneIconSolid className="hv-icon hv-icon--sm" aria-hidden="true" />
            ) : (
              <MicrophoneIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
