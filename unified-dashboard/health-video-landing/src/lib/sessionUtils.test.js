import { describe, it, expect } from 'vitest';
import {
  buildTopicChips,
  kellyGreeting,
  isGreetingLike,
  mergeAssistantMessage,
  createLocalGreeting,
  isMemoryMessage
} from './sessionUtils.js';

describe('sessionUtils', () => {
  it('builds topic chips from patient messages', () => {
    const chips = buildTopicChips([
      { speaker: 'patient', text: 'I have a rash on my arm for two days' }
    ]);
    expect(chips.some((c) => c.toLowerCase().includes('rash'))).toBe(true);
  });

  it('returns default chip when no messages', () => {
    expect(buildTopicChips([])).toEqual(['Health chat']);
  });

  it('includes camera hint in greeting', () => {
    const g = kellyGreeting('Amina');
    expect(g).toContain('Amina');
    expect(g.toLowerCase()).toContain('camera');
  });

  it('detects greeting-like SSE text', () => {
    expect(isGreetingLike("Hi, I'm Kelly")).toBe(true);
    expect(isGreetingLike('The pain is severe')).toBe(false);
  });

  it('replaces local greeting when SSE greeting arrives', () => {
    const local = [createLocalGreeting('Sam')];
    const merged = mergeAssistantMessage(local, "Hi Sam, I'm Kelly. Tell me what's bothering you.");
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('greeting-local');
    expect(merged[0].text).toContain("I'm Kelly");
  });

  it('appends assistant message after greeting when not similar', () => {
    const local = [createLocalGreeting('Sam')];
    const merged = mergeAssistantMessage(local, 'How long has the pain lasted?');
    expect(merged).toHaveLength(2);
  });

  it('normalizes physician assistant to AI health assistant in greetings', () => {
    const local = [createLocalGreeting('Sam')];
    const merged = mergeAssistantMessage(local, "Hello, I'm Kelly, a physician assistant. How can I help?");
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toContain('AI health assistant');
    expect(merged[0].text.toLowerCase()).not.toContain('physician assistant');
  });

  it('detects memory callout phrases', () => {
    expect(isMemoryMessage('You mentioned a rash earlier')).toBe(true);
    expect(isMemoryMessage('Tell me more about the pain')).toBe(false);
  });
});
