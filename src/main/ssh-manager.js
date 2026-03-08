const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SSHManager {
  constructor() {
    this.client = null;
    this.sftp = null;
    this.connected = false;
    this.config = null;
  }

  connect(config) {
    return new Promise((resolve, reject) => {
      if (this.client) {
        this.disconnect();
      }

      this.client = new Client();
      this.config = config;

      const connConfig = {
        host: config.host || 'localhost',
        port: config.port || 22,
        username: config.username || os.userInfo().username,
        readyTimeout: 10000,
      };

      // Support private key or password auth
      if (config.privateKeyPath) {
        try {
          connConfig.privateKey = fs.readFileSync(
            config.privateKeyPath.replace('~', os.homedir())
          );
          if (config.passphrase) {
            connConfig.passphrase = config.passphrase;
          }
        } catch (err) {
          reject(new Error(`Failed to read private key: ${err.message}`));
          return;
        }
      } else if (config.password) {
        connConfig.password = config.password;
      } else {
        // Try default SSH key
        const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
        const ed25519Path = path.join(os.homedir(), '.ssh', 'id_ed25519');
        if (fs.existsSync(ed25519Path)) {
          connConfig.privateKey = fs.readFileSync(ed25519Path);
        } else if (fs.existsSync(defaultKeyPath)) {
          connConfig.privateKey = fs.readFileSync(defaultKeyPath);
        }
      }

      this.client.on('ready', () => {
        this.connected = true;
        this._initSFTP().then(resolve).catch(reject);
      });

      this.client.on('error', (err) => {
        this.connected = false;
        reject(err);
      });

      this.client.on('close', () => {
        this.connected = false;
        this.sftp = null;
      });

      this.client.connect(connConfig);
    });
  }

  _initSFTP() {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        this.sftp = sftp;
        resolve();
      });
    });
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.sftp = null;
      this.connected = false;
    }
  }

  isConnected() {
    return this.connected;
  }

  listDirectory(dirPath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) return reject(new Error('Not connected'));
      this.sftp.readdir(dirPath, (err, list) => {
        if (err) return reject(err);
        const items = list
          .filter((item) => !item.filename.startsWith('.') || item.filename === '..')
          .map((item) => ({
            name: item.filename,
            path: path.posix.join(dirPath, item.filename),
            isDirectory: item.attrs.isDirectory(),
            size: item.attrs.size,
            modified: new Date(item.attrs.mtime * 1000).toISOString(),
          }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        resolve(items);
      });
    });
  }

  readFile(filePath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) return reject(new Error('Not connected'));
      let data = '';
      const stream = this.sftp.createReadStream(filePath, { encoding: 'utf8' });
      stream.on('data', (chunk) => (data += chunk));
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    });
  }

  writeFile(filePath, content) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) return reject(new Error('Not connected'));
      const stream = this.sftp.createWriteStream(filePath);
      stream.on('close', resolve);
      stream.on('error', reject);
      stream.end(content);
    });
  }

  mkdir(dirPath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) return reject(new Error('Not connected'));
      this.sftp.mkdir(dirPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  deletePath(targetPath) {
    return new Promise((resolve, reject) => {
      if (!this.sftp) return reject(new Error('Not connected'));
      this.sftp.stat(targetPath, (err, stats) => {
        if (err) return reject(err);
        if (stats.isDirectory()) {
          // Use exec to rm -rf for directories
          this.exec(`rm -rf "${targetPath}"`)
            .then(resolve)
            .catch(reject);
        } else {
          this.sftp.unlink(targetPath, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        }
      });
    });
  }

  exec(command, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('Not connected'));
      }

      const execOptions = {};
      if (options.cwd) {
        command = `cd "${options.cwd}" && ${command}`;
      }

      this.client.exec(command, execOptions, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';
        let timer;

        if (options.timeout) {
          timer = setTimeout(() => {
            stream.close();
            reject(new Error(`Command timed out after ${options.timeout}ms`));
          }, options.timeout);
        }

        stream.on('data', (data) => (stdout += data.toString()));
        stream.stderr.on('data', (data) => (stderr += data.toString()));
        stream.on('close', (code) => {
          if (timer) clearTimeout(timer);
          resolve({ stdout, stderr, code });
        });
      });
    });
  }

  startShell() {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        return reject(new Error('Not connected'));
      }
      this.client.shell(
        { term: 'xterm-256color', cols: 120, rows: 30 },
        (err, stream) => {
          if (err) return reject(err);
          resolve(stream);
        }
      );
    });
  }
}

module.exports = SSHManager;
