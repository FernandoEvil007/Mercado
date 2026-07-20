import cors from "cors";
import express from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "mercardo.sqlite");
const authDbPath = path.join(dataDir, "auth.sqlite");
const usersDataDir = path.join(dataDir, "users");
const port = Number(process.env.PORT || 3001);
const defaultUnits = ["kilo", "gramos", "litros", "unidad", "frasco", "pote", "sobre", "caja"];
const adminUsername = process.env.ADMIN_USERNAME || "Fernandoadmin";
const isHostedEnvironment = Boolean(process.env.RENDER || process.env.PORT || process.env.NODE_ENV === "production");
const adminAccessCode = process.env.ADMIN_ACCESS_CODE || (isHostedEnvironment ? "" : "1234");
const sessions = new Map();
const appDbContext = new AsyncLocalStorage();
const appDbCache = new Map();

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
await mkdir(usersDataDir, { recursive: true });

const db = await open({
  filename: dbPath,
  driver: sqlite3.Database,
});

const authDb = await open({
  filename: authDbPath,
  driver: sqlite3.Database,
});

function getDb() {
  return appDbContext.getStore() || db;
}

await authDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    db_file TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

await getDb().exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS catalogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog_id INTEGER NOT NULL DEFAULT 1,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'unidad',
    presentation_quantity REAL NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (catalog_id) REFERENCES catalogs(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE(catalog_id, category_id, name)
  );

  CREATE TABLE IF NOT EXISTS shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    completed_at TEXT,
    completed_total REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    checked INTEGER NOT NULL DEFAULT 0,
    price_snapshot REAL NOT NULL,
    FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    old_price REAL,
    new_price REAL NOT NULL,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL UNIQUE,
    quantity REAL NOT NULL DEFAULT 0,
    min_quantity REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS measurement_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id, name)
  );

  CREATE TABLE IF NOT EXISTS purchase_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER,
    list_name TEXT NOT NULL,
    total REAL NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    quantity REAL NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    checked INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (record_id) REFERENCES purchase_records(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const productColumns = await getDb().all("PRAGMA table_info(products)");
let defaultCatalog = await getDb().get("SELECT id, name FROM catalogs WHERE name = ?", "Catalogo alkosto");
if (!defaultCatalog) {
  const existingCatalog = await getDb().get("SELECT id, name FROM catalogs ORDER BY id LIMIT 1");
  if (existingCatalog) {
    await getDb().run("UPDATE catalogs SET name = ? WHERE id = ?", "Catalogo alkosto", existingCatalog.id);
    defaultCatalog = { id: existingCatalog.id, name: "Catalogo alkosto" };
  } else {
    const result = await getDb().run("INSERT INTO catalogs (name) VALUES (?)", "Catalogo alkosto");
    defaultCatalog = { id: result.lastID, name: "Catalogo alkosto" };
  }
}

if (!productColumns.some((column) => column.name === "brand")) {
  await getDb().run("ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT ''");
}
if (!productColumns.some((column) => column.name === "unit")) {
  await getDb().run("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'unidad'");
}
if (!productColumns.some((column) => column.name === "presentation_quantity")) {
  await getDb().run("ALTER TABLE products ADD COLUMN presentation_quantity REAL NOT NULL DEFAULT 1");
}
if (!productColumns.some((column) => column.name === "catalog_id")) {
  await getDb().run("ALTER TABLE products ADD COLUMN catalog_id INTEGER NOT NULL DEFAULT 1");
  await getDb().run("UPDATE products SET catalog_id = ?", defaultCatalog.id);
}

const productCatalogMigration = await getDb().get("SELECT value FROM app_settings WHERE key = ?", "products_catalog_unique_v1");
if (!productCatalogMigration) {
  await getDb().exec("PRAGMA foreign_keys = OFF");
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS products_catalog_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_id INTEGER NOT NULL DEFAULT 1,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'unidad',
      presentation_quantity REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (catalog_id) REFERENCES catalogs(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE(catalog_id, category_id, name)
    );
  `);
  await getDb().run(`
    INSERT OR IGNORE INTO products_catalog_migration (
      id, catalog_id, category_id, name, brand, price, unit, presentation_quantity, created_at
    )
    SELECT
      id,
      COALESCE(NULLIF(catalog_id, 0), ?),
      category_id,
      name,
      COALESCE(brand, ''),
      COALESCE(price, 0),
      COALESCE(unit, 'unidad'),
      COALESCE(presentation_quantity, 1),
      COALESCE(created_at, CURRENT_TIMESTAMP)
    FROM products
  `, defaultCatalog.id);
  await getDb().exec("DROP TABLE products");
  await getDb().exec("ALTER TABLE products_catalog_migration RENAME TO products");
  await getDb().exec("PRAGMA foreign_keys = ON");
  await getDb().run(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
    "products_catalog_unique_v1",
    "1",
  );
}

const inventoryColumns = await getDb().all("PRAGMA table_info(inventory)");
if (!inventoryColumns.some((column) => column.name === "min_quantity")) {
  await getDb().run("ALTER TABLE inventory ADD COLUMN min_quantity REAL NOT NULL DEFAULT 0");
}

const brandColumns = await getDb().all("PRAGMA table_info(product_brands)");
if (!brandColumns.some((column) => column.name === "price")) {
  await getDb().run("ALTER TABLE product_brands ADD COLUMN price REAL");
}
if (!brandColumns.some((column) => column.name === "updated_at")) {
  await getDb().run("ALTER TABLE product_brands ADD COLUMN updated_at TEXT");
  await getDb().run("UPDATE product_brands SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP)");
}

const listColumns = await getDb().all("PRAGMA table_info(shopping_lists)");
if (!listColumns.some((column) => column.name === "completed_at")) {
  await getDb().run("ALTER TABLE shopping_lists ADD COLUMN completed_at TEXT");
}
if (!listColumns.some((column) => column.name === "completed_total")) {
  await getDb().run("ALTER TABLE shopping_lists ADD COLUMN completed_total REAL");
}

const productCount = await getDb().get("SELECT COUNT(*) AS total FROM products");
const catalogSeeded = await getDb().get("SELECT value FROM app_settings WHERE key = ?", "catalog_seeded");
if (!catalogSeeded && productCount.total === 0) {
  for (const [categoryName, productName, price] of seedProducts) {
    const category = await getDb().get("SELECT id FROM categories WHERE name = ?", categoryName);
    const categoryId =
      category?.id ??
      (await getDb().run("INSERT INTO categories (name) VALUES (?)", categoryName)).lastID;

    await getDb().run(
      "INSERT OR IGNORE INTO products (catalog_id, category_id, name, price) VALUES (?, ?, ?, ?)",
      defaultCatalog.id,
      categoryId,
      productName,
      price,
    );
  }
}

if (!catalogSeeded) {
  await getDb().run(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
    "catalog_seeded",
    "1",
  );
}

for (const unit of defaultUnits) {
  await getDb().run("INSERT OR IGNORE INTO measurement_units (name) VALUES (?)", unit);
}

const historyCount = await getDb().get("SELECT COUNT(*) AS total FROM price_history");
if (historyCount.total === 0) {
  await getDb().run(`
    INSERT INTO price_history (product_id, old_price, new_price)
    SELECT id, NULL, price FROM products
  `);
}

const listCount = await getDb().get("SELECT COUNT(*) AS total FROM shopping_lists");
if (listCount.total === 0) {
  await getDb().run("INSERT INTO shopping_lists (name) VALUES (?)", "Mercado principal");
}

const app = express();
app.use(cors());
app.use(express.json());

function isValidSecret(value, expected) {
  const incoming = Buffer.from(String(value || ""));
  const current = Buffer.from(String(expected || ""));
  return incoming.length === current.length && crypto.timingSafeEqual(incoming, current);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { hash, salt };
}

function isValidPassword(password, hash, salt) {
  const attempted = hashPassword(password, salt).hash;
  return isValidSecret(attempted, hash);
}

function normalizeUsername(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function getSafeDbFilename(username, userId) {
  const safeUsername = username
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${userId}-${safeUsername || "usuario"}.sqlite`;
}

function getUserDbPath(dbFile) {
  return path.join(usersDataDir, path.basename(dbFile));
}

async function sanitizeUserDatabase(userDbPath) {
  const userDb = await open({
    filename: userDbPath,
    driver: sqlite3.Database,
  });

  try {
    await userDb.exec(`
      PRAGMA foreign_keys = ON;
      DELETE FROM purchase_items;
      DELETE FROM purchase_records;
      DELETE FROM list_items;
      DELETE FROM shopping_lists;
      DELETE FROM inventory;
      DELETE FROM price_history;
      DELETE FROM product_brands;
      UPDATE products SET price = 0, brand = '';
      INSERT INTO shopping_lists (name) VALUES ('Mercado principal');
    `);
  } finally {
    await userDb.close();
  }
}

async function createUserDatabase(username, userId) {
  const dbFile = getSafeDbFilename(username, userId);
  const userDbPath = getUserDbPath(dbFile);
  await copyFile(dbPath, userDbPath);
  await sanitizeUserDatabase(userDbPath);
  return dbFile;
}

async function openSessionDatabase(session) {
  if (session.role === "admin") {
    return db;
  }

  const userDbPath = getUserDbPath(session.dbFile);
  if (!appDbCache.has(userDbPath)) {
    const userDb = await open({
      filename: userDbPath,
      driver: sqlite3.Database,
    });
    await ensureCatalogSupport(userDb);
    appDbCache.set(userDbPath, userDb);
  }

  return appDbCache.get(userDbPath);
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { ...user, createdAt: Date.now() });
  return token;
}

