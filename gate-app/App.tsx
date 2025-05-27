import React, { useState, useEffect, Fragment } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TextInput, TouchableOpacity, Switch, Animated, Platform, GestureResponderEvent } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as appJson from './app.json';



// Helper to abstract storage - simplified to use only AsyncStorage
const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const value = await AsyncStorage.getItem(key);
      console.log(`Storage.getItem: ${key} = ${value !== null ? JSON.stringify(value) : 'null'} (type: ${typeof value})`);
      return value;
    } catch (error) {
      console.error(`Error getting item ${key}:`, error);
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      console.log(`Storage.setItem: ${key} = ${JSON.stringify(value)} (type: ${typeof value})`);
      await AsyncStorage.setItem(key, value);
      console.log(`Storage.setItem completed for ${key}`);
    } catch (error) {
      console.error(`Error setting item ${key}:`, error);
    }
  },
  async multiRemove(keys: string[]): Promise<void> {
    try {
      console.log(`Storage.multiRemove: ${keys.join(', ')}`);
      await AsyncStorage.multiRemove(keys);
      console.log(`Storage.multiRemove completed for: ${keys.join(', ')}`);
    } catch (error) {
      console.error(`Error removing items ${keys.join(', ')}:`, error);
    }
  },
  // Debug function to see all stored values
  async getAllKeys(): Promise<readonly string[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      console.log('All AsyncStorage keys:', keys);
      return keys;
    } catch (error) {
      console.error('Error getting all keys:', error);
      return [];
    }
  },
  async debugStorage(): Promise<void> {
    try {
      const keys = await this.getAllKeys();
      const relevantKeys = keys.filter(key => 
        key === STORAGE_KEYS.REMEMBER_ME || 
        key === STORAGE_KEYS.USERNAME || 
        key === STORAGE_KEYS.PASSWORD
      );
      
      console.log('=== STORAGE DEBUG ===');
      for (const key of relevantKeys) {
        const value = await this.getItem(key);
        console.log(`${key}: ${JSON.stringify(value)}`);
      }
      console.log('=== END STORAGE DEBUG ===');
    } catch (error) {
      console.error('Error debugging storage:', error);
    }
  }
};

