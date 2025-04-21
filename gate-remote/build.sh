#!/bin/bash

GOOS=linux GOARCH=arm GOARM=6 go build -o gate-remote
echo "Built for Raspberry Pi W (ARM v6)"
