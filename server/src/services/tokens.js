import { query } from '../db/index.js';
import { randomToken, sha256 } from '../utils/token.js';

const TTL_SEC = { verify_email: 24 * 3600, reset_password: 3600 };

/** Создаёт одноразовый токен и возвращает его «сырое» значение (его кладём в ссылку). */
export async function issueToken(userId, kind) {
  const token = randomToken();
  await query(
    `INSERT INTO user_tokens (user_id, kind, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4::double precision))`,
    [userId, kind, sha256(token), TTL_SEC[kind]],
  );
  return token;
}

/** Не чаще одного письма в окне: защита от спама на чужую почту. */
export async function issuedRecently(userId, kind, seconds = 50) {
  const { rowCount } = await query(
    `SELECT 1 FROM user_tokens
     WHERE user_id = $1 AND kind = $2 AND created_at > now() - make_interval(secs => $3::double precision) LIMIT 1`,
    [userId, kind, seconds],
  );
  return rowCount > 0;
}
