const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const pty = require('node-pty');

class LocalManager {
  constructor() {
    this.shell = null;
  }

  listDirectory(dirPath) {
    return new Promise((resolve, reject) => {
      fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
        if (err) return reject(err);
        const items = entries
          .filter((e) => !e.name.startsWith('.') || e.name === '..')
          .map((e) => {
            const fullPath = path.join(dirPath, e.name);
            let size = 0;
            let mtime = new Date();
            try {
              const stat = fs.statSync(fullPath);
              size = stat.size;
              mtime = stat.mtime;
            } catch (_) {}
            return {
              name: e.name,
              path: fullPath,
              isDirectory: e.isDirectory(),
              size,
              modified: mtime.toISOString(),
            };
          })
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
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
    });
  }

  writeFile(filePath, content) {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFile(filePath, content, 'utf8', (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  mkdir(dirPath) {
    return new Promise((resolve, reject) => {
      fs.mkdir(dirPath, { recursive: true }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  deletePath(targetPath) {
    return new Promise((resolve, reject) => {
      fs.stat(targetPath, (err, stats) => {
        if (err) return reject(err);
        if (stats.isDirectory()) {
          fs.rm(targetPath, { recursive: true, force: true }, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        } else {
          fs.unlink(targetPath, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        }
      });
    });
  }

  exec(command, options = {}) {
    return new Promise((resolve, reject) => {
      const cwd = options.cwd || os.homedir();
      const child = spawn('bash', ['-c', command], {
        cwd,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      let timer;

      if (options.timeout) {
        timer = setTimeout(() => {
          child.kill();
          reject(new Error(`Command timed out after ${options.timeout}ms`));
        }, options.timeout);
      }

      child.stdout.on('data', (data) => (stdout += data.toString()));
      child.stderr.on('data', (data) => (stderr += data.toString()));
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  startShell(onData, onClose) {
    const shellCmd = process.env.SHELL || '/bin/bash';
    this.shell = pty.spawn(shellCmd, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    this.shell.onData((data) => onData(data));
    this.shell.onExit(() => {
      this.shell = null;
      onClose();
    });

    return this.shell;
  }

  writeToShell(data) {
    if (this.shell) {
      this.shell.write(data);
    }
  }

  resizeShell(cols, rows) {
    if (this.shell) {
      this.shell.resize(cols, rows);
    }
  }

  killShell() {
    if (this.shell) {
      this.shell.kill();
      this.shell = null;
    }
  }
}

module.exports = LocalManager;
