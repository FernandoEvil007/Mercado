import cors from "cors";
import express from "express";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "mercardo.sqlite");
const port = Number(process.env.PORT || 3001);
const defaultUnits = ["kilo", "gramos", "litros", "unidad", "frasco", "pote", "sobre", "caja"];

const seedProducts = [
  ["Despensa", "Arroz", 4500],
  ["Despensa", "Frijol", 6200],
  ["Despensa", "Aceite", 14500],
  ["Despensa", "Pasta", 3800],
  ["Frutas y verduras", "Tomate", 3500],
  ["Frutas y verduras", "Cebolla", 2800],
  ["Frutas y verduras", "Banano", 4200],
  ["Frutas y verduras", "Papa", 3900],
  ["Carnes", "Pollo", 14500],
  ["Carnes", "Carne molida", 18500],
  ["Carnes", "Huevos", 16000],
  ["Lacteos", "Leche", 5200],
  ["Lacteos", "Queso", 12000],
  ["Lacteos", "Yogurt", 7200],
  ["Aseo", "Jabon", 4600],
  ["Aseo", "Papel higienico", 17800],
  ["Aseo", "Detergente", 23000],
  ["Otros", "Cafe", 18500],
  ["Otros", "Pan", 5000],
];

await mkdir(dataDir, { recursive: true });

const db = await open({
  filename: dbPath,
  driver: sqlite3.Database,
});

await db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'unidad',
    presentation_quantity REAL NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE(category_id, name)
  );

  CREATE TABLE IF NOT EXISTS shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    checked INTEGER NOT NULL DEFAULT 0,
    price_snapshot INTEGER NOT NULL,
    FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    old_price INTEGER,
    new_price INTEGER NOT NULL,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL UNIQUE,
    quantity REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS measurement_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const productColumns = await db.all("PRAGMA table_info(products)");
if (!productColumns.some((column) => column.name === "unit")) {
  await db.run("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'unidad'");
}
if (!productColumns.some((column) => column.name === "presentation_quantity")) {
  await db.run("ALTER TABLE products ADD COLUMN presentation_quantity REAL NOT NULL DEFAULT 1");
}

for (const [categoryName, productName, price] of seedProducts) {
  const category = await db.get("SELECT id FROM categories WHERE name = ?", categoryName);
  const categoryId =
    category?.id ??
    (await db.run("INSERT INTO categories (name) VALUES (?)", categoryName)).lastID;

  await db.run(
    "INSERT OR IGNORE INTO products (category_id, name, price) VALUES (?, ?, ?)",
    categoryId,
    productName,
    price,
  );
}

for (const unit of defaultUnits) {
  await db.run("INSERT OR IGNORE INTO measurement_units (name) VALUES (?)", unit);
}

const historyCount = await db.get("SELECT COUNT(*) AS total FROM price_history");
if (historyCount.total === 0) {
  await db.run(`
    INSERT INTO price_history (product_id, old_price, new_price)
    SELECT id, NULL, price FROM products
  `);
}

const listCount = await db.get("SELECT COUNT(*) AS total FROM shopping_lists");
if (listCount.total === 0) {
  await db.run("INSERT INTO shopping_lists (name) VALUES (?)", "Mercado principal");
}

const app = express();
app.use(cors());
app.use(express.json());

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUnitName(value) {
  return normalizeText(value).toLowerCase();
}

async function ensureUnit(value) {
  const unit = normalizeUnitName(value) || "unidad";
  await db.run("INSERT OR IGNORE INTO measurement_units (name) VALUES (?)", unit);
  return unit;
}

function normalizePresentationQuantity(value) {
  const quantity = Number(value);
  return Number.isNaN(quantity) || quantity <= 0 ? 1 : quantity;
}

async function getUnits() {
  return db.all("SELECT id, name FROM measurement_units ORDER BY name");
}

async function getProducts() {
  return db.all(`
    SELECT
      products.id,
      products.name,
      products.price,
      products.unit,
      products.presentation_quantity AS presentationQuantity,
      categories.id AS categoryId,
      categories.name AS category
    FROM products
    JOIN categories ON categories.id = products.category_id
    ORDER BY categories.name, products.name
  `);
}

