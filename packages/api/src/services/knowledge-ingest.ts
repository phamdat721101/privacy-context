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
    const bid = brainId || await this.getOrCreateBrain(userAddress, chain);
    const chunks = splitIntoChunks(content);

    for (let i = 0; i < chunks.length; i++) {
      await pool.query(
        `INSERT INTO knowledge_chunks (brain_id, chunk_index, content) VALUES ($1, $2, $3)`,
        [bid, i, chunks[i]]
      );
    }

    return { brainId: bid, estimatedChunks: chunks.length };
  }

  private static async getOrCreateBrain(userAddress: string, chain: string): Promise<number> {
    const { rows } = await pool.query(`SELECT id FROM brains WHERE owner_address = $1 LIMIT 1`, [userAddress]);
    if (rows[0]) return rows[0].id;
    const { rows: created } = await pool.query(
      `INSERT INTO brains (owner_address, title, chain) VALUES ($1, 'My Brain', $2) RETURNING id`,
      [userAddress, chain]
    );
    return created[0].id;
  }
}
