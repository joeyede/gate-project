import React, { useState, useEffect, Fragment } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TextInput, TouchableOpacity, Switch, Animated, Platform, GestureResponderEvent } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Font from 'expo-font';
import appJson from './app.json';

// Import MQTT client - Buffer is already polyfilled in index.ts
import mqtt, { MqttClient } from 'precompiled-mqtt';

const STORAGE_KEYS = {
  USERNAME: 'mqtt_username',
  PASSWORD: 'mqtt_password',
  REMEMBER_ME: 'remember_me'
};

// Helper to capitalize first letter
function capitalizeFirst(str: string) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [status, setStatus] = useState('Enter credentials');
  const [client, setClient] = useState<MqttClient | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [notification, setNotification] = useState('');
  const [notificationOpacity] = useState(new Animated.Value(0));
  const [showPassword, setShowPassword] = useState(false);
  const [pendingCommands] = useState<Map<string, string>>(new Map());
  const [statusDotColor, setStatusDotColor] = useState('#f44336'); // Default red
  const [loadingButton, setLoadingButton] = useState<string | null>(null);

  useEffect(() => {
    loadSavedPreferences();
  }, []);

  useEffect(() => {
    async function loadFonts() {
      try {
        await Font.loadAsync(MaterialIcons.font);
        await Font.loadAsync(MaterialCommunityIcons.font);
        setFontsLoaded(true);
      } catch (error) {
        console.error('Error loading fonts:', error);
        setFontsLoaded(true);
      }
    }
    loadFonts();
  }, []);

  useEffect(() => {
    if (notification) {
      Animated.sequence([
        Animated.timing(notificationOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: Platform.OS !== 'web'
        }),
        Animated.delay(2000),
        Animated.timing(notificationOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: Platform.OS !== 'web'
        })
      ]).start(() => {
        // Use setTimeout to safely schedule the state update
        setTimeout(() => {
          setNotification('');
        }, 0);
      });
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
          connectToMqtt(savedUsername, savedPassword);
        }
      }
    } catch (error) {
      console.error('Failed to load preferences:', error);
    }
  };

  const handleRememberMeToggle = async (value: boolean) => {
    setRememberMe(value);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.REMEMBER_ME, value.toString());
      if (!value) {
        await AsyncStorage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
      }
    } catch (error) {
      console.error('Failed to update remember me preference:', error);
    }
  };

  const saveCredentials = async (username: string, password: string) => {
    try {
      // Always save the remember me preference
      await AsyncStorage.setItem(STORAGE_KEYS.REMEMBER_ME, rememberMe.toString());
      
      if (rememberMe) {
        await AsyncStorage.setItem(STORAGE_KEYS.USERNAME, username);
        await AsyncStorage.setItem(STORAGE_KEYS.PASSWORD, password);
      } else {
        // Clear credentials if remember me is false
        await AsyncStorage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
      }
    } catch (error) {
      console.error('Failed to save credentials:', error);
    }
  };

  const connectToMqtt = async (providedUsername?: string, providedPassword?: string) => {
    const un = providedUsername || username;
    const pw = providedPassword || password;
    
    if (!un || !pw) {
      setStatus('Please enter both username and password');
      return;
    }

    try {
      const clientId = 'gate_app_' + Math.random().toString(16).substr(2, 8);
      const connectUrl = 'wss://3b62666a86a14b23956244c4308bad76.s1.eu.hivemq.cloud:8884/mqtt';
      
      const mqttClient = mqtt.connect(connectUrl, {
        clientId,
        username: un,
        password: pw,
        clean: true,
        reconnectPeriod: 3000,
        keepalive: 30,
        protocolVersion: 5,
        protocol: 'wss',
        rejectUnauthorized: false,
        properties: {
          sessionExpiryInterval: 300,
          receiveMaximum: 100,
          maximumPacketSize: 1024
        },
        will: {
          topic: 'gate/clients',
          payload: JSON.stringify({ clientId, status: 'offline' }),
          qos: 1,
          retain: false,
          properties: {
            willDelayInterval: 0,
            payloadFormatIndicator: true,
            messageExpiryInterval: 300
          }
        }
      });

      mqttClient.on('connect', () => {
        console.log('Connected to MQTT');
        setStatus('Connected');
        setIsConnected(true);
        setStatusDotColor('#4CAF50'); // Set dot to green on successful connection
        setClient(mqttClient);
        
        mqttClient.subscribe('gate/status', {
          qos: 1,
          properties: {
            subscriptionIdentifier: 100,
            userProperties: {
              app: 'gate-control'
            }
          }
        }, (err) => {
          if (err) {
            console.error('Subscribe error:', err);
          }
        });

        mqttClient.subscribe('gate/responses/#', {
          qos: 1,
          properties: {
            subscriptionIdentifier: 101,
            userProperties: {
              app: 'gate-control'
            }
          }
        }, (err) => {
          if (err) {
            console.error('Subscribe error:', err);
          }
        });

        saveCredentials(un, pw);
        showNotification('Connected successfully');
      });

      mqttClient.on('message', (topic, payload, packet) => {
        console.log('Message received:', topic, payload.toString(), packet);
        if (topic.startsWith('gate/responses/')) {
            try {
                const data = JSON.parse(payload.toString());
                if (packet.properties?.correlationData) {
                    const correlationId = Buffer.from(packet.properties.correlationData).toString();
                    const action = pendingCommands.get(correlationId);
                    if (action) {
                        pendingCommands.delete(correlationId);
                        const status = data.status === 'success' ? 'Success' : 'Failed';
                        setStatus(`${action}: ${status}`);
                        setStatusDotColor(data.status === 'success' ? '#4CAF50' : '#f44336'); // Green on success, red on failure
                    }
                }
            } catch (error) {
                console.error('Error parsing response:', error);
            }
        }
      });

      mqttClient.on('error', (err) => {
        console.error('MQTT Error:', err);
        let userFriendlyMessage = 'Connection failed';
        if (err.message?.includes('not authorized')) {
          userFriendlyMessage = 'Connection failed: Invalid username or password';
        }
        setStatus(userFriendlyMessage);
        showNotification('Connection failed');
      });

      mqttClient.on('close', () => {
        console.log('Connection closed');
        setStatus('Disconnected');
        setIsConnected(false);
      });

    } catch (error) {
      console.error('Setup error:', error);
      setStatus('Setup Error: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const sendCommand = (action: string) => {
    if (!client || !isConnected) {
      setStatus('Not connected');
      showNotification('Not connected to MQTT');
      return;
    }

    setLoadingButton(action);
    setStatusDotColor('#FFC107'); // Yellow during send
    try {
      const correlationId = Math.random().toString(36).substring(2, 15);
      pendingCommands.set(correlationId, action);

      client.publish('gate/control', 
        JSON.stringify({ action }), 
        { 
          qos: 1,
          properties: {
            messageExpiryInterval: 60,
            responseTopic: `gate/responses/${client.options.clientId}`,
            correlationData: Buffer.from(correlationId),
            userProperties: {
              source: 'gate-app',
              type: 'command'
            }
          }
        }, 
        (error) => {
          if (error) {
            console.error('Send command error:', error);
            setStatus(`Error: ${error.message}`);
            showNotification('Failed to send command');
            pendingCommands.delete(correlationId);
            setStatusDotColor('#f44336'); // Red on failure
          } else {
            setStatus(`Sent: ${action}`);
          }
          setLoadingButton(null);
        }
      );
    } catch (error) {
      console.error('Send command error:', error);
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      showNotification('Failed to send command');
      setStatusDotColor('#f44336'); // Red on failure
      setLoadingButton(null);
    }
  };

  const handleLogout = async () => {
    if (client) {
      client.end(false, { 
        properties: { 
          sessionExpiryInterval: 0,
          reasonString: 'User logout'
        } 
      }, async () => {
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
      });
    }
  };

  if (!fontsLoaded) {
    return (
      <Fragment>
        <View style={styles.container}>
          <ActivityIndicator size="large" />
        </View>
      </Fragment>
    );
  }

  const handleTouch = (onPress: () => void) => ({
    onTouchStart: (e: GestureResponderEvent) => {
      if (Platform.OS === 'web') {
        // @ts-ignore - Web-only property
        e.preventDefault();
      }
    },
    onPress,
  });

  const handleSubmit = () => {
    if (username && password) {
      connectToMqtt();
    }
  };

  const renderLoginScreen = () => (
    <View style={styles.container}>
      <Text style={styles.title}>Gate Control</Text>
      <Text style={styles.version}>v{appJson.expo.version}</Text>
      <Text style={[styles.status, status.includes('Error') && styles.error]}>{status}</Text>
      <View style={[styles.inputContainer, { flex: Platform.OS === 'web' ? 0 : undefined }]}>
        <View style={{ width: '100%' }}>
          <TextInput
            style={styles.input}
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleSubmit}
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
              onSubmitEditing={handleSubmit}
            />
            <TouchableOpacity 
              style={[
                styles.visibilityToggle
              ]}
              {...handleTouch(() => setShowPassword(!showPassword))}>
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
            style={[
              styles.connectButton
            ]} 
            disabled={!username || !password}
            {...handleTouch(handleSubmit)}>
            <Text style={styles.buttonText}>Connect</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderMainScreen = () => (
    <View style={[styles.container]}>
      <Text style={styles.title}>Gate Control</Text>
      <Text style={styles.version}>v{appJson.expo.version}</Text>
      <View style={styles.header}>
        <View style={styles.statusContainer}>
          <View style={[styles.connectionDot, { backgroundColor: statusDotColor }]} />
          <Text style={[styles.status, status.includes('Error') && styles.error]}>{capitalizeFirst(status)}</Text>
        </View>
        <TouchableOpacity 
          style={styles.logoutButton}
          {...handleTouch(handleLogout)}>
          <MaterialIcons name="logout" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>
      <View style={styles.stableContainer}>
        <View style={styles.gridContainer}>
          <Fragment>
            <View style={styles.row}>
              <TouchableOpacity 
                style={[styles.gridButton, loadingButton === 'pedestrian' && styles.buttonDisabled]} 
                disabled={loadingButton !== null || !client}
                {...handleTouch(() => sendCommand('pedestrian'))}>
                <MaterialIcons name="directions-walk" size={32} color="white" />
                <Text style={styles.buttonText}>Pedestrian</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.gridButton, loadingButton === 'full' && styles.buttonDisabled]} 
                disabled={loadingButton !== null || !client}
                {...handleTouch(() => sendCommand('full'))}>
                <MaterialCommunityIcons name="gate-open" size={32} color="white" />
                <Text style={styles.buttonText}>Full Open</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TouchableOpacity 
                style={[styles.gridButton, loadingButton === 'left' && styles.buttonDisabled]} 
                disabled={loadingButton !== null || !client}
                {...handleTouch(() => sendCommand('left'))}>
                <MaterialIcons name="arrow-back" size={32} color="white" />
                <Text style={styles.buttonText}>Left</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.gridButton, loadingButton === 'right' && styles.buttonDisabled]} 
                disabled={loadingButton !== null || !client}
                {...handleTouch(() => sendCommand('right'))}>
                <MaterialIcons name="arrow-forward" size={32} color="white" />
                <Text style={styles.buttonText}>Right</Text>
              </TouchableOpacity>
            </View>
          </Fragment>
        </View>
        {loadingButton !== null ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator />
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <Fragment>
      <View style={{ flex: 1 }}>
        {!isConnected ? renderLoginScreen() : renderMainScreen()}
      </View>
      
      {/* Notification overlay completely separate from main UI */}
      {notification ? (
        <Animated.View 
          style={[styles.notificationOverlay, { opacity: notificationOpacity }]}
          pointerEvents="none"
        >
          <Text style={styles.notificationText}>{notification}</Text>
        </Animated.View>
      ) : null}
    </Fragment>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#007AFF',
    textAlign: 'center',
  },
  version: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
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
    maxWidth: 400,
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
    marginBottom: 15,
  },
  header: {
    width: '100%',
    maxWidth: 600,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 30,
    alignSelf: 'center',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginLeft: 40,
    minHeight: 24,
  },
  logoutButton: {
    padding: 8,
    marginRight: 40,
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
    marginRight: 0,
  },
  notificationOverlay: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
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
  },
  gridContainer: {
    width: '100%',
    maxWidth: 600,
    paddingHorizontal: 20,
    gap: 20,
  },
  stableContainer: {
    width: '100%',
    maxWidth: 600,
    minHeight: 400,
    position: 'relative',
  },
  loaderContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    zIndex: 5,
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
    aspectRatio: 1,
    maxWidth: 250,
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
    marginLeft: 8,
    marginTop: 20,
    marginBottom: 20,
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
    overflow: 'hidden',
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 10,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  visibilityToggle: {
    padding: 8,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
