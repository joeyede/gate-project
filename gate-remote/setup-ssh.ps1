# Check if ssh key exists
if (-not (Test-Path "~/.ssh/id_ed25519")) {
    # Generate new SSH key
    ssh-keygen -t ed25519 -f "$env:USERPROFILE/.ssh/id_ed25519" -N '""'
}

# Copy the key to the Raspberry Pi
$key = Get-Content "~/.ssh/id_ed25519.pub"
$remoteHost = "joey@Jgate.local"

Write-Host "Copying SSH key to $remoteHost..."
$key | ssh $remoteHost "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

Write-Host "SSH key setup complete. Try running 'make deploy' now."
