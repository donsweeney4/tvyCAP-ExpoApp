import React, { useEffect, useState, useRef } from "react";
import { useKeepAwake } from "expo-keep-awake";
import {
  StyleSheet,
  Text,
  View,
  Dimensions,
  Image,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import * as FileSystem from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { Button } from 'react-native-elements';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Toast from 'react-native-root-toast'; // <--- NEW: Import Icon component


import { bleState } from "./utils/bleState";
import { handleStart, stopSampling, confirmAndClearDatabase } from "./functions";
import { uploadDatabaseToS3 } from "./functionsS3";
import { showToastAsync } from "./functionsHelper";
import { VERSION } from "./constants";







export default function MainScreen1() {
  
  

  const [deviceName, setDeviceName] = useState(null);
  const [counter, setCounter] = useState(0);
  const [temperature, setTemperature] = useState(NaN);
  const [accuracy, setAccuracy] = useState(NaN);
  const [dummyState, setDummyState] = useState(0); // Keep this for UI updates via bleState

  // --- NEW STATE FOR ICONS ---
  const [iconType, setIconType] = useState(null); // 'red', 'green', or null
  const [iconVisible, setIconVisible] = useState(false);
  // --- END NEW STATE ---

  const navigation = useNavigation();

  const deviceNameRef = useRef(null);
  const jobcodeRef = useRef(null);
  const redirectedRef = useRef(false);

  const { width, height } = Dimensions.get("window");
  const logoWidth = width * 0.15;
  const logoHeight = height * 0.15;

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", async () => {
      console.log("MainScreen L1: Focus event triggered");
      try {
        const campaignName = await SecureStore.getItemAsync("campaignName");
        const campaignSensorNumber = await SecureStore.getItemAsync("campaignSensorNumber");
        const pairedSensorName = await SecureStore.getItemAsync("pairedSensorName");

        console.log("📦 Focused: retrieved settings:", {
          campaignName,
          campaignSensorNumber,
          pairedSensorName
        });

        if (
           campaignName?.trim() &&
           campaignSensorNumber?.trim() &&
           pairedSensorName?.trim()
        ) {
          const paddedSensorNumber = campaignSensorNumber.padStart(3, "0");
          const fullDeviceName = `${campaignName}_${paddedSensorNumber}`;
          setDeviceName(fullDeviceName);
          deviceNameRef.current = fullDeviceName;

          const currentDateTime = new Date()
            .toLocaleString("sv-SE", { timeZoneName: "short" })
            .replace(/[:\-.TZ]/g, "")
            .slice(0, 15);

          jobcodeRef.current = `${fullDeviceName}-${currentDateTime}`;
          console.log("✅ Updated device name and jobcode:", fullDeviceName, jobcodeRef.current);

          redirectedRef.current = false;
        } else {
          if (!redirectedRef.current) {
            redirectedRef.current = true;
            console.warn("⚠️ Missing info. Redirecting to settings.");
            await showToastAsync("Missing campaign info. Redirecting to Settings...", 3000);
            navigation.navigate("Settings");
          }
        }
      } catch (error) {
        console.error("❌ Error loading settings:", error);
      }
    });

    return unsubscribe;
  }, [navigation]);



