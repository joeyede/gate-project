const fs = require('fs');
const path = require('path');

// Get the bump type from command line argument
const bumpType = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bumpType)) {
    console.error('Usage: node bump-version.js [patch|minor|major]');
    process.exit(1);
}

// Read current package.json
const packageJsonPath = 'package.json';
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

// Parse version numbers
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Calculate new version
let newVersion;
switch (bumpType) {
    case 'patch':
        newVersion = `${major}.${minor}.${patch + 1}`;
        break;
    case 'minor':
        newVersion = `${major}.${minor + 1}.0`;
        break;
    case 'major':
        newVersion = `${major + 1}.0.0`;
        break;
}

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

console.log(`📦 Version bumped: ${currentVersion} → ${newVersion}`);

// Now sync to app.json
require('./sync-version.js');