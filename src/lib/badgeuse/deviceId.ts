/**
 * Device ID generation and storage for Badgeuse V1
 * Generates a unique, persistent device identifier
 */

const DEVICE_ID_KEY = "badgeuse_device_id";

/**
 * Generate a unique device ID using cryptographically secure randomness
 */
function generateDeviceId(): string {
  return `dev_${crypto.randomUUID()}`;
}

/**
 * Get or create the device ID
 * Persisted in localStorage for device binding
 */
export function getDeviceId(): string {
  try {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = generateDeviceId();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  } catch {
    // Fallback if localStorage not available
    return generateDeviceId();
  }
}

/**
 * Check if device ID exists (device has been used before)
 */
export function hasDeviceId(): boolean {
  try {
    return !!localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    return false;
  }
}