// Import MQTT client - Buffer is already polyfilled in index.ts
import * as mqtt from 'precompiled-mqtt';
import type { MqttClient } from 'precompiled-mqtt';

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
  const [isInsideView, setIsInsideView] = useState(true); // Default to inside view

  // Fix viewport on web, especially for iPhone
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleResize = () => {
        // Force a re-render to handle viewport changes
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
        
        // Additional iPhone-specific fixes
        if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
          // Prevent zoom on input focus
          const viewport = document.querySelector('meta[name="viewport"]');
          if (viewport) {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
          }
          
          // Force body height to match viewport
          document.body.style.height = `${window.innerHeight}px`;
          document.documentElement.style.height = `${window.innerHeight}px`;
        }
      };

      // Set initial viewport height
      handleResize();
      
      // Listen for resize events (orientation changes, etc.)
      window.addEventListener('resize', handleResize);
      window.addEventListener('orientationchange', () => {
        // Delay to allow orientation change to complete
        setTimeout(handleResize, 100);
      });
      
      // Also handle when screen transitions happen
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          setTimeout(handleResize, 100);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, []);

  // Additional useEffect to handle viewport when connection state changes
  useEffect(() => {
    if (Platform.OS === 'web' && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      // Recalculate viewport when switching between login and main screen
      setTimeout(() => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
        document.body.style.height = `${window.innerHeight}px`;
        document.documentElement.style.height = `${window.innerHeight}px`;
      }, 100);
    }
  }, [isConnected]);

  useEffect(() => {
    console.log('App initialized, loading saved preferences');
    
    // Debug storage state first
    storage.debugStorage().then(() => {
      loadSavedPreferences();
    });
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
    console.log('Loading saved preferences...');
    try {
      // Get ALL storage values for debugging
      const allValues = await Promise.all([
        storage.getItem(STORAGE_KEYS.REMEMBER_ME),
        storage.getItem(STORAGE_KEYS.USERNAME),
        storage.getItem(STORAGE_KEYS.PASSWORD)
      ]);
      
      const [savedRememberMe, savedUsername, savedPassword] = allValues;
      
      console.log('Raw storage values retrieved:', {
        REMEMBER_ME: savedRememberMe,
        USERNAME: savedUsername ? '***SET***' : null,
        PASSWORD: savedPassword ? '***SET***' : null
      });
      
      // Default to false if not found or invalid
      const shouldRemember = savedRememberMe === 'true';
      console.log('Boolean conversion - savedRememberMe:', JSON.stringify(savedRememberMe), '-> shouldRemember:', shouldRemember);
      
      console.log('Setting remember me to:', shouldRemember);
      setRememberMe(shouldRemember);
      
      console.log('Loaded from storage:', {
        rememberMe: shouldRemember,
        hasUsername: !!savedUsername,
        hasPassword: !!savedPassword
      });
      
      // Check for inconsistent state and fix it
      if (shouldRemember === false && (savedUsername || savedPassword)) {
        console.warn('Found inconsistent state: Remember Me is OFF but credentials exist. Fixing...');
        console.warn('State details:', {
          shouldRemember,
          savedRememberMe,
          hasUsername: !!savedUsername,
          hasPassword: !!savedPassword
        });
        try {
          await storage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
          console.log('Cleared inconsistent credentials');
        } catch (e) {
          console.error('Failed to clear inconsistent credentials:', e);
        }
      } else if (savedUsername && savedPassword) {
        // We have credentials, use them
        console.log('Setting saved username and password');
        setUsername(savedUsername);
        setPassword(savedPassword);
        
        // Only auto-connect if remember me was true
        if (shouldRemember) {
          console.log('Auto-connecting with saved credentials');
          // Small delay to ensure state is updated
          setTimeout(() => connectToMqtt(savedUsername, savedPassword), 100);
        } else {
          console.log('Found credentials but remember me is false, not auto-connecting');
        }
      } else {
        console.log('No saved credentials found');
      }
    } catch (error) {
      console.error('Failed to load preferences:', error);
    }
  };

  const handleRememberMeToggle = async (value: boolean) => {
    console.log('Remember Me toggle changed to:', value);
    // Update the UI immediately
    setRememberMe(value);
    
    try {
      // Save the remember me setting
      console.log('About to save remember me setting:', value, 'as string:', value.toString());
      await storage.setItem(STORAGE_KEYS.REMEMBER_ME, value.toString());
      console.log('Saved remember me setting:', value);
      
      // Verify it was saved correctly by reading it back
      const verification = await storage.getItem(STORAGE_KEYS.REMEMBER_ME);
      console.log('Verification read back:', verification, 'matches expected:', verification === value.toString());
      
      // If turning off remember me, we should clear credentials when user logs out
      // We don't clear them here to avoid losing the current connection
      if (!value) {
        console.log('Remember Me turned off - credentials will be cleared on logout');
      } else if (username && password && isConnected) {
        // If we're already connected and turning on remember me, save credentials now
        console.log('Remember Me turned on - saving current credentials');
        await saveCredentials(username, password);
      }
    } catch (error) {
      console.error('Failed to update remember me preference:', error);
    }
  };

  const saveCredentials = async (username: string, password: string) => {
    console.log('Saving credentials, remember me =', rememberMe);
    try {
      // Always save the remember me preference first
      const saveRememberMeSuccess = await persistToStorage(
        STORAGE_KEYS.REMEMBER_ME, 
        rememberMe.toString(), 
        'Remember Me preference'
      );
      
      if (rememberMe) {
        // Save credentials if remember me is true
        console.log('Remember Me is ON - saving username and password');
        
        // Save username
        const usernameSuccess = await persistToStorage(
          STORAGE_KEYS.USERNAME,
          username,
          'username'
        );
        
        // Save password
        const passwordSuccess = await persistToStorage(
          STORAGE_KEYS.PASSWORD,
          password,
          'password'
        );
        
        if (usernameSuccess && passwordSuccess) {
          console.log('Credentials successfully saved to storage');
        } else {
          console.warn('Failed to save some credential data');
        }
      } else {
        console.log('Remember Me is OFF - credentials will be cleared on logout');
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

        // Save credentials when successfully connected (but not during auto-connect)
        setUsername(un); // Make sure state variables are updated
        setPassword(pw);
        
        // Only save credentials if this wasn't an auto-connect with existing credentials
        // Auto-connect means credentials are already saved, so don't re-save them
        if (!providedUsername || !providedPassword) {
          // This is a manual login, save the credentials
          saveCredentials(un, pw);
        } else {
          console.log('Auto-connect successful - not re-saving already saved credentials');
        }
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

    // Fix the left/right command mapping based on view perspective
    let actualAction = action;
    if (action === 'left' || action === 'right') {
      if (isInsideView) {
        // From inside view: left = left, right = right (direct mapping)
        actualAction = action;
      } else {
        // From outside view: swap commands because you're looking from opposite perspective
        actualAction = action === 'left' ? 'right' : 'left';
      }
    }

    // Debug logging
    console.log(`Sending command - Button: ${action}, View: ${isInsideView ? 'Inside' : 'Outside'}, Actual: ${actualAction}`);

    setLoadingButton(action);
    setStatusDotColor('#FFC107'); // Yellow during send
    try {
      const correlationId = Math.random().toString(36).substring(2, 15);
      pendingCommands.set(correlationId, action);

      const payload = JSON.stringify({ action: actualAction });
      console.log(`Publishing to gate/control: ${payload}`);

      client.publish('gate/control', 
        payload, 
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
            setStatus(`Sent: ${action} (${actualAction})`);
            console.log(`Command sent successfully: ${action} -> ${actualAction}`);
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

        try {
          if (!rememberMe) {
            console.log('Logging out with Remember Me OFF - clearing credentials');
            await storage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
            setUsername('');
            setPassword('');
          } else {
            console.log('Logging out with Remember Me ON - keeping saved credentials');
          }
        } catch (error) {
          console.error('Failed to handle credentials during logout:', error);
        }
      });
    }
  };

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
                <MaterialIcons 
                  name={isInsideView ? "home" : "park"} 
                  size={16} 
                  color="rgba(255, 255, 255, 0.7)" 
                  style={styles.buttonIndicator}
                />
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.gridButton, loadingButton === 'right' && styles.buttonDisabled]} 
                disabled={loadingButton !== null || !client}
                {...handleTouch(() => sendCommand('right'))}>
                <MaterialIcons name="arrow-forward" size={32} color="white" />
                <Text style={styles.buttonText}>Right</Text>
                <MaterialIcons 
                  name={isInsideView ? "home" : "park"} 
                  size={16} 
                  color="rgba(255, 255, 255, 0.7)" 
                  style={styles.buttonIndicator}
                />
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
      
      {/* View Toggle at Bottom */}
      <View style={styles.viewToggleContainer}>
        <View style={styles.viewToggleContent}>
          <MaterialIcons 
            name="home" 
            size={28} 
            color={isInsideView ? "#007AFF" : "#666"} 
          />
          <Text style={[styles.viewToggleLabel, { color: isInsideView ? "#007AFF" : "#666" }]}>
            Inside
          </Text>
          <Switch
            value={!isInsideView}
            onValueChange={(value) => setIsInsideView(!value)}
            trackColor={{ false: '#767577', true: '#007AFF' }}
            thumbColor={isInsideView ? '#f4f3f4' : '#007AFF'}
            style={styles.largeSwitch}
          />
          <Text style={[styles.viewToggleLabel, { color: !isInsideView ? "#007AFF" : "#666" }]}>
            Outside
          </Text>
          <MaterialIcons 
            name="park" 
            size={28} 
            color={!isInsideView ? "#007AFF" : "#666"} 
          />
        </View>
      </View>
    </View>
  );

  // Helper to reliably persist data to storage
  const persistToStorage = async (key: string, value: string, label: string): Promise<boolean> => {
    try {
      console.log(`Saving ${label}...`);
      await storage.setItem(key, value);
      console.log(`Successfully saved ${label}`);
      return true;
    } catch (error) {
      console.error(`Error saving ${label}:`, error);
      return false;
    }
  };

  // Debug function to test storage manually
  const testStorage = async () => {
    console.log('=== MANUAL STORAGE TEST ===');
    
    // Test setting and getting remember me
    console.log('Setting remember_me to "true"...');
    await storage.setItem(STORAGE_KEYS.REMEMBER_ME, 'true');
    
    console.log('Reading remember_me back...');
    const value = await storage.getItem(STORAGE_KEYS.REMEMBER_ME);
    console.log('Retrieved value:', JSON.stringify(value), 'type:', typeof value);
    console.log('Boolean conversion:', value === 'true');
    
    await storage.debugStorage();
    console.log('=== END MANUAL STORAGE TEST ===');
  };

  // Expose functions to global for debugging in console
  useEffect(() => {
    if (Platform.OS === 'web') {
      // @ts-ignore
      window.testStorage = testStorage;
      // @ts-ignore - Bind the debugStorage function to maintain 'this' context
      window.debugStorage = storage.debugStorage.bind(storage);
      // @ts-ignore
      window.clearAllStorage = async () => {
        await storage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD, STORAGE_KEYS.REMEMBER_ME]);
        console.log('Cleared all storage');
      };
      console.log('Debug functions available: testStorage(), debugStorage(), clearAllStorage()');
    }
  }, []);

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
    ...(Platform.OS === 'web' && {
      fontSize: 16, // Prevent zoom on iPhone
      WebkitAppearance: 'none',
    }),
  },
  header: {
    width: '100%',
    maxWidth: 600,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 30,
    alignSelf: 'center',
    flexShrink: 0,
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
    ...(Platform.OS === 'web' && {
      cursor: 'pointer',
      userSelect: 'none',
    }),
  },
  gridContainer: {
    width: '100%',
    maxWidth: 600,
    paddingHorizontal: 20,
    gap: 20,
    flexShrink: 0,
  },
  stableContainer: {
    width: '100%',
    maxWidth: 600,
    minHeight: 400,
    position: 'relative',
    flex: 1,
    flexShrink: 0,
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
    ...(Platform.OS === 'web' && {
      cursor: 'pointer',
      userSelect: 'none',
      touchAction: 'manipulation',
    }),
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
    ...(Platform.OS === 'web' && {
      userSelect: 'none',
    }),
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
    ...(Platform.OS === 'web' && {
      fontSize: 16, // Prevent zoom on iPhone
      WebkitAppearance: 'none',
    }),
  },
  visibilityToggle: {
    padding: 8,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' && {
      cursor: 'pointer',
      userSelect: 'none',
    }),
  },
  viewToggleContainer: {
    width: '100%',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    flexShrink: 0,
  },
  viewToggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 15,
  },
  viewToggleLabel: {
    fontSize: 14,
    fontWeight: '500',
    ...(Platform.OS === 'web' && {
      userSelect: 'none',
    }),
  },
  largeSwitch: {
    transform: [{ scale: 1.5 }], // Increase the size of the switch
  },
  buttonIndicator: {
    marginTop: 4,
  },
});
