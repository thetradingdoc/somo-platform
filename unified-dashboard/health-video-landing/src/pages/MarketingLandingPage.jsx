import { useNavigate } from 'react-router-dom';
import SomoLogo from '../components/brand/SomoLogo.jsx';
import MarketingSplitHero from '../components/marketing/MarketingSplitHero.jsx';

export default function MarketingLandingPage() {
  const navigate = useNavigate();
  const onStart = () => navigate('/start');

  return (
    <div className="hv-marketing-page">
      <header className="hv-marketing-topnav">
        <SomoLogo variant="light" size="nav" />
        <button type="button" className="hv-marketing-nav-cta" onClick={onStart}>
          Start health chat →
        </button>
      </header>
      <MarketingSplitHero onStart={onStart} />
    </div>
  );
}
