const { spawn } = require('child_process');
const { ReadConfig } = require('../test-data/readConfig');
const path = require('path');

class CodegenManager {
  static generateScript() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    const fileName = `Recorded_Script_${timestamp}.js`;
    const outputPath = path.join('recorder', 'recordedscript', fileName);
    const baseUrl = ReadConfig.getBaseUrl();

    const args = [
      'playwright',
      'codegen',
      baseUrl,
      '--output',
      outputPath
    ];

    console.log(`Starting Playwright codegen for: ${baseUrl}`);
    console.log(`Output will be saved to: ${outputPath}`);

    const child = spawn('npx', args, {
      stdio: 'inherit',
      shell: true
    });

    child.on('error', (error) => {
      console.error('Error starting codegen:', error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`Codegen completed successfully. Script saved as: ${fileName}`);
      } else {
        console.error(`Codegen exited with code ${code}`);
      }
    });
  }
}

module.exports = { CodegenManager };

// Execute when run directly
if (require.main === module) {
  CodegenManager.generateScript();
}