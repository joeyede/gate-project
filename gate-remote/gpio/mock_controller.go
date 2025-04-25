//go:build windows
// +build windows

package gpio

import (
	"log"
	"time"
)

type Controller struct {
	// No actual pins needed for mock
}

func NewController() (*Controller, error) {
	log.Println("Initializing Mock GPIO Controller for Windows")
	return &Controller{}, nil
}

func (c *Controller) pressButton(_ interface{}) error {
	log.Println("Mock: Pressing button")
	time.Sleep(1000 * time.Millisecond)
	log.Println("Mock: Released button")
	return nil
}

func (c *Controller) PressFullOpen() error {
	log.Println("Mock: Full Open pressed")
	return c.pressButton(nil)
}

func (c *Controller) PressPedestrian() error {
	log.Println("Mock: Pedestrian pressed")
	return c.pressButton(nil)
}

func (c *Controller) PressInnerRight() error {
	log.Println("Mock: Inner Right pressed")
	return c.pressButton(nil)
}

func (c *Controller) PressInnerLeft() error {
	log.Println("Mock: Inner Left pressed")
	return c.pressButton(nil)
}

func (c *Controller) Cleanup() error {
	log.Println("Mock: Cleanup called")
	return nil
}
