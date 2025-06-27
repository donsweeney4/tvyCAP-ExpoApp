import { Alert, Platform, PermissionsAndroid } from "react-native";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { BleManager } from "react-native-ble-plx";
import { atob } from "react-native-quick-base64";
import { Buffer } from "buffer";
import * as SecureStore from "expo-secure-store";
import { SERVICE_UUID, CHARACTERISTIC_UUID} from "./constants";
import { showToastAsync } from "./functionsHelper";
import { bleState } from "./utils/bleState";

const manager = new BleManager();
bleState.manager = manager;

let lastWriteTimestamp = 0;

//#0 Permissions for BLE on Android 12 and higher
async function requestBluetoothPermissions() {
  if (Platform.OS === 'android' && Platform.Version >= 31) {
    const grantedScan = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      {
        title: 'Bluetooth Scan Permission',
        message: 'This app needs access to scan for BLE devices.',
        buttonPositive: 'OK',
      },
    );

    const grantedConnect = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      {
        title: 'Bluetooth Connect Permission',
        message: 'This app needs access to connect to BLE devices.',
        buttonPositive: 'OK',
      },
    );

    return grantedScan === PermissionsAndroid.RESULTS.GRANTED &&
           grantedConnect === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;
}

////////////////////////////////////////////////////////////////////////////////////////////
//#1. handleStart: scan, connect and start sampling BLE temperature sensor
      // deviceName: "quest_001" or "quest_010"

export const handleStart = async (db, deviceName, setCounter, setTemperature, setAccuracy) => {
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
    // Stop sampling and disconnect if already connected or sampling
    if (bleState.isConnectedRef.current || bleState.deviceRef.current) {
      try {
        if (bleState.deviceRef.current) {
          console.log(`🔌 Disconnecting from ${bleState.deviceRef.current.name || "unknown"}...`);
          await bleState.deviceRef.current.cancelConnection();
        }
        bleState.isConnectedRef.current = false;
        bleState.deviceRef.current = null;
      } catch (error) {
        console.warn("⚠️ Disconnect failed:", error);
      }
    }

    bleState.isScanningRef.current = true;
    bleState.setDummyState(prev => prev + 1);

    // Scan and pair to the paired sensor device
    const { connected } = await ConnectToPairedSensor(db);

    bleState.isScanningRef.current = false;
    bleState.setDummyState(prev => prev + 1);

    console.log("✅ Connect result:", connected);
    console.log("✅ Characteristic present:", !!bleState.characteristicsRef.current);

    if (connected && bleState.characteristicsRef.current) {
      bleState.isConnectedRef.current = true;

      setTimeout(() => {
        startSampling(db, setCounter, setTemperature, setAccuracy);
      }, 500);
    } else {
      await showToastAsync("Sensor not found or failed to connect", 2000);
      console.warn("⚠️ Device not found or failed to connect.");
    }
  } catch (error) {
    console.error("❌ Error in handleStart:", error);
    bleState.isScanningRef.current = false;
    bleState.setDummyState(prev => prev + 1);
    Alert.alert("Error", "Failed to start device connection.");
  }
};


/////////////////////////////////////////////////////////////////////////////////////////////
//#2. ConnectToPairedSensor: Connect to sensor device and check characteristic



