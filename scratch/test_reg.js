const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dllPath = path.resolve(__dirname, '../assets/driver/UnityCaptureFilter64.dll');

// Test running regsvr32 directly with RunAs
const psScript = `Start-Process -FilePath 'regsvr32.exe' -ArgumentList @('/s', '${dllPath}', '/i:UnityCaptureName=SnapJM Virtual Camera') -Verb RunAs -Wait`;
const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

console.log('Script:', psScript);

try {
  execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { stdio: 'inherit' });
  console.log('Exec finished');
} catch (e) {
  console.error('Exec error:', e.message);
}
