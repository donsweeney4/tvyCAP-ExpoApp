import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  TouchableWithoutFeedback,
  TouchableOpacity,
  Platform,
  StyleSheet,
} from "react-native";

import * as SecureStore from "expo-secure-store";
import { useNavigation } from "@react-navigation/native";

import Icon from 'react-native-vector-icons/MaterialIcons';

import { GetPairedSensorName, openDatabaseConnection, clearDatabase } from "./functions";
import { showToastAsync } from "./functionsHelper";

export default function SettingsScreen() {
  const [isPressed, setIsPressed] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignSensorNumber, setCampaignSensorNumber] = useState("");
  const [sensorPaired, setSensorPaired] = useState(false);
  const [dummyState, setDummyState] = useState(0);
  const [counter, setCounter] = useState(0);

  const [iconType, setIconType] = useState(null);
  const [iconVisible, setIconVisible] = useState(false);
  const [iconText, setIconText] = useState("");
  const iconHideTimerRef = useRef(null);

  const navigation = useNavigation();

//# --- NEW HELPER: Function to manage icon display ---
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


  /**
   * Loads saved settings (campaignName and campaignSensorNumber) from SecureStore
   * when the component mounts.
   */
  const loadSettings = async () => {
    try {
      if (!(await SecureStore.isAvailableAsync())) {
        console.error("SecureStore is not available on this device.");
        return;
      }
      const storedCampaignName = await SecureStore.getItemAsync("campaignName");
      const storedCampaignSensorNumber = await SecureStore.getItemAsync("campaignSensorNumber");

      if (storedCampaignName) setCampaignName(storedCampaignName);
      if (storedCampaignSensorNumber) setCampaignSensorNumber(storedCampaignSensorNumber);
    } catch (error) {
      console.error("Error loading settings from SecureStore:", error);
      //showToastAsync("Error loading settings.", 3000);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  /**
   * Attempts to write a key-value pair to SecureStore with retry logic.
   * @param {string} key - The key to store.
   * @param {string} value - The value to store.
   * @param {number} retries - Number of retry attempts.
   * @returns {Promise<boolean>} True if saved successfully, false otherwise.
   */
  const writeWithRetry = async (key, value, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await SecureStore.setItemAsync(key, value);
        const verify = await SecureStore.getItemAsync(key);
        if (verify === value) {
          console.log(`✅ ${key} saved successfully on attempt ${attempt}`);
          return true;
        }
        console.warn(`⏳ Retry ${attempt} failed for ${key}. Verification mismatch.`);
      } catch (error) {
        console.warn(`⏳ Retry ${attempt} failed for ${key}. Error: ${error.message}`);
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    console.error(`❌ Failed to save ${key} after ${retries} attempts.`);
    return false;
  };

  /**
   * Saves the campaign settings to SecureStore and attempts to clear the database.
   * Provides user feedback via toast messages based on success/failure.
   */
  const saveSettings = async () => {
    try {
      Keyboard.dismiss();

      if (!campaignName || !campaignSensorNumber) {
        //showToastAsync("Missing Info \n Enter both campaign name and campaign sensor number.", 2000);
        updateIconDisplay('red', "Missing Info! Enter both campaign name and sensor number.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
        return;
      }

      if (campaignName.includes("_")) {
        //showToastAsync("❌ Campaign name cannot contain underscores (_)", 3000);
        updateIconDisplay('red', "Campaign name cannot contain underscores (_)", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
        return;
      }

      const paddedSensor = campaignSensorNumber.padStart(3, "0");

      if (!(await SecureStore.isAvailableAsync())) {
        //showToastAsync("Error: SecureStore is not available on this device. Cannot save settings.", 3000);
        console.error("SecureStore is not available on this device.");
        updateIconDisplay('red', "SecureStore not available! Cannot save settings.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
        return;
      }

      const savedCampaignName = await writeWithRetry("campaignName", campaignName);
      const savedCampaignSensorNumber = await writeWithRetry("campaignSensorNumber", paddedSensor);

      if (!savedCampaignName || !savedCampaignSensorNumber) {
        //showToastAsync("❌ Failed to save settings to SecureStore.", 3000);
        updateIconDisplay('red', "Failed to save settings to SecureStore.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);  
        return;
      }

      try {
          const db = await openDatabaseConnection();
          console.log("✅ Database connection opened successfully for clearing.");
          await clearDatabase(setDummyState, setCounter);

          console.log("Database cleared successfully after settings save.");
          //showToastAsync("✅ Settings saved and old data cleared!", 2000);
          u

      } catch (dbError) {
          console.error("❌ Error during database operation after settings save:", dbError);
          //showToastAsync("✅ Settings saved, but failed to clear old data.", 4000);
          updateIconDisplay('red', "Settings saved, but failed to clear old data.", 4000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
          return;
      }

      navigation.goBack();

    } catch (error) {
      console.error("❌ An unexpected error occurred during settings save:", error);
      //showToastAsync("An unexpected error occurred while saving settings.", 3000);
      updateIconDisplay('red', "An unexpected error occurred while saving settings.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    }
  };

  /**
   * Handles the pairing of a new temperature sensor.
   * Uses `GetPairedSensorName` and provides toast feedback.
   */
  const pairNewSensor = async () => {
    // Clear any existing icon timer when a new pairing attempt is made
    if (iconHideTimerRef.current) {
      clearTimeout(iconHideTimerRef.current);
      iconHideTimerRef.current = null;
    }

    try {
      const success = await GetPairedSensorName();

      if (success) {
        setSensorPaired(true);
        //showToastAsync("New sensor paired successfully!", 3000);

        updateIconDisplay('green', "New sensor paired successfully!", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);

      } else {
        setSensorPaired(false);
        //showToastAsync("Failed to pair with a new sensor.", 2000);


      }
    } catch (error) {
      console.error("❌ Error pairing new sensor:", error);
      setSensorPaired(false);
      showToastAsync("An unexpected error occurred during sensor pairing.", 2000);

      updateIconDisplay('red', "An unexpected error occurred during sensor pairing.", 3000, setIconType, setIconVisible, setIconText, iconHideTimerRef);
    }
  };

  // Cleanup effect for the icon timer
  useEffect(() => {
    return () => {
      if (iconHideTimerRef.current) {
        clearTimeout(iconHideTimerRef.current);
      }
    };
  }, []);


  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >

      {/* Sensor Paired Status Display - Re-enabled as it might be useful */}
      {sensorPaired && (
        <View style={styles.sensorStatus}>
          <Text style={styles.sensorStatusText}></Text>
        </View>
      )}

      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {/* Pair New Sensor Button */}
          <TouchableOpacity
            style={[styles.saveButton, { marginBottom: 45 }, isPressed && styles.saveButtonPressed]}
            onPressIn={() => setIsPressed(true)}
            onPressOut={() => setIsPressed(false)}
            onPress={pairNewSensor}
          >
            <Text style={[styles.saveButtonText, isPressed && styles.saveButtonTextPressed]}>
              Pair New Temperature Sensor
            </Text>
          </TouchableOpacity>

          {/* Campaign Name Input */}
          <Text style={styles.label}>Set New Campaign Name:</Text>
          <TextInput
            style={styles.input}
            value={campaignName}
            onChangeText={setCampaignName}
            placeholder="Campaign Name"
            returnKeyType="done"
            autoCapitalize="words"
          />

          {/* Sensor Number Input */}
          <Text style={styles.label}>Set New Integer Sensor Number:</Text>
          <TextInput
            style={styles.input}
            value={campaignSensorNumber}
            onChangeText={(text) =>
              setCampaignSensorNumber(text.replace(/[^0-9]/g, "").slice(0, 3))
            }
            placeholder="Your Campaign Member Number"
            keyboardType="numeric"
            maxLength={3}
          />

          {/* Save Settings Button */}
          <TouchableOpacity
            style={[styles.saveButton, isPressed && styles.saveButtonPressed]}
            onPressIn={() => setIsPressed(true)}
            onPressOut={() => setIsPressed(false)}
            onPress={saveSettings}
          >
            <Text style={[styles.saveButtonText, isPressed && styles.saveButtonTextPressed]}>
              Save
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>


   {iconVisible && (
  <View style={styles.iconContainer}>
    {/* Apply dynamic text color based on iconType */}
    <Text style={[
      styles.iconMessageText, // Base style for icon text
      iconType === 'green' && styles.iconMessageTextGreen, // Green color for success
      iconType === 'red' && styles.iconMessageTextRed // Red color for error
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


    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#fff",
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  label: {
    fontSize: 18,
    marginBottom: 10,
    textAlign: "center",
    fontWeight: "600",
    color: "#333",
  },
  input: {
    width: "90%",
    maxWidth: 300,
    padding: 12,
    borderWidth: 1,
    borderColor: "#a0a0a0",
    borderRadius: 8,
    marginBottom: 25,
    fontSize: 16,
    color: "#444",
    backgroundColor: "#f9f9f9",
  },
  saveButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 10,
    marginTop: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 6,
  },
  saveButtonPressed: {
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#007AFF",
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  saveButtonText: {
    color: "yellow",
    fontSize: 18,
    fontWeight: "bold",
  },
  saveButtonTextPressed: {
    color: "#007AFF",
  },
  sensorStatus: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    backgroundColor: "#e0ffe0",
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 10,
    zIndex: 10,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  sensorStatusText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "green",
  },
  iconContainer: {
    position: "absolute",
    bottom: 0, // Position at the bottom of the screen
    marginBottom: 50, // Lift it up from the very bottom edge
    alignSelf: "center", // Center horizontally
    alignItems: "center", // Center content (text and icon) horizontally within the container
    padding: 15, // Add some padding around the icon and text
    backgroundColor: 'rgba(255,255,255,0.95)', // Slightly more opaque white background
    borderRadius: 15, // More rounded corners
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    width: '80%', // Give it a defined width
    maxWidth: 350, // Max width for larger screens
  },
  // Base style for the icon message text
  iconMessageText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10, // Space between text and icon
    fontWeight: 'bold', // Make it bold
  },
  // Specific color for green icon text
  iconMessageTextGreen: {
    color: 'green',
  },
  // Specific color for red icon text
  iconMessageTextRed: {
    color: 'red',
  },
});