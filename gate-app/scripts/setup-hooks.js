const fs = require('fs');
const path = require('path');

// Check if we're in a git repository by looking for .git in parent directory
const parentDir = path.join('..', '.git');
const gitHooksDir = path.join('..', '.git', 'hooks');

if (!fs.existsSync(parentDir)) {
    console.log('⚠️  Git repository not found in parent directory.');
    process.exit(0);
}

// Ensure hooks directory exists
if (!fs.existsSync(gitHooksDir)) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
}

// Create pre-push hook with PowerShell-compatible commands
const prePushHook = `#!/bin/sh
# Auto-increment version on push
echo "🔄 Auto-incrementing version..."
cd gate-app
npm run version:patch
git add package.json app.json
git commit --amend --no-edit --no-verify
echo "✅ Version updated and committed"
`;

const prePushPath = path.join(gitHooksDir, 'pre-push');
fs.writeFileSync(prePushPath, prePushHook);

// Make the hook executable (important for Unix-like systems)
try {
    fs.chmodSync(prePushPath, '755');
} catch (error) {
    // chmod might not work on Windows, but that's okay
}

console.log('✅ Git pre-push hook installed successfully in parent directory!');
console.log('🚀 Now when you push from gate-project, the version will auto-increment');
console.log('');
console.log('Manual version commands (run from gate-app directory):');
console.log('  npm run version:patch  - 1.0.3 → 1.0.4');
console.log('  npm run version:minor  - 1.0.3 → 1.1.0');
console.log('  npm run version:major  - 1.0.3 → 2.0.0');