async function getListItems(listId) {
  return db.all(
    `
      SELECT
        list_items.id,
        list_items.list_id AS listId,
        list_items.product_id AS productId,
        list_items.quantity,
        list_items.checked,
        list_items.price_snapshot AS price,
        products.name,
        products.unit,
        products.presentation_quantity AS presentationQuantity,
        categories.name AS category
      FROM list_items
      JOIN products ON products.id = list_items.product_id
      JOIN categories ON categories.id = products.category_id
      WHERE list_items.list_id = ?
      ORDER BY list_items.id DESC
    `,
    listId,
  );
}

async function getInventory() {
  return db.all(`
    SELECT
      inventory.id,
      inventory.product_id AS productId,
      inventory.quantity,
      inventory.updated_at AS updatedAt,
      products.name,
      products.unit,
      products.presentation_quantity AS presentationQuantity,
      categories.name AS category
    FROM inventory
    JOIN products ON products.id = inventory.product_id
    JOIN categories ON categories.id = products.category_id
    ORDER BY categories.name, products.name
  `);
}

async function getPriceHistory() {
  return db.all(`
    SELECT
      price_history.id,
      price_history.product_id AS productId,
      price_history.old_price AS oldPrice,
      price_history.new_price AS newPrice,
      price_history.changed_at AS changedAt,
      products.name,
      categories.name AS category
    FROM price_history
    JOIN products ON products.id = price_history.product_id
    JOIN categories ON categories.id = products.category_id
    ORDER BY products.name COLLATE NOCASE ASC, price_history.changed_at DESC, price_history.id DESC
    LIMIT 120
  `);
}

app.get("/api/bootstrap", async (_request, response) => {
  const [categories, products, lists, priceHistory, inventory, units] = await Promise.all([
    db.all("SELECT id, name FROM categories ORDER BY name"),
    getProducts(),
    db.all("SELECT id, name, created_at AS createdAt FROM shopping_lists ORDER BY id DESC"),
    getPriceHistory(),
    getInventory(),
    getUnits(),
  ]);

  const activeListId = lists[0]?.id ?? null;
  const items = activeListId ? await getListItems(activeListId) : [];

  response.json({ categories, products, lists, activeListId, items, priceHistory, inventory, units });
});

app.get("/api/inventory", async (_request, response) => {
  response.json({ inventory: await getInventory() });
});

app.get("/api/price-history", async (_request, response) => {
  response.json({ priceHistory: await getPriceHistory() });
});

app.post("/api/units", async (request, response) => {
  const name = normalizeUnitName(request.body.name);
  if (!name) {
    response.status(400).json({ error: "Unit name is required." });
    return;
  }

  await ensureUnit(name);
  response.status(201).json({ units: await getUnits() });
});

app.patch("/api/units/:unitId", async (request, response) => {
  const unitId = Number(request.params.unitId);
  const name = normalizeUnitName(request.body.name);

  if (!unitId || !name) {
    response.status(400).json({ error: "Valid unit update is required." });
    return;
  }

  const currentUnit = await db.get("SELECT id, name FROM measurement_units WHERE id = ?", unitId);
  if (!currentUnit) {
    response.status(404).json({ error: "Unit not found." });
    return;
  }

  const existingUnit = await db.get("SELECT id, name FROM measurement_units WHERE name = ?", name);
  if (existingUnit && existingUnit.id !== unitId) {
    await db.run("UPDATE products SET unit = ? WHERE unit = ?", existingUnit.name, currentUnit.name);
    await db.run("DELETE FROM measurement_units WHERE id = ?", unitId);
  } else {
    await db.run("UPDATE measurement_units SET name = ? WHERE id = ?", name, unitId);
    await db.run("UPDATE products SET unit = ? WHERE unit = ?", name, currentUnit.name);
  }

  response.json({
    units: await getUnits(),
    products: await getProducts(),
    inventory: await getInventory(),
  });
});

app.post("/api/categories", async (request, response) => {
  const name = normalizeText(request.body.name);
  if (!name) {
    response.status(400).json({ error: "Category name is required." });
    return;
  }

  await db.run("INSERT OR IGNORE INTO categories (name) VALUES (?)", name);
  const category = await db.get("SELECT id, name FROM categories WHERE name = ?", name);
  response.status(201).json(category);
});

