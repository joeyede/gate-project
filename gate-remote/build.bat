@echo off
IF "%1"=="windows" (
    go build -o gate-remote.exe
) ELSE (
    set GOOS=linux
    set GOARCH=arm
    set GOARM=6
    go build -o gate-remote
)
