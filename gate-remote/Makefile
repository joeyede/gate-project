.PHONY: build deploy

build:
	SET GOOS=linux& SET GOARCH=arm& SET GOARM=6& go build -o gate-remote

build-windows:
	go build -o gate-remote.exe

deploy:
	scp gate-remote joey@Jgate.local:/home/joey/
