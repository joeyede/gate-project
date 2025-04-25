package main

import (
	"log"
	"os"

	"github.com/joeyede/gate-remote/gpio"
	"github.com/joeyede/gate-remote/mqtt"
)

func main() {
	// Check required secret is set

	// Get MQTT broker URL from env or use default HiveMQ public broker
	brokerURL := os.Getenv("MQTT_BROKER_URL")
	if brokerURL == "" {
		log.Fatal("GMQTT_BROKER_URL environment variable must be set")
	}

	controller, err := gpio.NewController()
	if err != nil {
		log.Fatal("Failed to initialize GPIO:", err)
	}
	defer controller.Cleanup()

	handler, err := mqtt.NewHandler(brokerURL, "gate-remote", controller)
	if err != nil {
		log.Fatal("Failed to initialize MQTT:", err)
	}
	defer handler.Close()

	log.Printf("Connected to MQTT broker at %s", brokerURL)
	log.Printf("Listening for commands on topic: %s", mqtt.TopicGateControl)

	// Keep the application running
	select {}
}
