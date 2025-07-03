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

import { bleState } from "./utils/bleState";
import { handleStart, stopSampling, confirmAndClearDatabase } from "./functions";
import { uploadDatabaseToS3 } from "./functionsS3"; // Import uploadDatabaseToS3
import { showToastAsync } from "./functionsHelper";
import { VERSION } from "./constants";

export default function MainScreen1() {
  const [deviceName, setDeviceName] = useState(null);
  const [counter, setCounter] = useState(0);
  const [temperature, setTemperature] = useState(NaN);
  const [accuracy, setAccuracy] = useState(NaN);
  const [dummyState, setDummyState] = useState(0);

  const [iconType, setIconType] = useState(null);
  const [iconVisible, setIconVisible] = useState(false);
  const [iconText, setIconText] = useState("");
  const iconHideTimerRef = useRef(null);

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
            //await showToastAsync("Missing campaign info. Redirecting to Settings...", 3000);
            updateIconDisplay('red', "Missing campaign info! Redirecting to Settings...", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
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
    console.log("MainScreen L4: Setting dummyState for bleState");
    bleState.setDummyState = setDummyState;
    if (!bleState.lastWriteTimestampRef) bleState.lastWriteTimestampRef = { current: 0 };
    if (!bleState.lastErrorToastTimestampRef) bleState.lastErrorToastTimestampRef = { current: 0 };
    if (!bleState.dbRef) bleState.dbRef = { current: null };
  }, []);

  // Cleanup effect for the icon timer, important when component unmounts
  useEffect(() => {
    return () => {
      if (iconHideTimerRef.current) {
        clearTimeout(iconHideTimerRef.current);
      }
    };
  }, []);

  // --- Helper: Function to manage icon display (copied for self-containment) ---
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

  if (type === null) {
    setIconVisible(false);
    setIconType(null);
    setIconText("");
  } else {
    setIconType(type);
    setIconText(text);
    setIconVisible(true);
    iconHideTimerRef.current = setTimeout(() => { // Corrected ref name: iconHideTimerTimerRef -> iconHideTimerRef
      setIconVisible(false);
      setIconType(null);
      setIconText("");
    }, duration);
  }
};



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
            //showToastAsync("❌ Device name missing. Check settings.", 3000);
            updateIconDisplay('red', "Device name missing! Check settings.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
            return;
          }
          handleStart(
            deviceNameRef.current,
            setCounter,
            setTemperature,
            setAccuracy,
            setIconType,
            setIconVisible,
            setIconText,
            iconHideTimerRef,
          );
        }}
      />

      <Button
        title="Stop"
        containerStyle={{ width: '35%', marginBottom: 12 }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          if (!bleState.deviceRef.current && !bleState.isSamplingRef.current) {
            //showToastAsync("⚠️ Nothing to stop: Not connected or sampling.", 2000);
            updateIconDisplay('red', "Nothing to stop: Not connected or sampling.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
            return;
          }
          // Pass icon setters to stopSampling
          stopSampling(setIconType, setIconVisible, setIconText, iconHideTimerRef);
        }}
      />

      <Button
        title="Upload Data"
        containerStyle={{ width: '35%', marginBottom: 12 }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          if (!deviceNameRef.current || !jobcodeRef.current) {
            //showToastAsync("❌ Missing metadata. Cannot upload.", 3000);
            updateIconDisplay('red', "Missing metadata! Cannot upload.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
            return;
          }
          const currentDbFilePath = `${FileSystem.documentDirectory}SQLite/appData.db`;
          // --- NEW: Pass icon setters to uploadDatabaseToS3 ---
          uploadDatabaseToS3(
            currentDbFilePath,
            jobcodeRef,
            deviceNameRef,
            setIconType,
            setIconVisible,
            setIconText,
            iconHideTimerRef
          );
        }}
      />

      <View style={{ marginBottom: 20 }}><Text> </Text></View>

      <Button
        title="Clear Data"
        containerStyle={{ width: '35%', marginBottom: 12 }}
        buttonStyle={{ backgroundColor: 'blue', borderRadius: 10 }}
        titleStyle={{ color: 'yellow' }}
        onPress={() => {
          // Pass icon setters to confirmAndClearDatabase
          confirmAndClearDatabase(setDummyState, setCounter, setIconType, setIconVisible, setIconText, iconHideTimerRef);
        }}
      />

      <Image
        source={require("./assets/icon.png")}
        style={[styles.logo, { width: logoWidth, height: logoHeight }]}
        resizeMode="contain"
      />
      <Text style={styles.questname}>Quest Science Center{"\n"}Livermore, CA</Text>

      {/* ICON DISPLAY: Now correctly uses iconText and dynamic text color */}
      {iconVisible && (
        <View style={styles.iconContainer}>
          <Text style={[
            styles.iconMessageText,
            iconType === 'green' && styles.iconMessageTextGreen,
            iconType === 'red' && styles.iconMessageTextRed
          ]}>
            {iconText}
          </Text>
          {iconType === 'red' && (
            <Icon name="error" size={50} color="red" />
          )}
          {iconType === 'green' && (
            <Icon name="check-circle" size={50} color="green" />
          )}
        </View>
      )}
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
  iconContainer: {
    position: "absolute",
    bottom: 0,
    marginBottom: 50,
    alignSelf: "center",
    alignItems: "center",
    padding: 15,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    width: '80%',
    maxWidth: 350,
    zIndex: 9998,
  },
  iconMessageText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
    fontWeight: 'bold',
  },
  iconMessageTextGreen: {
    color: 'green',
  },
  iconMessageTextRed: {
    color: 'red',
  },
  errorText: {
    fontSize: 16,
    color: 'red',
    textAlign: 'center',
    marginBottom: 5,
  },
});