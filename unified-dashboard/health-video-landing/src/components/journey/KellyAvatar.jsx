export default function KellyAvatar({ size = 'md', className = '' }) {
  const sizeClass = size === 'sm' ? 'hv-kelly-av--sm' : size === 'lg' ? 'hv-kelly-av--lg' : 'hv-kelly-av--md';
  return (
    <div className={`hv-kelly-av ${sizeClass} ${className}`.trim()} aria-hidden="true">
      <span>K</span>
    </div>
  );
}
