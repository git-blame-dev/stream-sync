const fs = require('fs');
const path = require('path');

class FileLogger {
    constructor(config = {}) {
        if (!config.logDir) {
            throw new Error('logDir is required for FileLogger');
        }

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
            // Check if rotation needed
            if (this.needsRotation(fullPath)) {
                this.rotateFile(fullPath);
            }
            
            // Write to file
            fs.appendFileSync(fullPath, content + '\n');
            
        } catch (error) {
            // Use process.stderr.write for critical system messages to avoid circular dependency
            process.stderr.write(`[FileLogger] Failed to write to ${fullPath}: ${error.message}\n`);
        }
    }
    
    log(content) {
        const filename = this.config.filename || 'runtime.log';
        this.write(filename, content);
    }
    
    needsRotation(filePath) {
        try {
            if (!fs.existsSync(filePath)) return false;
            
            const stats = fs.statSync(filePath);
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
            
            // Rotate existing files
            for (let i = this.config.maxFiles - 1; i >= 1; i--) {
                const oldFile = path.join(dir, `${basename}.${i}${ext}`);
                const newFile = path.join(dir, `${basename}.${i + 1}${ext}`);
                
                if (fs.existsSync(oldFile)) {
                    if (i === this.config.maxFiles - 1) {
                        fs.unlinkSync(oldFile); // Delete oldest
                    } else {
                        fs.renameSync(oldFile, newFile);
                    }
                }
            }
            
            // Move current file to .1
            const rotatedFile = path.join(dir, `${basename}.1${ext}`);
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, rotatedFile);
            }
        } catch (error) {
            // Use process.stderr.write for critical system messages to avoid circular dependency
            process.stderr.write(`[FileLogger] Failed to rotate log file: ${error.message}\n`);
        }
    }
    
    ensureLogDirectory() {
        try {
            if (!fs.existsSync(this.config.logDir)) {
                fs.mkdirSync(this.config.logDir, { recursive: true });
            }
        } catch (error) {
            // Use process.stderr.write for critical system messages to avoid circular dependency
            process.stderr.write(`[FileLogger] Failed to create log directory: ${error.message}\n`);
        }
    }
}

module.exports = { FileLogger }; 
