/** Only non-secret UI choices are stored, separated by account and workspace. */
export function readPreference(key: string): string {
  try {
    const value = localStorage.getItem(`factory:choice:${key}`)
    return value && value.length < 256 ? value : ''
  } catch {
    return ''
  }
}

export function savePreference(key: string, value: string): void {
  try {
    localStorage.setItem(`factory:choice:${key}`, value)
  } catch {
    // Restricted storage must not prevent using the current in-memory choice.
  }
}
