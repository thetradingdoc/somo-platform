import { useState } from 'react';
import Hero from './components/Hero';
import TrustBar from './components/TrustBar';
import CapabilityExplorerSection from './components/CapabilityExplorerSection';
import DemoSection from './components/DemoSection';
import HowItWorksSection from './components/HowItWorksSection';
import RoiSection from './components/RoiSection';
import HipaaLangSection from './components/HipaaLangSection';
import PricingSection from './components/PricingSection';
import FaqSection from './components/FaqSection';
import Footer from './components/Footer';
import FloatingDemoCta from './components/FloatingDemoCta';

export default function App() {
  const [selectedUseCase, setSelectedUseCase] = useState('');

  return (
    <>
      <Hero />
      <TrustBar />
      <CapabilityExplorerSection />
      <HowItWorksSection />
      <DemoSection selectedUseCase={selectedUseCase} onUseCaseChange={setSelectedUseCase} />
      <RoiSection />
      <PricingSection />
      <HipaaLangSection />
      <FaqSection />
      <Footer />
      <FloatingDemoCta />
    </>
  );
}
