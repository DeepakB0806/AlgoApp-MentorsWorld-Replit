export function invokeCallbackSafely(
  callback: (() => void) | undefined,
  onError: (error: unknown) => void,
): void {
  if (!callback) return;

  try {
    callback();
  } catch (error) {
    onError(error);
  }
}
