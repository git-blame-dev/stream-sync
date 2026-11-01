// Credential identity is shared; each sink retains its own content and URL policy.
const CREDENTIAL_KEYS = [
    'authorization', 'proxyauthorization', 'accesstoken', 'refreshtoken',
    'idtoken', 'authtoken', 'jwttoken', 'sessiontoken', 'token', 'clientsecret',
    'secret', 'password', 'passwd', 'cookie', 'setcookie', 'sessionid',
    'apikey', 'xapikey', 'accesskeyid', 'awsaccesskeyid', 'privatekey',
    'signingkey', 'signature', 'sig', 'credential', 'credentials', 'keypairid', 'policy',
] as const;
const credentialKeys = new Set<string>(CREDENTIAL_KEYS);

function isCredentialLogKey(key: string): boolean {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return credentialKeys.has(normalized) || normalized.startsWith('xamz') || normalized.startsWith('xgoog');
}

export { isCredentialLogKey };
