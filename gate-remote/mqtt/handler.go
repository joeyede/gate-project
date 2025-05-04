package mqtt

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
	"github.com/joeyede/gate-remote/gpio"
)

const (
	TopicGateControl  = "gate/control"
	TopicGateStatus   = "gate/status"
	QosLevel          = 1
	MQTTSessionExpiry = 60 // Session expiry in seconds
)

type GateCommand struct {
	Action string `json:"action"` // full, pedestrian, right, left
}

type HeartbeatMessage struct {
	Heartbeat string `json:"hb"`
}

type MQTTHandler struct {
	client     *autopaho.ConnectionManager
	controller *gpio.Controller
	stopHB     chan struct{}
}

var connectionLogged bool // Tracks if the connection message has already been logged

func NewHandler(broker, clientID string, controller *gpio.Controller) (*MQTTHandler, error) {
	u, err := url.Parse(broker)
	if err != nil {
		return nil, fmt.Errorf("invalid broker URL: %w", err)
	}

	h := &MQTTHandler{
		controller: controller,
		stopHB:     make(chan struct{}),
	}

	cliCfg := autopaho.ClientConfig{
		ServerUrls:            []*url.URL{u},
		KeepAlive:             20,
		SessionExpiryInterval: MQTTSessionExpiry,
		TlsCfg: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
		ConnectUsername: os.Getenv("MQTT_USERNAME"),
		ConnectPassword: []byte(os.Getenv("MQTT_PASSWORD")),
		OnConnectionUp: func(cm *autopaho.ConnectionManager, connAck *paho.Connack) {
			if !connectionLogged {
				log.Println("Connected to MQTT broker")
				connectionLogged = true
			}
			if _, err := cm.Subscribe(context.Background(), &paho.Subscribe{
				Subscriptions: []paho.SubscribeOptions{
					{Topic: TopicGateControl, QoS: QosLevel},
				},
			}); err != nil {
				log.Printf("Failed to subscribe: %v", err)
			}
		},
		OnConnectError: func(err error) {
			log.Printf("Connection error: %v", err)
		},
		ClientConfig: paho.ClientConfig{
			ClientID: clientID,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					log.Printf("Received message on topic %s: %s", pr.Packet.Topic, pr.Packet.Payload)

					// Parse the incoming message
					var cmd GateCommand
					if err := json.Unmarshal(pr.Packet.Payload, &cmd); err != nil {
						log.Printf("Error unmarshaling command: %v", err)
						return true, nil
					}

					// Execute command
					var err error
					switch cmd.Action {
					case "full":
						err = h.controller.PressFullOpen()
					case "pedestrian":
						err = h.controller.PressPedestrian()
					case "right":
						err = h.controller.PressInnerRight()
					case "left":
						err = h.controller.PressInnerLeft()
					default:
						log.Printf("Unknown action: %s", cmd.Action)
						return true, nil
					}
					if err != nil {
						log.Printf("GPIO action error for %s: %v", cmd.Action, err)
					}

					// Extract response topic and correlation data
					responseTopic := pr.Packet.Properties.ResponseTopic
					correlationData := pr.Packet.Properties.CorrelationData

					if responseTopic != "" {
						// Prepare acknowledgment message
						ack := map[string]string{
							"status": "success",
							"action": cmd.Action,
						}
						if err != nil {
							ack["status"] = "failed"
							ack["error"] = err.Error()
						}
						ackPayload, err := json.Marshal(ack)
						if err != nil {
							log.Printf("Error marshaling acknowledgment: %v", err)
							return true, nil
						}

						// Publish acknowledgment
						if _, err := h.client.Publish(context.Background(), &paho.Publish{
							QoS:     QosLevel,
							Topic:   responseTopic,
							Payload: ackPayload,
							Properties: &paho.PublishProperties{
								CorrelationData: correlationData,
							},
						}); err != nil {
							log.Printf("Error publishing acknowledgment: %v", err)
						}
					}

					return true, nil
				}},
		},
	}

	ctx := context.Background()
	client, err := autopaho.NewConnection(ctx, cliCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create MQTT connection: %w", err)
	}

	h.client = client

	if err := client.AwaitConnection(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to MQTT broker: %w", err)
	}

	go h.startHeartbeat(ctx)

	return h, nil
}

func (h *MQTTHandler) startHeartbeat(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			h.publishHeartbeat(ctx)
		case <-h.stopHB:
			return
		}
	}
}

func (h *MQTTHandler) publishHeartbeat(ctx context.Context) {
	msg := HeartbeatMessage{
		Heartbeat: time.Now().UTC().Format(time.RFC3339),
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshaling heartbeat: %v", err)
		return
	}

	if _, err := h.client.Publish(ctx, &paho.Publish{
		QoS:     QosLevel,
		Topic:   TopicGateStatus,
		Payload: payload,
	}); err != nil {
		log.Printf("Error publishing heartbeat: %v", err)
	}
}

func (h *MQTTHandler) Close() {
	close(h.stopHB)
	h.client.Disconnect(context.Background())
}
