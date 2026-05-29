const TRUSTED_BRANDS = [
  { name: 'Acme Consulting', src: '/assets/brand/trusted/acme.svg' },
  { name: 'BrightPath Health', src: '/assets/brand/trusted/brightpath.svg' },
  { name: 'Northline Solutions', src: '/assets/brand/trusted/northline.svg' },
  { name: 'Pioneer Realty', src: '/assets/brand/trusted/pioneer.svg' },
  { name: 'Elevate Fitness', src: '/assets/brand/trusted/elevate.svg' },
];

export default function TrustBar() {
  return (
    <div className="somo-hero-trust">
      <p className="somo-hero-trust-caption">Trusted by businesses around the world</p>
      <div className="somo-hero-trust-logos" aria-label="Trusted businesses">
        {TRUSTED_BRANDS.map((brand) => (
          <img
            key={brand.name}
            src={brand.src}
            alt={brand.name}
            className="somo-trust-logo"
            width={160}
            height={32}
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}
