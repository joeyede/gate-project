package client

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

func GenerateHeaders(path, secret string) map[string]string {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	signature := GenerateSignature(timestamp, path, secret)

	return map[string]string{
		"X-Timestamp": timestamp,
		"X-Signature": signature,
	}
}

func GenerateSignature(timestamp, path, secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(fmt.Sprintf("%s%s", timestamp, path)))
	return hex.EncodeToString(h.Sum(nil))
}

func SendRequest(urlStr, secret string) error {
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return err
	}

	headers := GenerateHeaders(parsedURL.Path, secret)
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return err
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("request failed with status: %d", resp.StatusCode)
	}
	return nil
}
