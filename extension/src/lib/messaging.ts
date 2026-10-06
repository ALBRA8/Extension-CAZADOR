// Thin wrapper around chrome.runtime.sendMessage so UI code doesn't import
// the chrome API directly (easier to mock in tests).
export function sendMessage(message: unknown): Promise<any> {
  return chrome.runtime.sendMessage(message)
}
