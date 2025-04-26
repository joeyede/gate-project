import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TextInput, TouchableOpacity, Switch, Animated, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import init from 'react_native_mqtt';
import * as Font from 'expo-font';

// Initialize MQTT client
init({
  size: 10000,
  storageBackend: AsyncStorage,
  defaultExpires: 1000 * 3600 * 24,
  enableCache: true,
  sync: {}
});

// Import Paho from global scope after initialization
const Paho = global.Paho;

const STORAGE_KEYS = {
  USERNAME: 'mqtt_username',
  PASSWORD: 'mqtt_password',
  REMEMBER_ME: 'remember_me'
};

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [status, setStatus] = useState('Enter credentials');
  const [loading, setLoading] = useState(false);
  const [client, setClient] = useState<any>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [notification, setNotification] = useState('');
  const [notificationOpacity] = useState(new Animated.Value(0));
  const [showPassword, setShowPassword] = useState(false);

  // Load saved preferences on startup
  useEffect(() => {
    loadSavedPreferences();
  }, []);

  // Load fonts
  useEffect(() => {
    async function loadFonts() {
      try {
        await Font.loadAsync(MaterialIcons.font);
        await Font.loadAsync(MaterialCommunityIcons.font);
        setFontsLoaded(true);
      } catch (error) {
        console.error('Error loading fonts:', error);
        // Even if fonts fail to load, we should still show the app
        setFontsLoaded(true);
      }
    }
    loadFonts();
  }, []);

  // Handle notification animations
  useEffect(() => {
    if (notification) {
      Animated.sequence([
        Animated.timing(notificationOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true
        }),
        Animated.delay(2000),
        Animated.timing(notificationOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true
        })
      ]).start(() => setNotification(''));
    }
  }, [notification]);

  const showNotification = (message: string) => {
    setNotification(message);
  };

  const loadSavedPreferences = async () => {
    try {
      const savedRememberMe = await AsyncStorage.getItem(STORAGE_KEYS.REMEMBER_ME);
      setRememberMe(savedRememberMe === 'true');

      if (savedRememberMe === 'true') {
        const savedUsername = await AsyncStorage.getItem(STORAGE_KEYS.USERNAME);
        const savedPassword = await AsyncStorage.getItem(STORAGE_KEYS.PASSWORD);
        
        if (savedUsername && savedPassword) {
          setUsername(savedUsername);
          setPassword(savedPassword);
          // Auto connect if we have saved credentials
          connectToMqtt(savedUsername, savedPassword);
        }
      }
    } catch (error) {
      console.error('Failed to load preferences:', error);
    }
  };

  const saveCredentials = async (username: string, password: string) => {
    try {
      if (rememberMe) {
        await AsyncStorage.setItem(STORAGE_KEYS.USERNAME, username);
        await AsyncStorage.setItem(STORAGE_KEYS.PASSWORD, password);
      }
      await AsyncStorage.setItem(STORAGE_KEYS.REMEMBER_ME, rememberMe.toString());
    } catch (error) {
      console.error('Failed to save credentials:', error);
    }
  };

  const handleRememberMeToggle = (value: boolean) => {
    setRememberMe(value);
    if (!value) {
      // Clear saved credentials if remember me is turned off
      AsyncStorage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
    }
  };

  const connectToMqtt = (providedUsername?: string, providedPassword?: string) => {
    // Use the provided values or fall back to state values
    const un = providedUsername || username;
    const pw = providedPassword || password;
    
    if (!un || !pw) {
      setStatus('Please enter both username and password');
      return;
    }

    setLoading(true);
    try {
      const clientId = 'gate_app_' + Math.random().toString(16).substr(2, 8);
      const client = new Paho.MQTT.Client(
        '3b62666a86a14b23956244c4308bad76.s1.eu.hivemq.cloud',
        8884,
        '/mqtt',
        clientId
      );

      // Add reconnection handling
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 5;
      const reconnectInterval = 3000;

      client.onConnectionLost = (responseObject: any) => {
        if (responseObject.errorCode !== 0) {
          console.log('Connection lost:', responseObject.errorMessage);
          setStatus('Disconnected: ' + responseObject.errorMessage);
          setIsConnected(false);

          // Attempt to reconnect
          if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            setStatus(`Reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
            setTimeout(() => {
              if (!isConnected) {
                client.connect(connectOptions);
              }
            }, reconnectInterval);
          } else {
            setStatus('Failed to reconnect after multiple attempts');
          }
        }
      };

      client.onMessageArrived = (message: any) => {
        console.log('Message received:', message.payloadString);
      };

      const connectOptions = {
        onSuccess: () => {
          console.log('Connected to MQTT');
          setStatus('Connected');
          setIsConnected(true);
          setLoading(false);
          setClient(client);
          reconnectAttempts = 0; // Reset reconnect attempts on successful connection
          // Save credentials only after successful connection
          saveCredentials(un, pw);
          showNotification('Connected successfully');
        },
        onFailure: (err: any) => {
          console.error('MQTT Error:', err);
          // Convert technical error message to user-friendly message
          let userFriendlyMessage = 'Connection failed';
          if (err.errorMessage.includes('not authorized')) {
            userFriendlyMessage = 'Connection failed: Invalid username or password';
          }
          setStatus(userFriendlyMessage);
          setLoading(false);
          showNotification('Connection failed');
        },
        useSSL: true,
        userName: un,
        password: pw,
        timeout: 3,
        keepAliveInterval: 30
      };

      client.connect(connectOptions);

    } catch (error) {
      console.error('Setup error:', error);
      setStatus('Setup Error: ' + (error instanceof Error ? error.message : String(error)));
      setLoading(false);
    }
  };

  // Add logout functionality
  const handleLogout = async () => {
    if (client) {
      client.disconnect();
    }
    setClient(null);
    setIsConnected(false);
    setStatus('Logged out');
    showNotification('Logged out successfully');
    
    if (!rememberMe) {
      try {
        await AsyncStorage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
        setUsername('');
        setPassword('');
      } catch (error) {
        console.error('Failed to clear credentials:', error);
      }
    }
  };

  const sendCommand = (action: string) => {
    if (!client || !isConnected) {
      setStatus('Not connected');
      showNotification('Not connected to MQTT');
      return;
    }

    setLoading(true);
    try {
      const message = new Paho.MQTT.Message(JSON.stringify({ action }));
      message.destinationName = 'gate/control';
      message.qos = 1;
      client.send(message);
      setStatus(`Sent: ${action}`);
      showNotification(`Command sent: ${action}`);
      setLoading(false);
    } catch (error) {
      console.error('Send command error:', error);
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      showNotification('Failed to send command');
      setLoading(false);
    }
  };

  if (!fontsLoaded) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isConnected) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Gate Control</Text>
        <Text style={[styles.status, status.includes('Error') && styles.error]}>
          {status}
        </Text>
        <View style={[styles.inputContainer, { flex: Platform.OS === 'web' ? 0 : undefined }]}>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && username && password) {
                connectToMqtt();
              }
            }}
            style={{ width: '100%' }}
          >
            <TextInput
              style={styles.input}
              placeholder="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => {
                if (!loading && username && password) {
                  connectToMqtt();
                }
              }}
            />
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => {
                  if (!loading && username && password) {
                    connectToMqtt();
                  }
                }}
              />
              <TouchableOpacity 
                style={styles.visibilityToggle}
                onPress={() => setShowPassword(!showPassword)}
              >
                <MaterialIcons 
                  name={showPassword ? "visibility-off" : "visibility"} 
                  size={24} 
                  color="#666"
                />
              </TouchableOpacity>
            </View>
            <View style={styles.rememberMeContainer}>
              <Text>Remember me</Text>
              <Switch
                value={rememberMe}
                onValueChange={handleRememberMeToggle}
              />
            </View>
            <TouchableOpacity 
              style={[styles.connectButton, loading && styles.buttonDisabled]} 
              onPress={() => connectToMqtt()}
              disabled={loading || !username || !password}
            >
              <Text style={styles.buttonText}>Connect</Text>
            </TouchableOpacity>
          </form>
        </View>
        {loading && <ActivityIndicator style={styles.loader} />}
        {notification && (
          <Animated.View style={[styles.notification, { opacity: notificationOpacity }]}>
            <Text style={styles.notificationText}>{notification}</Text>
          </Animated.View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gate Control</Text>
      <View style={styles.header}>
        <View style={styles.statusContainer}>
          <View style={[styles.connectionDot, { backgroundColor: isConnected ? '#4CAF50' : '#f44336' }]} />
          <Text style={[styles.status, status.includes('Error') && styles.error]}>
            {status}
          </Text>
        </View>
        <TouchableOpacity 
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <MaterialIcons name="logout" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>
      
      <View style={styles.gridContainer}>
        <View style={styles.row}>
          <TouchableOpacity 
            style={[styles.gridButton, loading && styles.buttonDisabled]} 
            onPress={() => sendCommand('pedestrian')}
            disabled={loading || !client}
          >
            <MaterialIcons name="directions-walk" size={32} color="white" />
            <Text style={styles.buttonText}>Pedestrian</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.gridButton, loading && styles.buttonDisabled]} 
            onPress={() => sendCommand('full')}
            disabled={loading || !client}
          >
            <MaterialCommunityIcons name="gate-open" size={32} color="white" />
            <Text style={styles.buttonText}>Full Open</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.row}>
          <TouchableOpacity 
            style={[styles.gridButton, loading && styles.buttonDisabled]} 
            onPress={() => sendCommand('left')}
            disabled={loading || !client}
          >
            <MaterialIcons name="arrow-back" size={32} color="white" />
            <Text style={styles.buttonText}>Left</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.gridButton, loading && styles.buttonDisabled]} 
            onPress={() => sendCommand('right')}
            disabled={loading || !client}
          >
            <MaterialIcons name="arrow-forward" size={32} color="white" />
            <Text style={styles.buttonText}>Right</Text>
          </TouchableOpacity>
        </View>
      </View>
      {loading && <ActivityIndicator style={styles.loader} />}
      {notification && (
        <Animated.View style={[styles.notification, { opacity: notificationOpacity }]}>
          <Text style={styles.notificationText}>{notification}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#007AFF',
    textAlign: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  inputContainer: {
    width: '100%',
    maxWidth: 400, // Constrain width on larger screens
    gap: 10,
    marginBottom: 20,
  },
  input: {
    width: '100%',
    height: 40,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    paddingHorizontal: 10,
    marginBottom: 15, // Add spacing between input fields
  },
  loader: {
    marginTop: 20,
  },
  header: {
    width: '100%',
    maxWidth: 600,
    flexDirection: 'row',
    justifyContent: 'flex-start', // Align to start to position status on the left
    alignItems: 'center',
    marginBottom: 30,
    alignSelf: 'center',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginLeft: 40, // Align with buttons
  },
  logoutButton: {
    padding: 8,
    marginRight: 40, // Match left margin for symmetry
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 10,
  },
  connectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  notification: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  notificationText: {
    color: '#fff',
    fontSize: 14,
  },
  connectButton: {
    width: '100%',
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  gridContainer: {
    width: '100%',
    maxWidth: 600, // Constrain width on larger screens
    paddingHorizontal: 20,
    gap: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 20,
  },
  gridButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    aspectRatio: 1,
    maxWidth: 250, // Constrain individual button width
  },
  buttonDisabled: {
    backgroundColor: '#A5A5A5',
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
    marginTop: 8,
  },
  status: {
    fontSize: 16,
    marginLeft: 0,
    marginTop: 20, // Add space above status text
    marginBottom: 20, // Add space below status text
  },
  error: {
    color: 'red',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    height: 40,
    marginBottom: 15,
    width: '100%',
    backgroundColor: '#fff',
    overflow: 'hidden', // This will help contain the input
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 10,
    borderWidth: 0,
    backgroundColor: 'transparent', // Make background transparent
  },
  visibilityToggle: {
    padding: 8,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center', // Center the icon
  },
});
