export default function BtnSecondary({ children, className = '', ...props }) {
  return (
    <button type="button" className={`hv-journey-btn hv-journey-btn-secondary ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
