# For current session only
$env:GATE_API_SECRET = "your-secret-here"
$env:GATE_URL = "http://your-pi-address:8080"

# To set permanently (uncomment and run as admin):
# [System.Environment]::SetEnvironmentVariable('GATE_API_SECRET', 'your-secret-here', 'User')
# [System.Environment]::SetEnvironmentVariable('GATE_URL', 'http://your-pi-address:8080', 'User')

Write-Host "Environment variables set for current session"
Write-Host "GATE_URL = $env:GATE_URL"
Write-Host "GATE_API_SECRET is set (hidden)"
