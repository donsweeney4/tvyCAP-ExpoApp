import { Alert, Platform, PermissionsAndroid } from "react-native";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system"; // Keep if needed elsewhere, otherwise remove
import * as SQLite from "expo-sqlite";
import { BleManager } from "react-native-ble-plx";
import { atob } from "react-native-quick-base64";
import { Buffer } from "buffer"; // Keep if needed elsewhere, otherwise remove
import * as SecureStore from "expo-secure-store";
import { SERVICE_UUID, CHARACTERISTIC_UUID} from "./constants";
import { showToastAsync } from "./functionsHelper";
import { bleState } from "./utils/bleState";

const manager = new BleManager();
bleState.manager = manager;

const THROTTLE_ERROR_TOAST_INTERVAL_MS = 5000;

//# Throttle error toasts to avoid spamming
export const displayErrorToast = async (message, duration = 3000) => {
  const now = Date.now();
  if (!bleState.lastErrorToastTimestampRef) {
      bleState.lastErrorToastTimestampRef = { current: 0 };
  }

  if (now - bleState.lastErrorToastTimestampRef.current > THROTTLE_ERROR_TOAST_INTERVAL_MS) {
    await showToastAsync(message, duration);
    bleState.lastErrorToastTimestampRef.current = now;
  } else {
    console.log("🚫 Toast throttled: too soon to show another error toast.");
  }
};

// --- NEW HELPER: Function to manage icon display ---
const updateIconDisplay = (
  type, // 'green', 'red', or null
  text,
  duration, // how long the icon should be visible
  setIconType,
  setIconVisible,
  setIconText,
  iconHideTimerRef
) => {
  if (iconHideTimerRef.current) {
    clearTimeout(iconHideTimerRef.current);
    iconHideTimerRef.current = null;
  }

  if (type === null) { // If type is null, hide icon immediately
    setIconVisible(false);
    setIconType(null);
    setIconText("");
  } else {
    setIconType(type);
    setIconText(text);
    setIconVisible(true);
    iconHideTimerRef.current = setTimeout(() => {
      setIconVisible(false);
      setIconType(null);
      setIconText("");
    }, duration);
  }
};


//#0 Permissions for BLE on Android 12 and higher
export async function requestBluetoothPermissions() {
  if (Platform.OS === 'android' && Platform.Version >= 31) {
    const grantedScan = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      {
        title: 'Bluetooth Scan Permission',
        message: 'This app needs access to scan for BLE devices.',
        buttonPositive: 'OK',
      }
    );

    const grantedConnect = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      {
        title: 'Bluetooth Connect Permission',
        message: 'This app needs access to connect to BLE devices.',
        buttonPositive: 'OK',
      }
    );

    const grantedLocation = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Permission',
        message: 'This app needs access to your location to scan for BLE devices.',
        buttonPositive: 'OK',
      }
    );

    return (
      grantedScan === PermissionsAndroid.RESULTS.GRANTED &&
      grantedConnect === PermissionsAndroid.RESULTS.GRANTED &&
      grantedLocation === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  return true;
}


////////////////////////////////////////////////////////////////////////////////////////////


