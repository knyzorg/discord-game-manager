export function wait(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

export function countdown(
  seconds: number,
  step: number,
  onTick: (remaining: number) => void
) {
  onTick(Math.max(seconds, 0));
  const interval = setInterval(() => {
    seconds -= step;
    onTick(Math.max(seconds, 0));
    if (!Math.max(seconds, 0)) clearInterval(interval);
  }, step * 1000);

  return () => clearInterval(interval);
}