async function requireSession(request, response, next) {
  const header = request.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = sessions.get(token);

  if (!session) {
    response.status(401).json({ error: "Session required." });
    return;
  }

  try {
    const sessionDb = await openSessionDatabase(session);
    request.session = session;
    appDbContext.run(sessionDb, () => next());
  } catch {
    response.status(500).json({ error: "Could not open user database." });
  }
}

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    protected: true,
  });
});

app.post("/api/session", async (request, response) => {
  const username = String(request.body.username || "").trim();
  const secret = String(request.body.password || request.body.accessCode || "");

  if (username === adminUsername && !adminAccessCode) {
    response.status(503).json({ error: "Admin access code is not configured." });
    return;
  }

  if (username === adminUsername && isValidSecret(secret, adminAccessCode)) {
    response.status(201).json({
      token: createSession({ username, role: "admin", dbFile: path.basename(dbPath) }),
      user: { username, role: "admin" },
    });
    return;
  }

  const user = await authDb.get(
    "SELECT id, username, password_hash AS passwordHash, password_salt AS passwordSalt, db_file AS dbFile, role FROM users WHERE username = ?",
    username,
  );
  if (!user || !isValidPassword(secret, user.passwordHash, user.passwordSalt)) {
    response.status(401).json({ error: "Invalid credentials." });
    return;
  }

  response.status(201).json({
    token: createSession({ id: user.id, username: user.username, role: user.role, dbFile: user.dbFile }),
    user: { username: user.username, role: user.role },
  });
});

