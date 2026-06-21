const fs = require('fs');
const path = require('path');
const https = require('https');

const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const OUT_DIR = path.join(__dirname, '..', 'src', 'public');
const OUT_FILE = path.join(OUT_DIR, 'live2dcubismcore.min.js');

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          download(response.headers.location).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(OUT_FILE)) {
    console.log('Cubism Core already present:', OUT_FILE);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Downloading Live2D Cubism Core…');

  try {
    const data = await download(CORE_URL);
    fs.writeFileSync(OUT_FILE, data);
    console.log('Saved:', OUT_FILE);
  } catch (error) {
    console.error('Could not download Cubism Core automatically.');
    console.error(error.message);
    console.error('');
    console.error('Download Cubism SDK for Web from:');
    console.error('  https://www.live2d.com/en/download/cubism-sdk/download-web/');
    console.error('Copy Core/live2dcubismcore.min.js to:');
    console.error(' ', OUT_FILE);
    process.exitCode = 1;
  }
}

main();
