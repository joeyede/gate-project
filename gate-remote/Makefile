.PHONY: build deploy

build:
	SET GOOS=linux& SET GOARCH=arm& SET GOARM=6& go build -o gate-remote

build-windows:
	go build -o gate-remote.exe

deploy:
	"C:\Program Files\Git\usr\bin\ssh.exe" joey@Jgate.local "sudo systemctl stop gate.service"
	"C:\Program Files\Git\usr\bin\scp.exe" gate-remote joey@Jgate.local:/home/joey/
	"C:\Program Files\Git\usr\bin\ssh.exe" joey@Jgate.local "sudo systemctl start gate.service && sudo systemctl status gate.service"

deploy-ip:
	"C:\Program Files\Git\usr\bin\ssh.exe" joey@192.168.4.118 "sudo systemctl stop gate.service"
	"C:\Program Files\Git\usr\bin\scp.exe" gate-remote joey@192.168.4.118:/home/joey/
	"C:\Program Files\Git\usr\bin\ssh.exe" joey@192.168.4.118 "sudo systemctl start gate.service && sudo systemctl status gate.service"
