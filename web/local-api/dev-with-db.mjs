import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const composeFile = path.join(__dirname, 'docker-compose.local-pg.yml');

let composeRunner;

function runCommand(cmd, args, options = {}) {
  return spawn(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
}

async function runCommandCapture(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', () => resolve({ code: -1, stdout, stderr }));
    child.on('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function waitForExit(child, commandText) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandText || child.spawnargs.join(' ')} 失败，退出码 ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runNodeScriptWithRetry(scriptFilePath, attempts = 3, delayMs = 1200) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const child = spawn(process.execPath, [scriptFilePath], {
        stdio: 'inherit',
      });
      await waitForExit(child, `node ${path.basename(scriptFilePath)}`);
      return;
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError || new Error(`执行脚本失败: ${scriptFilePath}`);
}

async function canRun(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      shell: false,
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function isPortInUse(port) {
  if (process.platform === 'win32') {
    const pids = await getWindowsPidsByPort(port);
    return pids.length > 0;
  }
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (error) => {
      resolve(error?.code === 'EADDRINUSE');
    });
    tester.once('listening', () => {
      tester.close(() => resolve(false));
    });
    tester.listen(port, '::');
  });
}

async function getWindowsPidsByPort(port) {
  return getWindowsPidsByPortFromNetstat(port);
}

async function getWindowsPidsByPortFromNetstat(port) {
  const result = await runCommandCapture('netstat', ['-ano', '-p', 'tcp']);
  if (result.code !== 0) return [];
  const pattern = new RegExp(`[:\\.]${port}\\s+.*LISTENING\\s+(\\d+)`, 'i');
  const pids = result.stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(pattern);
      return match ? Number(match[1]) : null;
    })
    .filter(item => Number.isInteger(item) && item > 0);
  return Array.from(new Set(pids));
}

async function killPidTreeWindows(pid) {
  const result = await runCommandCapture('taskkill', ['/PID', String(pid), '/T', '/F']);
  return result.code === 0;
}

async function waitForPortRelease(port, attempts = 10, intervalMs = 300) {
  for (let i = 0; i < attempts; i += 1) {
    if (!await isPortInUse(port)) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function ensureApiPortAvailable(port) {
  const occupied = await isPortInUse(port);
  if (!occupied) return;
  if (process.platform !== 'win32') {
    throw new Error(`本地 API 端口 ${port} 已被占用，请先释放端口后重试。`);
  }
  const pids = await getWindowsPidsByPort(port);
  const targetPids = pids.filter(pid => pid !== process.pid);
  for (const pid of targetPids) {
    await killPidTreeWindows(pid);
    const released = await waitForPortRelease(port, 6, 250);
    if (released) return;
  }
  const released = await waitForPortRelease(port, 10, 300);
  if (!released) {
    throw new Error(`本地 API 端口 ${port} 被占用且自动释放失败，请手动结束占用进程后重试。`);
  }
}

async function ensureDockerEngineForLocalDb() {
  if (await canRun('docker', ['info'])) return;
  throw new Error('Docker 引擎未运行。请先确保 Docker Desktop 已启动（可设为开机自启），再执行 npm run dev。');
}

async function resolveComposeRunner() {
  if (await canRun('docker', ['compose', 'version'])) {
    return {
      cmd: 'docker',
      argsPrefix: ['compose'],
      displayName: 'docker compose',
    };
  }
  if (await canRun('docker-compose', ['version'])) {
    return {
      cmd: 'docker-compose',
      argsPrefix: [],
      displayName: 'docker-compose',
    };
  }
  throw new Error('未检测到可用的 Docker Compose。请先安装 Docker Desktop（含 compose 插件）或 docker-compose。');
}

function runCompose(args, options = {}) {
  const fullArgs = [...composeRunner.argsPrefix, ...args];
  return runCommand(composeRunner.cmd, fullArgs, options);
}

await ensureDockerEngineForLocalDb();
const apiPort = Number(process.env.PORT || 8080);
await ensureApiPortAvailable(apiPort);
composeRunner = await resolveComposeRunner();

const serverProcess = runCompose(['-f', composeFile, 'up', '-d']);
await waitForExit(serverProcess, `${composeRunner.displayName} -f ${composeFile} up -d`);

await runNodeScriptWithRetry(path.join(__dirname, 'db-local-migrate-env.mjs'));

const apiProcess = spawn(process.execPath, [path.join(__dirname, 'dev-local-api.mjs')], {
  stdio: 'inherit',
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (!apiProcess.killed) {
    apiProcess.kill('SIGINT');
  }
  try {
    const down = runCompose(['-f', composeFile, 'down']);
    await waitForExit(down, `${composeRunner.displayName} -f ${composeFile} down`);
  } catch {
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const apiExitCode = await new Promise((resolve) => {
  apiProcess.on('error', () => resolve(1));
  apiProcess.on('exit', async (code) => {
    if (!stopping) {
      await shutdown();
    }
    resolve(code ?? 0);
  });
});

process.exit(apiExitCode);
