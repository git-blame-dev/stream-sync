
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

describe('Critical Startup Flow', () => {
    let startupResult;

    beforeAll(async () => {
        startupResult = await runApplicationStartup();
    }, 20000);

    it('should fail fast when required configuration is missing', async () => {
        const result = startupResult;

        expect(result.timeout).not.toBe(true);
        expect(result.exitCode).toBe(1);
    }, 15000); // 15 second timeout
    
    it('should exit with failure status without a config file', async () => {
        const result = startupResult;

        expect(result.timeout).not.toBe(true);
        expect(result.exitCode).toBe(1);
    }, 15000);
});

async function runApplicationStartup() {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const bootstrap = path.join(__dirname, '../../src/bootstrap.js');
        const missingConfigPath = path.join(__dirname, 'fixtures', 'missing-config.ini');
        
        // Run with debug mode to capture detailed logs
        const child = spawn('node', [bootstrap, '--debug'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                CHAT_BOT_CONFIG_PATH: missingConfigPath,
                NODE_ENV: 'test',
                DEBUG: 'true'
            }
        });
        
        let stdout = '';
        let stderr = '';

        const startupTimeoutId = scheduleTestTimeout(() => {
            child.kill('SIGTERM');
            scheduleTestTimeout(() => child.kill('SIGKILL'), 1000);

            const endTime = Date.now();
            let output = stdout + stderr;
            let outputLines = output.split('\n').filter(line => line.trim());

            if (outputLines.length === 0) {
                const fallback = readFallbackStartupLog();
                if (fallback) {
                    output = fallback;
                    outputLines = fallback.split('\n').filter(line => line.trim());
                }
            }

            resolve({
                exitCode: 'TIMEOUT',
                output,
                outputLines, 
                duration: endTime - startTime,
                stdout,
                stderr,
                timeout: true
            });
        }, 12000);
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        // Handle normal exit
        child.on('close', (code) => {
            clearTimeout(startupTimeoutId);
            const endTime = Date.now();
            let output = stdout + stderr;
            let outputLines = output.split('\n').filter(line => line.trim());

            if (outputLines.length === 0) {
                const fallback = readFallbackStartupLog();
                if (fallback) {
                    output = fallback;
                    outputLines = fallback.split('\n').filter(line => line.trim());
                }
            }
            
            resolve({
                exitCode: code,
                output,
                outputLines,
                duration: endTime - startTime,
                stdout,
                stderr
            });
        });
        
        // Handle spawn errors
        child.on('error', (error) => {
            clearTimeout(startupTimeoutId);
            const endTime = Date.now();
            resolve({
                exitCode: -1,
                output: error.message,
                outputLines: [error.message],
                duration: endTime - startTime,
                stdout: '',
                stderr: error.message,
                error
            });
        });
        
    });
}

function readFallbackStartupLog() {
    try {
        const logDir = path.join(__dirname, '../../logs');
        const candidates = [
            path.join(logDir, 'runtime.log'),
            path.join(logDir, 'program-log.txt')
        ];

        let combined = '';
        for (const file of candidates) {
            if (!fs.existsSync(file)) {
                continue;
            }
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            const tailLines = lines.slice(-200);
            combined += tailLines.join('\n') + '\n';
        }

        return combined.trim();
    } catch (error) {
        console.log('Unable to read fallback startup log:', error.message);
        return '';
    }
}
