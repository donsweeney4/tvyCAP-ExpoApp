import React, { useEffect, useState, useRef, useCallback } from "react";
import { useKeepAwake } from "expo-keep-awake";
import {
  StyleSheet,
  Text,
  Alert,
  View,
  Button
} from "react-native";

import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect } from "@react-navigation/native";
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
  }, []);



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
      <Text style={styles.title}>TVYCAP UHI Sensor</Text>
      <Text style={styles.version}>Version: {VERSION}</Text>
      <Text style={styles.status}>Sensor: {deviceName}</Text>
      <Text style={styles.temperature}>{"\n"}Counter: {counter} </Text>
      <Text>
        {"\n"}Temperature: {String(temperature)}C{"\n"} GPS Accuracy: {String(accuracy)}m{"\n"}
      </Text>

      {/* Start button */}

  <Button
      title="Start"
      color={isSamplingRef?.current || isScanningRef?.current ? "gray" : "red"}
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

{/* Stop button */}
<Button
      title="Stop Sampling"
      color={isSamplingRef?.current ? "red" : "gray"}
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

{/* Email .csv button */}
<Button
      title="Email Data File"
      color={isSamplingRef?.current ? "gray" : "red"}
      onPress={() => {
        emailDatabase(dbFilePath, jobcodeRef, emailAddress, isSamplingRef, setDummyState); // ✅ Call function   
      }}
      disabled={isSamplingRef.current} 
/>

{/* Clear Data Rows button */}
    <View style={{ marginBottom: 40 }}>
      <Text> --- </Text> 
    </View> 
<Button
  title="Clear Data"
  color="black"
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




</View>
  );
}

// ✅ Styles
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#eef", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 26, marginBottom: 7, color: "blue" },
  temperature: { fontSize: 24, marginBottom: 10, color: "red" },
  status: { fontSize: 18, marginVertical: 10 },
  version: { fontSize: 12, marginBottom: 15, color: "blue" },
});
