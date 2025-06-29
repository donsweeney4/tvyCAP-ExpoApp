import { Alert, Platform, PermissionsAndroid } from "react-native";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system"; // This import is present but not used in the provided snippet.
import * as SQLite from "expo-sqlite";
import { BleManager } from "react-native-ble-plx";
import { atob } from "react-native-quick-base64";
import { Buffer } from "buffer"; // This import is present but not used in the provided snippet.
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
    // Perform any necessary table creation/migrations here
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
     
export const handleStart = async (deviceName, setCounter, setTemperature, setAccuracy,
  setIconType,setIconVisible )   => {

  console.log(`🚀 handleStart triggered, Campaign & sensor: ${deviceName}`);

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Permission Denied", "Location access is required for tracking.");
    return;
  }


  const blePermissionsGranted = await requestBluetoothPermissions();
  if (!blePermissionsGranted) {
    Alert.alert("Permission Denied", "Bluetooth permissions are required.");
    return;
  }

 
  try {
    // If dbRef.current is null (e.g., first start or after a previous error),
    // this will attempt to open it. If it fails, it throws, and the catch block handles it.
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
        // Also ensure location tracking is stopped if `handleStart` is called while sampling
        if (bleState.isSamplingRef.current) {
            stopSamplingLoop(); // 
        }

      } catch (error) {
        console.warn("⚠️ Disconnect failed:", error);
        // Do NOT return here. A failed disconnect shouldn't necessarily stop the new start attempt.
      }
    }

    bleState.isScanningRef.current = true;
    bleState.setDummyState(prev => prev + 1);

    // Scan and pair to the paired sensor device
    // IMPORTANT: ConnectToPairedSensor should NOT be re-opening the database.
    // It should just connect to BLE and rely on bleState.dbRef.current being available for sampling later.
    const { connected } = await ConnectToPairedSensor(); // 

    bleState.isScanningRef.current = false;
    bleState.setDummyState(prev => prev + 1);

    console.log("✅ Connect result:", connected);
    console.log("✅ Characteristic present:", !!bleState.characteristicsRef.current);

    if (connected && bleState.characteristicsRef.current) {
      bleState.isConnectedRef.current = true;

      setTimeout(() => {
        // startSampling now uses bleState.dbRef.current implicitly
        startSampling(setCounter, setTemperature, setAccuracy); 
      }, 500);

    } else {
      await showToastAsync("Sensor not found or failed to connect", 2000);
      console.warn("⚠️ Device not found or failed to connect.");
      // If connection fails, ensure dbRef is not incorrectly nullified by this function,
      // as db opening was successful.
    }
  } catch (error) {
    console.error("❌ Error in handleStart:", error);
    bleState.isScanningRef.current = false;
    bleState.setDummyState(prev => prev + 1);
    Alert.alert("Error", `Failed to start device connection or open database: ${error.message}`);
    // If openDatabaseConnection throws, it will be caught here.
    // If it's a database error, the dbRef is likely already nullified by openDatabaseConnection.
    // Ensure any other error that makes dbRef invalid also nullifies it here.
    if (error.message && error.message.includes("database")) { // Simple check
        bleState.dbRef.current = null;
    }
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
              } catch (charErr) {
                console.warn("⚠️ Failed to read characteristic:", charErr);
                await device.cancelConnection();
                bleState.deviceRef.current = null;
                return resolve({ connected: false });
              }

              resolved = true;
              return resolve({ connected: true });

            } catch (err) {
              console.warn("⚠️ Connection or discovery error:", err);
              try {
                await device.cancelConnection();
              } catch (cleanupError) {
                console.warn("⚠️ Cleanup disconnect error:", cleanupError);
              }
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
const handleDeviceDisconnection = async () => {
  console.log(`🔌 Device disconnected.`);

  // Reset device references and status
  bleState.isScanningRef.current = false;
  bleState.isConnectedRef.current = false;
  bleState.deviceRef.current = null;
  bleState.characteristicsRef.current = null;
  bleState.setDummyState(prev => prev + 1); // Trigger UI update

  await showToastAsync("⚠️ Sensor disconnected! Press start to reconnect.", 2000);

  if (bleState.isSamplingRef.current) {
    console.log("🛑 Stopping due to disconnection...");
    stopSampling();
  }
};


//#3 startSampling: Start sampling data from the BLE device
// This function is called after a successful connection to the BLE device

const startSampling = async (setCounter, setTemperature, setAccuracy) => {
  console.log("🚦//#3 startSampling - Entered startSampling()");

  const device = bleState.deviceRef.current;
  const isConnected = device ? await device.isConnected() : false;

  console.log("📡 Checking device connection before sampling...");

  if (!device || !isConnected) {
    console.warn("⚠️ Sensor device is not connected. Sampling cannot start.");
    displayErrorToast("⚠️ Cannot start sampling. BLE sensor is not connected!", 3000);
    return;
  }

  if (!bleState.characteristicsRef.current) {
    console.warn("⚠️ No characteristic available. Cannot start sampling.");
    displayErrorToast("⚠️ Cannot start sampling. No BLE characteristic found!", 3000);
    return;
  }

  console.log("1. ble device isConnected:", isConnected);

  bleState.isSamplingRef.current = true;
  bleState.setDummyState(prev => prev + 1);

  try {
    console.log("📍📍📍📍 Setting up oneTimePos watchPositionAsync...");

    const oneTimePos = await Location.getCurrentPositionAsync({});
    console.log("🌍 One-time location check:", oneTimePos);

    // Start getting location updates every second
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
            stopSamplingLoop();
            
            displayErrorToast("⚠️ Device disconnected. Stopping location tracking.", 5000);
            return;
          }

          // handleLocationUpdate called each time location updates
          handleLocationUpdate(location, setCounter, setTemperature, setAccuracy, setIconType, setIconVisible);

        } catch (err) {
          console.error("❌ Error inside watchPositionAsync callback:", err);
          stopSamplingLoop();
          displayErrorToast("❌ An error occurred during data collection. Sampling stopped.", 5000);
        }
      }
    );

    console.log("✅ Location tracking started successfully.");
  } catch (error) {
    console.error("❌ Error starting location tracking:", error);
    stopSamplingLoop();
    displayErrorToast("❌ Error starting location tracking. Sampling stopped.", 5000);
  }
};


