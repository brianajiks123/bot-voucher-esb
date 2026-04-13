const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const logger = require('./logger');

const TEMP_BASE = path.resolve(__dirname, '../../files/tmp');

async function createTempFolder(userId, mode) {
  const folderName = `${Date.now()}-${userId}-${mode}`;
  const folderPath = path.join(TEMP_BASE, folderName);
  await fs.mkdir(folderPath, { recursive: true });
  logger.debug(`Temp folder created: ${folderPath}`);
  return folderPath;
}

async function deleteTempFolder(folderPath) {
  try {
    await fs.rm(folderPath, { recursive: true, force: true });
    logger.debug(`Temp folder deleted: ${folderPath}`);
  } catch (err) {
    logger.warn(`Failed to delete temp folder: ${err.message}`);
  }
}

async function downloadTelegramFile(botToken, fileId, fileName, destFolder) {
  const filePath = await getTelegramFilePath(botToken, fileId);
  const destPath = path.join(destFolder, fileName);
  await downloadFile(`https://api.telegram.org/file/bot${botToken}/${filePath}`, destPath);
  logger.info(`File downloaded: ${destPath}`);
  return destPath;
}

function getTelegramFilePath(botToken, fileId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/getFile?file_id=${fileId}`,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.ok) return reject(new Error(`getFile failed: ${json.description}`));
          resolve(json.result.file_path);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(destPath);

    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => {
        file.close();
        reject(err);
      });
    }).on('error', reject);
  });
}

module.exports = { createTempFolder, deleteTempFolder, downloadTelegramFile };
