import Hero from './components/Hero';
import DemoSection from './components/DemoSection';
import FloatingDemoCta from './components/FloatingDemoCta';

export default function App() {
  return (
    <>
      <Hero />
      <DemoSection />
      <FloatingDemoCta />
      <footer className="dc-footer">
        <p>Somo — AI voice for inbound and outbound calls.</p>
      </footer>
    </>
  );
}
