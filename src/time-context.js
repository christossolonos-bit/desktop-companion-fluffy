export function getLocalTimeContext(date = new Date()) {
  const hour = date.getHours();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  const localTime = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const dayOfWeek = date.toLocaleDateString(undefined, { weekday: 'long' });

  let timeOfDay = 'late night';
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 22) timeOfDay = 'evening';

  return {
    timezone,
    localTime,
    timeOfDay,
    hour,
    dayOfWeek,
  };
}

export function formatTimeContextForPrompt(context) {
  return `Your human's local time: ${context.localTime} (${context.timezone}), ${context.dayOfWeek}, ${context.timeOfDay}.`;
}
