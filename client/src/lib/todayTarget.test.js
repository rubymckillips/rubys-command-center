import { describe, expect, it } from 'vitest';
import { shouldShowTodayDropTarget } from './todayTarget.js';

describe('shouldShowTodayDropTarget', () => {
  it('shows a Today target for Today and source-section lists', () => {
    expect(shouldShowTodayDropTarget('today')).toBe(true);
    expect(shouldShowTodayDropTarget('academics')).toBe(true);
    expect(shouldShowTodayDropTarget('calendar')).toBe(true);
    expect(shouldShowTodayDropTarget('work')).toBe(true);
    expect(shouldShowTodayDropTarget('projects')).toBe(true);
    expect(shouldShowTodayDropTarget('workouts')).toBe(true);
  });

  it('does not show a target for an unknown list scope', () => {
    expect(shouldShowTodayDropTarget('unknown')).toBe(false);
  });
});
