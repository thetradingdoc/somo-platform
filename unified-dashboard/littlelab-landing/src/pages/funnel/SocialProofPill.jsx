import React from 'react';

const AVATARS = [
  { src: '/images/marketing/social-proof/avatar-1.jpg', alt: '' },
  { src: '/images/marketing/social-proof/avatar-2.jpg', alt: '' },
  { src: '/images/marketing/social-proof/avatar-3.jpg', alt: '' },
];

export default function SocialProofPill() {
  return (
    <div className="funnel-social-proof" aria-label="Rated 4.9 by our community">
      <span className="funnel-social-avatars" aria-hidden="true">
        {AVATARS.map((avatar, i) => (
          <img
            key={avatar.src}
            className="funnel-social-avatar"
            src={avatar.src}
            alt={avatar.alt}
            width={28}
            height={28}
            loading="lazy"
            decoding="async"
            style={{ marginLeft: i ? -8 : 0 }}
          />
        ))}
      </span>
      <span className="funnel-social-text">
        Loved by many with <span className="funnel-social-star" aria-hidden="true">★</span>{' '}
        <strong>4.9</strong> rating
      </span>
    </div>
  );
}