app.post("/api/products", async (request, response) => {
  const name = normalizeText(request.body.name);
  const categoryId = Number(request.body.categoryId);
  const price = Number(request.body.price);
  const unit = await ensureUnit(request.body.unit);
  const presentationQuantity = normalizePresentationQuantity(request.body.presentationQuantity);

  if (!name || !categoryId || Number.isNaN(price) || price < 0) {
    response.status(400).json({ error: "Valid name, category and price are required." });
    return;
  }

  const existing = await db.get(
    "SELECT id, price FROM products WHERE category_id = ? AND name = ?",
    categoryId,
    name,
  );
  const roundedPrice = Math.round(price);

  await db.run(
    "INSERT INTO products (category_id, name, price, unit, presentation_quantity) VALUES (?, ?, ?, ?, ?) ON CONFLICT(category_id, name) DO UPDATE SET price = excluded.price, unit = excluded.unit, presentation_quantity = excluded.presentation_quantity",
    categoryId,
    name,
    roundedPrice,
    unit,
    presentationQuantity,
  );

  const product = await db.get(
    "SELECT id FROM products WHERE category_id = ? AND name = ?",
    categoryId,
    name,
  );

  if (!existing || existing.price !== roundedPrice) {
    await db.run(
      "INSERT INTO price_history (product_id, old_price, new_price) VALUES (?, ?, ?)",
      product.id,
      existing?.price ?? null,
      roundedPrice,
    );
  }

  response.status(201).json({
    products: await getProducts(),
    priceHistory: await getPriceHistory(),
    inventory: await getInventory(),
  });
});

app.patch("/api/products/:productId", async (request, response) => {
  const productId = Number(request.params.productId);
  const hasPrice = request.body.price !== undefined;
  const hasUnit = request.body.unit !== undefined;
  const hasPresentationQuantity = request.body.presentationQuantity !== undefined;
  const hasCategory = request.body.categoryId !== undefined;
  const price = Number(request.body.price);
  const unit = hasUnit ? await ensureUnit(request.body.unit) : "unidad";
  const presentationQuantity = normalizePresentationQuantity(request.body.presentationQuantity);
  const categoryId = Number(request.body.categoryId);

  if (
    !productId ||
    (!hasPrice && !hasUnit && !hasPresentationQuantity && !hasCategory) ||
    (hasPrice && (Number.isNaN(price) || price < 0)) ||
    (hasCategory && !categoryId)
  ) {
    response.status(400).json({ error: "Valid product update is required." });
    return;
  }

  const product = await db.get("SELECT id, name, price, category_id AS categoryId FROM products WHERE id = ?", productId);
  if (!product) {
    response.status(404).json({ error: "Product not found." });
    return;
  }

  if (hasCategory) {
    const category = await db.get("SELECT id FROM categories WHERE id = ?", categoryId);
    if (!category) {
      response.status(404).json({ error: "Category not found." });
      return;
    }

    const duplicate = await db.get(
      "SELECT id FROM products WHERE category_id = ? AND name = ? AND id <> ?",
      categoryId,
      product.name,
      productId,
    );
    if (duplicate) {
      response.status(409).json({ error: "Product already exists in target category." });
      return;
    }

    await db.run("UPDATE products SET category_id = ? WHERE id = ?", categoryId, productId);
  }

  if (hasPrice) {
    const roundedPrice = Math.round(price);
    await db.run("UPDATE products SET price = ? WHERE id = ?", roundedPrice, productId);
    await db.run(
      "UPDATE list_items SET price_snapshot = ? WHERE product_id = ? AND checked = 0",
      roundedPrice,
      productId,
    );
    if (product.price !== roundedPrice) {
      await db.run(
        "INSERT INTO price_history (product_id, old_price, new_price) VALUES (?, ?, ?)",
        productId,
        product.price,
        roundedPrice,
      );
    }
  }

  if (hasUnit) {
    await db.run("UPDATE products SET unit = ? WHERE id = ?", unit, productId);
  }

  if (hasPresentationQuantity) {
    await db.run("UPDATE products SET presentation_quantity = ? WHERE id = ?", presentationQuantity, productId);
  }

  response.json({ products: await getProducts(), priceHistory: await getPriceHistory(), inventory: await getInventory() });
});

app.delete("/api/products/:productId", async (request, response) => {
  const productId = Number(request.params.productId);

  if (!productId) {
    response.status(400).json({ error: "Valid product is required." });
    return;
  }

  const product = await db.get("SELECT id FROM products WHERE id = ?", productId);
  if (!product) {
    response.status(404).json({ error: "Product not found." });
    return;
  }

  await db.run("DELETE FROM products WHERE id = ?", productId);

  response.json({
    products: await getProducts(),
    priceHistory: await getPriceHistory(),
    inventory: await getInventory(),
  });
});

