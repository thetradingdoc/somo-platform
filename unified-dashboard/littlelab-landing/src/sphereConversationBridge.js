/**
 * Lets TTS (`assistantSpeech.js`) signal the WebGL sphere while Kelly is “speaking”.
 * Read from `assistantSpeakingRef` in the animation loop (no React re-renders).
 */
export const assistantSpeakingRef = { current: false };

export function setAssistantSpeaking(on) {
  assistantSpeakingRef.current = !!on;
}
