import { deflateRawSync } from 'node:zlib';

/** Tiny synthetic ZIP writer for adversarial tests only; never used by production. */
export interface ZipFixtureEntry {
    name: string;
    body?: Buffer;
    method?: number;
    size?: number;
    mode?: number;
    flags?: number;
}

export function zipFixture(entries: ZipFixtureEntry[]): Buffer {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const body = entry.body ?? Buffer.from('synthetic asset');
        const method = entry.method ?? 0;
        const data = method === 8 ? deflateRawSync(body) : body;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(entry.flags ?? 0x800, 6);
        local.writeUInt16LE(method, 8);
        let crc = 0xffffffff;
        for (const byte of body) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        local.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(entry.size ?? body.length, 22);
        local.writeUInt16LE(name.length, 26);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50);
        header.writeUInt16LE(0x314, 4);
        local.copy(header, 6, 4, 30);
        header.writeUInt32LE(((entry.mode ?? 0x8000) * 65536) >>> 0, 38);
        header.writeUInt32LE(offset, 42);
        locals.push(local, name, data);
        central.push(header, name);
        offset += local.length + name.length + data.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

/** Wrap a one-entry fixture in genuine ZIP64 records, including its local offset. */
export function zip64Fixture(overrides: { locator?: bigint; central?: bigint; local?: bigint } = {}): Buffer {
    const original = zipFixture([{ name: 'asset', method: 8 }]);
    const endOffset = original.length - 22;
    const centralOffset = original.readUInt32LE(endOffset + 16);
    const central = Buffer.from(original.subarray(centralOffset, endOffset));
    central.writeUInt32LE(0xffffffff, 42);
    central.writeUInt16LE(12, 30);
    const extra = Buffer.alloc(12);
    extra.writeUInt16LE(1, 0);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(overrides.local ?? 0n, 4);
    const zip64Offset = endOffset + extra.length;
    const zip64 = Buffer.alloc(56);
    zip64.writeUInt32LE(0x06064b50, 0);
    zip64.writeBigUInt64LE(44n, 4);
    zip64.writeUInt16LE(45, 12);
    zip64.writeUInt16LE(45, 14);
    zip64.writeBigUInt64LE(1n, 24);
    zip64.writeBigUInt64LE(1n, 32);
    zip64.writeBigUInt64LE(BigInt(central.length + extra.length), 40);
    zip64.writeBigUInt64LE(overrides.central ?? BigInt(centralOffset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(overrides.locator ?? BigInt(zip64Offset), 8);
    locator.writeUInt32LE(1, 16);
    const end = Buffer.from(original.subarray(endOffset));
    end.writeUInt32LE(0xffffffff, 16);
    return Buffer.concat([original.subarray(0, centralOffset), central, extra, zip64, locator, end]);
}
