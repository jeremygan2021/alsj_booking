// Additive and shared by the SQLite/PostgreSQL adapters. No payment is changed
// until a GM imports a roster or a matching player subsequently authenticates.
export async function applyPaidPhones(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS paid_phones(phone TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',source_name TEXT NOT NULL DEFAULT '',imported_by TEXT NOT NULL,imported_at BIGINT NOT NULL)",
    )
    .run();
}
