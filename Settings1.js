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

export default function SettingsScreen() {
  const [inputName, setInputName] = useState("");
  const [inputEmail, setInputEmail] = useState("");

  const navigation = useNavigation();

  //#1 Function to load settings from SecureStore
  const loadSettings = async () => {
    try {
      if (!(await SecureStore.isAvailableAsync())) {
        console.error("SecureStore is not available on this device.");
        return;
      }

      const savedDeviceName = await SecureStore.getItemAsync("bleDeviceName");
      const savedEmailAddress = await SecureStore.getItemAsync("emailAddress");

      if (savedDeviceName) setInputName(savedDeviceName);
      if (savedEmailAddress) setInputEmail(savedEmailAddress);
    } catch (error) {
      console.error("Error loading settings from SecureStore:", error);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  //#2 Function to save settings to SecureStore
  const saveSettings = async () => {
    try {
      Keyboard.dismiss();
  
      console.log(`saveSettings: emailAddress: ${inputEmail} deviceName: ${inputName}`);
  
      if (!(await SecureStore.isAvailableAsync())) {
        Alert.alert("Error", "SecureStore is not available on this device.");
        return;
      }
  
      // Split emails by comma and trim whitespace
      const emailList = inputEmail.split(",").map(email => email.trim());
  
      // Validate each email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = emailList.filter(email => !emailRegex.test(email));
  
      if (invalidEmails.length > 0) {
        Alert.alert("Invalid Email(s)", `Please correct: ${invalidEmails.join(", ")}`);
        return;
      }
  
      // Save as a comma-separated string
      await SecureStore.setItemAsync("bleDeviceName", inputName);
      await SecureStore.setItemAsync("emailAddress", emailList.join(","));
  
      Alert.alert("Success", "Settings updated successfully!", [
        { text: "OK", onPress: loadSettings },
      ]);
  
      navigation.navigate("Main");
    } catch (error) {
      console.error("Error saving settings:", error);
      Alert.alert("Error", "Failed to save settings.");
    }
  };
  

  //#3. Return the UI
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <Text style={styles.label}>Set BLE Device Name:</Text>
          <TextInput
            style={styles.input}
            value={inputName}
            onChangeText={setInputName}
            placeholder="Enter BLE Device Name"
            returnKeyType="done"
          />

          <Text style={styles.label}>Set Email Address:</Text>
          <TextInput
            style={styles.input}
            value={inputEmail}
            onChangeText={setInputEmail}
            placeholder="Enter Email Address"
            keyboardType="email-address"
          />

          <Button title="Save" onPress={saveSettings} />
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
});
