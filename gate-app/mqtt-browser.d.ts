declare module 'precompiled-mqtt' {
  export interface IClientOptions {
    clientId?: string;
    username?: string;
    password?: string;
    clean?: boolean;
    reconnectPeriod?: number;
    keepalive?: number;
    protocolVersion?: number;
    protocol?: string;
    rejectUnauthorized?: boolean;
    properties?: {
      sessionExpiryInterval?: number;
      receiveMaximum?: number;
      maximumPacketSize?: number;
    };
    will?: {
      topic: string;
      payload: string;
      qos?: number;
      retain?: boolean;
      properties?: {
        willDelayInterval?: number;
        payloadFormatIndicator?: boolean;
        messageExpiryInterval?: number;
      };
    };
  }

  export interface IPublishOptions {
    qos?: number;
    retain?: boolean;
    properties?: {
      messageExpiryInterval?: number;
      userProperties?: {
        [key: string]: string;
      };
    };
  }

  export interface ISubscribeOptions {
    qos?: number;
    properties?: {
      subscriptionIdentifier?: number;
      userProperties?: {
        [key: string]: string;
      };
    };
  }

  export interface IEndOptions {
    properties?: {
      sessionExpiryInterval?: number;
      reasonString?: string;
    };
  }

  export interface MqttClient {
    on(event: 'connect', callback: () => void): void;
    on(event: 'close', callback: () => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
    on(event: 'message', callback: (topic: string, message: Buffer, packet: any) => void): void;
    publish(topic: string, message: string | Buffer, options?: IPublishOptions, callback?: (error?: Error) => void): void;
    subscribe(topic: string, options?: ISubscribeOptions, callback?: (error?: Error) => void): void;
    end(force?: boolean, options?: IEndOptions, callback?: () => void): void;
  }

  export function connect(url: string, options?: IClientOptions): MqttClient;
}