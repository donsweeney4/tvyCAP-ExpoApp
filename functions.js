import { Alert, Platform, PermissionsAndroid , Linking} from "react-native";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { BleManager } from "react-native-ble-plx";
import * as MailComposer from 'expo-mail-composer';
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
  setDummyState
) => {
  console.log(`🚀 handleStart triggered, looking for ${deviceName}`);

  // ✅ Request location permission
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Permission Denied", "Location access is required for tracking.");
    return;
  }
  console.log("✅ Location permission granted.");

  // ✅ Request Bluetooth permissions (Android 12+)
  const blePermissionsGranted = await requestBluetoothPermissions();

  try {
    // ✅ Disconnect existing connection before scanning
    if (isConnectedRef.current || deviceRef.current) {
      try {
        if (deviceRef.current) {
          console.log(`🔌 Disconnecting from ${deviceRef.current.name || "unknown device"}...`);
          await deviceRef.current.cancelConnection();
          console.log("✅ Device disconnected successfully.");
        }
        isConnectedRef.current = false;
        deviceRef.current = null;
      } catch (error) {
        console.warn("⚠️ Failed to disconnect:", error);
      }
    }

    // ✅ Start scanning for BLE device
    await showToastAsync(`Starting scan for ${deviceName}!`, 2000);
    isScanningRef.current = true;
    setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI

    // ✅ Set scan timeout
    const scanTimeout = setTimeout(async () => {
      console.log("⏳ Scan timeout reached. Stopping scan.");
      await showToastAsync("Sensor not found!!! Check sensor and restart this App", 2000);
      manager.stopDeviceScan();
      isScanningRef.current = false;
      setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI
    }, 10000);

    // ✅ Handle device discovery
    const handleDeviceFound = async (device) => {
      console.log(`🔍 Found device: ${device.name || device.localName}. Stopping scan.`);
      clearTimeout(scanTimeout);
      manager.stopDeviceScan();
      isScanningRef.current = false;

      console.log("🔗 Connecting to device...");
      const connected = await connectToDevice(
        db,
        device,
        deviceRef,
        isScanningRef,
        isConnectedRef,
        isIntentionalDisconnectRef,
        characteristicsRef,
        setDummyState
      );

      if (connected && characteristicsRef.current) {
        isConnectedRef.current = true;
        await showToastAsync("✅ Sensor found, starting sampling", 2000);

        setTimeout(() => {
          console.log("🚀 Calling startSampling...");
          startSampling(db, 
            characteristicsRef, 
            setCounter, 
            setTemperature, 
            setAccuracy, 
            isSamplingRef, 
            isTrackingRef,
            setDummyState,
            isIntentionalDisconnectRef,
            deviceRef);
        }, 500);
      } else {
        console.warn("⚠️ Device connected, but no characteristic found.");
        await showToastAsync("⚠️ Device connected but no characteristic found!", 2000);
      }
    };

    // ✅ Start scanning
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error("Error during scanning:", error);
        clearTimeout(scanTimeout);
        manager.stopDeviceScan();
        isScanningRef.current = false;
        setDummyState(prev => prev + 1); // ✅ Trigger re-render to update UI
        Alert.alert("Error", "Failed to scan for devices.");
        return;
      }

      if (device?.name === deviceName || device?.localName === deviceName) {
        handleDeviceFound(device);
        deviceRef.current = device;
      }
    });
  } catch (error) {
    console.error("Error during start:", error);
    isScanningRef.current = false;
  }
};


