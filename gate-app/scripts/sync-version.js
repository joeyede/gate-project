const fs = require('fs');
const path = require('path');

// Read package.json to get the current version
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;

// Update app.json with the same version
const appJsonPath = 'app.json';
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
appJson.expo.version = version;

// Also update iOS buildNumber and Android versionCode based on version
const versionParts = version.split('.');
const buildNumber = parseInt(versionParts[0]) * 10000 + parseInt(versionParts[1]) * 100 + parseInt(versionParts[2]);

appJson.expo.ios.buildNumber = buildNumber.toString();
appJson.expo.android.versionCode = buildNumber;

fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));
console.log(`✅ Synced version ${version} to app.json`);
console.log(`📱 iOS buildNumber: ${buildNumber}`);
console.log(`🤖 Android versionCode: ${buildNumber}`);