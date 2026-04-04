const captureOutput = (stream) => {
    const originalWrite = stream.write;
    const output = [];
    stream.write = (chunk, encoding, callback) => {
        output.push(String(chunk));
        if (typeof callback === 'function') callback();
        return true;
    };
    return {
        output,
        restore: () => {
            stream.write = originalWrite;
        }
    };
};

const captureStdout = () => captureOutput(process.stdout);
const captureStderr = () => captureOutput(process.stderr);

module.exports = { captureStdout, captureStderr };
