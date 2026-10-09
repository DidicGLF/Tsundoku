import type { SyncPage, SyncPayload, SyncTransport } from "../src/sync";
import type { SyncEntry, SyncFollowedAuthor } from "../src/types";

/** Double du serveur : même règle que le vrai (la version la plus récente gagne, un numéro de séquence par changement accepté). */
export class FakeServer {
  seq = 0;
  entries = new Map<string, { seq: number; entry: SyncEntry }>();
  followed = new Map<string, { seq: number; author: SyncFollowedAuthor }>();
  pushes = 0;

  transport(): SyncTransport {
    return {
      push: async (payload: SyncPayload) => {
        this.pushes++;
        for (const entry of payload.entries) {
          const current = this.entries.get(entry.id);
          if (!current || current.entry.updatedAt < entry.updatedAt) this.entries.set(entry.id, { seq: ++this.seq, entry });
        }
        for (const author of payload.followed) {
          const current = this.followed.get(author.authorKey);
          if (!current || current.author.updatedAt < author.updatedAt) this.followed.set(author.authorKey, { seq: ++this.seq, author });
        }
      },
      pull: async (since: number, limit: number): Promise<SyncPage> => {
        const rows = [
          ...[...this.entries.values()].filter(row => row.seq > since).map(row => ({ seq: row.seq, entry: row.entry })),
          ...[...this.followed.values()].filter(row => row.seq > since).map(row => ({ seq: row.seq, author: row.author }))
        ].sort((a, b) => a.seq - b.seq);
        const page = rows.slice(0, limit);
        return {
          entries: page.flatMap(row => ("entry" in row ? [row.entry] : [])),
          followed: page.flatMap(row => ("author" in row ? [row.author] : [])),
          cursor: page.length ? page[page.length - 1].seq : since,
          hasMore: rows.length > limit
        };
      }
    };
  }
}
