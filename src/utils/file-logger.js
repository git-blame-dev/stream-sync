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
            maxSize: config.maxSize ?? 10 * 1024 * 1024, // 10MB
            maxFiles: config.maxFiles ?? 5,
            logDir: config.logDir
        };

        this.ensureLogDirectory();
    }
    
    write(filename, content) {
        const fullPath = path.join(this.config.logDir, filename);

        try {
            if (this.needsRotation(fullPath)) {
                this.rotateFile(fullPath);
            }

            this.fs.appendFileSync(fullPath, content + '\n');

        } catch (error) {
            process.stderr.write(`[FileLogger] Failed to write to ${fullPath}: ${error.message}\n`);
        }
    }
    
    log(content) {
        const filename = this.config.filename || 'runtime.log';
        this.write(filename, content);
    }
    
    needsRotation(filePath) {
        try {
            if (!this.fs.existsSync(filePath)) return false;

            const stats = this.fs.statSync(filePath);
            return stats.size >= this.config.maxSize;
        } catch {
            return false;
        }
    }
    
    rotateFile(filePath) {
        try {
            const dir = path.dirname(filePath);
            const ext = path.extname(filePath);
            const basename = path.basename(filePath, ext);

            for (let i = this.config.maxFiles - 1; i >= 1; i--) {
                const oldFile = path.join(dir, `${basename}.${i}${ext}`);
                const newFile = path.join(dir, `${basename}.${i + 1}${ext}`);

                if (this.fs.existsSync(oldFile)) {
                    if (i === this.config.maxFiles - 1) {
                        this.fs.unlinkSync(oldFile);
                    } else {
                        this.fs.renameSync(oldFile, newFile);
                    }
                }
            }

            const rotatedFile = path.join(dir, `${basename}.1${ext}`);
            if (this.fs.existsSync(filePath)) {
                this.fs.renameSync(filePath, rotatedFile);
            }
        } catch (error) {
            process.stderr.write(`[FileLogger] Failed to rotate log file: ${error.message}\n`);
        }
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
