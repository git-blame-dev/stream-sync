function isBootstrapDebugModeEnabled(): boolean {
    return process.argv.includes('--debug') || process.env.EMERGENCY_DEBUG === '1';
}

export {
    isBootstrapDebugModeEnabled
};