app.patch("/api/inventory/:productId", async (request, response) => {
  const productId = Number(request.params.productId);
  const quantity = Number(request.body.quantity);

  if (!productId || Number.isNaN(quantity) || quantity < 0) {
    response.status(400).json({ error: "Valid product and quantity are required." });
    return;
  }

  const product = await db.get("SELECT id FROM products WHERE id = ?", productId);
  if (!product) {
    response.status(404).json({ error: "Product not found." });
    return;
  }

  await db.run(
    "INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP",
    productId,
    quantity,
  );

  response.json({ inventory: await getInventory() });
});

app.post("/api/lists", async (request, response) => {
  const name = normalizeText(request.body.name);
  if (!name) {
    response.status(400).json({ error: "List name is required." });
    return;
  }

  const result = await db.run("INSERT INTO shopping_lists (name) VALUES (?)", name);
  const list = await db.get(
    "SELECT id, name, created_at AS createdAt FROM shopping_lists WHERE id = ?",
    result.lastID,
  );

  response.status(201).json({ list, items: [] });
});

app.get("/api/lists/:listId/items", async (request, response) => {
  response.json({ items: await getListItems(Number(request.params.listId)) });
});

app.delete("/api/lists/:listId", async (request, response) => {
  const listId = Number(request.params.listId);
  await db.run("DELETE FROM shopping_lists WHERE id = ?", listId);

  const lists = await db.all(
    "SELECT id, name, created_at AS createdAt FROM shopping_lists ORDER BY id DESC",
  );
  const activeListId = lists[0]?.id ?? null;
  const items = activeListId ? await getListItems(activeListId) : [];

  response.json({ lists, activeListId, items });
});

app.post("/api/lists/:listId/items", async (request, response) => {
  const listId = Number(request.params.listId);
  const productId = Number(request.body.productId);
  const quantity = Math.max(1, Number(request.body.quantity || 1));
  const product = await db.get("SELECT price FROM products WHERE id = ?", productId);

  if (!listId || !productId || !product) {
    response.status(400).json({ error: "Valid list and product are required." });
    return;
  }

  const existing = await db.get(
    "SELECT id FROM list_items WHERE list_id = ? AND product_id = ? AND checked = 0",
    listId,
    productId,
  );

  if (existing) {
    await db.run("UPDATE list_items SET quantity = quantity + ? WHERE id = ?", quantity, existing.id);
  } else {
    await db.run(
      "INSERT INTO list_items (list_id, product_id, quantity, price_snapshot) VALUES (?, ?, ?, ?)",
      listId,
      productId,
      quantity,
      product.price,
    );
  }

  response.status(201).json({ items: await getListItems(listId) });
});

app.patch("/api/list-items/:itemId", async (request, response) => {
  const itemId = Number(request.params.itemId);
  const item = await db.get("SELECT list_id AS listId FROM list_items WHERE id = ?", itemId);

  if (!item) {
    response.status(404).json({ error: "Item not found." });
    return;
  }

  if (typeof request.body.checked === "boolean") {
    await db.run("UPDATE list_items SET checked = ? WHERE id = ?", request.body.checked ? 1 : 0, itemId);
  }

  if (request.body.quantity !== undefined) {
    const quantity = Math.max(1, Number(request.body.quantity));
    await db.run("UPDATE list_items SET quantity = ? WHERE id = ?", quantity, itemId);
  }

  response.json({ items: await getListItems(item.listId) });
});

app.delete("/api/list-items/:itemId", async (request, response) => {
  const itemId = Number(request.params.itemId);
  const item = await db.get("SELECT list_id AS listId FROM list_items WHERE id = ?", itemId);

  if (!item) {
    response.status(404).json({ error: "Item not found." });
    return;
  }

  await db.run("DELETE FROM list_items WHERE id = ?", itemId);
  response.json({ items: await getListItems(item.listId) });
});

app.use(express.static(path.join(__dirname, "..", "dist")));
app.use((request, response, next) => {
  if (request.method === "GET" && !request.path.startsWith("/api")) {
    response.sendFile(path.join(__dirname, "..", "dist", "index.html"));
    return;
  }

  next();
});

app.listen(port, () => {
  console.log(`Mercardo API running on http://127.0.0.1:${port}`);
});