//#2. connectToDevice: Connect to device and check characteristic
const connectToDevice = async (
  db,
  device,
  deviceRef,
  isScanningRef,
  isConnectedRef,
  isIntentionalDisconnectRef,
  characteristicsRef,
  setDummyState
) => {
  console.log(`🔗 Connecting to ${device.name || device.localName}...`);

  try {
    if (Platform.OS === "android") {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
    }

    if (await device.isConnected()) {
      console.log("⚠️ Device is already connected. Skipping connection.");
      return true;
    }

    const connectedDevice = await device.connect();
    if (!connectedDevice) {
      console.error("❌ Failed to connect to device.");
      Alert.alert("Error", "Could not connect to device.");
      return false;
    }
    console.log("✅ Device connected.");

    await connectedDevice.discoverAllServicesAndCharacteristics();
    const services = await connectedDevice.services();
    
    let characteristicFound = false;
    for (const service of services) {
      console.log(`🔍 Service found: ${service.uuid}`);
      const characteristics = await service.characteristics();
      for (const characteristic of characteristics) {
        console.log(`   🔹 Characteristic found: ${characteristic.uuid}`);

        if (characteristic.uuid.toLowerCase() === TARGET_CHARACTERISTIC_UUID.toLowerCase()) {
          characteristicsRef.current = characteristic;
          characteristicFound = true;
          console.log(`✅ Target characteristic found: ${characteristic.uuid}`);
          break;
        }
      }
      if (characteristicFound) break;
    }

    if (!characteristicFound) {
      console.error("❌ Target characteristic not found.");
      Alert.alert("Error", "Failed to find the target characteristic.");
      return false;
    }

    deviceRef.current = connectedDevice;
    isConnectedRef.current = true;

    deviceRef.current.onDisconnected(() => {
      handleDeviceDisconnection(
        db,
        deviceRef,
        isScanningRef,
        isConnectedRef,
        isIntentionalDisconnectRef,
        characteristicsRef,
        setDummyState
      );
      
      stopSamplingLoop(
                isTrackingRef, 
                isSamplingRef, 
                setDummyState, 
                locationRef, 
                isIntentionalDisconnectRef // ✅ Now explicitly passed
      );
      
    });

    return true;
  } catch (error) {
    console.error("❌ Error connecting to device:", error);
    Alert.alert("Connection Error", "Failed to connect to the device.");
    return false;
  }
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

/*  NOT USED SHARE FILE
                      //#5. Share File
                      export const shareFile = async (dataFilePath) => { // Removed unused parameters
                        try {
                          if (await FileSystem.getInfoAsync(dataFilePath).exists) {
                            if (await Sharing.isAvailableAsync()) {
                              await Sharing.shareAsync(dataFilePath, { mimeType: "text/csv" });
                            } else {
                              Alert.alert("Sharing Not Available", "File sharing is not supported on this platform.");
                            }
                          } else {
                            Alert.alert("No File Found", "The log file does not exist.");
                          }
                        } catch (error) {
                          console.error("Error sharing file:", error);
                        }
                      };
*/



//================
//#6 📌NOT USED  --  Function to trigger email on Android using Linking (Intent-based approach)
const sendEmailAndroid = async (emailAddress, shareablePath) => {
  const subject = "Sensor Data Backup";
  const body = "Attached is the sensor data CSV file.";
  
  const emailUrl = `mailto:${emailAddress}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  
  try {
    await Linking.openURL(emailUrl);
    console.log("✅ Email intent triggered successfully on Android.");
  } catch (error) {
    console.error("❌ Error triggering email intent on Android:", error);
    Alert.alert("Error", "Unable to send email.");
  }
};
//===============

//#7. Email Database
export const emailDatabase = async (
  dbFilePath,
  jobcodeRef,
  emailAddress,
  isSamplingRef) => {
  try { 
    console.log(`Emailing database file. Sampling is ${isSamplingRef.current}`);
    
    // ✅ Check if sampling is in progress
    if (isSamplingRef.current) {
      await showToastAsync("Sampling in Progress. Stop sampling before sending email.", 2000);
      return;
    }

    // ✅ Check if Mail Composer is available (iOS and Android check)
    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable && Platform.OS === 'ios') {  // Only warn if on iOS
      Alert.alert("Error", "Mail Composer is not available.");
      return;
    }

    // ✅ Check if dbFilePath is valid
    if (!dbFilePath || typeof dbFilePath !== "string") {
      console.error("❌ Error: dbFilePath is not set or invalid:", dbFilePath);
      Alert.alert("Error", "Database file path is invalid.");
      return;
    }
    
    // ✅ Check if the database file exists
    const fileExists = await FileSystem.getInfoAsync(dbFilePath);
    if (!fileExists.exists) {
      console.warn("⚠️ Database file does not exist. Skipping database operations.");
      Alert.alert("Error", "Database file not found.");
      return;
    }

    console.log("📂 Database file exists, proceeding with data operations.");
    
    let attachmentPath = dbFilePath; // Default to database file
    let fileType = "database";

    // ✅ Open database only if it exists
    const db = await SQLite.openDatabaseAsync("appData.db");

    // ✅ Check if columns exist before modifying the table
    const checkColumnExists = async (columnName) => {
      const result = await db.getAllAsync(`PRAGMA table_info(appData);`);
      return result.some(row => row.name === columnName);
    };

    if (!(await checkColumnExists("jobcode"))) {
      await db.execAsync(`ALTER TABLE appData ADD COLUMN jobcode TEXT;`);
    }
    await db.runAsync(`UPDATE appData SET jobcode = ?`, [jobcodeRef.current]);

    if (!(await checkColumnExists("rownumber"))) {
      await db.execAsync(`ALTER TABLE appData ADD COLUMN rownumber INTEGER;`);
    }
    await db.runAsync(
      `UPDATE appData 
       SET rownumber = rowid - (SELECT MIN(rowid) FROM appData) + 1;`
    );

    // ✅ Fetch data after updates
    const appData = await db.getAllAsync("SELECT * FROM appData;");
    if (appData.length === 0) {
      Alert.alert("No Data", "There is no data in the database.");
      return;
    }

    console.log("📊 Fetched data from database", jobcodeRef);
    jobcode = jobcodeRef.current;

    // ✅ Convert data to CSV format
    const csvHeader = "rownumber,jobcode,Timestamp,Local Date,Local Time,Temperature (°C),Humidity (%),Latitude,Longitude,Altitude (m),Accuracy (m),Speed (MPH)\n";
    const csvBody = appData
      .map(({ rownumber, jobcode, timestamp, temperature, humidity, latitude, longitude, altitude, accuracy, speed }) => {
        const dateObj = new Date(timestamp);
        const localDate = dateObj.toLocaleDateString();
        const localTime = dateObj.toLocaleTimeString([], { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const speedMph = ((speed * 1e-2) * 2.23694).toFixed(2); // Convert to MPH

        return `${rownumber},${jobcode},${timestamp},${localDate},${localTime},${(temperature * 1e-2).toFixed(2)},${humidity.toFixed(1)},${(latitude * 1e-7).toFixed(6)},${(longitude * 1e-7).toFixed(6)},${(altitude * 1e-2).toFixed(2)},${(accuracy * 1e-2).toFixed(2)},${speedMph}`;
      })
      .join("\n");

    const csvContent = csvHeader + csvBody;

    // ✅ Save CSV file in a shareable directory (Works on both Android and iOS)
    const shareablePath = FileSystem.cacheDirectory + `${jobcode}.csv`;
    

    await FileSystem.writeAsStringAsync(shareablePath, csvContent, { encoding: FileSystem.EncodingType.UTF8 });
    fileType = "csv";
    console.log(`📁 CSV file saved at: ${shareablePath}`);

    // ✅ Read and print the contents of the saved CSV file
    try {
      const fileContents = await FileSystem.readAsStringAsync(shareablePath, { encoding: FileSystem.EncodingType.UTF8 });
  //  console.log("📄 CSV File Contents:\n", fileContents);
    } catch (error) {
      console.error("❌ Error reading CSV file for debug:", error);
    }

   // ✅ Handle attachment URI differently for Android 
   let finalAttachmentUri = shareablePath;  //  for iOS

  if (Platform.OS === 'android') {
    await shareToDriveWithAttachment(emailAddress, shareablePath)
  }

 

// Now use finalAttachmentUri in composeAsync:
    if (Platform.OS === 'ios') {
          const emailResponse = await MailComposer.composeAsync({
          recipients: [emailAddress],
          subject: "Sensor Data Backup",
          body: "Attached is the sensor data CSV file.",
          attachments: [finalAttachmentUri], // uses content URI on Android, file path on iOS
        });
        console.log("📧 Email response:", emailResponse)  ;
      }
    
   // ✅ Delete the temporary CSV file after sharing
        // Note: FileSystem.deleteAsync will not work with content URIs on Android
        // Use the shareablePath directly for deletion 
        await FileSystem.deleteAsync(shareablePath, { idempotent: true });
        console.log("🗑️ Temporary CSV file deleted.");
        await db.closeAsync();
    
  } catch (error) {
    console.error("❌ Error sharing or sending email:", error);
    Alert.alert("Error", "Failed to share or send email.");
  }
};

//#7a. shareToDriveWithAttachment for Android
async function shareToDriveWithAttachment(emailAddress, shareablePath) {
  let finalAttachmentUri = shareablePath;

  // Debug: File info before sending
  const originalFileInfo = await FileSystem.getInfoAsync(shareablePath);
  console.log("Original file info:", originalFileInfo);
  await showToastAsync("For Android - Share data to your Google Drive", 4000);

  await Sharing.shareAsync(shareablePath, { mimeType: "text/csv" });
}
  
  
  
  
 /*  
 
 // Debug: Check MailComposer availability (Android)
  if (Platform.OS === 'android') {
      const isAvailable = await MailComposer.isAvailableAsync();
      console.log("MailComposer available on Android:", isAvailable);
      if (!isAvailable) {
          Alert.alert("Error", "Mail Composer is not available on this device.");
          return;
      }
  }

  console.log("🚀 About to call MailComposer.composeAsync...");

  const composePromise = MailComposer.composeAsync({
      recipients: [emailAddress],
      subject: "Sensor Data Backup",
      body: "Attached is the sensor data CSV file.",
      attachments: [finalAttachmentUri],
  });

  try {
      const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error("MailComposer.composeAsync timed out")), 15000); // 15 seconds timeout
      });

      const emailResponse = await Promise.race([composePromise, timeoutPromise]);

      console.log("📧 Email sent/result (inside try):", emailResponse);
      console.log("📧 Email Response (inside try):", JSON.stringify(emailResponse));

  } catch (error) {
      console.error("❌ Error sending Android email:", error);
      Alert.alert("Error", "Failed to send email: " + error.message);
  }

  console.log("🚀 After await MailComposer.composeAsync (outside try):");
  console.log("🚀 Full emailResponse (outside try):", JSON.stringify(emailResponse)); // Ensure emailResponse is defined here
}
 */

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

