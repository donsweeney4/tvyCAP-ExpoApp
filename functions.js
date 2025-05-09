import { Alert, Platform, PermissionsAndroid } from "react-native";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system";
import { BleManager } from "react-native-ble-plx";
import * as SQLite from 'expo-sqlite';
import { atob } from "react-native-quick-base64"; 
import { TARGET_CHARACTERISTIC_UUID } from "./constants";
import {showToastAsync} from "./functionsHelper";


let locationRef = null;
let isTrackingRef = { current: false };
let isSamplingRef = { current: false };

const manager = new BleManager();

let lastWriteTimestamp = 0; // Global variable to track last write timestamp

/////////////////////////////////////////////////////////

//#0 Permissions for BLE on Android 12 and higher
async function requestBluetoothPermissions() {
  if (Platform.OS === 'android' && Platform.Version >= 31) {  // Android 12 or higher
      const grantedScan = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          {
              title: 'Bluetooth Scan Permission',
              message: 'This app needs access to scan for BLE devices.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
          },
      );

      const grantedConnect = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          {
              title: 'Bluetooth Connect Permission',
              message: 'This app needs access to connect to BLE devices.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
          },
      );

      return grantedScan === PermissionsAndroid.RESULTS.GRANTED &&
             grantedConnect === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;  // For Android < 12 or iOS
}



//#1. handleStart: scan, connect and start sampling BLE temperature sensor
export const handleStart = async (
  db,
  deviceName,
  deviceRef,
  isScanningRef,
  isConnectedRef,
  isIntentionalDisconnectRef,
  characteristicsRef,
  setCounter,
  setTemperature,
  setAccuracy, 
  isSamplingRef,
  latestLocationRef,
  locationRef,
  isTrackingRef,
  setDummyState,
  setIsFallbackConnection // ⬅️ NEW: React state setter
) => {
  console.log(`🚀 handleStart triggered, looking for ${deviceName}`);

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
    // Disconnect if already connected
    if (isConnectedRef.current || deviceRef.current) {
      try {
        if (deviceRef.current) {
          console.log(`🔌 Disconnecting from ${deviceRef.current.name || "unknown"}...`);
          await deviceRef.current.cancelConnection();
          console.log("✅ Disconnected successfully.");
        }
        isConnectedRef.current = false;
        deviceRef.current = null;
      } catch (error) {
        console.warn("⚠️ Disconnect failed:", error);
      }
    }

    await showToastAsync(`Scanning for ${deviceName}...`, 2000);
    isScanningRef.current = true;
    setDummyState(prev => prev + 1);

    const { connected, usedFallback } = await connectToPrimaryOrSecondaryDevice(
      db,
      manager,
      deviceRef,
      isScanningRef,
      isConnectedRef,
      isIntentionalDisconnectRef,
      characteristicsRef,
      setDummyState,
      deviceName
    );

    isScanningRef.current = false;
    setDummyState(prev => prev + 1);

    if (connected && characteristicsRef.current) {
      isConnectedRef.current = true;
      setIsFallbackConnection(usedFallback); // ✅ Flag for UI

      if (usedFallback) {
        await showToastAsync("🟡 Connected using fallback name. Please assign a new name.", 3000);
      } else {
        await showToastAsync("✅ Sensor connected, starting sampling", 2000);
      }

      setTimeout(() => {
        startSampling(
          db,
          characteristicsRef,
          setCounter,
          setTemperature,
          setAccuracy,
          isSamplingRef,
          isTrackingRef,
          setDummyState,
          isIntentionalDisconnectRef,
          deviceRef
        );
      }, 500);
    } else {
      await showToastAsync("❌ Sensor not found or failed to connect", 2000);
      setIsFallbackConnection(false); // reset
    }
  } catch (error) {
    console.error("❌ Error in handleStart:", error);
    isScanningRef.current = false;
    setDummyState(prev => prev + 1);
    Alert.alert("Error", "Failed to start device connection.");
  }
};



