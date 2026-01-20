const defaultFs = require('fs');
const path = require('path');

class FileLogger {
    constructor(config = {}, deps = {}) {
        if (!config.logDir) {
            throw new Error('logDir is required for FileLogger');
        }

        this.fs = deps.fs || defaultFs;
        this.config = {
            ...config,
            logDir: config.logDir
        };

        this.ensureLogDirectory();
    }
    
    write(filename, content) {
        const fullPath = path.join(this.config.logDir, filename);

        try {
            this.fs.appendFileSync(fullPath, content + '\n');

        } catch (error) {
            process.stderr.write(`[FileLogger] Failed to write to ${fullPath}: ${error.message}\n`);
        }
    }
    
    log(content) {
        const filename = this.config.filename || 'runtime.log';
        this.write(filename, content);
    }
    
    ensureLogDirectory() {
        try {
            if (!this.fs.existsSync(this.config.logDir)) {
                this.fs.mkdirSync(this.config.logDir, { recursive: true });
            }
        } catch (error) {
            process.stderr.write(`[FileLogger] Failed to create log directory: ${error.message}\n`);
        }
    }
}

module.exports = { FileLogger }; 
