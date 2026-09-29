import crypto from "node:crypto";
import { db, now } from "./db.js";
import { ARTICLES } from "../shared/articles.js";

/**
 * 건강 정보 글을 데이터베이스에 넣는다.
 *
 * 글은 앱이 제공하는 콘텐츠이지 사용자 데이터가 아니므로, 기동할 때마다 최신 내용으로
 * 맞춘다(slug 가 같으면 덮어쓴다). 사용자 데이터는 이런 식으로 건드리지 않는다.
 */
export function seedArticles(): void {
  const stamp = now();
  const insert = db().prepare(
    `INSERT INTO health_articles
       (id, slug, category, title, summary, body, tags, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       category = excluded.category,
       title = excluded.title,
       summary = excluded.summary,
       body = excluded.body,
       tags = excluded.tags,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
  );

  db().exec("BEGIN");
  try {
    for (const article of ARTICLES) {
      insert.run(
        crypto.randomUUID(),
        article.slug,
        article.category,
        article.title,
        article.summary,
        article.body,
        article.tags,
        article.sortOrder,
        stamp,
        stamp,
      );
    }
    db().exec("COMMIT");
  } catch (err) {
    db().exec("ROLLBACK");
    throw err;
  }
}
