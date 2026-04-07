import { landingLiveKitIdentity, landingTryRoomName } from './landingLiveKitApi';

describe('landingLiveKitApi', () => {
  test('landingTryRoomName sanitizes session id', () => {
    expect(landingTryRoomName('abc-123_xyz')).toBe('try-landing-abc-123_xyz');
    expect(landingTryRoomName('bad!@#')).toBe('try-landing-bad');
  });

  test('landingLiveKitIdentity sanitizes', () => {
    expect(landingLiveKitIdentity('sid-1')).toMatch(/^landing-/);
  });
});