//#2. connectToPrimaryOrSecondaryDevice: Connect to device and check characteristic
const connectToPrimaryOrSecondaryDevice = async (
  db,
  manager,
  deviceRef,
  isScanningRef,
  isConnectedRef,
  isIntentionalDisconnectRef,
  characteristicsRef,
  setDummyState,
  knownPrimaryName = null
) => {
  return new Promise((resolve, reject) => {
    const secondaryName = "default_001";
    let connected = false;
    let usedFallback = false;

    const subscription = manager.onStateChange(async (state) => {
      if (state === "PoweredOn") {
        subscription.remove();

        manager.startDeviceScan(null, null, async (error, device) => {
          if (error) {
            console.error("❌ BLE scan error:", error);
            reject(error);
            return;
          }

          const deviceName = device.name || device.localName || "";

          const isPrimaryMatch = knownPrimaryName && deviceName === knownPrimaryName;
          const isSecondaryMatch = deviceName === secondaryName;

          if (!connected && (isPrimaryMatch || isSecondaryMatch)) {
            console.log(`📡 Found target device: ${deviceName}`);
            manager.stopDeviceScan();

            const success = await connectToDevice(
              db,
              device,
              deviceRef,
              isScanningRef,
              isConnectedRef,
              isIntentionalDisconnectRef,
              characteristicsRef,
              setDummyState
            );

            if (success) {
              connected = true;
              usedFallback = isSecondaryMatch;
              resolve({ connected, usedFallback });
            } else {
              resolve({ connected: false, usedFallback: false });
            }
          }
        });

        setTimeout(() => {
          if (!connected) {
            manager.stopDeviceScan();
            console.warn("⌛ Scan timeout - no matching device found.");
            resolve({ connected: false, usedFallback: false });
          }
        }, 15000);
      }
    }, true);
  });
};



//#2a ✅ Function to handle device disconnection
const handleDeviceDisconnection = async (
  db,
  deviceRef,
  isScanningRef,
  isConnectedRef,
  isIntentionalDisconnectRef,
  characteristicsRef,
  setDummyState
) => {
  console.log(`🔌 Device disconnected. `);

  // Reset device references and status
  isScanningRef.current = false;
  isConnectedRef.current = false;
  deviceRef.current = null;
  characteristicsRef.current = null;
  setDummyState(prev => prev + 1); // Trigger UI update

  await showToastAsync("⚠️ Sensor disconnected! Press start to reconnect.", 2000);

  if (isSamplingRef.current) { 
    console.log("🛑 Stopping due to disconnection...");
    stopSampling(
        db, 
        deviceRef, 
        isScanningRef, 
        isIntentionalDisconnectRef, 
        isSamplingRef, 
        isTrackingRef, 
        setDummyState
    );
  }
};



//#3. Start location updates on fixed interval - called from handleStart
const startSampling = async (
  db,
  characteristicsRef,
  setCounter,
  setTemperature,
  setAccuracy,
  isSamplingRef, 
  isTrackingRef,
  setDummyState,
  isIntentionalDisconnectRef,
  deviceRef 
) => {
  if (!deviceRef.current || !(await deviceRef.current.isConnected())) {
    console.warn("⚠️ Device is not connected. Sampling cannot start.");
    await showToastAsync("⚠️ Cannot start sampling. BLE device is not connected!", 2000);
    return;
  }

  isTrackingRef.current = true;
  isSamplingRef.current = true;
  setDummyState(prev => prev + 1);
  console.log("✅ Sampling started...");


  try {
    console.log("Starting location tracking function");
    locationRef = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,   // milliseconds
        distanceInterval: 0,
        mayShowUserSettingsDialog: true,
      },
      (location) => {
        if (!deviceRef.current) {
          console.warn("⚠️ Device disconnected. Stopping location tracking.");
          isIntentionalDisconnectRef.current = false;  
          stopSamplingLoop(
                  isTrackingRef, 
                  isSamplingRef, 
                  setDummyState, 
                  locationRef, 
                  isIntentionalDisconnectRef);
          return;

        }

        handleLocationUpdate(
              db,
              location, 
              characteristicsRef, 
              setCounter, 
              setTemperature,
              setAccuracy,
              isIntentionalDisconnectRef,
              isSamplingRef,
              setDummyState
        );
      }
    );
    console.log("✅ Location tracking started successfully.");
  } catch (error) {
    console.error("❌ Error starting location tracking:", error);
    stopSamplingLoop(
      isTrackingRef, 
      isSamplingRef, 
      setDummyState, 
      locationRef, 
      isIntentionalDisconnectRef);
  }
};