export const ConnectToPairedSensor = async (db, scanTimeout = 10000) => {
  return new Promise(async (resolve, reject) => {
    let isMatchingInProgress = false;
    let resolved = false;

    const storedName = await SecureStore.getItemAsync("pairedSensorName");

    if (!storedName) {
      console.error("❌ No paired sensor name found in SecureStore.");
      return resolve({ connected: false });
    }

    console.log("🔍 Stored target name:", storedName);
    console.log("🔍 Scanning for ESP32 device with name:", storedName);

    const subscription = bleState.manager.onStateChange(async (state) => {
      if (state === "PoweredOn") {
        subscription.remove();

        bleState.manager.startDeviceScan(null, null, async (error, device) => {
          if (resolved || isMatchingInProgress) return;

          if (error) {
            console.error("❌ BLE scan error:", error);
            bleState.manager.stopDeviceScan();
            return reject(error);
          }

          if (device?.name === storedName) {
            console.log(`📡 Matching device found: ${device.name}, id: ${device.id}`);
            isMatchingInProgress = true;

            try {
              console.log(`🔌 Connecting to device: ${device.name}`);
              await device.connect();
              console.log("✅ Connected");

              try {
                console.log("🔍 Calling discoverAllServicesAndCharacteristics...");
                await device.discoverAllServicesAndCharacteristics();
                console.log("✅ Service and characteristic discovery complete.");

                const services = await device.services();
                console.log("📋 Services:");
                for (const service of services) {
                  console.log("🔹 Service UUID:", service.uuid);
                  const characteristics = await device.characteristicsForService(service.uuid);
                  for (const char of characteristics) {
                    console.log("   🔸 Characteristic UUID:", char.uuid);
                  }
                }

                // 🚧 Log intended UUIDs for validation
                console.log("🔧 Using SERVICE_UUID:", SERVICE_UUID);
                console.log("🔧 Using CHARACTERISTIC_UUID:", CHARACTERISTIC_UUID);

                bleState.manager.stopDeviceScan();
                bleState.deviceRef.current = device;

                try {
                  const characteristic = await device.readCharacteristicForService(
                    SERVICE_UUID,
                    CHARACTERISTIC_UUID
                  );
                  bleState.characteristicsRef.current = characteristic;
                } catch (charErr) {
                  console.warn("⚠️ Failed to read main characteristic:", charErr);
                  await device.cancelConnection();
                  bleState.deviceRef.current = null;
                  return resolve({ connected: false });
                }

                resolved = true;
                return resolve({ connected: true });

              } catch (discoveryError) {
                console.error("❌ Failed to discover services/characteristics:", discoveryError);
                await device.cancelConnection();
                return resolve({ connected: false });
              }

            } catch (err) {
              console.warn("⚠️ Connection error:", err);
              try {
                await device.cancelConnection();
              } catch (cleanupError) {
                console.warn("⚠️ Disconnect cleanup error:", cleanupError);
              }
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






//////////////////////////////////////////////////////////////////////////////////////////////////
//#2a ✅ Function to handle device disconnection
const handleDeviceDisconnection = async (db) => {
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
    stopSampling(db);
  }
};



//#3. Start location updates on fixed interval - called from handleStart

const startSampling = async (db, setCounter, setTemperature, setAccuracy) => {

  console.log("🚦//#3 startSampling - Entered startSampling()");

  const device = bleState.deviceRef.current;
  const isConnected = device ? await device.isConnected() : false;

  console.log("📡 Checking device connection before sampling...");
  //console.log("deviceRef:", device);
  
  //console.log("characteristicsRef:", bleState.characteristicsRef.current);

  if (!device || !isConnected) {
    console.warn("⚠️ Device is not connected. Sampling cannot start.");
    await showToastAsync("⚠️ Cannot start sampling. BLE device is not connected!", 3000);
    return;
  }

  if (!bleState.characteristicsRef.current) {
    console.warn("⚠️ No characteristic available. Cannot start sampling.");
    await showToastAsync("⚠️ Cannot start sampling. No BLE characteristic found!", 3000);
    return;
  }

  console.log("1. ble device isConnected:", isConnected);

  bleState.isSamplingRef.current = true;
  bleState.setDummyState(prev => prev + 1);


  try {
    console.log("📍📍📍📍 Setting up oneTimePos watchPositionAsync...");

//// Get the location ONCE using Location.getCurrentPositionAsync

    const oneTimePos = await Location.getCurrentPositionAsync({});
    console.log("🌍 One-time location check:", oneTimePos);

    // Check if the device is still connected before starting location tracking

//// Set up continuous loop for location tracking using Location.watchPositionAsync
//// Two parameters (object,callback), the second is the callback when location triggers

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
            return;
          }
/////////////// This is the second parameter for Location.watchPositionAsync 
/////// and is the callback function that handles location updates
/////// every time location updates

          handleLocationUpdate(db, location, setCounter, setTemperature, setAccuracy);

///////////////  

        } catch (err) {
          console.error("❌ Error inside watchPositionAsync callback:", err);
        }
      }
    );

    console.log("✅ Location tracking started successfully.");
  } catch (error) {
    console.error("❌ Error starting location tracking:", error);
    stopSamplingLoop();
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
};

//#4. handleLocationUpdate: Callback function when location updates in #3

const handleLocationUpdate = async (db, location, setCounter, setTemperature, setAccuracy) => {
  console.log("📍📍📍📍 //#4 handleLocationUpdate:", location.coords.latitude, location.coords.longitude);

  setCounter((prev) => {
    const newCounter = prev + 1;
    console.log(`✅ Updated Counter: ${newCounter}`);
    return newCounter;
  });

  try {
    if (!bleState.characteristicsRef.current) {
      console.warn("⚠️ Device disconnected or no characteristic found. Stopping updates...");
      bleState.isIntentionalDisconnectRef.current = false;
      stopSamplingLoop();
      return;
    }

    if (!bleState.isSamplingRef.current) {
      console.warn("⚠️ Sampling stopped. Ignoring BLE read.");
      return;
    }

    const rawData = await bleState.characteristicsRef.current.read();
    if (!rawData.value) {
      console.error("❌ Error: No value returned in the characteristic.");
      return;
    }

    const decodedValue = atob(rawData.value);
    console.log("📥 Decoded characteristic value:", decodedValue);

    const tempValue = decodedValue;
    const temperature = parseFloat(parseFloat(tempValue).toFixed(2)) || NaN;
    setTemperature(temperature);
    console.log(`🌡 Temperature: ${temperature}°C`);

    const { latitude, longitude, altitude, accuracy, speed } = location.coords;
    const timestamp = Date.now();

    if (timestamp - lastWriteTimestamp < 50) {
      console.warn("⚠️ Duplicate data detected! Skipping write.");
      return;
    }
    lastWriteTimestamp = timestamp;

    const humInt = 0;
    const tempInt = Math.round(temperature * 1e2);
    const latInt = Math.round(latitude * 1e7);
    const lonInt = Math.round(longitude * 1e7);
    const altInt = Math.round(altitude * 1e2);
    const accInt = Math.round(accuracy * 1e2);
    const speedInt = Math.round(speed * 1e2);

    setAccuracy(Math.round(accuracy));

    try {
      const database = await db;
      await database.runAsync(
        `INSERT INTO appData (timestamp, temperature, humidity, latitude, longitude, altitude, accuracy, speed) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [timestamp, tempInt, humInt, latInt, lonInt, altInt, accInt, speedInt]
      );
      console.log("✅ Data added to database successfully.");
    } catch (error) {

      await showToastAsync("ERROR - Data stopped recording \n  Stop scanning, \n  Submit current data \
        \n  Reload App\n  Change member number\n  Continue", 10000);

      console.error("❌ Error inserting data into database:", error);
      stopSamplingLoop();      
    }
   
  } catch (error) {
    console.error("❌ Error reading characteristic:", error);
  }
};

//#8. Stop Sampling
export const stopSampling = async (db) => {
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
  }

  if (!db) {
    console.log("🔄 Re-opening database...");
    db = await SQLite.openDatabaseAsync("appData.db");
  }


  

  bleState.deviceRef.current = null;
  bleState.isSamplingRef.current = false;
  bleState.setDummyState(prev => prev + 1);
  await showToastAsync("Stopped Sampling Temperature Data", 3000);
};

//#9 confirmAndClearDatabase
export const confirmAndClearDatabase = (db, setDummyState, setCounter, clearDatabaseFn) => {
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
          clearDatabaseFn(db, setDummyState, setCounter);
        }
      }
    ],
    { cancelable: false }
  );
};

//////////////////////////////////////////////////////////////////////////////////////////////////
//#10. clearDatabase
export const clearDatabase = async (db, setDummyState, setCounter) => {
  try {
    console.log("🚨 Clearing database...");
    setCounter(0);
    await db.runAsync("DELETE FROM appData;");
    console.log("✅ Database cleared successfully.");
    setDummyState(prev => prev + 1);
    showToastAsync("Data deleted", 2000);
  } catch (error) {
    console.error("❌ Error clearing database:", error);
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////
//#11. GetPairedSensorID, save unique device ID (ie, the paired sensor ID) 
// in SecureStore.  Exit funtion in disconnected state   


export const GetPairedSensorName = async (scanTimeout = 10000) => {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Stop sampling if active
      if (bleState.isSamplingRef.current) {
        console.log("🛑 Stopping sampling before reading sensor ID...");
        await stopSampling(null);
      }

      // 2. Disconnect if connected
      if (bleState.deviceRef.current) {
        try {
          const isConnected = await bleState.deviceRef.current.isConnected();
          if (isConnected) {
            console.log("🔌 Disconnecting from current device...");
            await bleState.deviceRef.current.cancelConnection();
          }
        } catch (err) {
          console.warn("⚠️ Disconnect error:", err);
        }
        bleState.deviceRef.current = null;
      }

      console.log("🔍 Scanning for BLE devices...");

      let scanTimeoutHandle;
      let scanResolved = false;

      const subscription = bleState.manager.onStateChange(async (state) => {
        if (state === "PoweredOn") {
          subscription.remove();

          showToastAsync("Start scanning for BLE devices", 2000);

          bleState.manager.startDeviceScan(null, null, async (error, device) => {
            if (error || scanResolved) return;

            const name = device?.name || "";
            const id = device?.id || "(no id)";
            console.log("🔎 Found device:", name, id);

    // Search pattern filter for device           
            const questPattern = /^[qQ]uest.*/;



            if (questPattern.test(name)) {
              showToastAsync(`Found device: ${name}`, 2000);
              scanResolved = true;
              clearTimeout(scanTimeoutHandle);
              bleState.manager.stopDeviceScan();
              console.log("🔍 Stopping scan for quest_nnn device:", name);
              try {
                await device.connect();

                console.log("Print the discovered services and characteristics");
                

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
                showToastAsync("Sensor name ${name} saved to SecureStore", 3000);

                await device.cancelConnection();
                bleState.deviceRef.current = null;

                return resolve(true);
              } catch (connectError) {
                console.error("❌ Connection or read error:", connectError);
                return reject(connectError);
              }
            }
          });

          // Timeout handler
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