//# Define the function to open/get the database connection
export const openDatabaseConnection = async () => { // Exported for use in SettingsScreen
  if (bleState.dbRef.current) {
    console.log("Database already open, returning existing instance.");
    return bleState.dbRef.current;
  }
  try {
    const database = await SQLite.openDatabaseAsync('appData.db');
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS appData (
        timestamp INTEGER PRIMARY KEY NOT NULL,
        temperature INTEGER NOT NULL,
        humidity INTEGER,
        latitude INTEGER NOT NULL,
        longitude INTEGER NOT NULL,
        altitude INTEGER,
        accuracy INTEGER,
        speed INTEGER
      );
    `);
    console.log("✅ Database opened and tables ensured.");
    bleState.dbRef.current = database; // Store the open database instance
    return database;
  } catch (error) {
    console.error("❌ Error opening database:", error);
    await displayErrorToast("❌ Critical error: Could not open database! Restart app.", 10000);
    throw error; // Re-throw to propagate the error
  }
};

//#1. handleStart: scan, connect and start sampling BLE temperature sensor
     
export const handleStart = async (
  deviceName,
  setCounter,
  setTemperature,
  setAccuracy,
  setIconType,
  setIconVisible,
  setIconText,
  iconHideTimerRef // Passed ref for icon management
) => {
  console.log(`🚀 handleStart triggered, Campaign & sensor: ${deviceName}`);

  // Hide any existing icon when starting a new operation
  updateIconDisplay(null, "", 0, setIconType, setIconVisible, setIconText, iconHideTimerRef);


  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Permission Denied", "Location access is required for tracking.");
    // Display red icon if location permission is denied
    updateIconDisplay('red', "Location access denied! Cannot start.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    return;
  }


  const blePermissionsGranted = await requestBluetoothPermissions();
  if (!blePermissionsGranted) {
    Alert.alert("Permission Denied", "Bluetooth permissions are required.");
    // Display red icon if BLE permissions are denied
    updateIconDisplay('red', "Bluetooth permissions denied! Cannot start.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    return;
  }

 
  try {
    console.log("🔗 Opening database connection...")  ;
    await openDatabaseConnection();
  
    // Stop sampling and disconnect if already connected or sampling
    if (bleState.isConnectedRef.current || bleState.deviceRef.current) {
      try {
        if (bleState.deviceRef.current) {
          console.log(`🔌 Disconnecting from ${bleState.deviceRef.current.name || "unknown"}...`);
          await bleState.deviceRef.current.cancelConnection();
        }
        bleState.isConnectedRef.current = false;
        bleState.deviceRef.current = null;
        if (bleState.isSamplingRef.current) {
            stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef); // Pass icon setters
        }

      } catch (error) {
        console.warn("⚠️ Disconnect failed:", error);
      }
    }

    bleState.isScanningRef.current = true;
    bleState.setDummyState(prev => prev + 1);

    const { connected } = await ConnectToPairedSensor();

    bleState.isScanningRef.current = false;
    bleState.setDummyState(prev => prev + 1);

    console.log("✅ Connect result:", connected);
    console.log("✅ Characteristic present:", !!bleState.characteristicsRef.current);

    if (connected && bleState.characteristicsRef.current) {
      bleState.isConnectedRef.current = true;

      setTimeout(() => {
        // Pass all icon related arguments to startSampling
        startSampling(setCounter, setTemperature, setAccuracy, setIconType, setIconVisible, setIconText, iconHideTimerRef);
      }, 500);

    } else {
      displayErrorToast("Sensor not found or failed to connect", 2000);
      console.warn("⚠️ Device not found or failed to connect.");
      // Set red icon if initial connection or characteristic discovery failed
      updateIconDisplay('red', "Sensor not found or failed to connect!", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    }
  } catch (error) {
    console.error("❌ Error in handleStart:", error);
    bleState.isScanningRef.current = false;
    bleState.setDummyState(prev => prev + 1);
    Alert.alert("Error", `Failed to start device connection or open database: ${error.message}`);
    if (error.message && error.message.includes("database")) {
        bleState.dbRef.current = null;
    }
    // Also set red icon for any major error in handleStart
    updateIconDisplay('red', `Startup Error: ${error.message}`, 8000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
  }
};


/////////////////////////////////////////////////////////////////////////////////////////////
//#2. ConnectToPairedSensor: Connect to sensor device and check characteristic

export const ConnectToPairedSensor = async (scanTimeout = 10000) => {
  return new Promise(async (resolve, reject) => {
    let isMatchingInProgress = false;
    let resolved = false;

    const storedName = await SecureStore.getItemAsync("pairedSensorName");
    if (!storedName) {
      console.error("❌ No paired sensor name found in SecureStore.");
      // Note: This error is caught by handleStart, which will then display an icon.
      return resolve({ connected: false });
    }

    console.log("🔍 Stored target name:", storedName);

    const currentBleState = await bleState.manager.state();
    console.log("🧭 Initial BLE state:", currentBleState);

    const subscription = bleState.manager.onStateChange(async (state) => {
      console.log("📶 onStateChange triggered:", state);

      if (state === "PoweredOn") {
        subscription.remove();

        console.log("🔍 Starting device scan...");

        bleState.manager.startDeviceScan(null, null, async (error, device) => {
          if (resolved || isMatchingInProgress) return;

          if (error) {
            console.error("❌ BLE scan error:", error);
            bleState.manager.stopDeviceScan();
            return reject(error);
          }

          if (device?.name) {
            console.log("🛰 Found device:", device.name, device.id);
          } else {
            console.log("🛰 Found unnamed device:", device?.id);
          }

          if (device?.name === storedName) {
            console.log(`🎯 Match found: ${device.name}`);
            isMatchingInProgress = true;

            try {
              console.log("🔌 Attempting to connect...");
              await device.connect();
              console.log("✅ Connected to device:", device.name);

              console.log("🔍 Discovering all services and characteristics...");
              await device.discoverAllServicesAndCharacteristics();
              console.log("✅ Discovery complete");

              const services = await device.services();
              for (const service of services) {
                console.log("🔧 Service UUID:", service.uuid);
                const characteristics = await device.characteristicsForService(service.uuid);
                for (const char of characteristics) {
                  console.log("   📍 Characteristic UUID:", char.uuid);
                }
              }

              bleState.manager.stopDeviceScan();
              bleState.deviceRef.current = device;

              try {
                const characteristic = await device.readCharacteristicForService(
                  SERVICE_UUID,
                  CHARACTERISTIC_UUID
                );
                bleState.characteristicsRef.current = characteristic;
                console.log("✅ Characteristic found and stored.");
                resolved = true;
                return resolve({ connected: true });

              } catch (charErr) {
                console.warn("⚠️ Failed to read characteristic for service during connection:", charErr);
                await device.cancelConnection();
                bleState.deviceRef.current = null;
                bleState.characteristicsRef.current = null;
                return resolve({ connected: false });
              }

            } catch (err) {
              console.warn("⚠️ Connection or discovery error (general):", err);
              try {
                await device.cancelConnection();
              } catch (cleanupError) {
                console.warn("⚠️ Cleanup disconnect error:", cleanupError);
              }
              bleState.deviceRef.current = null;
              bleState.characteristicsRef.current = null;
              return resolve({ connected: false });
            } finally {
              isMatchingInProgress = false;
            }
          }
        });

        setTimeout(() => {
          if (!resolved) {
            bleState.manager.stopDeviceScan();
            console.warn("⌛ Scan timeout — paired device not found.");
            resolve({ connected: false });
          }
        }, scanTimeout);
      }
    }, true);
  });
};


//#2a ✅ Function to handle device disconnection
// This function needs icon setters if it's called from BLE event listeners directly
const handleDeviceDisconnection = async (setIconType, setIconVisible, setIconText, iconHideTimerRef) => {
  console.log(`🔌 Device disconnected.`);

  bleState.isScanningRef.current = false;
  bleState.isConnectedRef.current = false;
  bleState.deviceRef.current = null;
  bleState.characteristicsRef.current = null;
  bleState.setDummyState(prev => prev + 1);

  await showToastAsync("⚠️ Sensor disconnected! Press start to reconnect.", 2000);
  updateIconDisplay('red', "Sensor disconnected! Reconnect to continue.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);


  if (bleState.isSamplingRef.current) {
    console.log("🛑 Stopping due to disconnection...");
    stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef); // Pass icon setters
  }
};


//#3 startSampling: Start sampling data from the BLE device
// This function is called after a successful connection to the BLE device

const startSampling = async (
  setCounter,
  setTemperature,
  setAccuracy,
  setIconType,
  setIconVisible,
  setIconText,
  iconHideTimerRef // Passed ref for icon management
) => {
  console.log("🚦//#3 startSampling - Entered startSampling()");

  const device = bleState.deviceRef.current;
  const isConnected = device ? await device.isConnected() : false;

  console.log("📡 Checking device connection before sampling...");

  if (!device || !isConnected) {
    console.warn("⚠️ Sensor device is not connected. Sampling cannot start.");
    displayErrorToast("⚠️ Cannot start sampling. BLE sensor is not connected!", 3000);
    updateIconDisplay('red', "Sensor not connected! Cannot sample.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    return;
  }

  if (!bleState.characteristicsRef.current) {
    console.warn("⚠️ No characteristic available. Cannot start sampling.");
    displayErrorToast("⚠️ Cannot start sampling. No BLE characteristic found!", 3000);
    updateIconDisplay('red', "No BLE characteristic found! Cannot sample.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    return;
  }

  console.log("1. ble device isConnected:", isConnected);

  bleState.isSamplingRef.current = true;
  bleState.setDummyState(prev => prev + 1);

  // Initial success icon when sampling begins
  updateIconDisplay('green', "Sensor connected! Data logging...", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);


  try {
    console.log("📍📍📍📍 Setting up oneTimePos watchPositionAsync...");

    const oneTimePos = await Location.getCurrentPositionAsync({});
    console.log("🌍 One-time location check:", oneTimePos);

    bleState.locationRef = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
        distanceInterval: 0,
        mayShowUserSettingsDialog: true,
      },
      (location) => {
        try {
          console.log("📍 watchPositionAsync callback triggered");
          console.log("📍 Got location:", location.coords);

          if (!bleState.deviceRef.current) {
            console.warn("⚠️ Device disconnected. Stopping location tracking.");
            bleState.isIntentionalDisconnectRef.current = false;
            stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef); // Pass icon setters
            displayErrorToast("⚠️ Device disconnected. Stopping location tracking.", 5000);
            updateIconDisplay('red', "Device disconnected! Data stopped.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
            return;
          }

          // Pass icon related arguments to handleLocationUpdate
          handleLocationUpdate(location, setCounter, setTemperature, setAccuracy, setIconType, setIconVisible, setIconText, iconHideTimerRef);

        } catch (err) {
          console.error("❌ Error inside watchPositionAsync callback:", err);
          stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef); // Pass icon setters
          displayErrorToast("❌ An error occurred during data collection. Sampling stopped.", 5000);
          updateIconDisplay('red', "Data collection error! Sampling stopped.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
        }
      }
    );

    console.log("✅ Location tracking started successfully.");
  } catch (error) {
    console.error("❌ Error starting location tracking:", error);
    stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef); // Pass icon setters
    displayErrorToast("❌ Error starting location tracking. Sampling stopped.", 5000);
    updateIconDisplay('red', "Location error! Sampling stopped.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
  }
};


//#3a ✅ Helper function to stop tracking when BLE disconnects

const stopSamplingLoop = (setIconType, setIconVisible, setIconText, iconHideTimerRef) => {
  if (!bleState.isSamplingRef.current) {
    console.log("⚠️ Sampling already marked as stopped. Proceeding with full cleanup...");
  } else {
    console.log("🚫 Stopping location tracking and sampling...");
  }
  
  if (bleState.locationRef?.remove) {
    try {
        bleState.locationRef.remove();
        bleState.locationRef = null;
        console.log("📡 Location listener removed successfully.");
    } catch (removeError) {
        console.error("❌ Error removing location listener:", removeError);
        bleState.locationRef = null;
    }
  } else {
    console.log("No active location listener to remove.");
  }

  bleState.isSamplingRef.current = false;
  bleState.isIntentionalDisconnectRef.current = false;
  bleState.setDummyState(prev => prev + 1);

  // Clear icon when sampling loop stops cleanly, unless it's already an error state
  // You might choose to leave an error icon visible if the stop was due to an error.
  // For a general stop, clear it.
  if (iconHideTimerRef.current) { // If there's an active timer, clear it
    clearTimeout(iconHideTimerRef.current);
    iconHideTimerRef.current = null;
  }
  // Only hide if not explicitly set to red (e.g., if called after a red icon was set by an error)
  if (setIconType) { // Check if setters are provided
    setIconVisible(false);
    setIconType(null);
    setIconText("");
  }


  console.log("✅ Sampling and location tracking cleanup complete.");
}

//#4. handleLocationUpdate: Callback function when location updates in #3

const handleLocationUpdate = async (
  location,
  setCounter,
  setTemperature,
  setAccuracy,
  setIconType,
  setIconVisible,
  setIconText,
  iconHideTimerRef // Passed ref for icon management
) => {
  console.log("📍📍📍📍 //#4 handleLocationUpdate:");

  try {
    if (!bleState.characteristicsRef.current) {
      console.warn("⚠️ Device disconnected or no characteristic found. Stopping updates...");
      bleState.isIntentionalDisconnectRef.current = false;
      stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef);
      displayErrorToast("⚠️ BLE device disconnected. Data recording stopped.", 5000);
      updateIconDisplay('red', "BLE disconnected! Data recording stopped.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
      return;
    }

    if (!bleState.isSamplingRef.current) {
      console.warn("⚠️ Sampling stopped. Ignoring BLE read.");
      updateIconDisplay(null, "", 0, setIconType, setIconVisible, setIconText, iconHideTimerRef); // Hide any icon if sampling stopped
      return;
    }

    let rawData;
    try {
      rawData = await bleState.characteristicsRef.current.read();
    } catch (readError) {
      console.error("❌ Error reading characteristic from BLE device:", readError);
      stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef);
      displayErrorToast("❌ Failed to read data from sensor. Data recording stopped.", 5000);
      updateIconDisplay('red', "Sensor read error! Data recording stopped.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
      return;
    }

    if (!rawData || !rawData.value) {
      console.error("❌ Error: No value returned in the characteristic.");
      displayErrorToast("❌ No value from BLE device. Check connection.", 3000);
      updateIconDisplay('red', "No data from sensor! Check connection.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
      return;
    }

    const decodedValue = atob(rawData.value);
    console.log("📥 Decoded characteristic value:", decodedValue);

    const tempValue = decodedValue;
    const temperature = parseFloat(parseFloat(tempValue).toFixed(2)) || NaN;
    setTemperature(temperature);

    const { latitude, longitude, altitude, accuracy, speed } = location.coords;
    const timestamp = Date.now();

    if (!bleState.lastWriteTimestampRef) {
        bleState.lastWriteTimestampRef = { current: 0 };
    }

    if (timestamp - bleState.lastWriteTimestampRef.current < 50) {
      console.warn("⚠️ Duplicate data detected! Skipping write.");
      return;
    }
    bleState.lastWriteTimestampRef.current = timestamp;

    const humInt = 0;
    const tempInt = Math.round(temperature * 1e2);
    const latInt = Math.round(latitude * 1e7);
    const lonInt = Math.round(longitude * 1e7);
    const altInt = Math.round(altitude * 1e2);
    const accInt = Math.round(accuracy * 1e2);
    const speedInt = Math.round(speed * 1e2);

    setAccuracy(Math.round(accuracy));

    try {
      const database = bleState.dbRef.current;
      if (!database) {
          console.error("❌ Database reference is null. Cannot write data.");
          stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef);
          displayErrorToast("❌ Data recording stopped! Database not available.", 5000);
          updateIconDisplay('red', "Database error! Data recording stopped.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
          return;
      }

      await database.runAsync(
        `INSERT INTO appData (timestamp, temperature, humidity, latitude, longitude, altitude, accuracy, speed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [timestamp, tempInt, humInt, latInt, lonInt, altInt, accInt, speedInt]
      );
      console.log("✅ Data added to database successfully.");

      // Show green icon briefly for successful data save
      updateIconDisplay('green', "Data sample saved!", 500, setIconType, setIconVisible, setIconText, iconHideTimerRef);

      setCounter((prev) => {
        const newCounter = prev + 1;
        console.log(`✅ Updated Counter: ${newCounter}`);
        return newCounter;
      });

    } catch (dbError) {
      console.error("❌ Fatal Error inserting data into database:", dbError);
      stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef);
      displayErrorToast(
        "❌ ERROR: Data recording stopped! Database issue. Please restart the app.",
        15000
      );
      console.log("🗑️ Invalidating database reference due to error.");
      bleState.dbRef.current = null;
      updateIconDisplay('red', "Database write error! Recording stopped.", 8000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
      return;
    }

  } catch (error) {
    console.error("❌ General error in handleLocationUpdate:", error);
    stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef);
    displayErrorToast("❌ An unexpected error occurred. Data recording stopped.", 5000);
    updateIconDisplay('red', "Unexpected error! Recording stopped.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
  }
};


