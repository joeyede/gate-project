package main

// to call the API you will need:
// X-Timestamp: 2024-01-01T12:00:00Z
// X-Signature: <generated-hmac-signature>
import (
	"log"
	"net/http"
	"os"

	"github.com/joeyede/gate-remote/auth"
	"github.com/joeyede/gate-remote/gpio"
)

func main() {
	// Check required secret is set
	if os.Getenv("GATE_API_SECRET") == "" {
		log.Fatal("GATE_API_SECRET environment variable must be set")
	}

	controller, err := gpio.NewController()
	if err != nil {
		log.Fatal("Failed to initialize GPIO:", err)
	}
	defer controller.Cleanup()

	// Create mux for HTTPS endpoints
	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/gate/full", auth.ValidateHMAC(func(w http.ResponseWriter, r *http.Request) {
		if err := controller.PressFullOpen(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	mux.HandleFunc("/api/gate/pedestrian", auth.ValidateHMAC(func(w http.ResponseWriter, r *http.Request) {
		if err := controller.PressPedestrian(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	mux.HandleFunc("/api/gate/right", auth.ValidateHMAC(func(w http.ResponseWriter, r *http.Request) {
		if err := controller.PressInnerRight(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	mux.HandleFunc("/api/gate/left", auth.ValidateHMAC(func(w http.ResponseWriter, r *http.Request) {
		if err := controller.PressInnerLeft(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	log.Printf("Starting server on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal(err)
	}
}
