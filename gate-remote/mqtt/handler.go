package mqtt

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"os"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/joeyede/gate-remote/gpio"
)

const (
	TopicGateControl = "gate/control"
	QosLevel         = 1
)

type GateCommand struct {
	Action string `json:"action"` // full, pedestrian, right, left
}

type Handler struct {
	client     mqtt.Client
	controller *gpio.Controller
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
	}

	// Subscribe to control topic
	if token := client.Subscribe(TopicGateControl, QosLevel, h.handleCommand); token.Wait() && token.Error() != nil {
		return nil, token.Error()
	}

	return h, nil
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
	h.client.Disconnect(250)
}
