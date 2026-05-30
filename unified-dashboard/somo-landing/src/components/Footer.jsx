import { loginUrl, signupUrl } from '../api/somoDemo';

export default function Footer() {
  return (
    <footer className="somo-footer">
      <div className="somo-footer-inner">
        <a href="/" className="somo-footer-logo" aria-label="Somo home">
          <img
            src="/assets/brand/somo-logo.png"
            alt="Somo"
            className="somo-footer-logo-img"
            width={199}
            height={68}
          />
        </a>
        <div className="somo-footer-links">
          <a href="/terms">Terms of Service</a>
          <a href="/privacy">Privacy Policy</a>
          <a href={loginUrl()}>Sign in</a>
          <a href={signupUrl()}>Sign up</a>
        </div>
        <p className="somo-footer-copy">© {new Date().getFullYear()} Somo</p>
      </div>
    </footer>
  );
}
