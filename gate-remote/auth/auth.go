package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"time"
)

const (
	ApiKeyHeader    = "X-API-Key"
	TimestampHeader = "X-Timestamp"
	SignatureHeader = "X-Signature"

	TimestampValidityWindow = 5 * time.Minute
)

func ValidateAPIKey(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		apiKey := r.Header.Get(ApiKeyHeader)
		expectedKey := os.Getenv("GATE_API_KEY")

		if expectedKey == "" {
			http.Error(w, "Server configuration error", http.StatusInternalServerError)
			return
		}

		if subtle.ConstantTimeCompare([]byte(apiKey), []byte(expectedKey)) != 1 {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next(w, r)
	}
}

func GenerateSignature(timestamp, path, secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(fmt.Sprintf("%s%s", timestamp, path)))
	return hex.EncodeToString(h.Sum(nil))
}

func validateSignature(timestamp, signature, path, secret string) bool {
	ts, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return false
	}
	if time.Since(ts) > TimestampValidityWindow {
		return false
	}

	expectedSig := GenerateSignature(timestamp, path, secret)
	return hmac.Equal([]byte(signature), []byte(expectedSig))
}

func ValidateHMAC(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		timestamp := r.Header.Get(TimestampHeader)
		signature := r.Header.Get(SignatureHeader)
		secret := os.Getenv("GATE_API_SECRET")

		if secret == "" {
			http.Error(w, "Server configuration error", http.StatusInternalServerError)
			return
		}

		if !validateSignature(timestamp, signature, r.URL.Path, secret) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next(w, r)
	}
}
