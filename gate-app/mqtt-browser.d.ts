declare module 'mqtt-browser' {
  export interface MqttClient {
    on(event: 'connect', callback: () => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
    on(event: 'message', callback: (topic: string, message: Buffer) => void): void;
    publish(topic: string, message: string, callback: (error?: Error) => void): void;
    end(): void;
  }

  export interface IClientOptions {
    username?: string;
    password?: string;
    clientId?: string;
  }

  export function connect(url: string, options?: IClientOptions): MqttClient;
}

export = mqtt;