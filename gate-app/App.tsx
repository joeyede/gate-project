import React, { useState, useEffect, Fragment } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TextInput, TouchableOpacity, Switch, Animated, Platform, GestureResponderEvent } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as appJson from './app.json';
import * as mqtt from 'precompiled-mqtt';
import type { MqttClient } from 'precompiled-mqtt';

/**
 * DEBUG SYSTEM DOCUMENTATION
 * 
 * This app uses a comprehensive debug flag system to control console output:
 * 
 * 1. DEBUG_ENABLED: Master switch - when false, NO console output occurs (production mode)
 * 2. Category-specific flags (only active when DEBUG_ENABLED = true):
 *    - DEBUG_STORAGE: Controls storage operations (load/save credentials, preferences)
 *    - DEBUG_RECONNECTION: Controls auto-reconnection logic and app state changes
 *    - DEBUG_MQTT: Controls MQTT operations (connection, messages, commands)
 * 
 * Visual Debug Panel: Only visible when DEBUG_ENABLED = true (hidden in production)
 * 
 * For production: Set DEBUG_ENABLED = false to hide all debug features
 * For troubleshooting: Set DEBUG_ENABLED = true and enable specific categories as needed
 */

// Debug Configuration
// Set DEBUG_ENABLED to false to disable all console output in production
// Individual category flags provide fine-grained control when DEBUG_ENABLED is true
const ALL_DEBUG_ON = true; // Set to true to enable all debug categories
const DEBUG_ENABLED = ALL_DEBUG_ON || false; // Master switch - set to false for production
const DEBUG_STORAGE = ALL_DEBUG_ON || false; // Storage operations (load/save credentials, preferences)
const DEBUG_RECONNECTION = ALL_DEBUG_ON ||false; // Auto-reconnection logic and app state changes  
const DEBUG_MQTT = ALL_DEBUG_ON || false; // MQTT operations (connection, messages, commands) - keep enabled for troubleshooting

/**
 * Centralized debug logging function with category-based filtering
 * 
 * Usage:
 * - debugLog('Connection established') // General info message
 * - debugLog('Failed to connect', 'error', 'mqtt') // MQTT error message  
 * - debugLog('Credentials saved', 'success', 'storage') // Storage success message
 * - debugLog('Auto-reconnecting...', 'warning', 'reconnection') // Reconnection warning
 * 
 * @param message - The debug message to log
 * @param type - Message type: 'info' | 'error' | 'success' | 'warning' (default: 'info')
 * @param category - Message category: 'general' | 'storage' | 'reconnection' | 'mqtt' (default: 'general')
 */
const debugLog = (message: string, type: 'info' | 'error' | 'success' | 'warning' = 'info', category: 'general' | 'storage' | 'reconnection' | 'mqtt' = 'general') => {
  if (!DEBUG_ENABLED) return;
  if (category === 'storage' && !DEBUG_STORAGE) return;
  if (category === 'reconnection' && !DEBUG_RECONNECTION) return;
  if (category === 'mqtt' && !DEBUG_MQTT) return;
  
  const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
  console.log(`${prefix} ${message}`);
};

// Extend the global Window interface for debug functions
declare global {
  interface Window {
    testStorage: () => Promise<void>;
    debugStorage: () => Promise<void>;
    clearAllStorage: () => Promise<void>;
  }
}


