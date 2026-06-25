import { SparklesIcon } from '@heroicons/react/24/outline';

export default function MemoryCallout({ children }) {
  return (
    <div className="hv-memory-callout">
      <SparklesIcon className="hv-icon hv-icon--sm" aria-hidden="true" />
      <div className="hv-memory-callout-text">{children}</div>
    </div>
  );
}
