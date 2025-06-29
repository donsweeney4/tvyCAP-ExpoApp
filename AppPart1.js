import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MainScreen from './MainScreen1';
import SettingsScreen from './Settings1'; // Import the Settings screen

// --- IMPORTANT: Import ToastContainer here ---
import ToastContainer from 'react-native-root-toast/lib/ToastContainer';

if (!__DEV__) {
  console.log = () => {};  // Disable all console logs in production
  console.warn = () => {}; // Disable warnings
  console.error = () => {}; // Disable errors (optional)
}

const Tab = createBottomTabNavigator();

export default function App() { // This 'App' component is your actual root
  return (
    <> {/* Use a Fragment here to wrap both the NavigationContainer and ToastContainer */}
      <NavigationContainer>
        <Tab.Navigator>
          <Tab.Screen name="Main" component={MainScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>

      {/* --- RENDER THE TOASTCONTAINER HERE --- */}
      <ToastContainer />
    </>
  );
}