// Helper to abstract storage - simplified to use only AsyncStorage
const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const value = await AsyncStorage.getItem(key);
      debugLog(`Storage.getItem: ${key} = ${value !== null ? JSON.stringify(value) : 'null'} (type: ${typeof value})`, 'info', 'storage');
      return value;
    } catch (error) {
      debugLog(`Error getting item ${key}: ${error}`, 'error', 'storage');
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      debugLog(`Storage.setItem: ${key} = ${JSON.stringify(value)} (type: ${typeof value})`, 'info', 'storage');
      await AsyncStorage.setItem(key, value);
      debugLog(`Storage.setItem completed for ${key}`, 'success', 'storage');
    } catch (error) {
      debugLog(`Error setting item ${key}: ${error}`, 'error', 'storage');
    }
  },
  async multiRemove(keys: string[]): Promise<void> {
    try {
      debugLog(`Storage.multiRemove: ${keys.join(', ')}`, 'info', 'storage');
      await AsyncStorage.multiRemove(keys);
      debugLog(`Storage.multiRemove completed for: ${keys.join(', ')}`, 'success', 'storage');
    } catch (error) {
      debugLog(`Error removing items ${keys.join(', ')}: ${error}`, 'error', 'storage');
    }
  },
  // Debug function to see all stored values
  async getAllKeys(): Promise<readonly string[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      debugLog('All AsyncStorage keys: ' + keys.join(', '), 'info', 'storage');
      return keys;
    } catch (error) {
      debugLog(`Error getting all keys: ${error}`, 'error', 'storage');
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
      
      debugLog('=== STORAGE DEBUG ===', 'info', 'storage');
      for (const key of relevantKeys) {
        const value = await this.getItem(key);
        debugLog(`${key}: ${JSON.stringify(value)}`, 'info', 'storage');
      }
      debugLog('=== END STORAGE DEBUG ===', 'info', 'storage');
    } catch (error) {
      debugLog(`Error debugging storage: ${error}`, 'error', 'storage');
    }
  }
};

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
  const [isInitializing, setIsInitializing] = useState(true); // Track initialization state
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false); // Track auto-reconnection attempts
  const [forceRenderKey, setForceRenderKey] = useState(0); // Force re-renders on mobile
  const [showDebugPanel, setShowDebugPanel] = useState(false); // Toggle debug panel
  const [debugLogs, setDebugLogs] = useState<Array<{timestamp: string, message: string, type: 'info' | 'error' | 'success' | 'warning'}>>([]);

  /**
   * Visual debug panel logger - always adds to the visual debug panel
   * Also logs to console if debug flags are enabled
   * 
   * @param message - The debug message to display
   * @param type - Message type for visual styling and console logging
   */
  const addToDebugPanel = (message: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    debugLog(`[${timestamp}] ${message}`, type); // Console logging controlled by debug flags
    
    setDebugLogs(prev => {
      const newLog = { timestamp, message, type };
      const updated = [newLog, ...prev.slice(0, 49)]; // Keep last 50 logs
      return updated;
    });
  };

  // Helper function to get color for log types
  const getLogColor = (type: 'info' | 'error' | 'success' | 'warning') => {
    switch (type) {
      case 'error': return '#ff6b6b';
      case 'success': return '#51cf66';
      case 'warning': return '#ffd43b';
      default: return '#ffffff';
    }
  };

  // Debug logging for isAutoReconnecting changes
  useEffect(() => {
    const message = `🔄 isAutoReconnecting changed to: ${isAutoReconnecting}`;
    debugLog(message, isAutoReconnecting ? 'warning' : 'info');
    addToDebugPanel(message, isAutoReconnecting ? 'warning' : 'info');
  }, [isAutoReconnecting]);

  // Debug logging for connection state changes
  useEffect(() => {
    const message = `🔗 isConnected changed to: ${isConnected} at ${new Date().toISOString()}`;
    debugLog(message, isConnected ? 'success' : 'error');
    addToDebugPanel(message, isConnected ? 'success' : 'error');
  }, [isConnected]);

  // Debug logging for client changes
  useEffect(() => {
    const message = `🔌 client changed to: ${client ? 'EXISTS' : 'NULL'} at ${new Date().toISOString()}`;
    debugLog(message, client ? 'success' : 'info');
    addToDebugPanel(message, client ? 'success' : 'info');
    if (client) {
      const clientMsg = `🔌 Client state: Connected = ${!!client && isConnected}`;
      debugLog(clientMsg, 'info');
      addToDebugPanel(clientMsg, 'info');
    }
  }, [client]);

  // Force render function for mobile
  const forceRender = () => {
    debugLog('🔄 Forcing re-render...', 'info');
    setForceRenderKey(prev => prev + 1);
  };

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

  // Monitor page visibility to understand app lifecycle
  useEffect(() => {
    const logVisibilityState = () => {
      const message = `📄 Page visibility: ${document.hidden ? 'hidden' : 'visible'}, isConnected: ${isConnected}, hasClient: ${!!client}`;
      debugLog(message, 'info');
    };

    // Log initial state
    logVisibilityState();

    // Monitor visibility changes
    document.addEventListener('visibilitychange', logVisibilityState);

    return () => {
      document.removeEventListener('visibilitychange', logVisibilityState);
    };
  }, [isConnected, client, isInitializing, isAutoReconnecting]);

  // Handle app visibility changes (when user switches away and back)
  useEffect(() => {
    const handleVisibilityChange = () => {
      const visMsg = `🖥️ Visibility changed: ${document.hidden ? 'hidden' : 'visible'} at ${new Date().toISOString()}`;
      debugLog(visMsg, 'info', 'reconnection');
      addToDebugPanel(visMsg, 'info');
      
      const stateMsg = `🖥️ Connection state: connected=${isConnected}, hasClient=${!!client}, init=${isInitializing}`;
      debugLog(stateMsg, 'info', 'reconnection');
      addToDebugPanel(stateMsg, 'info');
      
      if (!document.hidden && !isInitializing) {
        // App became visible again
        const visibleMsg = `App became visible - checking reconnection conditions`;
        debugLog(visibleMsg, 'warning', 'reconnection');
        addToDebugPanel(visibleMsg, 'warning');
        
        // Check if we have credentials - attempt reconnect regardless of current connection state
        // because the connection often closes right after visibility change
        if (username && password && rememberMe && !isAutoReconnecting) {
          const reconnectMsg = `🔗 Visibility change: App became visible with credentials - attempting reconnect`;
          debugLog(reconnectMsg, 'warning', 'reconnection');
          addToDebugPanel(reconnectMsg, 'warning');
          
          setIsAutoReconnecting(true);
          setStatus('Reconnecting...');
          
          // Set a timeout to clear auto-reconnecting state if connection takes too long
          const timeoutId = setTimeout(() => {
            const timeoutMsg = '🔗 Auto-reconnection timeout - clearing auto-reconnecting state';
            debugLog(timeoutMsg, 'error', 'reconnection');
            addToDebugPanel(timeoutMsg, 'error');
            setIsAutoReconnecting(false);
          }, 10000); // 10 second timeout
          
          // Start connection immediately without delay
          connectToMqtt(username, password).finally(() => {
            // Clear the timeout since connection attempt completed
            clearTimeout(timeoutId);
          });
        } else {
          const skipMsg = `🔗 Visibility change: Skipping reconnect - conditions not met (hasCredentials: ${!!(username && password)}, rememberMe: ${rememberMe}, isAutoReconnecting: ${isAutoReconnecting})`;
          debugLog(skipMsg, 'info', 'reconnection');
          addToDebugPanel(skipMsg, 'info');
        }
      }
    };

    const handleFocus = () => {
      const focusMsg = 'Window gained focus';
      debugLog(focusMsg, 'info', 'reconnection');
      addToDebugPanel(focusMsg, 'info');
      
      // Check immediately without delay
      if (!document.hidden && !isConnected && username && password && rememberMe && !isInitializing) {
          const attemptMsg = '🎯 Focus event: attempting reconnect with saved credentials';
          debugLog(attemptMsg, 'warning', 'reconnection');
          addToDebugPanel(attemptMsg, 'warning');
          setIsAutoReconnecting(true);
          setStatus('Reconnecting...');
          
          // Set a timeout to clear auto-reconnecting state if connection takes too long
          const timeoutId = setTimeout(() => {
            const timeoutMsg = '🎯 Auto-reconnection timeout - clearing auto-reconnecting state';
            debugLog(timeoutMsg, 'error', 'reconnection');
            addToDebugPanel(timeoutMsg, 'error');
            setIsAutoReconnecting(false);
          }, 10000); // 10 second timeout
          
          // Start connection immediately without delay
          connectToMqtt(username, password).finally(() => {
            // Clear the timeout since connection attempt completed
            clearTimeout(timeoutId);
          });
        } else {
          const skipFocusMsg = `🎯 Focus event: Skipping reconnect - conditions not met (hidden: ${document.hidden}, connected: ${isConnected}, hasCredentials: ${!!(username && password)}, rememberMe: ${rememberMe}, initializing: ${isInitializing})`;
          debugLog(skipFocusMsg, 'info', 'reconnection');
          addToDebugPanel(skipFocusMsg, 'info');
        }
    };

    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
    }
    
    // For React Native, use AppState
    let appStateSubscription: any;
    if (Platform.OS !== 'web') {
      const { AppState } = require('react-native');
      
      const handleAppStateChange = (nextAppState: string) => {
        const stateMsg = `📱 App state changed to: ${nextAppState}`;
        debugLog(stateMsg, 'info', 'reconnection');
        addToDebugPanel(stateMsg, 'info');
        
        if (nextAppState === 'active' && !isInitializing) {
          const activeMsg = '📱 App became active - checking reconnection conditions';
          debugLog(activeMsg, 'warning', 'reconnection');
          addToDebugPanel(activeMsg, 'warning');
          
          // Check if we have credentials - attempt reconnect regardless of current connection state
          // because the connection often closes right after app becomes active
          if (username && password && rememberMe && !isAutoReconnecting) {
            const reconnectMsg = '📱 ✅ All conditions met - attempting reconnect';
            debugLog(reconnectMsg, 'warning', 'reconnection');
            addToDebugPanel(reconnectMsg, 'warning');
            
            // Use functional state updates to ensure we have the latest state
            setIsAutoReconnecting(prevState => {
              const funcMsg = `📱 isAutoReconnecting functional update, prev: ${prevState}, new: true`;
              debugLog(funcMsg, 'info', 'reconnection');
              addToDebugPanel(funcMsg, 'info');
              return true;
            });
            
            setStatus(prevStatus => {
              const statusMsg = `📱 status functional update, prev: ${prevStatus}, new: Reconnecting...`;
              debugLog(statusMsg, 'info', 'reconnection');
              addToDebugPanel(statusMsg, 'info');
              return 'Reconnecting...';
            });
            
            // Force a re-render by updating multiple states
            const renderMsg = '📱 States updated, forcing re-render and starting connection...';
            debugLog(renderMsg, 'info', 'reconnection');
            addToDebugPanel(renderMsg, 'info');
            forceRender(); // Force re-render on mobile
            
            // Additional immediate update to ensure UI reflects the change
            setTimeout(() => {
              const additionalMsg = '📱 Additional state update to ensure UI reflects change';
              debugLog(additionalMsg, 'info', 'reconnection');
              addToDebugPanel(additionalMsg, 'info');
              setIsAutoReconnecting(true);
              forceRender();
            }, 0);
            
            // Set a timeout to clear auto-reconnecting state if connection takes too long
            const timeoutId = setTimeout(() => {
              const timeoutMsg = '📱 Auto-reconnection timeout - clearing auto-reconnecting state';
              debugLog(timeoutMsg, 'error', 'reconnection');
              addToDebugPanel(timeoutMsg, 'error');
              setIsAutoReconnecting(false);
            }, 10000); // 10 second timeout
            
            // Start connection immediately without delay
            connectToMqtt(username, password).finally(() => {
              // Clear the timeout since connection attempt completed
              clearTimeout(timeoutId);
            });
          } else {
            const skipAppMsg = `📱 ❌ Not attempting reconnect - conditions not met (hasCredentials: ${!!(username && password)}, rememberMe: ${rememberMe}, isAutoReconnecting: ${isAutoReconnecting})`;
            debugLog(skipAppMsg, 'info', 'reconnection');
            addToDebugPanel(skipAppMsg, 'info');
          }
        } else {
          const skipStateMsg = `📱 Not processing app state change - nextState: ${nextAppState}, isInitializing: ${isInitializing}`;
          debugLog(skipStateMsg, 'info', 'reconnection');
          addToDebugPanel(skipStateMsg, 'info');
        }
      };
      
      debugLog('📱 Setting up AppState listener...', 'info', 'reconnection');
      appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
    }
    
    return () => {
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
      } else if (appStateSubscription) {
        appStateSubscription.remove();
      }
    };
  }, [isConnected, username, password, rememberMe, client, isInitializing, isAutoReconnecting]);

  useEffect(() => {
    if (__DEV__) {
      debugLog('🚀 App initialized, loading saved preferences', 'info');
    }
    
    // Debug storage state first, then load preferences and set initialization complete
    storage.debugStorage().then(() => {
      debugLog('🚀 About to load saved preferences...', 'info');
      loadSavedPreferences().then((result) => {
        debugLog('🚀 Load preferences completed, result: ' + JSON.stringify(result), 'info');
        
        if (result.willAutoReconnect && result.username && result.password) {
          // We're starting auto-reconnection, finish initialization immediately so reconnecting screen shows
          debugLog('🚀 Starting auto-reconnection with saved credentials: ' + result.username, 'info');
          debugLog('🚀 Setting isInitializing to false...', 'info');
          setIsInitializing(false); // Set this immediately so render shows reconnecting screen
          debugLog('🚀 isInitializing set to false, isAutoReconnecting should be true', 'info');
          
          // CRITICAL: Ensure state variables are updated before attempting connection
          // This ensures that when the connection succeeds, the state variables are properly set
          debugLog('🚀 Setting username and password state before auto-reconnect', 'info');
          setUsername(result.username);
          setPassword(result.password);
          
          // Force a render to ensure UI updates
          forceRender();
          
          // Start connection with a delay to ensure state updates have taken effect
          debugLog('🚀 Starting connection in 500ms...', 'info');
          setTimeout(() => {
            debugLog('🚀 Now calling connectToMqtt with credentials and rememberMe flag', 'info');
            connectToMqtt(result.username, result.password, true); // Pass true for savedRememberMe since we're auto-reconnecting
          }, 500); // Increased delay to ensure UI shows
        } else {
          // No auto-reconnection, just finish initialization
          debugLog('🚀 No auto-reconnection, finishing initialization', 'info');
          setIsInitializing(false);
        }
      }).catch((error) => {
        debugLog(`🚀 Error loading preferences: ${error}`, 'error');
        setIsInitializing(false);
      });
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
    debugLog('Loading saved preferences...', 'info', 'storage');
    try {
      // Get ALL storage values for debugging
      const allValues = await Promise.all([
        storage.getItem(STORAGE_KEYS.REMEMBER_ME),
        storage.getItem(STORAGE_KEYS.USERNAME),
        storage.getItem(STORAGE_KEYS.PASSWORD)
      ]);
      
      const [savedRememberMe, savedUsername, savedPassword] = allValues;
      
      debugLog('Raw storage values retrieved: REMEMBER_ME=' + JSON.stringify(savedRememberMe) + ', hasUsername=' + !!savedUsername + ', hasPassword=' + !!savedPassword, 'info', 'storage');
      
      // Default to false if not found or invalid
      const shouldRemember = savedRememberMe === 'true';
      debugLog('Boolean conversion - savedRememberMe: ' + JSON.stringify(savedRememberMe) + ' -> shouldRemember: ' + shouldRemember, 'info', 'storage');
      
      debugLog('Setting remember me to: ' + shouldRemember, 'info', 'storage');
      setRememberMe(shouldRemember);
      
      debugLog('Loaded from storage: rememberMe=' + shouldRemember + ', hasUsername=' + !!savedUsername + ', hasPassword=' + !!savedPassword, 'info', 'storage');
      
      // Check for inconsistent state and fix it
      if (shouldRemember === false && (savedUsername || savedPassword)) {
        debugLog('Found inconsistent state: Remember Me is OFF but credentials exist. Fixing...', 'warning', 'storage');
        debugLog(`State details: shouldRemember=${shouldRemember}, savedRememberMe=${savedRememberMe}, hasUsername=${!!savedUsername}, hasPassword=${!!savedPassword}`, 'warning', 'storage');
        try {
          await storage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
          debugLog('Cleared inconsistent credentials', 'warning', 'storage');
        } catch (e) {
          debugLog(`Failed to clear inconsistent credentials: ${e}`, 'error', 'storage');
        }
      } else if (savedUsername && savedPassword) {
        // We have credentials, use them
        debugLog('Setting saved username and password', 'info', 'storage');
        setUsername(savedUsername);
        setPassword(savedPassword);
        
        // Only auto-connect if remember me was true
        if (shouldRemember) {
          debugLog('Auto-connecting with saved credentials', 'info', 'reconnection');
          setIsAutoReconnecting(true); // Use auto-reconnecting state instead of setting connected immediately
          setStatus('Connecting...');
          
          // Return the credentials to use for connection
          return { willAutoReconnect: true, username: savedUsername, password: savedPassword };
        } else {
          debugLog('Found credentials but remember me is false, not auto-connecting', 'info');
        }
      } else {
        debugLog('No saved credentials found', 'info', 'storage');
      }
      
      // Return false if we're not auto-connecting
      return { willAutoReconnect: false };
    } catch (error) {
      debugLog(`Failed to load preferences: ${error}`, 'error');
      return { willAutoReconnect: false };
    }
  };

  const handleRememberMeToggle = async (value: boolean) => {
    debugLog('Remember Me toggle changed to: ' + value, 'info', 'storage');
    // Update the UI immediately
    setRememberMe(value);
    
    // Don't save to storage immediately - only save when connection succeeds
    // This prevents the storage from getting out of sync with the actual intention
    
    // If turning off remember me and we're connected, we might want to clear credentials on logout
    if (!value) {
      debugLog('Remember Me turned off - credentials will be cleared on logout', 'warning', 'storage');
    } else if (username && password && isConnected) {
      // If we're already connected and turning on remember me, save credentials now
      debugLog('Remember Me turned on - saving current credentials', 'info', 'storage');
      try {
        await saveCredentials(username, password, value);
      } catch (error) {
        debugLog(`Failed to save credentials when toggling remember me: ${error}`, 'error', 'storage');
      }
    }
  };

  const saveCredentials = async (username: string, password: string, rememberMeValue?: boolean) => {
    const effectiveRememberMe = rememberMeValue !== undefined ? rememberMeValue : rememberMe;
    debugLog('Saving credentials, remember me = ' + effectiveRememberMe, 'info', 'storage');
    try {
      // Always save the remember me preference first
      const saveRememberMeSuccess = await persistToStorage(
        STORAGE_KEYS.REMEMBER_ME, 
        effectiveRememberMe.toString(), 
        'Remember Me preference'
      );
      
      if (effectiveRememberMe) {
        // Save credentials if remember me is true
        debugLog('Remember Me is ON - saving username and password', 'info', 'storage');
        
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
          debugLog('Credentials successfully saved to storage', 'success', 'storage');
        } else {
          debugLog('Failed to save some credential data', 'warning', 'storage');
        }
      } else {
        debugLog('Remember Me is OFF - clearing any existing credentials', 'info', 'storage');
        try {
          await storage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD]);
          debugLog('Cleared credentials since Remember Me is OFF', 'success', 'storage');
        } catch (error) {
          debugLog(`Failed to clear credentials: ${error}`, 'error', 'storage');
        }
      }
    } catch (error) {
      debugLog(`Failed to save credentials: ${error}`, 'error', 'storage');
    }
  };

  const connectToMqtt = async (providedUsername?: string, providedPassword?: string, savedRememberMe?: boolean): Promise<void> => {
    return new Promise((resolve, reject) => {
      const un = providedUsername || username;
      const pw = providedPassword || password;
      
      if (!un || !pw) {
        setStatus('Please enter both username and password');
        setIsConnected(false);
        reject(new Error('Missing credentials'));
        return;
      }

      // Clean up existing client if it exists
      if (client) {
        debugLog('Cleaning up existing client', 'info', 'mqtt');
        try {
          client.end(true);
        } catch (e) {
          debugLog(`Error cleaning up old client: ${e}`, 'warning', 'mqtt');
        }
        setClient(null);
      }

      try {
        const clientId = 'gate_app_' + Math.random().toString(16).substr(2, 8);
        const connectUrl = 'wss://3b62666a86a14b23956244c4308bad76.s1.eu.hivemq.cloud:8884/mqtt';
        
        debugLog('Creating new MQTT connection...', 'info', 'mqtt');
        setStatus('Connecting...');
        
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
          const connectMsg = 'Connected to MQTT';
          debugLog(connectMsg, 'success', 'mqtt');
          addToDebugPanel(connectMsg, 'success');
          setStatus('Connected');
          setIsConnected(true);
          setIsAutoReconnecting(false); // Clear auto-reconnection state
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
              debugLog(`Subscribe error for gate/status: ${err}`, 'error', 'mqtt');
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
              debugLog(`Subscribe error for gate/responses/#: ${err}`, 'error', 'mqtt');
            }
          });

          // Save credentials when successfully connected
          setUsername(un); // Make sure state variables are updated
          setPassword(pw);
          
          // Always save credentials if remember me is enabled and we have valid credentials
          // Use savedRememberMe if provided (during auto-reconnect), otherwise use current state
          const shouldSaveCredentials = (savedRememberMe !== undefined ? savedRememberMe : rememberMe) && un && pw;
          if (shouldSaveCredentials) {
            debugLog(`Connection successful - saving credentials (rememberMe: ${savedRememberMe !== undefined ? savedRememberMe : rememberMe})`, 'info', 'mqtt');
            saveCredentials(un, pw, savedRememberMe !== undefined ? savedRememberMe : rememberMe);
          } else {
            debugLog(`Connection successful - not saving credentials (rememberMe: ${savedRememberMe !== undefined ? savedRememberMe : rememberMe}, hasCredentials: ${!!(un && pw)})`, 'info', 'mqtt');
          }
          showNotification('Connected successfully');
          resolve(); // Connection successful
        });

        mqttClient.on('message', (topic, payload, packet) => {
          debugLog(`Message received: ${topic} - ${payload.toString()}`, 'info', 'mqtt');
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
                  debugLog(`Error parsing response: ${error}`, 'error', 'mqtt');
              }
          }
        });

        mqttClient.on('error', (err) => {
          const errorMsg = `MQTT Error: ${err.message}`;
          debugLog(errorMsg, 'error', 'mqtt');
          addToDebugPanel(errorMsg, 'error');
          let userFriendlyMessage = 'Connection failed';
          if (err.message?.includes('not authorized')) {
            userFriendlyMessage = 'Connection failed: Invalid username or password';
          }
          setStatus(userFriendlyMessage);
          setIsConnected(false); // Make sure to reset connection state on error
          setIsAutoReconnecting(false); // Clear auto-reconnection state on error
          showNotification('Connection failed');
          reject(err); // Connection failed
        });

        mqttClient.on('close', () => {
          const closeMsg = `🔌 MQTT Connection closed at ${new Date().toISOString()}`;
          debugLog(closeMsg, 'warning', 'mqtt');
          addToDebugPanel(closeMsg, 'warning');
          const visibilityMsg = `🔌 App visibility state: ${document.hidden ? 'hidden' : 'visible'}`;
          debugLog(visibilityMsg, 'info', 'mqtt');
          addToDebugPanel(visibilityMsg, 'info');
          setStatus('Disconnected');
          setIsConnected(false);
          setIsAutoReconnecting(false); // Clear auto-reconnection state
        });

      } catch (error) {
        debugLog(`Setup error: ${error}`, 'error', 'mqtt');
        addToDebugPanel(`Setup error: ${error}`, 'error');
        setStatus('Setup Error: ' + (error instanceof Error ? error.message : String(error)));
        setIsAutoReconnecting(false); // Clear auto-reconnection state on setup error
        reject(error); // Setup failed
      }
    });
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
    debugLog(`Sending command - Button: ${action}, View: ${isInsideView ? 'Inside' : 'Outside'}, Actual: ${actualAction}`, 'info', 'mqtt');

    setLoadingButton(action);
    setStatusDotColor('#FFC107'); // Yellow during send
    try {
      const correlationId = Math.random().toString(36).substring(2, 15);
      pendingCommands.set(correlationId, action);

      const payload = JSON.stringify({ action: actualAction });
      debugLog(`Publishing to gate/control: ${payload}`, 'info', 'mqtt');

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
            debugLog(`Send command error: ${error}`, 'error', 'mqtt');
            addToDebugPanel(`Send command error: ${error}`, 'error');
            setStatus(`Error: ${error.message}`);
            showNotification('Failed to send command');
            pendingCommands.delete(correlationId);
            setStatusDotColor('#f44336'); // Red on failure
          } else {
            setStatus(`Sent: ${action} (${actualAction})`);
            debugLog(`Command sent successfully: ${action} -> ${actualAction}`, 'success', 'mqtt');
          }
          setLoadingButton(null);
        }
      );
    } catch (error) {
      debugLog(`Send command error: ${error}`, 'error', 'mqtt');
      addToDebugPanel(`Send command error: ${error}`, 'error');
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
          debugLog('Logging out - clearing all credentials and remember me setting', 'info');
          await storage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD, STORAGE_KEYS.REMEMBER_ME]);
          setUsername('');
          setPassword('');
          setRememberMe(false);
        } catch (error) {
          debugLog(`Failed to clear credentials during logout: ${error}`, 'error');
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
      debugLog(`Manual login attempt with username: ${username}`, 'info', 'mqtt');
      
      // Set auto-reconnecting state to show visual feedback during connection
      setIsAutoReconnecting(true);
      setStatus('Connecting...');
      
      // Set a timeout to clear auto-reconnecting state if connection takes too long
      const timeoutId = setTimeout(() => {
        debugLog('Connection timeout - clearing auto-reconnecting state', 'warning');
        setIsAutoReconnecting(false);
      }, 10000); // 10 second timeout
      
      // Pass the current username and password explicitly for manual login
      connectToMqtt(username, password).finally(() => {
        // Clear the timeout since connection attempt completed
        clearTimeout(timeoutId);
      });
    } else {
      debugLog('Handle submit called without valid credentials', 'error');
      setStatus('Please enter both username and password');
    }
  };

  const renderLoginScreen = () => (
    <View style={styles.container}>
      {DEBUG_ENABLED && (
        <TouchableOpacity 
          style={[styles.debugCloseButton, { top: 40, right: 20, backgroundColor: 'rgba(0, 123, 255, 0.2)' }]}
          onPress={() => setShowDebugPanel(!showDebugPanel)}
        >
          <MaterialIcons name="bug-report" size={24} color="#007AFF" />
        </TouchableOpacity>
      )}
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
        {DEBUG_ENABLED && (
          <TouchableOpacity 
            style={styles.logoutButton}
            {...handleTouch(() => setShowDebugPanel(!showDebugPanel))}>
            <MaterialIcons name="bug-report" size={24} color="#007AFF" />
          </TouchableOpacity>
        )}
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
            
            {/* Grouped Left/Right buttons with view toggle */}
            <View style={styles.directionControlGroup}>
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
              
              {/* View Toggle grouped with direction buttons */}
              <View style={styles.groupedViewToggle}>
                <View style={styles.viewToggleSeparator} />
                <View style={styles.viewToggleContent}>
                  <MaterialIcons 
                    name="home" 
                    size={24} 
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
                    style={styles.compactSwitch}
                  />
                  <Text style={[styles.viewToggleLabel, { color: !isInsideView ? "#007AFF" : "#666" }]}>
                    Outside
                  </Text>
                  <MaterialIcons 
                    name="park" 
                    size={24} 
                    color={!isInsideView ? "#007AFF" : "#666"} 
                  />
                </View>
              </View>
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

  // Helper to reliably persist data to storage
  const persistToStorage = async (key: string, value: string, label: string): Promise<boolean> => {
    try {
      debugLog(`Saving ${label}...`, 'info', 'storage');
      await storage.setItem(key, value);
      debugLog(`Successfully saved ${label}`, 'success', 'storage');
      return true;
    } catch (error) {
      debugLog(`Error saving ${label}: ${error}`, 'error', 'storage');
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

  // Expose functions to global for debugging in console (only on web)
  useEffect(() => {
    if (Platform.OS === 'web') {
      window.testStorage = testStorage;
      window.debugStorage = storage.debugStorage.bind(storage);
      window.clearAllStorage = async () => {
        await storage.multiRemove([STORAGE_KEYS.USERNAME, STORAGE_KEYS.PASSWORD, STORAGE_KEYS.REMEMBER_ME]);
        console.log('Cleared all storage');
      };
      debugLog('Debug functions available: testStorage(), debugStorage(), clearAllStorage()', 'info');
    }
  }, []);

  return (
    <Fragment key={forceRenderKey}>
      <View style={{ flex: 1 }}>
        {(() => {
          const timestamp = new Date().toISOString();
          debugLog(`🖥️ [${timestamp}] Render decision (key=${forceRenderKey}): isInitializing=${isInitializing}, isAutoReconnecting=${isAutoReconnecting}, isConnected=${isConnected}, hasCredentials=${!!(username && password)}, rememberMe=${rememberMe}`, 'info');
          
          // Show auto-reconnecting screen if we're auto-reconnecting (even during initialization)
          if (isAutoReconnecting) {
            debugLog(`🖥️ [${timestamp}] Rendering: Auto-reconnecting screen`, 'info');
            return (
              <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={styles.title}>Gate Control</Text>
                <Text style={styles.version}>v{appJson.expo.version}</Text>
                <View style={[styles.connectionDot, { backgroundColor: '#FFC107', marginTop: 20 }]} />
                <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
                <Text style={[styles.status, { marginTop: 10, textAlign: 'center' }]}>Connecting...</Text>
                <Text style={[styles.version, { marginTop: 10, fontStyle: 'italic' }]}>Restoring your session</Text>
              </View>
            );
          } else if (isInitializing) {
            debugLog(`🖥️ [${timestamp}] Rendering: Initializing screen`, 'info');
            return (
              <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={styles.title}>Gate Control</Text>
                <Text style={styles.version}>v{appJson.expo.version}</Text>
                <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
                <Text style={[styles.status, { marginTop: 10 }]}>Loading...</Text>
              </View>
            );
          } else if (!isConnected) {
            // Check if we have saved credentials - show reconnecting screen and attempt reconnection
            if (username && password && rememberMe && !isAutoReconnecting) {
              debugLog(`🖥️ [${timestamp}] Have credentials but not connected - starting auto-reconnection`, 'info');
              
              // Start auto-reconnection immediately
              setIsAutoReconnecting(true);
              setStatus('Reconnecting...');
              
              // Set a timeout to clear auto-reconnecting state if connection takes too long
              const timeoutId = setTimeout(() => {
                debugLog('Render-triggered auto-reconnection timeout - clearing auto-reconnecting state', 'warning');
                setIsAutoReconnecting(false);
              }, 10000); // 10 second timeout
              
              // Start connection attempt
              connectToMqtt(username, password).finally(() => {
                clearTimeout(timeoutId);
              });
              
              return (
                <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                  <Text style={styles.title}>Gate Control</Text>
                  <Text style={styles.version}>v{appJson.expo.version}</Text>
                  <View style={[styles.connectionDot, { backgroundColor: '#FFC107', marginTop: 20 }]} />
                  <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
                  <Text style={[styles.status, { marginTop: 10, textAlign: 'center' }]}>Reconnecting...</Text>
                  <Text style={[styles.version, { marginTop: 10, fontStyle: 'italic' }]}>Restoring your session</Text>
                </View>
              );
            }
            debugLog(`🖥️ [${timestamp}] Rendering: Login screen`, 'info');
            return renderLoginScreen();
          } else {
            debugLog(`🖥️ [${timestamp}] Rendering: Main screen`, 'info');
            return renderMainScreen();
          }
        })()}
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

      {/* Debug panel for development - shows logs and app state */}
      {DEBUG_ENABLED && showDebugPanel ? (
        <View style={styles.debugPanel}>
          <TouchableOpacity 
            style={[styles.debugCloseButton, { right: 50 }]}
            onPress={async () => {
              try {
                // Prepare debug content for copying
                const currentState = `=== GATE APP DEBUG INFO ===
Current State:
- Connected: ${isConnected ? '✅' : '❌'}
- Auto-Reconnecting: ${isAutoReconnecting ? '🔄' : '❌'}
- Initializing: ${isInitializing ? '⏳' : '❌'}
- Has Client: ${client ? '✅' : '❌'}
- Has Credentials: ${username && password ? '✅' : '❌'}
- Remember Me: ${rememberMe ? '✅' : '❌'}
- Page Hidden: ${Platform.OS === 'web' ? (document.hidden ? '🙈' : '👁️') : 'N/A'}

Recent Events:
${debugLogs.map(log => `[${log.timestamp}] ${log.message}`).join('\n')}

=== END DEBUG INFO ===`;

                if (Platform.OS === 'web') {
                  await navigator.clipboard.writeText(currentState);
                  showNotification('Debug info copied to clipboard!');
                } else {
                  // For React Native, we'll use Expo Clipboard
                  await Clipboard.setStringAsync(currentState);
                  showNotification('Debug info copied to clipboard!');
                }
              } catch (error) {
                debugLog(`Failed to copy debug info: ${error}`, 'error');
                showNotification('Failed to copy debug info');
              }
            }}
          >
            <MaterialIcons name="content-copy" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.debugCloseButton}
            onPress={() => setShowDebugPanel(false)}
          >
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.debugTitle}>Debug Panel</Text>
          
          {/* Current App State */}
          <View style={[styles.debugContent, { maxHeight: '25%', marginBottom: 10 }]}>
            <Text style={[styles.debugLog, { color: '#fff', fontSize: 16, fontWeight: 'bold' }]}>Current State:</Text>
            <Text style={[styles.debugLog, { color: '#fff' }]}>Connected: {isConnected ? '✅' : '❌'}</Text>
            <Text style={[styles.debugLog, { color: '#fff' }]}>Auto-Reconnecting: {isAutoReconnecting ? '🔄' : '❌'}</Text>
            <Text style={[styles.debugLog, { color: '#fff' }]}>Initializing: {isInitializing ? '⏳' : '❌'}</Text>
            <Text style={[styles.debugLog, { color: '#fff' }]}>Has Client: {client ? '✅' : '❌'}</Text>
            <Text style={[styles.debugLog, { color: '#fff' }]}>Has Credentials: {username && password ? '✅' : '❌'}</Text>
            <Text style={[styles.debugLog, { color: '#fff' }]}>Remember Me: {rememberMe ? '✅' : '❌'}</Text>
            <Text style={[styles.debugLog, { color: '#fff' }]}>Page Hidden: {Platform.OS === 'web' ? (document.hidden ? '🙈' : '👁️') : 'N/A'}</Text>
          </View>
          
          {/* Debug Logs */}
          <Text style={[styles.debugTitle, { fontSize: 16 }]}>Recent Events:</Text>
          <View style={[styles.debugContent, { maxHeight: '60%' }]}>
            {debugLogs.map((log, index) => (
              <Text key={index} style={[styles.debugLog, { color: getLogColor(log.type) }]}>
                [{log.timestamp}] {log.message}
              </Text>
            ))}
          </View>
        </View>
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
    top: Platform.OS === 'web' ? 60 : 80, // Account for status bar on mobile
    left: 20,
    right: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  notificationText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 8,
    textAlign: 'center',
    overflow: 'hidden',
    ...(Platform.OS === 'web' && {
      maxWidth: 400,
    }),
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
    gap: 15, // Reduce gap between sections to bring them closer
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
  directionControlGroup: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 20,
    marginHorizontal: -20, // Extend frame to container edges
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginTop: 5, // Reduce gap from top buttons
  },
  groupedViewToggle: {
    marginTop: 15,
    alignItems: 'center',
  },
  viewToggleSeparator: {
    width: '100%',
    height: 1,
    backgroundColor: '#d0d0d0',
    marginBottom: 15,
  },
  compactSwitch: {
    transform: [{ scale: 1.2 }], // Slightly smaller than the large switch
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
  debugPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 20,
    zIndex: 10000,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  debugCloseButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  debugTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  debugContent: {
    width: '100%',
    maxHeight: '70%',
    padding: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  debugLog: {
    fontSize: 14,
    marginBottom: 8,
  },
});
