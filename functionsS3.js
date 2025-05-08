import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite/next';
import { Alert, Platform } from 'react-native';
import { showToastAsync } from './utils'; // Your custom toast function
/*

This is called when the user clicks the upload button.
It uploads the database to S3 using a presigned URL.


It first checks if the database file exists and if the user is sampling.
It then checks if the jobcode and rownumber columns exist in the database.
If they don't, it adds them.

*/

///////////////////////////////////////////////////////////////////////////////////////////////////
export const uploadDatabaseToS3 = async (
  dbFilePath,
  jobcodeRef,
  isSamplingRef
) => {
  try {
    console.log(`Uploading database file. Sampling is ${isSamplingRef.current}`);

    if (isSamplingRef.current) {
      await showToastAsync("Sampling in Progress. Stop sampling before uploading.", 2000);
      return;
    }

    if (!dbFilePath || typeof dbFilePath !== "string") {
      console.error("❌ Error: dbFilePath is not valid:", dbFilePath);
      Alert.alert("Error", "Database file path is invalid.");
      return;
    }

    const fileExists = await FileSystem.getInfoAsync(dbFilePath);
    if (!fileExists.exists) {
      console.warn("⚠️ Database file does not exist.");
      Alert.alert("Error", "Database file not found.");
      return;
    }

    const db = await SQLite.openDatabaseAsync("appData.db");

    const checkColumnExists = async (columnName) => {
      const result = await db.getAllAsync(`PRAGMA table_info(appData);`);
      return result.some(row => row.name === columnName);
    };

    if (!(await checkColumnExists("jobcode"))) {
      await db.execAsync(`ALTER TABLE appData ADD COLUMN jobcode TEXT;`);
    }
    await db.runAsync(`UPDATE appData SET jobcode = ?`, [jobcodeRef.current]);

    if (!(await checkColumnExists("rownumber"))) {
      await db.execAsync(`ALTER TABLE appData ADD COLUMN rownumber INTEGER;`);
    }
    await db.runAsync(
      `UPDATE appData 
       SET rownumber = rowid - (SELECT MIN(rowid) FROM appData) + 1;`
    );

    const appData = await db.getAllAsync("SELECT * FROM appData;");
    if (appData.length === 0) {
      Alert.alert("No Data", "There is no data in the database.");
      return;
    }

    const jobcode = jobcodeRef.current;
    const csvHeader = "rownumber,jobcode,Timestamp,Local Date,Local Time,Temperature (°C),Humidity (%),Latitude,Longitude,Altitude (m),Accuracy (m),Speed (MPH)\n";
    const csvBody = appData
      .map(({ rownumber, jobcode, timestamp, temperature, humidity, latitude, longitude, altitude, accuracy, speed }) => {
        const dateObj = new Date(timestamp);
        const localDate = dateObj.toLocaleDateString();
        const localTime = dateObj.toLocaleTimeString([], { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const speedMph = ((speed * 1e-2) * 2.23694).toFixed(2);
        return `${rownumber},${jobcode},${timestamp},${localDate},${localTime},${(temperature * 1e-2).toFixed(2)},${humidity.toFixed(1)},${(latitude * 1e-7).toFixed(6)},${(longitude * 1e-7).toFixed(6)},${(altitude * 1e-2).toFixed(2)},${(accuracy * 1e-2).toFixed(2)},${speedMph}`;
      })
      .join("\n");

    const csvContent = csvHeader + csvBody;
    const shareablePath = FileSystem.cacheDirectory + `${jobcode}.csv`;
    await FileSystem.writeAsStringAsync(shareablePath, csvContent, { encoding: FileSystem.EncodingType.UTF8 });

    // ✅ Upload to S3 via presigned URL
    const uploadFilename = `${jobcode}_${Date.now()}.csv`;
    const presignedUrl = await getPresignedS3Url(uploadFilename); // Call your backend

    const fileContent = await FileSystem.readAsStringAsync(shareablePath, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    const uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/csv',
      },
      body: fileContent,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status ${uploadResponse.status}`);
    }

    console.log("✅ Upload successful:", uploadFilename);
    await showToastAsync("File uploaded to cloud storage", 2000);
    await FileSystem.deleteAsync(shareablePath, { idempotent: true });
    await db.closeAsync();
  } catch (error) {
    console.error("❌ Error uploading database to S3:", error);
    Alert.alert("Error", "Failed to upload data.");
  }
};


///////////////////////////////////////////////////////////////////////////////////
// api.js

export async function getPresignedS3Url(filename) {
    try {
      const response = await fetch('http://mobile.quest-science.net/get_presigned_url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename }),
      });
  
      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Server error: ${error.error || response.status}`);
      }
  
      const data = await response.json();
      return {
        uploadUrl: data.uploadUrl,
        publicUrl: data.publicUrl,
      };
    } catch (err) {
      console.error('❌ Error fetching presigned S3 URL:', err);
      throw err;
    }
  }


  