useEffect(() => {
  console.log("📢 About to show toast...");
    setTimeout(() => {
    Toast.show('This is a test toast', {
      duration: Toast.durations.LONG,
      position: Toast.positions.TOP,
      containerStyle: {
        backgroundColor: 'black',
        zIndex: 9999,
        elevation: 9999,
      },
      textStyle: {
        color: 'white',
        fontSize: 16,
      },
    });
   }, 100);
  }, []);










  useEffect(() => {
    console.log("MainScreen L4: Setting dummyState for bleState");
    bleState.setDummyState = setDummyState; // Correctly sets the setter
    // Also, initialize refs in bleState if they aren't already for safety (though bleState.js should do this)
    if (!bleState.lastWriteTimestampRef) bleState.lastWriteTimestampRef = { current: 0 };
    if (!bleState.lastErrorToastTimestampRef) bleState.lastErrorToastTimestampRef = { current: 0 };
    if (!bleState.dbRef) bleState.dbRef = { current: null };

  }, []);


  useKeepAwake();

  return (
    <View style={styles.container}>
      <Text style={styles.header}>TriValley Youth</Text>
      <Text style={styles.header}>Climate Action Program</Text>
      <Text style={styles.title}>UHI Sensor</Text>
      <Text style={styles.version}>Version: {VERSION}</Text>

      <Text style={styles.status}>
        Sensor: {deviceName || "(no name)"}{"\n"}
        Temperature: {isNaN(temperature) ? "--" : `${(temperature * 9/5 + 32).toFixed(2)}°F`} {"\n"}
        GPS Accuracy: {isNaN(accuracy) ? "--" : `${accuracy}m`}
      </Text>

      <Text style={styles.temperature}>Counter: {counter}</Text>

      <Button
        title="Start"
        containerStyle={{ width: '35%', marginBottom: 12 }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          if (!deviceNameRef.current) {
            showToastAsync("❌ Device name missing. Check settings.", 3000);
            return;
          }
          console.log("--> Start button pressed!", bleState.isScanningRef.current, bleState.isSamplingRef.current);

          // --- PASS NEW SETTERS TO handleStart ---
          handleStart(
            deviceNameRef.current,
            setCounter,
            setTemperature,
            setAccuracy,
            setIconType,      // Pass setIconType
            setIconVisible    // Pass setIconVisible
          );
        }}
      />

      <Button
        title="Stop"
        containerStyle={{ width: '35%', marginBottom: 12 }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          console.log("Stop button pressed! Calling stopSampling //#8");
          if (!bleState.deviceRef.current && !bleState.isSamplingRef.current) { // Check if there's nothing to stop
            console.warn("⚠️ Nothing to stop: No device connected or not sampling.");
            showToastAsync("⚠️ Nothing to stop: Not connected or sampling.", 2000); // User feedback
            return;
          }

          stopSampling();
          // *** IMPORTANT: When stopping, you might want to clear any existing icon
          setIconVisible(false);
          setIconType(null);
          // If you want the red icon to persist until the next "good" connection,
          // then you wouldn't clear it here, but it would be cleared by a successful write.
          // For now, clearing it on stop is a reasonable default.
        }}
      />

      <Button
        title="Upload Data"
        containerStyle={{ width: '35%', marginBottom: 12 }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          if (!deviceNameRef.current || !jobcodeRef.current) {
            showToastAsync("❌ Missing metadata. Cannot upload.", 3000);
            return;
          }

          const currentDbFilePath = `${FileSystem.documentDirectory}SQLite/appData.db`;
          uploadDatabaseToS3(currentDbFilePath, jobcodeRef, deviceNameRef);
        }}
      />

     


      <View style={{ marginBottom: 20 }}><Text> </Text></View>
      <Button
        title="Clear Data"
        containerStyle={{ width: '35%', marginBottom: 12 }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {

          confirmAndClearDatabase(setDummyState, setCounter);
          // When data is cleared, you might also want to clear any status icons
          setIconVisible(false);
          setIconType(null);
        }}
      />

     
      {iconVisible && (
        <View style={styles.iconContainer}>
          {iconType === 'red' && (
            <Icon name="error" size={50} color="red" />
          )}
          {iconType === 'green' && (
            <Icon name="check-circle" size={50} color="green" />
          )}
        </View>
      )}
   

      <Image
        source={require("./assets/icon.png")}
        style={[styles.logo, { width: logoWidth, height: logoHeight }]}
        resizeMode="contain"
      />
      <Text style={styles.questname}>Quest Science Center{"\n"}Livermore, CA</Text>
    </View>
  );
}

const { width, height } = Dimensions.get("window");
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#eef",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: height * 0.05,
  },
  header: {
    fontSize: 20,
    marginBottom: 4,
    color: 'rgb(53, 111, 130)',
    fontWeight: "bold"
  },
  title: {
    fontSize: 36,
    marginBottom: 7,
    color: "blue",
    fontWeight: "bold"
  },
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
  status: {
    fontSize: 18,
    marginVertical: 3
  },
  version: {
    fontSize: 12,
    marginBottom: 15,
    color: "blue"
  },
  logo: {
    position: "absolute",
    bottom: 0,
    right: 0,
    marginRight: 5,
    marginBottom: -35,
  },
  questname: {
    position: "absolute",
    bottom: 0,
    left: 0,
    marginBottom: 0,
    marginLeft: 5,
    fontSize: 18,
    color: "blue"
  },
  // --- NEW STYLE FOR ICON CONTAINER ---
  iconContainer: {
    marginTop: 20, // Adjust as needed for spacing
    marginBottom: 20, // Adjust as needed
  }
  // --- END NEW STYLE ---
});