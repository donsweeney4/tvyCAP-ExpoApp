import React, { useEffect, useState } from "react";
import { View, Text, Button, StyleSheet, Alert, Platform } from "react-native";
import * as Location from "expo-location";

export default function LocationTestScreen() {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const requestAndFetchLocation = async () => {
    try {
      console.log("📍 Requesting location permissions...");
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setErrorMsg("Permission to access location was denied");
        Alert.alert("Permission Denied", "Please enable location access in Settings.");
        return;
      }

      console.log("🌍 Fetching current position...");
      const pos = await Location.getCurrentPositionAsync({});
      setLocation(pos);
      console.log("✅ Location received:", pos);
    } catch (err) {
      console.error("❌ Location error:", err);
      setErrorMsg(err.message);
    }
  };

  useEffect(() => {
    requestAndFetchLocation();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>📍 Location Test Screen</Text>
      {location ? (
        <Text style={styles.result}>
          Latitude: {location.coords.latitude}{"\n"}
          Longitude: {location.coords.longitude}{"\n"}
          Accuracy: {location.coords.accuracy} meters
        </Text>
      ) : errorMsg ? (
        <Text style={styles.error}>⚠️ Error: {errorMsg}</Text>
      ) : (
        <Text>🔄 Requesting location...</Text>
      )}

      <Button title="Retry" onPress={requestAndFetchLocation} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  header: {
    fontSize: 20,
    marginBottom: 20,
  },
  result: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: "center",
  },
  error: {
    color: "red",
    marginBottom: 20,
    textAlign: "center",
  },
});
