type WriteCallback = (error?: Error | null) => void;

const captureOutput = (stream: NodeJS.WriteStream) => {
    const originalWrite = stream.write;
    const output: string[] = [];
    stream.write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | WriteCallback, callback?: WriteCallback) => {
        output.push(String(chunk));
        const writeCallback = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        writeCallback?.();
        return true;
    }) as typeof stream.write;
    let restored = false;
    return {
        output,
        restore: () => {
            if (restored) return;
            restored = true;
            stream.write = originalWrite;
        }
    };
};

const captureStdout = () => captureOutput(process.stdout);
const captureStderr = () => captureOutput(process.stderr);

export { captureStdout, captureStderr };
