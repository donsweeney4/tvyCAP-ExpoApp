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
import { useNavigation } from "@react-navigation/native";


import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { useFocusEffect } from "@react-navigation/native";
import { Button } from 'react-native-elements';
import * as SQLite from "expo-sqlite";

import { handleStart,  stopSampling, confirmAndClearDatabase,clearDatabase } from "./functions";
import { uploadDatabaseToS3} from "./functionsS3";
import { showToastAsync } from "./functionsHelper";

import  {VERSION} from "./constants";

//#1 **** MainScreen: start of EXPO component ****/
export default function MainScreen() {
  const [db, setDb] = useState(null);
  const [dbFilePath, setDbFilePath] = useState(null);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [deviceName, setDeviceName] = useState(null);
  const [counter, setCounter] = useState(0);
  const [temperature, setTemperature] = useState(NaN);
  const [accuracy, setAccuracy] = useState(NaN);
  const [dummyState, setDummyState] = useState(0); // ✅ State used to trigger re-render
  const [isFallbackConnection, setIsFallbackConnection] = useState(false);
  const [settingsMissing, setSettingsMissing] = useState(false);
  const navigation = useNavigation();


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

  

 
  // ✅ Ensure the latest  campaignName and sensorNumber is fetched when screen is focused
  useEffect(() => {
    const checkStoredSettings = async () => {
      try {
        const storedCampaign = await SecureStore.getItemAsync("campaignName");
        const storedSensor = await SecureStore.getItemAsync("sensorNumber");
  
        if (storedCampaign && storedSensor) {
          const paddedSensor = storedSensor.padStart(3, "0");
          const fullDeviceName = `${storedCampaign}_${paddedSensor}`;
          setDeviceName(fullDeviceName);
          setSettingsMissing(false);
  
          const currentDateTime = new Date()
            .toLocaleString("sv-SE", { timeZoneName: "short" })
            .replace(/[:\-.TZ]/g, "")
            .slice(0, 15);
  
          jobcodeRef.current = `${fullDeviceName}-${currentDateTime}`;
          console.log("✅ Device name and jobcode set:", fullDeviceName, jobcodeRef.current);
        } else {
          console.warn("⚠️ Missing campaignName or sensorNumber");
          setSettingsMissing(true);
          Alert.alert("Device Name Not Set", "Redirecting to Settings page.", [
            { text: "OK", onPress: () => navigation.navigate("Settings") }
          ]);
        }
      } catch (error) {
        console.error("❌ Error reading stored settings:", error);
        setSettingsMissing(true);
      }
    };
  
    checkStoredSettings();
  }, []);
  
  

  useEffect(() => {
    if (isFallbackConnection) {
      Alert.alert(
        "Setup Required",
        "This sensor is using the default BLE name. Please go to Settings to assign a unique name.",
        [
          {
            text: "Go to Settings",
            onPress: () => navigation.navigate("Settings"),
          },
          { text: "Cancel", style: "cancel" }
        ]
      );
    }
  }, [isFallbackConnection]);
  
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
  







  useKeepAwake(); // Prevents the screen from sleeping

  return (
    <View style={styles.container}>
      <Text style={styles.header}>TriValley Youth</Text>
      <Text style={styles.header}>Climate Action Program</Text>
      <Text style={styles.title}>UHI Sensor</Text>
      <Text style={styles.version}>Version: {VERSION}</Text>
  
      <Text style={styles.status}>
        Sensor: {deviceName || "(no name)"}{"\n"}
        Temperature: {isNaN(temperature) ? "--" : `${(temperature * 9/5 + 32).toFixed(2)}°F`} {"\n"}
        GPS Accuracy: {String(accuracy)}m
      </Text>
  
      <Text style={styles.temperature}>Counter: {counter}</Text>
  
      {isFallbackConnection && (
        <View style={{ marginTop: 20, backgroundColor: '#fff3cd', padding: 10 }}>
          <Text style={{ color: '#856404' }}>
            ⚠️ Connected using default device name. Please assign a unique name in Settings.
          </Text>
        </View>
      )}
  
  {settingsMissing && (
  <View style={{ 
    marginTop: 15, 
    padding: 12, 
    backgroundColor: "#ffebee", 
    borderRadius: 6, 
    alignItems: "center" 
  }}>
    <Text style={{ 
      color: "#c62828", 
      textAlign: "center", 
      fontWeight: "bold", 
      marginBottom: 10 
    }}>
      ⚠️ Missing campaign info. Please go to Settings to enter campaign name and sensor number.
    </Text>
    <Button
      title="Go to Settings"
      onPress={() => navigation.navigate("Settings")}
      buttonStyle={{ backgroundColor: "#c62828", paddingHorizontal: 20 }}
      titleStyle={{ color: "white" }}
    />
  </View>
)}


      {/* Start Button */}
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
            setDummyState,
            setIsFallbackConnection
          );
        }}
        disabled={isScanningRef.current || isSamplingRef.current}
      />
  
      {/* Stop Button */}
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
            setDummyState
          );
        }}
        disabled={!isSamplingRef.current}
      />
  
      {/* Upload Data Button */}
      <Button
        title="Upload Data"
        containerStyle={{ width: '35%' }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          uploadDatabaseToS3(dbFilePath, jobcodeRef );
        }}
        disabled={isSamplingRef.current}
      />
  
      {/* Spacer and Clear Button */}
      <View style={{ marginBottom: 40 }}><Text> </Text></View>
      <Button
        title="Clear Data"
        containerStyle={{ width: '35%' }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          confirmAndClearDatabase(
            db,
            setDummyState,
            setCounter,
            clearDatabase,
            deviceRef,
            isScanningRef,
            isIntentionalDisconnectRef,
            isSamplingRef,
            isTrackingRef
          );
        }}
      />
  
      {/* Logo */}
      <Image
        source={require("./assets/icon.png")}
        style={[styles.logo, { width: logoWidth, height: logoHeight }]}
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
    justifyContent: "flex-start",paddingTop: height * 0.05 },

    
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
  logo: {position: "absolute",bottom: 0,right: 0,marginRight:5,marginBottom:-35,},
  questname: {position: "absolute",bottom: 0,left: 0,marginBottom:0,marginLeft:5,
    fontSize: 18,color: "blue"},
});
