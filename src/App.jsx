import React, { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Check,
  ChevronDown,
  ClipboardList,
  FolderPlus,
  History,
  House,
  Layers3,
  Moon,
  PackagePlus,
  Pencil,
  Plus,
  Ruler,
  Search,
  Settings,
  ShoppingBasket,
  Sun,
  Trash2,
} from "lucide-react";

const API_URL = "http://127.0.0.1:3001/api";

const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const fallbackUnits = ["kilo", "gramos", "litros", "unidad", "frasco", "pote", "sobre", "caja"];
const emptyProductDraft = { name: "", price: "", presentationQuantity: "1", unit: "unidad" };

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});

function getBaseCost(product) {
  const unit = product.unit;
  const normalizedUnit = unit.toLowerCase();
  const quantity = Number(product.presentationQuantity || 1);

  if (normalizedUnit.includes("kilo")) {
    return `${currency.format(product.price / (quantity * 1000))} por gramo`;
  }

  if (normalizedUnit.includes("litro")) {
    return `${currency.format(product.price / (quantity * 1000))} por ml`;
  }

  if (normalizedUnit.includes("gramo")) {
    return `${currency.format(product.price / quantity)} por gramo`;
  }

  return `${currency.format(product.price / quantity)} por ${unit}`;
}

function getPresentationLabel(product) {
  const quantity = Number(product.presentationQuantity || 1);
  const formattedQuantity = Number.isInteger(quantity) ? quantity : quantity.toLocaleString("es-CO");
  return `${formattedQuantity} ${product.unit}`;
}

function groupByCategory(products) {
  return products.reduce((groups, product) => {
    if (!groups[product.category]) {
      groups[product.category] = [];
    }

    groups[product.category].push(product);
    return groups;
  }, {});
}

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    throw new Error("No se pudo completar la accion.");
  }

  return response.json();
}

