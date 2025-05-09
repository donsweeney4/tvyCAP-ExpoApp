import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  TouchableWithoutFeedback,
  Platform,
} from "react-native";

import * as SecureStore from "expo-secure-store";
import { useNavigation } from "@react-navigation/native";
import { bleWriteNameToESP32 } from "./functionsS3"; 

export default function SettingsScreen() {
  const [campaignName, setCampaignName] = useState("");
  const [sensorNumber, setSensorNumber] = useState("");
  const [inputName, setInputName] = useState("");

  const navigation = useNavigation();

  const loadSettings = async () => {
    try {
      if (!(await SecureStore.isAvailableAsync())) {
        console.error("SecureStore is not available on this device.");
        return;
      }

      const savedName = await SecureStore.getItemAsync("bleDeviceName");

      if (savedName) {
        setInputName(savedName);
        const parts = savedName.split("_");
        if (parts.length === 2) {
          setCampaignName(parts[0]);
          setSensorNumber(parts[1].padStart(3, "0"));
        }
      }
    } catch (error) {
      console.error("Error loading settings from SecureStore:", error);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveSettings = async () => {
    try {
      Keyboard.dismiss();
  
      if (!campaignName || !sensorNumber) {
        Alert.alert("Missing Info", "Please enter both campaign name and sensor number.");
        return;
      }
  
      const paddedSensor = sensorNumber.padStart(3, "0");
      const newName = `${campaignName}_${paddedSensor}`;
      setInputName(newName);
  
      if (!(await SecureStore.isAvailableAsync())) {
        Alert.alert("Error", "SecureStore is not available on this device.");
        return;
      }
  
      // Write the name to the ESP32 via BLE
      const success = await bleWriteNameToESP32(newName);
      if (!success) {
        Alert.alert("Error", "Failed to update ESP32 name over BLE.");
        return;
      }
  
      // Save locally
      await SecureStore.setItemAsync("campaignName", campaignName);
      await SecureStore.setItemAsync("sensorNumber", paddedSensor);
      await SecureStore.setItemAsync("bleDeviceName", newName);

      // Save to SQLite database (if applicable)
      Alert.alert("Success", "ESP32 name updated!", [
        { text: "OK", onPress: loadSettings },
      ]);
  
      navigation.navigate("Main");
    } catch (error) {
      console.error("❌ Error saving settings:", error);
      Alert.alert("Error", "Failed to update settings.");
    }
  };
  

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <Text style={styles.label}>Set Campaign Name:</Text>
          <TextInput
            style={styles.input}
            value={campaignName}
            onChangeText={setCampaignName}
            placeholder="Enter Campaign Name"
            returnKeyType="done"
          />

          <Text style={styles.label}>Set Sensor Number:</Text>
        <TextInput
           style={styles.input}
           value={sensorNumber}
           onChangeText={(text) =>
            setSensorNumber(text.replace(/[^0-9]/g, "").slice(0, 3))
           }
           placeholder="Enter Sensor Number"
           keyboardType="numeric"
        />

          <Button title="Save" onPress={saveSettings} />

          <View style={styles.previewBox}>
            <Text style={styles.previewText}>Current Setting:</Text>
            <Text style={styles.previewName}>{inputName || "(none)"}</Text>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

///////////////////////////
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
  },
  input: {
    width: "90%",
    padding: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 5,
    marginBottom: 20,
  },
  previewBox: {
    marginTop: 30,
    alignItems: "center",
  },
  previewText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  previewName: {
    fontSize: 18,
    color: "#007AFF",
    marginTop: 5,
  },
});
