const supportedScopes = new Set([
  'today', 'academics', 'calendar', 'work', 'projects', 'job-applications', 'workouts', 'meals',
]);

export function shouldShowTodayDropTarget(scope) {
  return supportedScopes.has(scope);
}