//#3a ✅ Helper function to stop tracking when BLE disconnects
const stopSamplingLoop = (
                          isTrackingRef, 
                          isSamplingRef, 
                          setDummyState, 
                          locationRef, 
                          isIntentionalDisconnectRef) => {
  if (!isSamplingRef.current) {
    console.log("⚠️ Sampling already stopped. Ignoring...");
    return;
  }                          
  if (isTrackingRef.current) {
    console.log("🚫 Stopping location tracking...");
    isTrackingRef.current = false;
  }
  if (isSamplingRef.current) {
    isSamplingRef.current = false;
  }
  
  if (isIntentionalDisconnectRef) {
    isIntentionalDisconnectRef.current = false;  // ✅ Ensure the reference is valid before using it
  }

  setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI

  if (locationRef?.current) {
    locationRef.current.remove();
    locationRef.current = null;
    console.log("📡 Location listener removed.");
  }

  console.log("✅ Location tracking successfully stopped.");
};


//#4. handleLocationUpdate: Callback function when location updates
//     Read sensor, add location, update counter and update database
const handleLocationUpdate = async (
  db,
  location, 
  characteristicsRef, 
  setCounter, 
  setTemperature,
  setAccuracy,
  isIntentionalDisconnectRef,
  isSamplingRef,
  setDummyState
) => {

  //if (!isTrackingRef.current) {
  //  console.log("Location update received, but tracking is stopped. Ignoring.");
  //  return;
  //}

  console.log("📍 New location:", location.coords.latitude, location.coords.longitude);

  setCounter((prev) => {
    const newCounter = prev + 1;
    console.log(`✅ Updated Counter: ${newCounter}`);
    return newCounter;
  });
   
  try {
    const deccodedValue = "0"; // placeholder
    // Read sensor data
    try {

      if (!characteristicsRef.current) { //|| !deviceRef.current) {
        console.warn("⚠️ Device disconnected or no characteristic found. Stopping updates...");
        isIntentionalDisconnectRef.current = false;  
        stopSamplingLoop(
          isTrackingRef, 
          isSamplingRef, 
          setDummyState, 
          locationRef, 
          isIntentionalDisconnectRef
        );
        return;
      }
      
      console.log("🔍 Reading characteristic...");
      
      isIntentionalDisconnectRef = false;

      if (!isSamplingRef.current) {
        console.warn("⚠️ Sampling stopped. Ignoring BLE read.");
        return;
      }

 // ✅ Read characteristic data
      const rawData = await characteristicsRef.current.read();
    
      // ✅ Debug: Print the full characteristic response
      //console.log("✅ Characteristic read response:", rawData);
    
      // ✅ Ensure the `value` property exists
      if (!rawData.value) {
        console.error("❌ Error: No value returned in the characteristic.");
        return;
      }
    
      // ✅ Decode Base64 value
      decodedValue = atob(rawData.value);
      console.log("📥 Decoded characteristic value:", decodedValue);
    
    } catch (error) {
      console.error("❌ Error reading the characteristic:", error);
    }
    
              //   const [tempValue, humValue] = decodedValue.split(",");

      const tempValue = decodedValue; 
    // Convert sensor data
    const temperature = parseFloat(parseFloat(tempValue).toFixed(2)) || NaN;
    
    //const temperatureF = parseFloat(parseFloat(tempValue*1.8+32).toFixed(2)) || NaN;
    setTemperature( temperature  );

    console.log(`🌡 Temperature: ${temperature}°C`);
    //console.log(`🌡 TemperatureF: ${temperatureF}°F`);

    // Extract GPS data
    const { latitude, longitude, altitude,accuracy, speed } = location.coords;
    const timestamp = Date.now();

  // Prevent duplicate writes occurring within 50ms 
if (timestamp - lastWriteTimestamp < 50) {
  console.warn("⚠️ Duplicate data detected! Skipping write.");
  return;
}
lastWriteTimestamp = timestamp;  

  // Convert all data to integers for SQLite storage

    const humInt =  0;    //Math.round(parseFloat(humValue)) || NaN;
    const tempInt = Math.round(temperature * 1e2);
    const latInt = Math.round(latitude * 1e7);
    const lonInt = Math.round(longitude * 1e7);
    const altInt = Math.round(altitude * 1e2);
    const accInt = Math.round(accuracy*1e2);
    const speedInt = Math.round(speed * 1e2);

    setAccuracy(Math.round(accuracy));

    console.log(`📌 Data Entry:  ${timestamp}, ${tempInt},${humInt}, ${latInt}, ${lonInt}, ${altInt},${accInt} ${speedInt}`);

    // ✅ Insert data into SQLite (Async)
    try {
      const database = await db;
      await database.runAsync(
        `INSERT INTO appData (timestamp, temperature, humidity, latitude, longitude, altitude, accuracy, speed) 
         VALUES ( ?, ?, ?, ?, ?, ?, ?, ?);`,
        [timestamp, tempInt,humInt, latInt, lonInt, altInt,accInt, speedInt]
      );
      console.log("✅ Data added to database successfully.");
    } catch (error) {
      console.error("❌ Error inserting data into database:", error);
    }

  } catch (error) {
    console.error("❌ Error reading characteristic:", error);
  }
};


