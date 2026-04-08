type WriteCallback = (error?: Error | null) => void;

const captureOutput = (stream: NodeJS.WriteStream) => {
    const originalWrite = stream.write;
    const output: string[] = [];
    stream.write = ((chunk: string | Uint8Array, _encoding?: BufferEncoding, callback?: WriteCallback) => {
        output.push(String(chunk));
        if (typeof callback === 'function') callback();
        return true;
    }) as typeof stream.write;
    return {
        output,
        restore: () => {
            stream.write = originalWrite;
        }
    };
};

const captureStdout = () => captureOutput(process.stdout);
const captureStderr = () => captureOutput(process.stderr);

export { captureStdout, captureStderr };