//#3a ✅ Helper function to stop tracking when BLE disconnects

const stopSamplingLoop = () => {
  if (!bleState.isSamplingRef.current) {
    console.log("⚠️ Sampling already stopped. Ignoring...");
    return;
  }
  if (bleState.isTrackingRef.current) {
    console.log("🚫 Stopping location tracking...");
    bleState.isTrackingRef.current = false;
  }
  if (bleState.isSamplingRef.current) {
    bleState.isSamplingRef.current = false;
  }
  bleState.isIntentionalDisconnectRef.current = false;

  bleState.setDummyState(prev => prev + 1);

  if (bleState.locationRef?.remove) {
    bleState.locationRef.remove();
    bleState.locationRef = null;
    console.log("📡 Location listener removed.");
  }
  console.log("✅ Location tracking successfully stopped.");
}

//#4. handleLocationUpdate: Callback function when location updates in #3

// Original function with modifications
const handleLocationUpdate = async (location, setCounter, setTemperature, setAccuracy, setIconType, setIconVisible) => {
  console.log("📍📍📍📍 //#4 handleLocationUpdate:");

  try {
    // --- Pre-checks for BLE connection and sampling status ---
    if (!bleState.characteristicsRef.current) {
      console.warn("⚠️ Device disconnected or no characteristic found. Stopping updates...");
      bleState.isIntentionalDisconnectRef.current = false;
      stopSamplingLoop();
      displayErrorToast("⚠️ BLE device disconnected. Data recording stopped.", 5000);
      // *** MODIFICATION 1: Show Red Icon ***
      setIconType('red');
      setIconVisible(true);
      return; // Exit if BLE device is not connected
    }

    if (!bleState.isSamplingRef.current) {
      console.warn("⚠️ Sampling stopped. Ignoring BLE read.");
      // Ensure red icon is removed if sampling stopped but device was connected
      setIconVisible(false); // Hide any existing icon
      return; // Exit if sampling is not active
    }

    // --- BLE Read Operation ---
    const rawData = await bleState.characteristicsRef.current.read();
    if (!rawData.value) {
      console.error("❌ Error: No value returned in the characteristic.");
      displayErrorToast("❌ No value from BLE device. Check connection.", 3000);
      // *** MODIFICATION 2: Show Red Icon for read error ***
      setIconType('red');
      setIconVisible(true);
      return; // Exit if no data is read from BLE
    }

    const decodedValue = atob(rawData.value);
    console.log("📥 Decoded characteristic value:", decodedValue);

    const tempValue = decodedValue;
    const temperature = parseFloat(parseFloat(tempValue).toFixed(2)) || NaN;
    setTemperature(temperature); // Update temperature display regardless of database save

    const { latitude, longitude, altitude, accuracy, speed } = location.coords;
    const timestamp = Date.now();

    // Ensure bleState.lastWriteTimestampRef is initialized
    if (!bleState.lastWriteTimestampRef) {
        bleState.lastWriteTimestampRef = { current: 0 };
    }

    // Duplicate data check based on timestamp
    if (timestamp - bleState.lastWriteTimestampRef.current < 50) {
      console.warn("⚠️ Duplicate data detected! Skipping write.");
      return; // Exit if data is a duplicate
    }
    bleState.lastWriteTimestampRef.current = timestamp;

    const humInt = 0; // Humidity is fixed to 0 as per original code
    const tempInt = Math.round(temperature * 1e2);
    const latInt = Math.round(latitude * 1e7);
    const lonInt = Math.round(longitude * 1e7);
    const altInt = Math.round(altitude * 1e2);
    const accInt = Math.round(accuracy * 1e2);
    const speedInt = Math.round(speed * 1e2);

    setAccuracy(Math.round(accuracy)); // Update accuracy display regardless of database save

    // --- Database Write Operation ---
    try {
      const database = bleState.dbRef.current;
      if (!database) {
          console.error("❌ Database reference is null. Cannot write data.");
          stopSamplingLoop();
          displayErrorToast("❌ Data recording stopped! Database not available.", 5000);
          // *** MODIFICATION 3: Show Red Icon for DB null ***
          setIconType('red');
          setIconVisible(true);
          return; // Exit if database is not available
      }

      await database.runAsync(
        `INSERT INTO appData (timestamp, temperature, humidity, latitude, longitude, altitude, accuracy, speed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [timestamp, tempInt, humInt, latInt, lonInt, altInt, accInt, speedInt]
      );
      console.log("✅ Data added to database successfully.");

      // *** MODIFICATION 4: Remove Red, Show Green for 500ms ***
      setIconType('green');
      setIconVisible(true);
      setTimeout(() => {
        setIconVisible(false); // Hide green icon after 500ms
      }, 500);

      // --- ONLY Increment Counter IF Data is Successfully Saved to Database ---
      setCounter((prev) => {
        const newCounter = prev + 1;
        console.log(`✅ Updated Counter: ${newCounter}`);
        return newCounter;
      });
      // --- End Counter Increment Block ---

    } catch (dbError) {
      console.error("❌ Fatal Error inserting data into database:", dbError);
      stopSamplingLoop();
      displayErrorToast(
        "❌ ERROR: Data recording stopped! Database issue. Please restart the app.",
        15000
      );
      // Invalidate the database reference on critical database error
      console.log("🗑️ Invalidating database reference due to error.");
      bleState.dbRef.current = null;
      // *** MODIFICATION 5: Show Red Icon for DB write error ***
      setIconType('red');
      setIconVisible(true);
      return; // Exit on database write error
    }

  } catch (error) {
    // This catch block handles errors from BLE characteristic reading or any other
    // unexpected errors within the handleLocationUpdate function, before the database write attempt.
    console.error("❌ Error reading characteristic or general handleLocationUpdate error:", error);
    stopSamplingLoop();
    displayErrorToast("❌ Error reading data from BLE device. Data recording stopped.", 5000);
    // *** MODIFICATION 6: Show Red Icon for general errors ***
    setIconType('red');
    setIconVisible(true);
  }
};


//#8. Stop Sampling

export const stopSampling = async () => { 
  console.log("🛑 //#8 stopSampling -  Stopping sampling ...");

  bleState.isIntentionalDisconnectRef.current = true;
  bleState.isScanningRef.current = false;
  bleState.setDummyState(prev => prev + 1);

  if (bleState.locationRef) {
    console.log("📍 Stopping location tracking...");
    bleState.locationRef.remove();
    bleState.locationRef = null;
  }

  if (!bleState.deviceRef.current) {
    console.log("⚠️ No device connected.");
    bleState.isSamplingRef.current = false;
    bleState.setDummyState(prev => prev + 1);
    await showToastAsync("Stopped Sampling Temperature Data", 3000); // This toast is fine here
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
    console.error("❌ Disconnection error:", error);
    // Use displayErrorToast here if a critical BLE disconnect error should be shown
    // displayErrorToast("❌ Failed to disconnect BLE device.", 3000);
  }

  bleState.deviceRef.current = null;
  bleState.isSamplingRef.current = false;
  bleState.setDummyState(prev => prev + 1);
  await showToastAsync("Stopped Sampling Temperature Data", 3000);
};

//#9 confirmAndClearDatabase

export const confirmAndClearDatabase = (setDummyState, setCounter) => {
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
          
          clearDatabase(setDummyState, setCounter);
        }
      }
    ],
    { cancelable: false }
  );
};

//////////////////////////////////////////////////////////////////////////////////////////////////
//#10. clearDatabase
export const clearDatabase = async (setDummyState, setCounter) => {
  // Removed 'db' argument
  try {
    console.log("🚨 Entering function 10: Clearing database...");
    setCounter(0);

    // --- NEW DATABASE MANAGEMENT LOGIC ---
    // Get the database instance from bleState.dbRef.current
    const database = bleState.dbRef.current;

    if (!database) {
      console.warn("⚠️ Database not open/available. Cannot clear data.");
      // Use displayErrorToast as this is a critical error for the user's intent
      displayErrorToast("⚠️ Cannot clear data. Database not available. ", 5000);
      return; // Exit if database is not available
    }

    await database.runAsync("DELETE FROM appData;");
    console.log("✅ Database cleared successfully.");
    setDummyState(prev => prev + 1);
    showToastAsync("Data deleted", 2000);
  } catch (error) {
    console.error("❌ Error clearing database:", error);
    // Use displayErrorToast for persistent database errors
    displayErrorToast("❌ Error clearing database: " + error.message, 8000); // Show specific error message
    // If the database operation failed critically, invalidate the reference
    bleState.dbRef.current = null;
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
      // ✅ Request Location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location access is required to scan for BLE devices.");
        return reject(new Error("Location permission denied"));
      }

      // ✅ Ensure location services are turned ON
      const locationServicesEnabled = await Location.hasServicesEnabledAsync();
      console.log("📍 Location services enabled:", locationServicesEnabled);
      if (!locationServicesEnabled) {
        Alert.alert("Enable Location", "Please enable location services (GPS) in device settings.");
        return reject(new Error("Location services disabled"));
      }

      // ✅ BLE permissions (Android 12+)
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

      // Proceed with BLE scan
      if (bleState.isSamplingRef.current) {
        console.log("🛑 Stopping sampling before reading sensor ID...");
        await stopSampling(null); // Assuming stopSampling can handle a null argument if it doesn't need it
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
