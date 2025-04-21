package gpio

import (
	"time"

	"periph.io/x/conn/v3/gpio"
	"periph.io/x/host/v3"
	"periph.io/x/host/v3/rpi"
)

type Controller struct {
	fullPin       gpio.PinIO
	pedestrianPin gpio.PinIO
	rightPin      gpio.PinIO
	leftPin       gpio.PinIO
}

func NewController() (*Controller, error) {
	// Initialize host
	if _, err := host.Init(); err != nil {
		return nil, err
	}

	c := &Controller{
		fullPin:       rpi.P1_11, // GPIO17
		pedestrianPin: rpi.P1_7,  // GPIO4
		rightPin:      rpi.P1_13, // GPIO27
		leftPin:       rpi.P1_15, // GPIO22
	}

	// Initialize all pins to LOW
	pins := []gpio.PinIO{c.fullPin, c.pedestrianPin, c.rightPin, c.leftPin}
	for _, pin := range pins {
		if err := pin.Out(gpio.Low); err != nil {
			return nil, err
		}
	}

	return c, nil
}

func (c *Controller) pressButton(pin gpio.PinIO) error {
	if err := pin.Out(gpio.High); err != nil {
		return err
	}
	time.Sleep(1000 * time.Millisecond)
	return pin.Out(gpio.Low)
}

func (c *Controller) PressFullOpen() error {
	return c.pressButton(c.fullPin)
}

func (c *Controller) PressPedestrian() error {
	return c.pressButton(c.pedestrianPin)
}

func (c *Controller) PressInnerRight() error {
	return c.pressButton(c.rightPin)
}

func (c *Controller) PressInnerLeft() error {
	return c.pressButton(c.leftPin)
}

// Add cleanup method
func (c *Controller) Cleanup() error {
	pins := []gpio.PinIO{c.fullPin, c.pedestrianPin, c.rightPin, c.leftPin}
	for _, pin := range pins {
		if err := pin.Out(gpio.Low); err != nil {
			return err
		}
	}
	return nil
}