app.post("/api/register", async (request, response) => {
  const username = normalizeUsername(request.body.username);
  const email = normalizeText(request.body.email);
  const phone = normalizeText(request.body.phone);
  const password = String(request.body.password || "");

  if (!username || !email || !phone || password.length < 6) {
    response.status(400).json({ error: "Username, email, phone and a 6 character password are required." });
    return;
  }

  if (username.toLowerCase() === adminUsername.toLowerCase()) {
    response.status(409).json({ error: "That username is reserved." });
    return;
  }

  const duplicate = await authDb.get("SELECT id FROM users WHERE username = ?", username);
  if (duplicate) {
    response.status(409).json({ error: "Username already exists." });
    return;
  }

  const { hash, salt } = hashPassword(password);
  const result = await authDb.run(
    "INSERT INTO users (username, email, phone, password_hash, password_salt, db_file) VALUES (?, ?, ?, ?, ?, ?)",
    username,
    email,
    phone,
    hash,
    salt,
    "pending.sqlite",
  );

  try {
    const dbFile = await createUserDatabase(username, result.lastID);
    await authDb.run("UPDATE users SET db_file = ? WHERE id = ?", dbFile, result.lastID);

    response.status(201).json({
      token: createSession({ id: result.lastID, username, role: "user", dbFile }),
      user: { username, role: "user" },
    });
  } catch (error) {
    await authDb.run("DELETE FROM users WHERE id = ?", result.lastID);
    await rm(getUserDbPath(getSafeDbFilename(username, result.lastID)), { force: true });
    response.status(500).json({ error: "Could not create user database." });
  }
});

app.use("/api", requireSession);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUnitName(value) {
  return normalizeText(value).toLowerCase();
}

async function ensureUnit(value) {
  const unit = normalizeUnitName(value) || "unidad";
  await getDb().run("INSERT OR IGNORE INTO measurement_units (name) VALUES (?)", unit);
  return unit;
}

function normalizePresentationQuantity(value) {
  const quantity = Number(value);
  return Number.isNaN(quantity) || quantity <= 0 ? 1 : quantity;
}

