import React, { useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TextInput, TouchableOpacity } from 'react-native';
import mqtt from 'mqtt-browser';

export default function App() {
  const [status, setStatus] = useState('Enter credentials');
  const [loading, setLoading] = useState(false);
  const [client, setClient] = useState<mqtt.MqttClient | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  const connectToMqtt = () => {
    if (!username || !password) {
      setStatus('Please enter both username and password');
      return;
    }

    setLoading(true);
    try {
      const mqttClient = mqtt.connect('wss://3b62666a86a14b23956244c4308bad76.s1.eu.hivemq.cloud:8884/mqtt', {
        username,
        password,
        clientId: 'gate_app_' + Math.random().toString(16).substr(2, 8),
        rejectUnauthorized: false,
      });

      mqttClient.on('connect', () => {
        console.log('Connected to MQTT');
        setStatus('Connected');
        setIsConnected(true);
        setLoading(false);
      });

      mqttClient.on('error', (err) => {
        console.error('MQTT Error:', err);
        setStatus('Connection error: ' + err.message);
        setIsConnected(false);
        setLoading(false);
      });

      mqttClient.on('close', () => {
        console.log('MQTT connection closed');
        setStatus('Disconnected');
        setIsConnected(false);
      });

      setClient(mqttClient);
    } catch (error) {
      console.error('MQTT Setup error:', error);
      setStatus('Setup error: ' + (error instanceof Error ? error.message : String(error)));
      setLoading(false);
    }
  };

  const sendCommand = (action: string) => {
    if (!client) {
      setStatus('Not connected');
      return;
    }

    setLoading(true);
    const message = JSON.stringify({ action });
    
    client.publish('gate/control', message, (error) => {
      if (error) {
        console.error('Publish error:', error);
        setStatus('Failed to send command: ' + error.message);
      } else {
        setStatus(`Sent: ${action}`);
      }
      setLoading(false);
    });
  };

  if (!isConnected) {
    return (
      <View style={styles.container}>
        <Text style={[styles.status, status.includes('Error') && styles.error]}>
          {status}
        </Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity 
            style={[styles.customButton, loading && styles.buttonDisabled]} 
            onPress={connectToMqtt}
            disabled={loading || !username || !password}
          >
            <Text style={styles.buttonText}>Connect</Text>
          </TouchableOpacity>
        </View>
        {loading && <ActivityIndicator style={styles.loader} />}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.status, status.includes('Error') && styles.error]}>
        {status}
      </Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.customButton, loading && styles.buttonDisabled]} 
          onPress={() => sendCommand('full')}
          disabled={loading || !client}
        >
          <Text style={styles.buttonText}>Full Open</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.customButton, loading && styles.buttonDisabled]} 
          onPress={() => sendCommand('pedestrian')}
          disabled={loading || !client}
        >
          <Text style={styles.buttonText}>Pedestrian</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.customButton, loading && styles.buttonDisabled]} 
          onPress={() => sendCommand('right')}
          disabled={loading || !client}
        >
          <Text style={styles.buttonText}>Inner Right</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.customButton, loading && styles.buttonDisabled]} 
          onPress={() => sendCommand('left')}
          disabled={loading || !client}
        >
          <Text style={styles.buttonText}>Inner Left</Text>
        </TouchableOpacity>
      </View>
      {loading && <ActivityIndicator style={styles.loader} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  status: {
    marginBottom: 20,
    fontSize: 16,
  },
  error: {
    color: 'red',
  },
  buttonContainer: {
    gap: 15,
    width: '100%',
    paddingHorizontal: 20,
  },
  customButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  buttonDisabled: {
    backgroundColor: '#A5A5A5',
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    textAlign: 'center',
    fontWeight: '600',
  },
  inputContainer: {
    width: '100%',
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
  },
  loader: {
    marginTop: 20,
  },
});
