import React, { useEffect, useState } from 'react';
import { View, Text, Button, FlatList } from 'react-native';
import * as SQLite from 'expo-sqlite/next';

// Open database asynchronously
const db = SQLite.openDatabaseAsync('sensor_data.db');

export default function App() {
  const [records, setRecords] = useState([]);

  useEffect(() => {
    const initializeDatabase = async () => {
      try {
        const database = await db;

        // Create table with required columns
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS sensor_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            temperature INTEGER,
            location INTEGER
          );
        `);

        // Check if data exists
        const existingData = await database.getAllAsync('SELECT * FROM sensor_data;');
        if (existingData.length === 0) {
          await insertMockData(); // Insert mock data if table is empty
        } else {
          fetchRecords();
        }
      } catch (error) {
        console.error('Database initialization error:', error);
      }
    };

    initializeDatabase();
  }, []);

  // Function to insert 10 rows of simulated data
  const insertMockData = async () => {
    try {
      const database = await db;
      for (let i = 1; i <= 10; i++) {
        const timestamp = Math.floor(Date.now() / 1000); // UNIX timestamp
        const temperature = Math.floor(Math.random() * 30) + 10; // Simulated temp (10°C to 40°C)
        const location = Math.floor(Math.random() * 5) + 1; // Simulated location (1 to 5)

        await database.runAsync(
          'INSERT INTO sensor_data (timestamp, temperature, location) VALUES (?, ?, ?);',
          [timestamp, temperature, location]
        );
      }
      fetchRecords();
    } catch (error) {
      console.error('Error inserting mock data:', error);
    }
  };

  // Function to fetch all records
  const fetchRecords = async () => {
    try {
      const database = await db;
      const result = await database.getAllAsync('SELECT * FROM sensor_data ORDER BY id DESC;');
      setRecords(result);
    } catch (error) {
      console.error('Error fetching records:', error);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Button title="Insert 10 More Rows" onPress={insertMockData} />
      <FlatList
        data={records}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <Text>{`ID: ${item.id}, Temp: ${item.temperature}°C, Loc: ${item.location}, Time: ${item.timestamp}`}</Text>
        )}
      />
    </View>
  );
}
