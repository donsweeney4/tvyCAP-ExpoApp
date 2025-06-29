import Toast from 'react-native-root-toast';
import { Dimensions } from 'react-native';

const screenHeight = Dimensions.get('window').height; // Get screen height

export const showToastAsync = (message, duration = 3000) => {
  return new Promise((resolve) => {
    Toast.show(message, {
      duration: duration,
       position: Toast.positions.CENTER, 
      shadow: true,
      animation: true,
      hideOnPress: true,
      delay: 0,
      opacity: 1,
      containerStyle: {
        backgroundColor: 'blue',
        borderRadius: 10,
        padding: 10,
      },
      textStyle: {
        color: 'yellow',
        fontSize: 20,
      },
    });
    setTimeout(resolve, duration);
  });
};