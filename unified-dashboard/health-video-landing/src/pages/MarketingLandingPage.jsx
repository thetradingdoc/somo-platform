import { useNavigate } from 'react-router-dom';
import MarketingSplitHero from '../components/marketing/MarketingSplitHero.jsx';

export default function MarketingLandingPage() {
  const navigate = useNavigate();
  const onStart = () => navigate('/start');

  return (
    <div className="hv-marketing-page">
      <MarketingSplitHero onStart={onStart} />
    </div>
  );
}
