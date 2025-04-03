import React, { useEffect, useState, useRef, useCallback } from "react";
import { useKeepAwake } from "expo-keep-awake";
import {
  StyleSheet,
  Text,
  Alert,
  View,
  Dimensions,
  Platform,
  Image,
} from "react-native";

import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect } from "@react-navigation/native";
import { Button } from 'react-native-elements';
import * as SQLite from "expo-sqlite";

import { handleStart, emailDatabase, stopSampling, confirmAndClearDatabase,clearDatabase } from "./functions";
import { showToastAsync } from "./functionsHelper";

import  {VERSION} from "./constants";

//#1 **** MainScreen: start of EXPO component ****/
export default function MainScreen() {
  const [db, setDb] = useState(null);
  const [dbFilePath, setDbFilePath] = useState(null);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [deviceName, setDeviceName] = useState(null);
  const [emailAddress, setEmailAddress] = useState("default@example.com");
  const [counter, setCounter] = useState(0);
  const [temperature, setTemperature] = useState(NaN);
  const [accuracy, setAccuracy] = useState(NaN);
  const [dummyState, setDummyState] = useState(0); // ✅ State used to trigger re-render

  const jobcodeRef = useRef(null);
  const locationRef = useRef(null);
  const latestLocationRef = useRef(null);
  const isTrackingRef = useRef(false);

  const characteristicsRef = useRef(null);
  const counterRef = useRef(0);
  const isScanningRef = useRef(false);
  const isConnectedRef = useRef(false);
  const isSamplingRef = useRef(false);
  const isIntentionalDisconnectRef = useRef(false);
  const deviceRef = useRef(null);

  const { width, height } = Dimensions.get("window");
  const logoWidth = width * 0.15;
  const logoHeight = height * 0.15;

  // ✅ Ensure the latest device name and email is fetched when screen is focused

  useFocusEffect(
    useCallback(() => {
      const loadSettings = async () => {
        try {
          const storedDevice = await SecureStore.getItemAsync("bleDeviceName");
          const storedEmail = await SecureStore.getItemAsync("emailAddress");
  
          console.log("Updated deviceName:", storedDevice || "No stored device");
          console.log("Updated emailAddress:", storedEmail || "No stored email");
  
          setDeviceName(storedDevice || "");  // Ensure it doesn't break on null/undefined
          setEmailAddress(storedEmail || "default@example.com");
        } catch (error) {
          console.error("Error loading settings:", error);
        }
      };
  
      loadSettings();
    }, []) // ✅ Keep dependencies minimal to prevent unnecessary re-renders
  );
  
  


  // ✅ Open the database when the app loads
  useEffect(() => {
    const resetDatabase = async () => {
      try {
        const newDbFilePath = `${FileSystem.documentDirectory}SQLite/appData.db`;
  
        // ✅ Check if the database file exists
        const fileInfo = await FileSystem.getInfoAsync(newDbFilePath);
        if (fileInfo.exists) {
          console.log("🗑️ Deleting existing database...");
          await FileSystem.deleteAsync(newDbFilePath, { idempotent: true });
          console.log("✅ Database deleted successfully");
        } else {
          console.log("ℹ️ No existing database found");
        }
  
        // ✅ Open a new database instance (which creates a fresh database)
        const database = await SQLite.openDatabaseAsync("appData.db");
        console.log("✅ New database created");
  
        // ✅ Update the database state and file path
        setDb(database);
        setDbFilePath(newDbFilePath);  // 🔥 Ensure dbFilePath is updated
  
      } catch (error) {
        console.error("❌ Error resetting database:", error);
      }
    };
  
    resetDatabase();
  }, []);
  
  // ✅ Ensure `db` is available before calling `execAsync`
  useEffect(() => {
    const initializeDatabase = async () => {
      if (!db) {
        console.warn("⚠️ Database not ready. Waiting...");
        return;
      }
  
      // ✅ Create the table if it doesn't exist; the database and its table are deleted whenever the app loads
      try {
        console.log("🔄 Initializing database...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS appData (        
            timestamp INTEGER NOT NULL,
            temperature INTEGER,
            humidity INTEGER,
            latitude INTEGER,
            longitude INTEGER,
            altitude INTEGER,
            accuracy INTEGER,
            speed INTEGER
          );
        `);
        console.log("✅ Database initialized successfully");
        setDbInitialized(true);
      } catch (error) {
        console.error("❌ Database initialization error:", error);
      }
    };
  
    if (db) {
      initializeDatabase();
    }
  }, [db]); // Runs only when `db` is set
  
  useEffect(() => {
    let isMounted = true; 
    const initializeFilePath = async () => {
      try {
        console.log("Initializing file path...");
        const storedName = await SecureStore.getItemAsync("bleDeviceName");
        if (!isMounted) return;
  
        if (!storedName) {
          Alert.alert("Device Name Not Set", "Redirecting to Settings page.");
          return;
        }
  
        const currentDateTime = new Date()
          .toLocaleString("sv-SE", { timeZoneName: "short" })
          .replace(/[:\-.TZ]/g, "")
          .slice(0, 15);
  
        console.log(`Current dateTime: ${currentDateTime}`);
        setDeviceName(storedName); // ✅ Ensures deviceName is updated 
        const jobcodeName = `${storedName}-${currentDateTime}`;
        jobcodeRef.current = jobcodeName;        
      } catch (error) {
        console.error("Error initializing file path:", error);
      }
    }; 
    initializeFilePath(); 
    return () => { isMounted = false };  // Cleanup function
  }, [deviceName]);



  // ✅ Load email address and device name when app loads
  useEffect(() => {
    const checkStoredSettings = async () => {
      try {
        const storedEmail = await SecureStore.getItemAsync("emailAddress");
        console.log("Stored email on app load:", storedEmail);
        setEmailAddress(storedEmail || "default@example.com");

        const storedDevice = await SecureStore.getItemAsync("bleDeviceName");
        console.log("Stored device on app load:", storedDevice);
        if (storedDevice) setDeviceName(storedDevice);
      } catch (error) {
        console.error("Error reading stored settings:", error);
      }
    };

    checkStoredSettings();
  }, []);

  useKeepAwake(); // Prevents the screen from sleeping

  return (
    <View style={styles.container}>
      <Text style={styles.header}>TriValley Youth</Text>
      <Text style={styles.header}>Climate Action Program</Text>
      <Text style={styles.title}>UHI Sensor</Text>
      <Text style={styles.version}>Version: {VERSION}</Text>

    <Text style={styles.status}>
        Sensor: {deviceName}{"\n"}
        Email: {emailAddress}  {"\n"}   
        Temperature: {(temperature * 9/5 + 32).toFixed(2)}°F {"\n"}
        GPS Accuracy: {String(accuracy)}m
    </Text>

      <Text style={styles.temperature}>Counter: {counter} </Text>

      {/* Start button  color={isSamplingRef?.current || isScanningRef?.current ? "gray" : "red"} */}

  <Button
      title="Start"
      containerStyle={{ width: '35%' }}
      buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
      titleStyle={{ color: 'yellow' }}

        onPress={() => {
        console.log("--> Start button pressed!", db, isScanningRef.current, isSamplingRef.current);
        
        handleStart(
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
        );
      }}
      disabled={isScanningRef.current || isSamplingRef.current}   
/>

{/* Stop button  color={isSamplingRef?.current ? "red" : "gray"}*/}
<Button
      title="Stop"
      containerStyle={{ width: '35%' }}
      buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
      titleStyle={{ color: 'yellow' }}
      
      onPress={() => {
        console.log("Stop button pressed!", db, deviceRef.current);  
        if (!deviceRef.current) {
          console.warn("⚠️ Cannot stop sampling: No device connected.");
          return;
        }
        stopSampling(
                db, 
                deviceRef, 
                isScanningRef, 
                isIntentionalDisconnectRef, 
                isSamplingRef, 
                isTrackingRef, 
                setDummyState);
      
      }}
      disabled={!isSamplingRef.current}  
/>

{/* Email .csv button color={isSamplingRef?.current ? "gray" : "red"} */}
<Button
      title={Platform.OS === 'ios' ? 'Email Data' : 'Share to Drive'}
      containerStyle={{ width: '35%' }}
      buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
      titleStyle={{ color: 'yellow' }}
      onPress={() => {
        emailDatabase(dbFilePath, jobcodeRef, emailAddress, isSamplingRef, setDummyState); // ✅ Call function   
      }}
      disabled={isSamplingRef.current} 
/>      

{/* Clear Data Rows button */}
    <View style={{ marginBottom: 40 }}>
        <Text> </Text> 
    </View> 
<Button
  title="Clear Data"
  containerStyle={{ width: '35%' }}
      buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
      titleStyle={{ color: 'yellow' }}
  onPress={() => {confirmAndClearDatabase( 
      db, 
      setDummyState, 
      setCounter, 
      clearDatabase,
      deviceRef, 
      isScanningRef, 
      isIntentionalDisconnectRef,
      isSamplingRef,
      isTrackingRef,
    )   
  }}
/>

{/* Logo */}
<Image
        source={require("./assets/icon.png")}
        style={[
          styles.logo,
          {
            width: logoWidth,
            height: logoHeight
          }
        ]}
        resizeMode="contain"
/>
<Text style={styles.questname}>Quest Science Center{"\n"}Livermore, CA</Text>

</View>
  );
}

// ✅ Styles
const { width, height } = Dimensions.get("window");
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#eef", alignItems: "center",
    justifyContent: "flex-start",paddingTop: height * 0.09 },

    
  header: { fontSize: 20, marginBottom: 4, color:'rgb(53, 111, 130)',fontWeight: "bold"},
  title: { fontSize: 36, marginBottom: 7, color: "blue",fontWeight: "bold"},

  temperature: {
    fontSize: 36,
    marginTop: 20,
    marginBottom: 30,
    color: "yellow",
    fontWeight: "bold",
    borderColor: "blue",
    backgroundColor: "blue",
    borderWidth: 2,
    borderRadius: 12,
    padding: 10
  },
  

  status: { fontSize: 18, marginVertical: 3 },
  version: { fontSize: 12, marginBottom: 15, color: "blue" },
  logo: {position: "absolute",bottom: 0,left: 0,marginBottom: 25,marginLeft:5,},
  questname: {position: "absolute",bottom: 0,left: 0,marginBottom: 5,marginLeft:5,
    fontSize: 18,color: "blue"},
});