async function ensureCatalogSupport(targetDb = getDb()) {
  await targetDb.exec(`
    CREATE TABLE IF NOT EXISTS catalogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  let currentDefaultCatalog = await targetDb.get("SELECT id, name FROM catalogs WHERE name = ?", "Catalogo alkosto");
  if (!currentDefaultCatalog) {
    const existingCatalog = await targetDb.get("SELECT id, name FROM catalogs ORDER BY id LIMIT 1");
    if (existingCatalog) {
      await targetDb.run("UPDATE catalogs SET name = ? WHERE id = ?", "Catalogo alkosto", existingCatalog.id);
      currentDefaultCatalog = { id: existingCatalog.id, name: "Catalogo alkosto" };
    } else {
      const result = await targetDb.run("INSERT INTO catalogs (name) VALUES (?)", "Catalogo alkosto");
      currentDefaultCatalog = { id: result.lastID, name: "Catalogo alkosto" };
    }
  }

  const columns = await targetDb.all("PRAGMA table_info(products)");
  if (columns.length && !columns.some((column) => column.name === "catalog_id")) {
    await targetDb.run("ALTER TABLE products ADD COLUMN catalog_id INTEGER NOT NULL DEFAULT 1");
    await targetDb.run("UPDATE products SET catalog_id = ?", currentDefaultCatalog.id);
  }

  const migrated = await targetDb.get("SELECT value FROM app_settings WHERE key = ?", "products_catalog_unique_v1");
  if (!migrated && columns.length) {
    await targetDb.exec("PRAGMA foreign_keys = OFF");
    await targetDb.exec(`
      CREATE TABLE IF NOT EXISTS products_catalog_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER NOT NULL DEFAULT 1,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL DEFAULT 0,
        unit TEXT NOT NULL DEFAULT 'unidad',
        presentation_quantity REAL NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (catalog_id) REFERENCES catalogs(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        UNIQUE(catalog_id, category_id, name)
      );
    `);
    await targetDb.run(`
      INSERT OR IGNORE INTO products_catalog_migration (
        id, catalog_id, category_id, name, brand, price, unit, presentation_quantity, created_at
      )
      SELECT
        id,
        COALESCE(NULLIF(catalog_id, 0), ?),
        category_id,
        name,
        COALESCE(brand, ''),
        COALESCE(price, 0),
        COALESCE(unit, 'unidad'),
        COALESCE(presentation_quantity, 1),
        COALESCE(created_at, CURRENT_TIMESTAMP)
      FROM products
    `, currentDefaultCatalog.id);
    await targetDb.exec("DROP TABLE products");
    await targetDb.exec("ALTER TABLE products_catalog_migration RENAME TO products");
    await targetDb.exec("PRAGMA foreign_keys = ON");
    await targetDb.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      "products_catalog_unique_v1",
      "1",
    );
  }

  const activeCatalog = await targetDb.get("SELECT value FROM app_settings WHERE key = ?", "active_catalog_id");
  const activeCatalogExists = activeCatalog
    ? await targetDb.get("SELECT id FROM catalogs WHERE id = ?", Number(activeCatalog.value))
    : null;
  if (!activeCatalogExists) {
    await targetDb.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      "active_catalog_id",
      String(currentDefaultCatalog.id),
    );
  }

  return currentDefaultCatalog;
}

async function getUnits() {
  return getDb().all("SELECT id, name FROM measurement_units ORDER BY name");
}

async function getCatalogs() {
  return getDb().all("SELECT id, name, created_at AS createdAt FROM catalogs ORDER BY name COLLATE NOCASE");
}

async function getActiveCatalogId() {
  await ensureCatalogSupport();
  const catalogs = await getCatalogs();
  const setting = await getDb().get("SELECT value FROM app_settings WHERE key = ?", "active_catalog_id");
  const activeId = Number(setting?.value);
  const activeCatalog =
    catalogs.find((catalog) => catalog.id === activeId) ||
    catalogs.find((catalog) => catalog.name === "Catalogo alkosto") ||
    catalogs[0];

  if (activeCatalog && activeCatalog.id !== activeId) {
    await getDb().run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      "active_catalog_id",
      String(activeCatalog.id),
    );
  }

  return activeCatalog?.id ?? null;
}

async function getBootstrapData() {
  const activeCatalogId = await getActiveCatalogId();
  const [categories, catalogs, products, lists, priceHistory, inventory, units, purchases] = await Promise.all([
    getDb().all("SELECT id, name FROM categories ORDER BY name"),
    getCatalogs(),
    getProducts(),
    getDb().all("SELECT id, name, completed_at AS completedAt, completed_total AS completedTotal, created_at AS createdAt FROM shopping_lists ORDER BY id DESC"),
    getPriceHistory(),
    getInventory(),
    getUnits(),
    getPurchaseRecords(),
  ]);

  const activeListId = lists[0]?.id ?? null;
  const items = activeListId ? await getListItems(activeListId) : [];
  const summary = await getSummary(activeListId);

  return { categories, catalogs, activeCatalogId, products, lists, activeListId, items, priceHistory, inventory, units, purchases, summary };
}

async function saveBrandPrice(productId, name, price) {
  const brand = normalizeText(name);
  if (!brand) {
    return;
  }

  await getDb().run(
    "INSERT INTO product_brands (product_id, name, price, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(product_id, name) DO UPDATE SET price = excluded.price, updated_at = CURRENT_TIMESTAMP",
    productId,
    brand,
    price,
  );
}

async function getProducts() {
  const activeCatalogId = await getActiveCatalogId();
  const products = await getDb().all(`
    SELECT
      products.id,
      products.catalog_id AS catalogId,
      products.name,
      products.brand,
      products.price,
      products.unit,
      products.presentation_quantity AS presentationQuantity,
      categories.id AS categoryId,
      categories.name AS category,
      COALESCE(brand_list.names, '') AS brandOptionsText
    FROM products
    JOIN categories ON categories.id = products.category_id
    LEFT JOIN (
      SELECT product_id, GROUP_CONCAT(name, '|||') AS names
      FROM product_brands
      GROUP BY product_id
    ) AS brand_list ON brand_list.product_id = products.id
    WHERE products.catalog_id = ?
    ORDER BY categories.name, products.name
  `, activeCatalogId);
  const brandRows = await getDb().all(`
    SELECT product_id AS productId, name, price, updated_at AS updatedAt
    FROM product_brands
    WHERE product_id IN (SELECT id FROM products WHERE catalog_id = ?)
    ORDER BY name COLLATE NOCASE
  `, activeCatalogId);
  const brandsByProduct = brandRows.reduce((groups, brand) => {
    if (!groups[brand.productId]) {
      groups[brand.productId] = [];
    }
    groups[brand.productId].push(brand);
    return groups;
  }, {});

  return products.map((product) => ({
      ...product,
      brandOptions: product.brandOptionsText
        ? product.brandOptionsText.split("|||").filter(Boolean).sort((first, second) => first.localeCompare(second, "es", { sensitivity: "base" }))
        : [],
      brandPrices: brandsByProduct[product.id] || [],
      brandOptionsText: undefined,
    }));
}

async function getListItems(listId) {
  return getDb().all(
    `
      SELECT
        list_items.id,
        list_items.list_id AS listId,
        list_items.product_id AS productId,
        list_items.quantity,
        list_items.checked,
        list_items.price_snapshot AS price,
        products.name,
        products.brand,
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
  const activeCatalogId = await getActiveCatalogId();
  return getDb().all(`
    SELECT
      inventory.id,
      inventory.product_id AS productId,
      inventory.quantity,
      inventory.min_quantity AS minQuantity,
      inventory.updated_at AS updatedAt,
      products.name,
      products.brand,
      products.unit,
      products.presentation_quantity AS presentationQuantity,
      categories.name AS category
    FROM inventory
    JOIN products ON products.id = inventory.product_id
    JOIN categories ON categories.id = products.category_id
    WHERE products.catalog_id = ?
    ORDER BY categories.name, products.name
  `, activeCatalogId);
}

async function getPriceHistory() {
  const activeCatalogId = await getActiveCatalogId();
  return getDb().all(`
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
    WHERE products.catalog_id = ?
    ORDER BY products.name COLLATE NOCASE ASC, price_history.changed_at DESC, price_history.id DESC
    LIMIT 120
  `, activeCatalogId);
}

async function getPurchaseRecords() {
  const records = await getDb().all(`
    SELECT
      id,
      list_id AS listId,
      list_name AS listName,
      total,
      item_count AS itemCount,
      completed_at AS completedAt
    FROM purchase_records
    ORDER BY completed_at DESC, id DESC
    LIMIT 40
  `);
  const items = await getDb().all(`
    SELECT
      record_id AS recordId,
      product_name AS productName,
      brand,
      category,
      quantity,
      price,
      checked
    FROM purchase_items
    ORDER BY category COLLATE NOCASE, product_name COLLATE NOCASE
  `);
  const itemsByRecord = items.reduce((groups, item) => {
    if (!groups[item.recordId]) {
      groups[item.recordId] = [];
    }
    groups[item.recordId].push(item);
    return groups;
  }, {});

  return records.map((record) => ({ ...record, items: itemsByRecord[record.id] || [] }));
}

async function getSummary(activeListId = null) {
  const [products, inventory, priceHistory, purchases] = await Promise.all([
    getProducts(),
    getInventory(),
    getPriceHistory(),
    getPurchaseRecords(),
  ]);
  const items = activeListId ? await getListItems(activeListId) : [];
  const lowStock = inventory.filter((item) => item.minQuantity > 0 && item.quantity <= item.minQuantity);
  const estimatedListTotal = items.reduce((total, item) => total + item.price * item.quantity, 0);
  const checkedItems = items.filter((item) => item.checked).length;
  const priceChanges = priceHistory
    .filter((entry) => entry.oldPrice !== null)
    .slice(0, 8)
    .map((entry) => ({
      ...entry,
      difference: entry.newPrice - entry.oldPrice,
      percent: entry.oldPrice ? ((entry.newPrice - entry.oldPrice) / entry.oldPrice) * 100 : 0,
    }));

  return {
    productCount: products.length,
    inventoryCount: inventory.filter((item) => item.quantity > 0).length,
    lowStockCount: lowStock.length,
    lowStock,
    listItemCount: items.length,
    checkedItems,
    pendingItems: items.length - checkedItems,
    estimatedListTotal,
    priceChanges,
    lastPurchase: purchases[0] || null,
  };
}

app.get("/api/bootstrap", async (_request, response) => {
  response.json(await getBootstrapData());
});

app.get("/api/summary", async (request, response) => {
  const listId = Number(request.query.listId);
  response.json({ summary: await getSummary(listId || null) });
});

app.get("/api/export", async (_request, response) => {
  const [
    categories,
    catalogs,
    products,
    productBrands,
    inventory,
    priceHistory,
    purchases,
    purchaseItems,
    shoppingLists,
    listItems,
    units,
  ] = await Promise.all([
    getDb().all("SELECT * FROM categories ORDER BY name"),
    getDb().all("SELECT * FROM catalogs ORDER BY name"),
    getDb().all("SELECT * FROM products ORDER BY catalog_id, name"),
    getDb().all("SELECT * FROM product_brands ORDER BY product_id, name"),
    getDb().all("SELECT * FROM inventory ORDER BY product_id"),
    getDb().all("SELECT * FROM price_history ORDER BY changed_at DESC, id DESC"),
    getDb().all("SELECT * FROM purchase_records ORDER BY completed_at DESC, id DESC"),
    getDb().all("SELECT * FROM purchase_items ORDER BY record_id, category, product_name"),
    getDb().all("SELECT * FROM shopping_lists ORDER BY id DESC"),
    getDb().all("SELECT * FROM list_items ORDER BY list_id, id"),
    getDb().all("SELECT * FROM measurement_units ORDER BY name"),
  ]);

  response.setHeader("Content-Type", "application/json");
  response.setHeader("Content-Disposition", `attachment; filename="merky-respaldo-${new Date().toISOString().slice(0, 10)}.json"`);
  response.json({
    exportedAt: new Date().toISOString(),
    categories,
    catalogs,
    products,
    productBrands,
    inventory,
    priceHistory,
    purchases,
    purchaseItems,
    shoppingLists,
    listItems,
    units,
  });
});

app.get("/api/catalogs", async (_request, response) => {
  response.json({
    catalogs: await getCatalogs(),
    activeCatalogId: await getActiveCatalogId(),
  });
});

app.post("/api/catalogs", async (request, response) => {
  const name = normalizeText(request.body.name);
  if (!name) {
    response.status(400).json({ error: "Catalog name is required." });
    return;
  }

  const duplicate = await getDb().get("SELECT id FROM catalogs WHERE name = ?", name);
  if (duplicate) {
    response.status(409).json({ error: "Catalog already exists." });
    return;
  }

  const sourceCatalogId = await getActiveCatalogId();
  const result = await getDb().run("INSERT INTO catalogs (name) VALUES (?)", name);
  const catalogId = result.lastID;

  if (sourceCatalogId) {
    const sourceProducts = await getDb().all(
      "SELECT category_id AS categoryId, name, unit, presentation_quantity AS presentationQuantity FROM products WHERE catalog_id = ? ORDER BY name",
      sourceCatalogId,
    );
    for (const product of sourceProducts) {
      await getDb().run(
        "INSERT OR IGNORE INTO products (catalog_id, category_id, name, brand, price, unit, presentation_quantity) VALUES (?, ?, ?, '', 0, ?, ?)",
        catalogId,
        product.categoryId,
        product.name,
        product.unit || "unidad",
        product.presentationQuantity || 1,
      );
    }
  }

  await getDb().run(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
    "active_catalog_id",
    String(catalogId),
  );

  response.status(201).json(await getBootstrapData());
});

app.patch("/api/catalogs/active", async (request, response) => {
  const catalogId = Number(request.body.catalogId);
  if (!catalogId) {
    response.status(400).json({ error: "Valid catalog is required." });
    return;
  }

  const catalog = await getDb().get("SELECT id FROM catalogs WHERE id = ?", catalogId);
  if (!catalog) {
    response.status(404).json({ error: "Catalog not found." });
    return;
  }

  await getDb().run(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
    "active_catalog_id",
    String(catalogId),
  );

  response.json(await getBootstrapData());
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

  const currentUnit = await getDb().get("SELECT id, name FROM measurement_units WHERE id = ?", unitId);
  if (!currentUnit) {
    response.status(404).json({ error: "Unit not found." });
    return;
  }

  const existingUnit = await getDb().get("SELECT id, name FROM measurement_units WHERE name = ?", name);
  if (existingUnit && existingUnit.id !== unitId) {
    await getDb().run("UPDATE products SET unit = ? WHERE unit = ?", existingUnit.name, currentUnit.name);
    await getDb().run("DELETE FROM measurement_units WHERE id = ?", unitId);
  } else {
    await getDb().run("UPDATE measurement_units SET name = ? WHERE id = ?", name, unitId);
    await getDb().run("UPDATE products SET unit = ? WHERE unit = ?", name, currentUnit.name);
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

  await getDb().run("INSERT OR IGNORE INTO categories (name) VALUES (?)", name);
  const category = await getDb().get("SELECT id, name FROM categories WHERE name = ?", name);
  response.status(201).json(category);
});

app.patch("/api/categories/:categoryId", async (request, response) => {
  const categoryId = Number(request.params.categoryId);
  const name = normalizeText(request.body.name);

  if (!categoryId || !name) {
    response.status(400).json({ error: "Valid category and name are required." });
    return;
  }

  const category = await getDb().get("SELECT id, name FROM categories WHERE id = ?", categoryId);
  if (!category) {
    response.status(404).json({ error: "Category not found." });
    return;
  }

  const duplicate = await getDb().get(
    "SELECT id FROM categories WHERE name = ? AND id <> ?",
    name,
    categoryId,
  );
  if (duplicate) {
    response.status(409).json({ error: "Category already exists." });
    return;
  }

  await getDb().run("UPDATE categories SET name = ? WHERE id = ?", name, categoryId);

  response.json({
    categories: await getDb().all("SELECT id, name FROM categories ORDER BY name"),
    products: await getProducts(),
    priceHistory: await getPriceHistory(),
    inventory: await getInventory(),
  });
});

app.delete("/api/categories/:categoryId", async (request, response) => {
  const categoryId = Number(request.params.categoryId);

  if (!categoryId) {
    response.status(400).json({ error: "Valid category is required." });
    return;
  }

  const category = await getDb().get("SELECT id, name FROM categories WHERE id = ?", categoryId);
  if (!category) {
    response.status(404).json({ error: "Category not found." });
    return;
  }

  await getDb().run("DELETE FROM categories WHERE id = ?", categoryId);

  const lists = await getDb().all(
    "SELECT id, name, completed_at AS completedAt, completed_total AS completedTotal, created_at AS createdAt FROM shopping_lists ORDER BY id DESC",
  );
  const activeListId = lists[0]?.id ?? null;

  response.json({
    categories: await getDb().all("SELECT id, name FROM categories ORDER BY name"),
    products: await getProducts(),
    inventory: await getInventory(),
    priceHistory: await getPriceHistory(),
    lists,
    activeListId,
    items: activeListId ? await getListItems(activeListId) : [],
    summary: await getSummary(activeListId),
  });
});

app.post("/api/products", async (request, response) => {
  const catalogId = await getActiveCatalogId();
  const name = normalizeText(request.body.name);
  const brand = normalizeText(request.body.brand);
  const categoryId = Number(request.body.categoryId);
  const price = Number(request.body.price);
  const unit = await ensureUnit(request.body.unit);
  const presentationQuantity = normalizePresentationQuantity(request.body.presentationQuantity);

  if (!name || !categoryId || Number.isNaN(price) || price < 0) {
    response.status(400).json({ error: "Valid name, category and price are required." });
    return;
  }

  const existing = await getDb().get(
    "SELECT id, price FROM products WHERE catalog_id = ? AND category_id = ? AND name = ?",
    catalogId,
    categoryId,
    name,
  );
  await getDb().run(
    "INSERT INTO products (catalog_id, category_id, name, brand, price, unit, presentation_quantity) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(catalog_id, category_id, name) DO UPDATE SET brand = excluded.brand, price = excluded.price, unit = excluded.unit, presentation_quantity = excluded.presentation_quantity",
    catalogId,
    categoryId,
    name,
    brand,
    price,
    unit,
    presentationQuantity,
  );

  const product = await getDb().get(
    "SELECT id FROM products WHERE catalog_id = ? AND category_id = ? AND name = ?",
    catalogId,
    categoryId,
    name,
  );

  if (!existing || existing.price !== price) {
    await getDb().run(
      "INSERT INTO price_history (product_id, old_price, new_price) VALUES (?, ?, ?)",
      product.id,
      existing?.price ?? null,
      price,
    );
  }

  if (brand) {
    await saveBrandPrice(product.id, brand, price);
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
  const hasName = request.body.name !== undefined;
  const hasBrand = request.body.brand !== undefined;
  const hasUnit = request.body.unit !== undefined;
  const hasPresentationQuantity = request.body.presentationQuantity !== undefined;
  const hasCategory = request.body.categoryId !== undefined;
  const price = Number(request.body.price);
  const name = normalizeText(request.body.name);
  const brand = normalizeText(request.body.brand);
  const unit = hasUnit ? await ensureUnit(request.body.unit) : "unidad";
  const presentationQuantity = normalizePresentationQuantity(request.body.presentationQuantity);
  const categoryId = Number(request.body.categoryId);

  if (
    !productId ||
    (!hasPrice && !hasName && !hasBrand && !hasUnit && !hasPresentationQuantity && !hasCategory) ||
    (hasName && !name) ||
    (hasPrice && (Number.isNaN(price) || price < 0)) ||
    (hasCategory && !categoryId)
  ) {
    response.status(400).json({ error: "Valid product update is required." });
    return;
  }

  const product = await getDb().get("SELECT id, catalog_id AS catalogId, name, brand, price, category_id AS categoryId FROM products WHERE id = ?", productId);
  if (!product) {
    response.status(404).json({ error: "Product not found." });
    return;
  }

  if (hasCategory) {
    const category = await getDb().get("SELECT id FROM categories WHERE id = ?", categoryId);
    if (!category) {
      response.status(404).json({ error: "Category not found." });
      return;
    }

    const duplicate = await getDb().get(
      "SELECT id FROM products WHERE catalog_id = ? AND category_id = ? AND name = ? AND id <> ?",
      product.catalogId,
      categoryId,
      product.name,
      productId,
    );
    if (duplicate) {
      response.status(409).json({ error: "Product already exists in target category." });
      return;
    }

    await getDb().run("UPDATE products SET category_id = ? WHERE id = ?", categoryId, productId);
  }

  if (hasName) {
    const targetCategoryId = hasCategory ? categoryId : product.categoryId;
    const duplicate = await getDb().get(
      "SELECT id FROM products WHERE catalog_id = ? AND category_id = ? AND name = ? AND id <> ?",
      product.catalogId,
      targetCategoryId,
      name,
      productId,
    );
    if (duplicate) {
      response.status(409).json({ error: "Product already exists in category." });
      return;
    }

    await getDb().run("UPDATE products SET name = ? WHERE id = ?", name, productId);
  }

  if (hasPrice) {
    await getDb().run("UPDATE products SET price = ? WHERE id = ?", price, productId);
    await getDb().run(
      "UPDATE list_items SET price_snapshot = ? WHERE product_id = ? AND checked = 0",
      price,
      productId,
    );
    if (product.price !== price) {
      await getDb().run(
        "INSERT INTO price_history (product_id, old_price, new_price) VALUES (?, ?, ?)",
        productId,
        product.price,
        price,
      );
    }
  }

  if (hasBrand) {
    await getDb().run("UPDATE products SET brand = ? WHERE id = ?", brand, productId);
  }

  const finalBrand = hasBrand ? brand : product.brand;
  const finalPrice = hasPrice ? price : product.price;
  if ((hasBrand || hasPrice) && finalBrand) {
    await saveBrandPrice(productId, finalBrand, finalPrice);
  }

  if (hasUnit) {
    await getDb().run("UPDATE products SET unit = ? WHERE id = ?", unit, productId);
  }

  if (hasPresentationQuantity) {
    await getDb().run("UPDATE products SET presentation_quantity = ? WHERE id = ?", presentationQuantity, productId);
  }

  response.json({ products: await getProducts(), priceHistory: await getPriceHistory(), inventory: await getInventory() });
});

app.delete("/api/products/:productId", async (request, response) => {
  const productId = Number(request.params.productId);

  if (!productId) {
    response.status(400).json({ error: "Valid product is required." });
    return;
  }

  const product = await getDb().get("SELECT id FROM products WHERE id = ?", productId);
  if (!product) {
    response.status(404).json({ error: "Product not found." });
    return;
  }

  await getDb().run("DELETE FROM products WHERE id = ?", productId);

  response.json({
    products: await getProducts(),
    priceHistory: await getPriceHistory(),
    inventory: await getInventory(),
  });
});

app.patch("/api/inventory/:productId", async (request, response) => {
  const productId = Number(request.params.productId);
  const hasQuantity = request.body.quantity !== undefined;
  const hasMinQuantity = request.body.minQuantity !== undefined;
  const quantity = Number(request.body.quantity);
  const minQuantity = Number(request.body.minQuantity);

  if (
    !productId ||
    (!hasQuantity && !hasMinQuantity) ||
    (hasQuantity && (Number.isNaN(quantity) || quantity < 0)) ||
    (hasMinQuantity && (Number.isNaN(minQuantity) || minQuantity < 0))
  ) {
    response.status(400).json({ error: "Valid product and quantity are required." });
    return;
  }

  const product = await getDb().get("SELECT id FROM products WHERE id = ?", productId);
  if (!product) {
    response.status(404).json({ error: "Product not found." });
    return;
  }

  const current = await getDb().get("SELECT quantity, min_quantity AS minQuantity FROM inventory WHERE product_id = ?", productId);
  const nextQuantity = hasQuantity ? quantity : current?.quantity ?? 0;
  const nextMinQuantity = hasMinQuantity ? minQuantity : current?.minQuantity ?? 0;

  await getDb().run(
    "INSERT INTO inventory (product_id, quantity, min_quantity, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(product_id) DO UPDATE SET quantity = excluded.quantity, min_quantity = excluded.min_quantity, updated_at = CURRENT_TIMESTAMP",
    productId,
    nextQuantity,
    nextMinQuantity,
  );

  response.json({ inventory: await getInventory() });
});

app.post("/api/lists", async (request, response) => {
  const name = normalizeText(request.body.name);
  if (!name) {
    response.status(400).json({ error: "List name is required." });
    return;
  }

  const result = await getDb().run("INSERT INTO shopping_lists (name) VALUES (?)", name);
  const list = await getDb().get(
    "SELECT id, name, created_at AS createdAt FROM shopping_lists WHERE id = ?",
    result.lastID,
  );

  response.status(201).json({ list, items: [] });
});

app.get("/api/lists/:listId/items", async (request, response) => {
  response.json({ items: await getListItems(Number(request.params.listId)) });
});

app.post("/api/lists/:listId/complete", async (request, response) => {
  const listId = Number(request.params.listId);
  const list = await getDb().get("SELECT id, name FROM shopping_lists WHERE id = ?", listId);

  if (!list) {
    response.status(404).json({ error: "List not found." });
    return;
  }

  const items = await getListItems(listId);
  if (!items.length || items.some((item) => !item.checked)) {
    response.status(400).json({ error: "All items must be checked before completing the purchase." });
    return;
  }

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const result = await getDb().run(
    "INSERT INTO purchase_records (list_id, list_name, total, item_count, completed_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    listId,
    list.name,
    total,
    items.length,
  );

  for (const item of items) {
    await getDb().run(
      "INSERT INTO purchase_items (record_id, product_id, product_name, brand, category, quantity, price, checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      result.lastID,
      item.productId,
      item.name,
      item.brand || "",
      item.category || "",
      item.quantity,
      item.price,
      item.checked ? 1 : 0,
    );
  }

  await getDb().run(
    "UPDATE shopping_lists SET completed_at = CURRENT_TIMESTAMP, completed_total = ? WHERE id = ?",
    total,
    listId,
  );

  response.status(201).json({
    purchases: await getPurchaseRecords(),
    lists: await getDb().all("SELECT id, name, completed_at AS completedAt, completed_total AS completedTotal, created_at AS createdAt FROM shopping_lists ORDER BY id DESC"),
    summary: await getSummary(listId),
  });
});

app.post("/api/lists/:listId/clear", async (request, response) => {
  const listId = Number(request.params.listId);
  const list = await getDb().get("SELECT id FROM shopping_lists WHERE id = ?", listId);

  if (!list) {
    response.status(404).json({ error: "List not found." });
    return;
  }

  await getDb().run("DELETE FROM list_items WHERE list_id = ?", listId);
  await getDb().run("UPDATE shopping_lists SET completed_at = NULL, completed_total = NULL WHERE id = ?", listId);

  response.json({
    items: [],
    lists: await getDb().all("SELECT id, name, completed_at AS completedAt, completed_total AS completedTotal, created_at AS createdAt FROM shopping_lists ORDER BY id DESC"),
  });
});

app.delete("/api/lists/:listId", async (request, response) => {
  const listId = Number(request.params.listId);
  await getDb().run("DELETE FROM shopping_lists WHERE id = ?", listId);

  const lists = await getDb().all(
    "SELECT id, name, completed_at AS completedAt, completed_total AS completedTotal, created_at AS createdAt FROM shopping_lists ORDER BY id DESC",
  );
  const activeListId = lists[0]?.id ?? null;
  const items = activeListId ? await getListItems(activeListId) : [];

  response.json({ lists, activeListId, items });
});

app.post("/api/lists/:listId/items", async (request, response) => {
  const listId = Number(request.params.listId);
  const productId = Number(request.body.productId);
  const quantity = Math.max(1, Number(request.body.quantity || 1));
  const product = await getDb().get("SELECT price FROM products WHERE id = ?", productId);

  if (!listId || !productId || !product) {
    response.status(400).json({ error: "Valid list and product are required." });
    return;
  }

  const existing = await getDb().get(
    "SELECT id FROM list_items WHERE list_id = ? AND product_id = ? AND checked = 0",
    listId,
    productId,
  );

  if (existing) {
    await getDb().run("UPDATE list_items SET quantity = quantity + ? WHERE id = ?", quantity, existing.id);
  } else {
    await getDb().run(
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
  const item = await getDb().get(
    `
      SELECT
        list_items.list_id AS listId,
        list_items.product_id AS productId,
        products.name,
        products.brand,
        products.price AS productPrice
      FROM list_items
      JOIN products ON products.id = list_items.product_id
      WHERE list_items.id = ?
    `,
    itemId,
  );

  if (!item) {
    response.status(404).json({ error: "Item not found." });
    return;
  }

  if (typeof request.body.checked === "boolean") {
    await getDb().run("UPDATE list_items SET checked = ? WHERE id = ?", request.body.checked ? 1 : 0, itemId);
  }

  if (request.body.quantity !== undefined) {
    const quantity = Math.max(1, Number(request.body.quantity));
    await getDb().run("UPDATE list_items SET quantity = ? WHERE id = ?", quantity, itemId);
  }

  if (request.body.price !== undefined) {
    const price = Number(request.body.price);
    if (Number.isNaN(price) || price < 0) {
      response.status(400).json({ error: "Valid price is required." });
      return;
    }

    await getDb().run("UPDATE list_items SET price_snapshot = ? WHERE id = ?", price, itemId);
    await getDb().run("UPDATE products SET price = ? WHERE id = ?", price, item.productId);
    await getDb().run(
      "UPDATE list_items SET price_snapshot = ? WHERE product_id = ? AND checked = 0",
      price,
      item.productId,
    );

    if (item.productPrice !== price) {
      await getDb().run(
        "INSERT INTO price_history (product_id, old_price, new_price) VALUES (?, ?, ?)",
        item.productId,
        item.productPrice,
        price,
      );
    }

    if (item.brand) {
      await saveBrandPrice(item.productId, item.brand, price);
    }
  }

  response.json({
    items: await getListItems(item.listId),
    products: request.body.price !== undefined ? await getProducts() : undefined,
    priceHistory: request.body.price !== undefined ? await getPriceHistory() : undefined,
    summary: await getSummary(item.listId),
  });
});

app.delete("/api/list-items/:itemId", async (request, response) => {
  const itemId = Number(request.params.itemId);
  const item = await getDb().get("SELECT list_id AS listId FROM list_items WHERE id = ?", itemId);

  if (!item) {
    response.status(404).json({ error: "Item not found." });
    return;
  }

  await getDb().run("DELETE FROM list_items WHERE id = ?", itemId);
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
  console.log(`Merky API running on http://127.0.0.1:${port}`);
});

