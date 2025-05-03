import React, { useState, useEffect, Fragment } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TextInput, TouchableOpacity, Switch, Animated, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as mqtt from 'mqtt/dist/mqtt.min';
import * as Font from 'expo-font';

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
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const [isGateOnline, setIsGateOnline] = useState(false);
  const [hasReceivedHeartbeat, setHasReceivedHeartbeat] = useState(false);

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
      AsyncStorage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
    }
  };

  useEffect(() => {
    const checkHeartbeat = () => {
      if (!hasReceivedHeartbeat) return;
      
      const now = new Date();
      const timeSinceLastHeartbeat = lastHeartbeat 
        ? now.getTime() - lastHeartbeat.getTime()
        : Infinity;
      setIsGateOnline(timeSinceLastHeartbeat < 120000);
    };

    const timer = setInterval(checkHeartbeat, 10000);
    checkHeartbeat();

    return () => clearInterval(timer);
  }, [lastHeartbeat, hasReceivedHeartbeat]);

  const connectToMqtt = (providedUsername?: string, providedPassword?: string) => {
    const un = providedUsername || username;
    const pw = providedPassword || password;
    
    if (!un || !pw) {
      setStatus('Please enter both username and password');
      return;
    }

    setLoading(true);
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
        properties: {
          sessionExpiryInterval: 300,
          receiveMaximum: 100,
          maximumPacketSize: 1024
        }
      });

      mqttClient.on('connect', () => {
        console.log('Connected to MQTT');
        setStatus('Connected');
        setIsConnected(true);
        setLoading(false);
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

        saveCredentials(un, pw);
        showNotification('Connected successfully');
      });

      mqttClient.on('message', (topic, payload, packet) => {
        console.log('Message received:', payload.toString());
        if (topic === 'gate/status') {
          try {
            const data = JSON.parse(payload.toString());
            if (data.hb) {
              setLastHeartbeat(new Date(data.hb));
              setHasReceivedHeartbeat(true);
            }
          } catch (error) {
            console.error('Error parsing heartbeat:', error);
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
        setLoading(false);
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
      setLoading(false);
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
      client.publish('gate/control', 
        JSON.stringify({ action }), 
        { 
          qos: 1,
          properties: {
            messageExpiryInterval: 60,
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
          } else {
            setStatus(`Sent: ${action}`);
            showNotification(`Command sent: ${action}`);
          }
          setLoading(false);
        }
      );
    } catch (error) {
      console.error('Send command error:', error);
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      showNotification('Failed to send command');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (client) {
      client.end(false, { 
        properties: { 
          sessionExpiryInterval: 0,
          reasonString: 'User logout'
        } 
      }, () => {
        setClient(null);
        setIsConnected(false);
        setStatus('Logged out');
        showNotification('Logged out successfully');
        
        if (!rememberMe) {
          try {
            AsyncStorage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
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
    onTouchStart: (e: any) => {
      if (Platform.OS === 'web') {
        e.preventDefault();
      }
    },
    onPress,
  });

  const handleSubmit = () => {
    if (!loading && username && password) {
      connectToMqtt();
    }
  };

  const renderLoginScreen = () => (
    <Fragment>
      <View style={styles.container}>
        <Text style={styles.title}>Gate Control</Text>
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
                  styles.visibilityToggle,
                  { pointerEvents: loading ? 'none' : undefined }
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
                styles.connectButton,
                loading && styles.buttonDisabled,
                { pointerEvents: loading ? 'none' : undefined }
              ]} 
              disabled={loading || !username || !password}
              {...handleTouch(handleSubmit)}>
              <Text style={styles.buttonText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
        {loading ? <ActivityIndicator style={styles.loader} /> : null}
        {notification ? (
          <Animated.View style={[styles.notification, { opacity: notificationOpacity }]}>
            <Text style={styles.notificationText}>{notification}</Text>
          </Animated.View>
        ) : null}
      </View>
    </Fragment>
  );

  const renderMainScreen = () => (
    <Fragment>
      <View style={[styles.container, loading && { pointerEvents: 'none' }]}>
        <Text style={styles.title}>Gate Control</Text>
        <View style={styles.header}>
          <View style={styles.statusContainer}>
            <View style={[styles.connectionDot, { backgroundColor: isConnected ? '#4CAF50' : '#f44336' }]} />
            <Text style={[styles.status, status.includes('Error') && styles.error]}>{status}</Text>
          </View>
          <TouchableOpacity 
            style={styles.logoutButton}
            {...handleTouch(handleLogout)}>
            <MaterialIcons name="logout" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.gridContainer}>
          <Fragment>
            <View style={styles.row}>
              <TouchableOpacity 
                style={[styles.gridButton, loading && styles.buttonDisabled]} 
                disabled={loading || !client}
                {...handleTouch(() => sendCommand('pedestrian'))}>
                <MaterialIcons name="directions-walk" size={32} color="white" />
                <Text style={styles.buttonText}>Pedestrian</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.gridButton, loading && styles.buttonDisabled]} 
                disabled={loading || !client}
                {...handleTouch(() => sendCommand('full'))}>
                <MaterialCommunityIcons name="gate-open" size={32} color="white" />
                <Text style={styles.buttonText}>Full Open</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TouchableOpacity 
                style={[styles.gridButton, loading && styles.buttonDisabled]} 
                disabled={loading || !client}
                {...handleTouch(() => sendCommand('left'))}>
                <MaterialIcons name="arrow-back" size={32} color="white" />
                <Text style={styles.buttonText}>Left</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.gridButton, loading && styles.buttonDisabled]} 
                disabled={loading || !client}
                {...handleTouch(() => sendCommand('right'))}>
                <MaterialIcons name="arrow-forward" size={32} color="white" />
                <Text style={styles.buttonText}>Right</Text>
              </TouchableOpacity>
            </View>
          </Fragment>
        </View>
        
        <View style={styles.heartbeatContainer}>
          <View style={[styles.connectionDot, { 
            backgroundColor: hasReceivedHeartbeat 
              ? (isGateOnline ? '#4CAF50' : '#f44336') 
              : '#FFC107'
          }]} />
          <Text style={styles.heartbeatText}>
            Gate: {hasReceivedHeartbeat 
              ? (isGateOnline ? 'Online' : 'Offline') 
              : 'Waiting for status'}
            {lastHeartbeat && ` (Last heartbeat: ${lastHeartbeat.toLocaleTimeString()})`}
          </Text>
        </View>
        
        {loading ? <ActivityIndicator style={styles.loader} /> : null}
        {notification ? (
          <Animated.View style={[styles.notification, { opacity: notificationOpacity }]}>
            <Text style={styles.notificationText}>{notification}</Text>
          </Animated.View>
        ) : null}
      </View>
    </Fragment>
  );

  return (
    <Fragment>
      {!isConnected ? renderLoginScreen() : renderMainScreen()}
    </Fragment>
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
  loader: {
    marginTop: 20,
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
    boxShadow: '0px 2px 3.84px rgba(0, 0, 0, 0.25)',
  },
  gridContainer: {
    width: '100%',
    maxWidth: 600,
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
    boxShadow: '0px 2px 3.84px rgba(0, 0, 0, 0.25)',
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
    marginLeft: 0,
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
  heartbeatContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 5,
    maxWidth: 600,
    width: '100%',
  },
  heartbeatText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#333',
  },
});
