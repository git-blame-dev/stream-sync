type WriteCallback = (error?: Error | null) => void;

const activeCaptures = new WeakSet<NodeJS.WriteStream>();

const captureOutput = (stream: NodeJS.WriteStream) => {
    if (activeCaptures.has(stream)) throw new Error('Output stream already has an active capture');
    const originalWrite = stream.write;
    const output: string[] = [];
    stream.write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | WriteCallback, callback?: WriteCallback) => {
        output.push(String(chunk));
        const writeCallback = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        writeCallback?.();
        return true;
    }) as typeof stream.write;
    activeCaptures.add(stream);
    let restored = false;
    return {
        output,
        restore: () => {
            if (restored) return;
            restored = true;
            stream.write = originalWrite;
            activeCaptures.delete(stream);
        }
    };
};

const captureStdout = () => captureOutput(process.stdout);
const captureStderr = () => captureOutput(process.stderr);

export { captureStdout, captureStderr };
