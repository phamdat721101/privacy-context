import { pool } from '../db';

const CHUNK_SIZE = 2000;

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  for (const p of paragraphs) {
    if ((current + p).length > CHUNK_SIZE && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? '\n\n' : '') + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

export class KnowledgeIngestService {
  static async ingestFile(userAddress: string, content: string, brainId: number | null, chain: string) {
    const bid = brainId || await this.getDefaultBrain(userAddress, chain);
    const chunks = splitIntoChunks(content);

    // Get max chunk_index to append (not overwrite)
    const { rows: [{ max }] } = await pool.query(
      `SELECT COALESCE(MAX(chunk_index), -1) as max FROM knowledge_chunks WHERE brain_id = $1`, [bid]
    );
    const startIndex = (max as number) + 1;

    for (let i = 0; i < chunks.length; i++) {
      await pool.query(
        `INSERT INTO knowledge_chunks (brain_id, chunk_index, content) VALUES ($1, $2, $3)`,
        [bid, startIndex + i, chunks[i]]
      );
    }
    return { brainId: bid, estimatedChunks: chunks.length };
  }

  static async createBrain(userAddress: string, chain: string, title: string): Promise<number> {
    const { rows } = await pool.query(
      `INSERT INTO brains (owner_address, title, chain) VALUES ($1, $2, $3) RETURNING id`,
      [userAddress, title, chain]
    );
    return rows[0].id;
  }

  static async getDefaultBrain(userAddress: string, chain: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT id FROM brains WHERE owner_address = $1 ORDER BY created_at LIMIT 1`, [userAddress]
    );
    if (rows[0]) return rows[0].id;
    return this.createBrain(userAddress, chain, 'My Brain');
  }
}
