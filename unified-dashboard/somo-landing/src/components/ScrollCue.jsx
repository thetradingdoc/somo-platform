import { useEffect, useState } from 'react';

const SCROLL_HIDE_OFFSET = 80;

export default function ScrollCue() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setHidden(window.scrollY > SCROLL_HIDE_OFFSET);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className={`somo-scroll-cue${hidden ? ' is-hidden' : ''}`}
      aria-hidden="true"
    >
      <div className="somo-scroll-cue__mouse" />
      <p className="somo-scroll-cue__label">Scroll</p>
    </div>
  );
}
