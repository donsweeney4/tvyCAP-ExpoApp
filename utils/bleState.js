// utils/bleState.js

export const bleState = {
  deviceRef: { current: null },
  characteristicsRef: { current: null },
  isConnectedRef: { current: false },
  isScanningRef: { current: false },
  isSamplingRef: { current: false },
  isIntentionalDisconnectRef: { current: false },
  locationRef: null,
  lastWriteTimestampRef: { current: 0 }, // Include in bleState
  lastErrorToastTimestampRef: { current: 0 }, // <-- Fix: Removed the extra comma here
  setDummyState: () => {},  // Placeholder to prevent undefined errors
  dbRef: { current: null }, // <-- New: Add a ref for your database instance
};