//#8. Stop Sampling

export const stopSampling = async (setIconType, setIconVisible, setIconText, iconHideTimerRef) => {
  console.log("🛑 //#8 stopSampling -  Stopping sampling ...");

  bleState.isIntentionalDisconnectRef.current = true;
  bleState.isScanningRef.current = false;
  bleState.setDummyState(prev => prev + 1);

  // Pass icon setters to the loop for full cleanup and potential UI update
  stopSamplingLoop(setIconType, setIconVisible, setIconText, iconHideTimerRef);

  if (!bleState.deviceRef.current) {
    console.log("⚠️ No device connected.");
    await showToastAsync("Stopped Sampling Temperature Data", 3000);
    // Clear icon on manual stop, unless it's already showing a persistent error
    updateIconDisplay(null, "", 0, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    return;
  }

  try {
    const isConnected = await bleState.deviceRef.current.isConnected();
    if (isConnected) {
      console.log("🔌 Disconnecting BLE device...");
      await bleState.deviceRef.current.cancelConnection();
      console.log("✅ Device disconnected.");
    }
  } catch (error) {
    console.error("❌ Disconnection error on stop:", error);
    displayErrorToast("❌ Failed to disconnect BLE device gracefully.", 3000);
    // You might want a specific icon here, or let the general error catch handle it
    updateIconDisplay('red', "Disconnection error!", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
  }

  bleState.deviceRef.current = null;
  bleState.setDummyState(prev => prev + 1);
  await showToastAsync("Stopped Sampling Temperature Data", 3000);
  // Ensure icon is cleared after successful manual stop
  updateIconDisplay(null, "", 0, setIconType, setIconVisible, setIconText, iconHideTimerRef);
};

//#9 confirmAndClearDatabase

export const confirmAndClearDatabase = (setDummyState, setCounter, setIconType, setIconVisible, setIconText, iconHideTimerRef) => {
  if (bleState.isSamplingRef.current) {
    showToastAsync("Sampling in Progress. Stop sampling before clearing data.", 2000);
    return;
  }

  Alert.alert(
    "Confirm Action",
    "Are you sure you want to clear the database?",
    [
      {
        text: "Cancel",
        style: "cancel"
      },
      {
        text: "Yes, Clear Data",
        onPress: () => {
          // Pass icon setters to clearDatabase
          clearDatabase(setDummyState, setCounter, setIconType, setIconVisible, setIconText, iconHideTimerRef);
        }
      }
    ],
    { cancelable: false }
  );
};

//////////////////////////////////////////////////////////////////////////////////////////////////
//#10. clearDatabase
export const clearDatabase = async (setDummyState, setCounter, setIconType, setIconVisible, setIconText, iconHideTimerRef) => {
  try {
    console.log("🚨 Entering function 10: Clearing database...");
    setCounter(0);

    const database = bleState.dbRef.current;

    if (!database) {
      console.warn("⚠️ Database not open/available. Cannot clear data.");
      displayErrorToast("⚠️ Cannot clear data. Database not available. ", 5000);
      updateIconDisplay('red', "Database not available! Cannot clear data.", 5000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
      return;
    }

    await database.runAsync("DELETE FROM appData;");
    console.log("✅ Database cleared successfully.");
    setDummyState(prev => prev + 1);
    showToastAsync("Data deleted", 2000);
    // Show green icon briefly for successful clear, then clear it
    updateIconDisplay('green', "Data cleared successfully!", 2000, setIconType, setIconVisible, setIconText, iconHideTimerRef);

  } catch (error) {
    console.error("❌ Error clearing database:", error);
    displayErrorToast("❌ Error clearing database: " + error.message, 8000);
    bleState.dbRef.current = null;
    updateIconDisplay('red', `Error clearing DB: ${error.message}`, 8000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////
//#11. GetPairedSensorID, save unique device ID (ie, the paired sensor ID) 
// in SecureStore.  Exit funtion in disconnected state   


export const GetPairedSensorName = async (scanTimeout = 10000) => {
  return new Promise(async (resolve, reject) => {
    console.log("🔍 Starting GetPairedSensorName() ...");
    console.log("📱 Platform:", Platform.OS);

    try {
      // No icon updates here directly, as this is used by SettingsScreen's pairing logic
      // which has its own icon display for success/failure.
      // If this function were used independently for pairing in MainScreen1,
      // it would also need to accept icon setters.

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location access is required to scan for BLE devices.");
        return reject(new Error("Location permission denied"));
      }

      const locationServicesEnabled = await Location.hasServicesEnabledAsync();
      console.log("📍 Location services enabled:", locationServicesEnabled);
      if (!locationServicesEnabled) {
        Alert.alert("Enable Location", "Please enable location services (GPS) in device settings.");
        return reject(new Error("Location services disabled"));
      }

      if (Platform.OS === 'android' && Platform.Version >= 31) {
        const grantedScan = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          {
            title: 'Bluetooth Scan Permission',
            message: 'This app needs permission to scan for BLE devices.',
            buttonPositive: 'OK',
          }
        );

        const grantedConnect = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          {
            title: 'Bluetooth Connect Permission',
            message: 'This app needs permission to connect to BLE devices.',
            buttonPositive: 'OK',
          }
        );

        const grantedLocation = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'This app needs location access to scan for BLE.',
            buttonPositive: 'OK',
          }
        );
       
        if (
          grantedScan !== PermissionsAndroid.RESULTS.GRANTED ||
          grantedConnect !== PermissionsAndroid.RESULTS.GRANTED ||
          grantedLocation !== PermissionsAndroid.RESULTS.GRANTED
        ) {
          Alert.alert("Permission Denied", "All required BLE and location permissions must be granted.");
          return reject(new Error("Required permissions denied"));
        }
      }

      if (bleState.isSamplingRef.current) {
        console.log("🛑 Stopping sampling before reading sensor ID...");
        // Pass arguments needed by stopSampling if it were to update icons
        // As per MainScreen1, stopSampling does not take icon setters, so this might need refactor or careful consideration
        await stopSampling(null, null, null, null); // Pass nulls for icon setters from this context
      }

      if (bleState.deviceRef.current) {
        try {
          const isConnected = await bleState.deviceRef.current.isConnected();
          console.log("🔌 Existing device connection status:", isConnected);
          if (isConnected) {
            console.log("🔌 Disconnecting from current device...");
            await bleState.deviceRef.current.cancelConnection();
          }
        } catch (err) {
          console.warn("⚠️ Disconnect error:", err);
        }
        bleState.deviceRef.current = null;
      }

      console.log("🔍 Waiting for BLE adapter to power on...");

      let scanTimeoutHandle;
      let scanResolved = false;

      const subscription = bleState.manager.onStateChange(async (state) => {
        if (state === "PoweredOn") {
          console.log("✅ BLE adapter is powered on");
          subscription.remove();

          showToastAsync("Start scanning for BLE devices", 2000);
          console.log("🚀 Scanning for BLE devices...");

          bleState.manager.startDeviceScan(null, null, async (error, device) => {
            if (error || scanResolved) {
              if (error) console.error("❌ Scan error:", error);
              return;
            }

            const name = device?.name || "";
            const id = device?.id || "(no id)";
            console.log("🔎 Found device:", `"${name}"`, "ID:", id);

            const questPattern = /^[qQ]uest.*/;

            if (questPattern.test(name)) {
              console.log("🎯 Matching device name found:", name);
              showToastAsync(`Found device: ${name}`, 2000);
              scanResolved = true;
              clearTimeout(scanTimeoutHandle);
              bleState.manager.stopDeviceScan();
              console.log("🛑 Stopping scan. Attempting connection...");

              try {
                await device.connect();
                console.log("🔗 Connected to device (raw):", device.name);

                const isActuallyConnected = await device.isConnected();
                console.log("✅ Connection confirmed:", isActuallyConnected);

                await device.discoverAllServicesAndCharacteristics();

                const services = await device.services();
                console.log("✅ Discovered services:");
                for (const service of services) {
                  console.log("🔧 Service UUID:", service.uuid);

                  const characteristics = await device.characteristicsForService(service.uuid);
                  console.log(`🔍 Characteristics for service ${service.uuid}:`);
                  for (const char of characteristics) {
                    console.log("  📍 Characteristic UUID:", char.uuid);
                  }
                }

                bleState.deviceRef.current = device;
                showToastAsync(`Connected to ${name}`, 2000);
                console.log("🔌 Connected to device:", name);

                await SecureStore.setItemAsync("pairedSensorName", name);
                console.log("🔒 Sensor name saved to SecureStore");
                showToastAsync(`Sensor name ${name} saved to SecureStore`, 3000);

                await device.cancelConnection();
                bleState.deviceRef.current = null;

                return resolve(true);
              } catch (connectError) {
                  console.error("❌ Connection or read error:", connectError);
                  return reject(connectError);
              }
            }
          });

          scanTimeoutHandle = setTimeout(() => {
            if (!scanResolved) {
              scanResolved = true;
              bleState.manager.stopDeviceScan();
              console.error("❌ Timeout: No matching quest_nnn device found.");
              reject(new Error("Timeout: No matching quest_nnn device found."));
              showToastAsync("Timeout: quest_nnn sensor not found", 3000);
            }
          }, scanTimeout);
        }
      }, true);
    } catch (error) {
      console.error("❌ Error in GetPairedSensorName:", error);
      reject(error);
    }
  });
};
