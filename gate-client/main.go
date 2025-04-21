package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/joeyede/gate-client/internal/client"
)

func main() {
	action := flag.String("action", "", "Action to perform (full/pedestrian/right/left)")
	flag.Parse()

	if *action == "" {
		log.Fatal("--action flag is required")
	}

	validActions := map[string]bool{
		"full":       true,
		"pedestrian": true,
		"right":      true,
		"left":       true,
	}

	if !validActions[*action] {
		log.Fatal("Invalid action. Must be one of: full, pedestrian, right, left")
	}

	secret := os.Getenv("GATE_API_SECRET")
	if secret == "" {
		log.Fatal("GATE_API_SECRET environment variable must be set")
	}

	baseURL := os.Getenv("GATE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}

	path := fmt.Sprintf("/api/gate/%s", *action)
	url := baseURL + path

	fmt.Printf("Sending request to %s\n", url)
	if err := client.SendRequest(url, secret); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Successfully triggered gate action: %s\n", *action)
}
