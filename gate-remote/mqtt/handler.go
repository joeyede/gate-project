package mqtt

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/joeyede/gate-remote/gpio"
)

const (
	TopicGateControl = "gate/control"
	TopicGateStatus  = "gate/status"
	QosLevel         = 1
)

type GateCommand struct {
	Action string `json:"action"` // full, pedestrian, right, left
}

type HeartbeatMessage struct {
	Heartbeat string `json:"hb"`
}

type Handler struct {
	client     mqtt.Client
	controller *gpio.Controller
	stopHB     chan struct{}
}

func NewHandler(broker, clientID string, controller *gpio.Controller) (*Handler, error) {
	opts := mqtt.NewClientOptions()
	opts.AddBroker(broker)
	opts.SetClientID(clientID)
	opts.SetCleanSession(true)
	opts.SetAutoReconnect(true)

	// Add TLS config
	opts.SetTLSConfig(&tls.Config{
		MinVersion: tls.VersionTLS12,
	})

	// Add authentication
	username := os.Getenv("MQTT_USERNAME")
	password := os.Getenv("MQTT_PASSWORD")
	if username == "" || password == "" {
		return nil, fmt.Errorf("MQTT credentials not set")
	}
	opts.SetUsername(username)
	opts.SetPassword(password)

	// Add connection logging
	opts.OnConnect = func(c mqtt.Client) {
		log.Printf("Connected to MQTT broker")
	}
	opts.OnConnectionLost = func(c mqtt.Client, err error) {
		log.Printf("Lost connection to MQTT broker: %v", err)
	}

	client := mqtt.NewClient(opts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		return nil, token.Error()
	}

	h := &Handler{
		client:     client,
		controller: controller,
		stopHB:     make(chan struct{}),
	}

	// Subscribe to control topic
	if token := client.Subscribe(TopicGateControl, QosLevel, h.handleCommand); token.Wait() && token.Error() != nil {
		return nil, token.Error()
	}

	// Start heartbeat goroutine
	go h.startHeartbeat()

	return h, nil
}

func (h *Handler) startHeartbeat() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	// Send initial heartbeat
	h.publishHeartbeat()

	for {
		select {
		case <-ticker.C:
			h.publishHeartbeat()
		case <-h.stopHB:
			return
		}
	}
}

func (h *Handler) publishHeartbeat() {
	msg := HeartbeatMessage{
		Heartbeat: time.Now().UTC().Format(time.RFC3339),
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshaling heartbeat: %v", err)
		return
	}

	token := h.client.Publish(TopicGateStatus, QosLevel, false, payload)
	if token.Wait() && token.Error() != nil {
		log.Printf("Error publishing heartbeat: %v", token.Error())
	}
}

func (h *Handler) handleCommand(client mqtt.Client, msg mqtt.Message) {
	var cmd GateCommand
	if err := json.Unmarshal(msg.Payload(), &cmd); err != nil {
		log.Printf("Error parsing command: %v", err)
		return
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
		return
	}

	if err != nil {
		log.Printf("Error executing command: %v", err)
	}
}

func (h *Handler) Close() {
	close(h.stopHB)
	h.client.Disconnect(250)
}
