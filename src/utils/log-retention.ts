import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type LogRetention = { archiveMaxBytes: number; archiveMaxAgeDays: number };

export function archiveIdentity(filename: string): string {
    return createHash('sha256').update(filename).digest('hex').slice(0, 12);
}

/** Only this generation's exact archive namespace is managed; historical files stay untouched. */
export async function pruneLogArchives(directory: string, filenames: readonly string[], policy: LogRetention): Promise<void> {
    const identities = new Set(filenames.map(archiveIdentity));
    const cutoff = Date.now() - policy.archiveMaxAgeDays * 86_400_000;
    const archives: { file: string; size: number; created: number }[] = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const match = /^archive-([a-f0-9]{12})\.(\d{13})\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.log$/.exec(entry.name);
        if (!entry.isFile() || !match || !identities.has(match[1]!)) continue;
        const file = path.join(directory, entry.name);
        const stat = await fs.lstat(file);
        if (stat.isFile()) archives.push({ file, size: stat.size, created: Number(match[2]) });
    }
    archives.sort((a, b) => a.created - b.created || a.file.localeCompare(b.file));
    let bytes = archives.reduce((sum, file) => sum + file.size, 0);
    for (const archive of archives) {
        if (archive.created >= cutoff && bytes <= policy.archiveMaxBytes) continue;
        await fs.unlink(archive.file);
        bytes -= archive.size;
    }
}
