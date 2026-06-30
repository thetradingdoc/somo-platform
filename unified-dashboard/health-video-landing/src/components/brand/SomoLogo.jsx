const LOGO_SRC = '/assets/brand/somo-logo.png';



export default function SomoLogo({ variant = 'light', size = 'nav', className = '' }) {

  const isDark = variant === 'dark';

  const isSm = size === 'sm';



  if (isDark && isSm) {

    return (

      <span className={`hv-somo-lockup hv-somo-lockup--dark ${className}`.trim()}>

        <span className="hv-somo-lockup-text">Somo</span>

      </span>

    );

  }



  return (

    <img

      className={`hv-somo-logo hv-somo-logo--${size} ${className}`.trim()}

      src={LOGO_SRC}

      alt="Somo"

    />

  );

}

