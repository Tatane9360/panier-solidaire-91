// Seul module qui ouvre des connexions et des transactions (ADR 0002).
import pg from 'pg';

export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString });

  return {
    query: (text, params) => pool.query(text, params),

    async withTransaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    end: () => pool.end(),
  };
}