function App() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [lists, setLists] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const [activeView, setActiveView] = useState("catalog");
  const [theme, setTheme] = useState(() => localStorage.getItem("mercardo-theme") || "light");
  const [items, setItems] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [units, setUnits] = useState(fallbackUnits.map((name, index) => ({ id: `fallback-${index}`, name })));
  const [inventoryDrafts, setInventoryDrafts] = useState({});
  const [productDrafts, setProductDrafts] = useState({});
  const [priceDrafts, setPriceDrafts] = useState({});
  const [presentationQuantityDrafts, setPresentationQuantityDrafts] = useState({});
  const [unitDrafts, setUnitDrafts] = useState({});
  const [expandedCategories, setExpandedCategories] = useState({});
  const [productFormMenus, setProductFormMenus] = useState({});
  const [editingProductId, setEditingProductId] = useState(null);
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);
  const [showUnitManager, setShowUnitManager] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [listName, setListName] = useState("");
  const [query, setQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [status, setStatus] = useState("Cargando datos...");
  const [toast, setToast] = useState("");

  useEffect(() => {
    api("/bootstrap")
      .then((data) => {
        setCategories(data.categories);
        setProducts(data.products);
        setLists(data.lists);
        setActiveListId(data.activeListId);
        setItems(data.items);
        setPriceHistory(data.priceHistory || []);
        setInventory(data.inventory || []);
        setUnits(data.units?.length ? data.units : fallbackUnits.map((name, index) => ({ id: `fallback-${index}`, name })));
        setStatus("");
      })
      .catch(() => setStatus("No se pudo conectar con la base de datos."));
  }, []);

  useEffect(() => {
    localStorage.setItem("mercardo-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeList = lists.find((list) => list.id === activeListId);
  const filteredProducts = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) {
      return products;
    }

    return products.filter((product) =>
      `${product.name} ${product.category}`.toLowerCase().includes(text),
    );
  }, [products, query]);
  const groupedProducts = useMemo(() => groupByCategory(filteredProducts), [filteredProducts]);
  const unitOptions = useMemo(() => units.map((unit) => unit.name), [units]);
  const inventoryByProduct = useMemo(
    () =>
      inventory.reduce((result, item) => {
        result[item.productId] = item;
        return result;
      }, {}),
    [inventory],
  );
  const inventoryProducts = useMemo(
    () =>
      products.map((product) => ({
        ...product,
        quantity: inventoryByProduct[product.id]?.quantity ?? 0,
        updatedAt: inventoryByProduct[product.id]?.updatedAt ?? null,
      })),
    [products, inventoryByProduct],
  );
  const groupedInventory = useMemo(() => groupByCategory(inventoryProducts), [inventoryProducts]);
  const filteredPriceHistory = useMemo(() => {
    const text = historyQuery.trim().toLowerCase();
    const entries = text
      ? priceHistory.filter((entry) =>
          `${entry.name} ${entry.category} ${entry.oldPrice ?? "inicial"} ${entry.newPrice}`
            .toLowerCase()
            .includes(text),
        )
      : priceHistory;

    return [...entries].sort((first, second) => {
      const byName = first.name.localeCompare(second.name, "es", { sensitivity: "base" });
      if (byName !== 0) {
        return byName;
      }

      return new Date(second.changedAt) - new Date(first.changedAt);
    });
  }, [priceHistory, historyQuery]);
  const totals = useMemo(
    () =>
      items.reduce(
        (result, item) => ({
          amount: result.amount + item.price * item.quantity,
          units: result.units + item.quantity,
          checked: result.checked + (item.checked ? 1 : 0),
        }),
        { amount: 0, units: 0, checked: 0 },
      ),
    [items],
  );
  const shoppingProgress = items.length ? Math.round((totals.checked / items.length) * 100) : 0;

  async function createCategory(event) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name) {
      return;
    }

    const category = await api("/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    setCategories((current) =>
      current.some((item) => item.id === category.id) ? current : [...current, category],
    );
    setExpandedCategories((current) => ({ ...current, [category.id]: true }));
    setCategoryName("");
    setShowCategoryCreator(false);
    setToast(`Categoria ${category.name} lista`);
  }

  function updateProductDraft(categoryId, updates) {
    setProductDrafts((current) => ({
      ...current,
      [categoryId]: {
        ...emptyProductDraft,
        ...current[categoryId],
        ...updates,
      },
    }));
  }

  async function createProduct(event, categoryId) {
    event.preventDefault();
    const draft = productDrafts[categoryId] || emptyProductDraft;
    const name = draft.name.trim();
    const price = Number(draft.price);
    const unit = unitOptions.includes(draft.unit) ? draft.unit : unitOptions[0] || "unidad";
    const presentationQuantity = Number(draft.presentationQuantity);

    if (!name || !categoryId || Number.isNaN(price) || price < 0 || Number.isNaN(presentationQuantity) || presentationQuantity <= 0) {
      return;
    }

    const data = await api("/products", {
      method: "POST",
      body: JSON.stringify({ name, price, categoryId, unit, presentationQuantity }),
    });

    setProducts(data.products);
    setPriceHistory(data.priceHistory || priceHistory);
    setInventory(data.inventory || inventory);
    updateProductDraft(categoryId, emptyProductDraft);
    setExpandedCategories((current) => ({ ...current, [categoryId]: true }));
    setProductFormMenus((current) => ({ ...current, [categoryId]: false }));
    setToast(`${name} guardado en el catalogo`);
  }

  async function createUnit(event) {
    event.preventDefault();
    const name = unitName.trim().toLowerCase();
    if (!name) {
      return;
    }

    const data = await api("/units", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setUnits(data.units);
    setUnitName("");
    setToast(`Presentacion ${name} agregada`);
  }

  function updateUnitDraft(unitId, value) {
    setUnitDrafts((current) => ({ ...current, [unitId]: value }));
  }

  async function saveUnit(unit) {
    const name = (unitDrafts[unit.id] ?? unit.name).trim().toLowerCase();
    if (!name || name === unit.name) {
      updateUnitDraft(unit.id, undefined);
      return;
    }

    const data = await api(`/units/${unit.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setUnits(data.units);
    setProducts(data.products || products);
    setInventory(data.inventory || inventory);
    setItems((current) =>
      current.map((item) => (item.unit === unit.name ? { ...item, unit: name } : item)),
    );
    updateUnitDraft(unit.id, undefined);
    setToast(`Presentacion ${unit.name} ahora es ${name}`);
  }

  async function createList(event) {
    event.preventDefault();
    const name = listName.trim();
    if (!name) {
      return;
    }

    const data = await api("/lists", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    setLists((current) => [data.list, ...current]);
    setActiveListId(data.list.id);
    setItems(data.items);
    setListName("");
    setActiveView("list");
    setToast(`Lista ${data.list.name} creada`);
  }

  async function selectList(listId) {
    setActiveListId(listId);
    const data = await api(`/lists/${listId}/items`);
    setItems(data.items);
    setActiveView("list");
  }

  async function deleteList(listId) {
    const data = await api(`/lists/${listId}`, { method: "DELETE" });
    setLists(data.lists);
    setActiveListId(data.activeListId);
    setItems(data.items);
  }

  async function addToList(productId) {
    if (!activeListId) {
      return;
    }

    const product = products.find((item) => item.id === productId);
    const data = await api(`/lists/${activeListId}/items`, {
      method: "POST",
      body: JSON.stringify({ productId, quantity: 1 }),
    });
    setItems(data.items);
    setToast(`${product?.name || "Producto"} agregado a tu lista`);
  }

  function updatePriceDraft(productId, value) {
    setPriceDrafts((current) => ({ ...current, [productId]: value }));
  }

  function updatePresentationQuantityDraft(productId, value) {
    setPresentationQuantityDrafts((current) => ({ ...current, [productId]: value }));
  }

  async function saveProductPrice(product) {
    const draftValue = priceDrafts[product.id];
    if (draftValue === undefined || draftValue === "") {
      return;
    }

    const price = Number(draftValue);
    if (Number.isNaN(price) || price < 0 || price === product.price) {
      updatePriceDraft(product.id, undefined);
      return;
    }

    const data = await api(`/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ price }),
    });
    setProducts(data.products);
    setPriceHistory(data.priceHistory || priceHistory);
    setInventory(data.inventory || inventory);
    setItems((current) =>
      current.map((item) =>
        item.productId === product.id && !item.checked ? { ...item, price: Math.round(price) } : item,
      ),
    );
    updatePriceDraft(product.id, undefined);
    setToast(`Precio de ${product.name} actualizado`);
    setEditingProductId(null);
  }

  async function updateItem(itemId, updates) {
    const data = await api(`/list-items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    setItems(data.items);
  }

  async function removeItem(itemId) {
    const data = await api(`/list-items/${itemId}`, { method: "DELETE" });
    setItems(data.items);
  }

  function updateInventoryDraft(productId, value) {
    setInventoryDrafts((current) => ({ ...current, [productId]: value }));
  }

  async function saveInventory(product) {
    const value = inventoryDrafts[product.id];
    if (value === undefined || value === "") {
      return;
    }

    const quantity = Number(value);
    if (Number.isNaN(quantity) || quantity < 0 || quantity === product.quantity) {
      updateInventoryDraft(product.id, undefined);
      return;
    }

    const data = await api(`/inventory/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    });
    setInventory(data.inventory);
    updateInventoryDraft(product.id, undefined);
    setToast(`Inventario de ${product.name} actualizado`);
  }

  async function updateProductPresentation(product, updates) {
    const nextUnit = updates.unit || product.unit;
    const nextPresentationQuantity =
      updates.presentationQuantity !== undefined
        ? Number(updates.presentationQuantity)
        : Number(product.presentationQuantity || 1);

    if (Number.isNaN(nextPresentationQuantity) || nextPresentationQuantity <= 0) {
      updatePresentationQuantityDraft(product.id, undefined);
      return;
    }

    const data = await api(`/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ unit: nextUnit, presentationQuantity: nextPresentationQuantity }),
    });
    setProducts(data.products);
    setInventory(data.inventory || inventory);
    setItems((current) =>
      current.map((item) =>
        item.productId === product.id
          ? { ...item, unit: nextUnit, presentationQuantity: nextPresentationQuantity }
          : item,
      ),
    );
    updatePresentationQuantityDraft(product.id, undefined);
    setToast(`Presentacion de ${product.name} actualizada`);
  }

  async function updateProductCategory(product, categoryId) {
    const nextCategoryId = Number(categoryId);
    const nextCategory = categories.find((category) => category.id === nextCategoryId);
    if (!nextCategory || nextCategoryId === product.categoryId) {
      return;
    }

    const data = await api(`/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ categoryId: nextCategoryId }),
    });
    setProducts(data.products);
    setInventory(data.inventory || inventory);
    setItems((current) =>
      current.map((item) =>
        item.productId === product.id
          ? { ...item, category: nextCategory.name }
          : item,
      ),
    );
    setPriceHistory((current) =>
      current.map((entry) =>
        entry.productId === product.id
          ? { ...entry, category: nextCategory.name }
          : entry,
      ),
    );
    setExpandedCategories((current) => ({
      ...current,
      [product.categoryId]: true,
      [nextCategoryId]: true,
    }));
    setToast(`${product.name} movido a ${nextCategory.name}`);
  }

  function toggleCategory(categoryId) {
    setExpandedCategories((current) => ({
      ...current,
      [categoryId]: current[categoryId] === false,
    }));
  }

  function toggleProductForm(categoryId) {
    setProductFormMenus((current) => ({
      ...current,
      [categoryId]: !current[categoryId],
    }));
  }

  function togglePriceEditor(product) {
    setEditingProductId((current) => (current === product.id ? null : product.id));
    setPriceDrafts((current) => ({ ...current, [product.id]: product.price }));
  }

  function formatHistoryDate(value) {
    const date = new Date(`${value}Z`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return dateFormatter.format(date);
  }

  return (
    <main className="app mobile-app" data-theme={theme}>
      <section className="phone-shell">
        <header className="app-header">
          <div className="brand-row">
            <div className="brand-mark">
              <ShoppingBasket size={24} aria-hidden="true" />
            </div>
            <div>
              <p>Aplicacion de mercado</p>
              <h1>Mercardo</h1>
            </div>
            <button
              className="theme-button"
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
            >
              {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
            </button>
          </div>
          <div>
            <p className="eyebrow">Lista activa</p>
            <h2>{activeList?.name || "Sin lista"}</h2>
          </div>
        </header>

        <section className="totals" aria-label="Resumen">
          <article>
            <BadgeDollarSign size={20} aria-hidden="true" />
            <span>Total</span>
            <strong>{currency.format(totals.amount)}</strong>
          </article>
          <article>
            <ClipboardList size={20} aria-hidden="true" />
            <span>Unidades</span>
            <strong>{totals.units}</strong>
          </article>
        </section>

        {status ? <div className="status-bar">{status}</div> : null}

        <section className="view-stage">
          {activeView === "lists" ? (
            <section className="panel lists-panel">
              <div className="panel-title">
                <Layers3 size={20} aria-hidden="true" />
                <h3>Mis listas</h3>
              </div>
              <form className="inline-form create-list-form" onSubmit={createList}>
                <input
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  placeholder="Nombre de lista"
                />
                <button className="primary-button square" type="submit" aria-label="Crear lista">
                  <Plus size={19} aria-hidden="true" />
                </button>
              </form>
              <div className="list-tabs">
                {lists.map((list) => (
                  <div className={list.id === activeListId ? "list-tab active" : "list-tab"} key={list.id}>
                    <button type="button" onClick={() => selectList(list.id)}>
                      {list.name}
                    </button>
                    {lists.length > 1 ? (
                      <button
                        className="delete-list"
                        type="button"
                        onClick={() => deleteList(list.id)}
                        aria-label={`Eliminar lista ${list.name}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activeView === "catalog" ? (
            <section className="panel catalog-panel">
              <div className="catalog-head">
                <div className="panel-title">
                  <PackagePlus size={20} aria-hidden="true" />
                  <h3>Catalogo</h3>
                </div>
                <div className="search-box">
                  <Search size={18} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar producto"
                  />
                </div>
              </div>

              <div className="category-stack">
                {categories.map((category) => {
                  const categoryProducts = groupedProducts[category.name] || [];
                  const draft = productDrafts[category.id] || emptyProductDraft;
                  const draftUnit = unitOptions.includes(draft.unit) ? draft.unit : unitOptions[0] || "unidad";
                  const isExpanded = expandedCategories[category.id] !== false;
                  const isProductFormOpen = Boolean(productFormMenus[category.id]);

                  return (
                    <article className="category-card" key={category.id}>
                      <button
                        className="category-card-head"
                        type="button"
                        onClick={() => toggleCategory(category.id)}
                        aria-expanded={isExpanded}
                      >
                        <div>
                          <h4>{category.name}</h4>
                          <span>{categoryProducts.length} productos</span>
                        </div>
                        <ChevronDown className={isExpanded ? "chevron open" : "chevron"} size={20} aria-hidden="true" />
                      </button>
                      {isExpanded ? (
                        <>
                          <button
                            className="category-action-trigger"
                            type="button"
                            onClick={() => toggleProductForm(category.id)}
                            aria-expanded={isProductFormOpen}
                          >
                            <span>
                              <Plus size={17} aria-hidden="true" />
                              Agregar producto
                            </span>
                            <ChevronDown className={isProductFormOpen ? "chevron open" : "chevron"} size={18} aria-hidden="true" />
                          </button>
                          {isProductFormOpen ? (
                            <form className="category-product-form" onSubmit={(event) => createProduct(event, category.id)}>
                              <input
                                value={draft.name}
                                onChange={(event) => updateProductDraft(category.id, { name: event.target.value })}
                                placeholder="Nuevo producto"
                                aria-label={`Nuevo producto en ${category.name}`}
                              />
                              <input
                                value={draft.price}
                                onChange={(event) => updateProductDraft(category.id, { price: event.target.value })}
                                type="number"
                                min="0"
                                step="100"
                                placeholder="Precio"
                                aria-label={`Precio para ${category.name}`}
                              />
                              <input
                                value={draft.presentationQuantity}
                                onChange={(event) => updateProductDraft(category.id, { presentationQuantity: event.target.value })}
                                type="number"
                                min="0.01"
                                step="0.01"
                                placeholder="Cant."
                                aria-label={`Cantidad de presentacion para ${category.name}`}
                              />
                              <select
                                value={draftUnit}
                                onChange={(event) => updateProductDraft(category.id, { unit: event.target.value })}
                                aria-label={`Unidad para ${category.name}`}
                              >
                                {unitOptions.map((unit) => (
                                  <option key={unit} value={unit}>
                                    {unit}
                                  </option>
                                ))}
                              </select>
                              <button className="primary-button compact" type="submit">
                                <Plus size={17} aria-hidden="true" />
                                Guardar
                              </button>
                            </form>
                          ) : null}
                          <div className="catalog-products">
                            {categoryProducts.length === 0 ? (
                              <div className="category-empty">Sin productos por ahora</div>
                            ) : (
                              categoryProducts.map((product) => (
                                <div className="catalog-item" key={product.id}>
                                  <div className="catalog-row">
                                    <button
                                      className="product-menu-trigger"
                                      type="button"
                                      onClick={() => togglePriceEditor(product)}
                                      aria-expanded={editingProductId === product.id}
                                    >
                                      <strong>{product.name}</strong>
                                      <span>{currency.format(product.price)} / {getPresentationLabel(product)}</span>
                                      <small>{getBaseCost(product)}</small>
                                    </button>
                                    <button
                                      className="add-product-button"
                                      type="button"
                                      onClick={() => addToList(product.id)}
                                      aria-label={`Agregar ${product.name}`}
                                    >
                                      <Plus size={18} aria-hidden="true" />
                                    </button>
                                  </div>
                                  {editingProductId === product.id ? (
                                    <div className="product-dropdown">
                                      <label className="price-editor">
                                        Cambiar precio
                                        <input
                                          value={priceDrafts[product.id] ?? product.price}
                                          onChange={(event) => updatePriceDraft(product.id, event.target.value)}
                                          onBlur={() => saveProductPrice(product)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          type="number"
                                          min="0"
                                          step="100"
                                          aria-label={`Cambiar precio de ${product.name}`}
                                        />
                                      </label>
                                      <label className="price-editor">
                                        Cantidad
                                        <input
                                          value={presentationQuantityDrafts[product.id] ?? product.presentationQuantity ?? 1}
                                          onChange={(event) => updatePresentationQuantityDraft(product.id, event.target.value)}
                                          onBlur={() =>
                                            updateProductPresentation(product, {
                                              presentationQuantity: presentationQuantityDrafts[product.id] ?? product.presentationQuantity ?? 1,
                                            })
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          type="number"
                                          min="0.01"
                                          step="0.01"
                                          aria-label={`Cambiar cantidad de presentacion de ${product.name}`}
                                        />
                                      </label>
                                      <label className="price-editor">
                                        Unidad
                                        <select
                                          value={product.unit}
                                          onChange={(event) => updateProductPresentation(product, { unit: event.target.value })}
                                          aria-label={`Cambiar presentacion de ${product.name}`}
                                        >
                                          {unitOptions.map((unit) => (
                                            <option key={unit} value={unit}>
                                              {unit}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <label className="price-editor">
                                        Mover a
                                        <select
                                          value={product.categoryId}
                                          onChange={(event) => updateProductCategory(product, event.target.value)}
                                          aria-label={`Mover ${product.name} a otra categoria`}
                                        >
                                          {categories.map((category) => (
                                            <option key={category.id} value={category.id}>
                                              {category.name}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    </div>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>
                        </>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeView === "settings" ? (
            <section className="panel settings-panel">
              <div className="panel-title">
                <Settings size={20} aria-hidden="true" />
                <h3>Configuracion</h3>
              </div>

              <section className="dropdown-panel">
                <button
                  className="dropdown-trigger"
                  type="button"
                  onClick={() => setShowCategoryCreator((current) => !current)}
                  aria-expanded={showCategoryCreator}
                >
                  <span>
                    <FolderPlus size={18} aria-hidden="true" />
                    Nueva categoria
                  </span>
                  <ChevronDown className={showCategoryCreator ? "chevron open" : "chevron"} size={19} aria-hidden="true" />
                </button>
                {showCategoryCreator ? (
                  <form className="mini-form category-create" onSubmit={createCategory}>
                    <label>
                      Nombre
                      <div className="inline-form">
                        <input
                          value={categoryName}
                          onChange={(event) => setCategoryName(event.target.value)}
                          placeholder="Ej: Mascotas"
                        />
                        <button className="primary-button square" type="submit" aria-label="Crear categoria">
                          <Plus size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </label>
                  </form>
                ) : null}
              </section>

              <section className="dropdown-panel">
                <button
                  className="dropdown-trigger"
                  type="button"
                  onClick={() => setShowUnitManager((current) => !current)}
                  aria-expanded={showUnitManager}
                >
                  <span>
                    <Ruler size={18} aria-hidden="true" />
                    Presentaciones
                  </span>
                  <ChevronDown className={showUnitManager ? "chevron open" : "chevron"} size={19} aria-hidden="true" />
                </button>
                {showUnitManager ? (
                  <div className="mini-form unit-manager">
                    <form className="inline-form unit-create" onSubmit={createUnit}>
                      <input
                        value={unitName}
                        onChange={(event) => setUnitName(event.target.value)}
                        placeholder="Ej: botella"
                        aria-label="Nueva presentacion"
                      />
                      <button className="primary-button square" type="submit" aria-label="Agregar presentacion">
                        <Plus size={18} aria-hidden="true" />
                      </button>
                    </form>
                    <div className="unit-list">
                      {units.map((unit) => (
                        <label className="unit-editor" key={unit.id}>
                          <Pencil size={15} aria-hidden="true" />
                          <input
                            value={unitDrafts[unit.id] ?? unit.name}
                            onChange={(event) => updateUnitDraft(unit.id, event.target.value)}
                            onBlur={() => saveUnit(unit)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.currentTarget.blur();
                              }
                            }}
                            aria-label={`Editar presentacion ${unit.name}`}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            </section>
          ) : null}

          {activeView === "list" ? (
            <section className="panel list-panel">
              <div className="panel-title list-title">
                <ShoppingBasket size={20} aria-hidden="true" />
                <div>
                  <h3>{activeList?.name || "Lista sin seleccionar"}</h3>
                  <p>{totals.checked} de {items.length} productos comprados</p>
                </div>
              </div>

              <section className="shopping-progress" aria-label="Avance de compras">
                <div className="progress-head">
                  <span>Avance de mercado</span>
                  <strong>{shoppingProgress}%</strong>
                </div>
                <div className="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={shoppingProgress}>
                  <span style={{ width: `${shoppingProgress}%` }} />
                </div>
                <p>
                  {items.length === 0
                    ? "Agrega productos para iniciar tu recorrido."
                    : shoppingProgress === 100
                      ? "Todo comprado. Lista completa."
                      : `Faltan ${items.length - totals.checked} productos por comprar.`}
                </p>
              </section>

              {items.length === 0 ? (
                <div className="empty-state">
                  <ShoppingBasket size={40} aria-hidden="true" />
                  <strong>Lista vacia</strong>
                  <span>Agrega productos desde el catalogo.</span>
                  <button className="primary-button" type="button" onClick={() => setActiveView("catalog")}>
                    <PackagePlus size={18} aria-hidden="true" />
                    Ir al catalogo
                  </button>
                </div>
              ) : (
                <div className="product-list">
                  {items.map((item) => (
                    <article className={item.checked ? "product-row checked" : "product-row"} key={item.id}>
                      <button
                        className={item.checked ? "check-button checked" : "check-button"}
                        type="button"
                        onClick={() => updateItem(item.id, { checked: !item.checked })}
                        aria-label={item.checked ? `${item.name} comprado` : `Marcar ${item.name} como comprado`}
                      >
                        <Check size={16} aria-hidden="true" />
                      </button>
                      <div className="product-main">
                        <strong>{item.name}</strong>
                        <span>{item.checked ? "Comprado" : item.category}</span>
                      </div>
                      <input
                        className="quantity-input"
                        value={item.quantity}
                        onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
                        type="number"
                        min="1"
                        aria-label={`Cantidad de ${item.name}`}
                      />
                      <div className="product-numbers">
                        <span>{currency.format(item.price)} / {getPresentationLabel(item)}</span>
                        <span>{getBaseCost(item)}</span>
                        <strong>{currency.format(item.price * item.quantity)}</strong>
                      </div>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label={`Eliminar ${item.name}`}
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeView === "inventory" ? (
            <section className="panel inventory-panel">
              <div className="panel-title">
                <House size={20} aria-hidden="true" />
                <h3>Inventario en casa</h3>
              </div>

              <div className="inventory-stack">
                {categories.map((category) => {
                  const categoryInventory = groupedInventory[category.name] || [];

                  return (
                    <article className="category-card" key={category.id}>
                      <div className="category-card-head static-head">
                        <div>
                          <h4>{category.name}</h4>
                          <span>{categoryInventory.filter((product) => product.quantity > 0).length} con existencia</span>
                        </div>
                      </div>
                      <div className="inventory-products">
                        {categoryInventory.map((product) => (
                          <div className="inventory-row" key={product.id}>
                            <div>
                              <strong>{product.name}</strong>
                              <span>{getPresentationLabel(product)}</span>
                            </div>
                            <label className="inventory-editor">
                              Tengo
                              <input
                                value={inventoryDrafts[product.id] ?? product.quantity}
                                onChange={(event) => updateInventoryDraft(product.id, event.target.value)}
                                onBlur={() => saveInventory(product)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                                type="number"
                                min="0"
                                step="0.1"
                                aria-label={`Cantidad en inventario de ${product.name}`}
                              />
                            </label>
                            <label className="inventory-editor">
                              Cantidad
                              <input
                                value={presentationQuantityDrafts[product.id] ?? product.presentationQuantity ?? 1}
                                onChange={(event) => updatePresentationQuantityDraft(product.id, event.target.value)}
                                onBlur={() =>
                                  updateProductPresentation(product, {
                                    presentationQuantity: presentationQuantityDrafts[product.id] ?? product.presentationQuantity ?? 1,
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                                type="number"
                                min="0.01"
                                step="0.01"
                                aria-label={`Cantidad de presentacion de ${product.name}`}
                              />
                            </label>
                            <label className="inventory-editor">
                              Unidad
                              <select
                                value={product.unit}
                                onChange={(event) => updateProductPresentation(product, { unit: event.target.value })}
                                aria-label={`Presentacion de ${product.name}`}
                              >
                                {unitOptions.map((unit) => (
                                  <option key={unit} value={unit}>
                                    {unit}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeView === "history" ? (
            <section className="panel history-panel">
              <div className="catalog-head">
                <div className="panel-title">
                  <History size={20} aria-hidden="true" />
                  <h3>Historial de precios</h3>
                </div>
                <div className="search-box">
                  <Search size={18} aria-hidden="true" />
                  <input
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder="Buscar historial"
                  />
                </div>
              </div>

              {filteredPriceHistory.length === 0 ? (
                <div className="empty-state">
                  <History size={40} aria-hidden="true" />
                  <strong>{priceHistory.length === 0 ? "Sin cambios todavia" : "Sin resultados"}</strong>
                  <span>
                    {priceHistory.length === 0
                      ? "Cuando crees o cambies precios, apareceran aqui con la fecha."
                      : "Prueba buscando otro producto, categoria o precio."}
                  </span>
                </div>
              ) : (
                <div className="history-list">
                  {filteredPriceHistory.map((entry) => (
                    <article className="history-row" key={entry.id}>
                      <div>
                        <strong>{entry.name}</strong>
                        <span>{entry.category}</span>
                      </div>
                      <div className="history-prices">
                        <span>{entry.oldPrice === null ? "Inicial" : currency.format(entry.oldPrice)}</span>
                        <strong>{currency.format(entry.newPrice)}</strong>
                      </div>
                      <time dateTime={entry.changedAt}>{formatHistoryDate(entry.changedAt)}</time>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </section>

        <nav className="bottom-nav" aria-label="Navegacion principal">
          <button
            className={activeView === "catalog" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("catalog")}
          >
            <PackagePlus size={20} aria-hidden="true" />
            Catalogo
          </button>
          <button
            className={activeView === "list" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("list")}
          >
            <ShoppingBasket size={20} aria-hidden="true" />
            Mi lista
          </button>
          <button
            className={activeView === "lists" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("lists")}
          >
            <Layers3 size={20} aria-hidden="true" />
            Listas
          </button>
          <button
            className={activeView === "inventory" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("inventory")}
          >
            <House size={20} aria-hidden="true" />
            Inventario
          </button>
          <button
            className={activeView === "history" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("history")}
          >
            <History size={20} aria-hidden="true" />
            Historial
          </button>
          <button
            className={activeView === "settings" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("settings")}
          >
            <Settings size={20} aria-hidden="true" />
            Config.
          </button>
        </nav>

        {toast ? <div className="toast">{toast}</div> : null}
      </section>
    </main>
  );
}

export default App;