//#8. Stop Sampling
export const stopSampling = async (
                db,
                deviceRef, 
                isScanningRef, 
                isIntentionalDisconnectRef,
                isSamplingRef,
                isTrackingRef,
                setDummyState) => {
  console.log("🛑 Stopping sampling...");
  isIntentionalDisconnectRef.current = true;
  isScanningRef.current = false;
  setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI


  if (locationRef) {
    console.log("📍 Stopping location tracking...");
    locationRef.remove();
    locationRef = null;
    isTrackingRef.current = false;
  }

  if (!deviceRef.current) {
    console.log("⚠️ No device connected.");
    isSamplingRef.current = false;
    setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI
    return;
  }

  try {
    const isConnected = await deviceRef.current.isConnected();
    if (isConnected) {
      console.log("🔌 Disconnecting BLE device...");
      await deviceRef.current.cancelConnection();
      console.log("✅ Device disconnected.");
    }
  } catch (error) {
    console.error("❌ Disconnection error:", error);
  }

  if (!db) {
    console.log("🔄 Re-opening database...");
    db = await SQLite.openDatabaseAsync("appData.db");
  }

  deviceRef.current = null;
  isSamplingRef.current = false;
  setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI
  await showToastAsync('Stop Sampling Data',2000);
  return;
};

//#9 confirmAndClearDatabase

export const confirmAndClearDatabase = (
        db, 
        setDummyState, 
        setCounter, 
        clearDatabase,
        deviceRef, 
        isScanningRef, 
        isIntentionalDisconnectRef,
        isSamplingRef,
        isTrackingRef, 
  ) => {

  if (isSamplingRef.current) {
      showToastAsync("Sampling in Progress.  Stop sampling before clearing data.", 2000);
      return;
  }

  Alert.alert(
    "Confirm Action",
    "Are you sure you want to clear the database?", // Message
    [
      {
        text: "Cancel",
        style: "cancel"
      },
      {
        text: "Yes, Clear Data",
        onPress: () => {clearDatabase(
            db, 
            setDummyState, 
            setCounter, 
            clearDatabase,
            deviceRef, 
            isScanningRef, 
            isIntentionalDisconnectRef,
            isSamplingRef,
            isTrackingRef
          ); // Call the function to clear the database
        }
      }
    ],
    { cancelable: false } // Prevents dismissing the alert without choosing an option
  );
};

//#10. clearDatabase
 
export const clearDatabase = async (
  db, 
  setDummyState, 
  setCounter, 
  clearDatabase,
  deviceRef, 
  isScanningRef, 
  isIntentionalDisconnectRef,
  isSamplingRef,
  isTrackingRef,  
  ) => {
  try {
    console.log("🚨 Clearing database...");      
    setCounter(0)
    await db.runAsync("DELETE FROM appData;");
    console.log("✅ Database cleared successfully.");
    
    setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI
  
    showToastAsync(" Data deleted ", 2000); 
  
  } catch (error) {
    console.error("❌ Error clearing database:", error);
  }
} ;

