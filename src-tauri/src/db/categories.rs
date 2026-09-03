// Port of the `db:getCategories` and `db:createCategory` IPC handlers from
// `electron/main.js` (`git show ca805d0:electron/main.js`, lines 470-484).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

use super::error::{DbError, DbResult};
use super::models::Category;

const CATEGORY_COLUMNS: &str = "id, name, color, created_at";

/// What a caller supplies to create a category: no `id` (assigned by
/// SQLite) and no `created_at` (defaulted by the column).
#[derive(Debug, Deserialize)]
pub struct NewCategory {
    pub name: String,
    pub color: String,
}

pub fn get_categories(conn: &Connection) -> DbResult<Vec<Category>> {
    let sql = format!("SELECT {CATEGORY_COLUMNS} FROM categories ORDER BY name");
    let mut stmt = conn.prepare(&sql)?;
    let categories = stmt.query_map([], Category::from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(categories)
}

/// Reads the row back rather than echoing the input plus a generated id
/// (as `main.js`'s object-spread did) — see the equivalent note on
/// `events::create_event` for why.
pub fn create_category(conn: &Connection, new_category: &NewCategory) -> DbResult<Category> {
    conn.execute(
        "INSERT INTO categories (name, color) VALUES (?1, ?2)",
        params![new_category.name, new_category.color],
    )?;
    let id = conn.last_insert_rowid();
    let sql = format!("SELECT {CATEGORY_COLUMNS} FROM categories WHERE id = ?1");
    conn.query_row(&sql, params![id], Category::from_row)
        .optional()?
        .ok_or_else(|| DbError::Other(format!("category {id} vanished immediately after insert")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn create_category_round_trips_every_field() {
        let conn = setup();

        let created = create_category(
            &conn,
            &NewCategory { name: "Client Work".to_string(), color: "#112233".to_string() },
        )
        .unwrap();

        assert!(created.id.is_some());
        assert_eq!(created.name, "Client Work");
        assert_eq!(created.color, "#112233");
        assert!(created.created_at.is_some());
    }

    #[test]
    fn get_categories_orders_by_name() {
        let conn = setup();
        create_category(&conn, &NewCategory { name: "Charlie".to_string(), color: "#000000".to_string() }).unwrap();
        create_category(&conn, &NewCategory { name: "Alpha".to_string(), color: "#000000".to_string() }).unwrap();
        create_category(&conn, &NewCategory { name: "Bravo".to_string(), color: "#000000".to_string() }).unwrap();

        let categories = get_categories(&conn).unwrap();

        let names: Vec<_> = categories.iter().map(|c| c.name.clone()).collect();
        assert_eq!(names, vec!["Alpha", "Bravo", "Charlie"]);
    }
}
