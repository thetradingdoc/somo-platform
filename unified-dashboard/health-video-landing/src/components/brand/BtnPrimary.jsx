export default function BtnPrimary({ children, className = '', ...props }) {
  return (
    <button type="button" className={`hv-journey-btn hv-journey-btn-primary ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
