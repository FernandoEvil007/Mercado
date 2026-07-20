import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  Check,
  ChevronDown,
  X,
  ClipboardList,
  Download,
  FolderPlus,
  History,
  House,
  LayoutDashboard,
  Layers3,
  Moon,
  PackagePlus,
  Pencil,
  Plus,
  Ruler,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  ShoppingBasket,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:3001/api" : "/api");

const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const fallbackUnits = ["kilo", "gramos", "litros", "unidad", "frasco", "pote", "sobre", "caja"];
const emptyProductDraft = { name: "", brand: "", price: "", presentationQuantity: "1", unit: "unidad" };
const sessionStorageKey = "merky-session";

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});

function getBaseCost(product) {
  const unit = product.unit;
  const normalizedUnit = unit
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const quantity = Number(product.presentationQuantity || 1);

  if (normalizedUnit.includes("kilo") || normalizedUnit === "kg") {
    return `${currency.format(product.price / (quantity * 1000))} por gramo`;
  }

  if (normalizedUnit.includes("litro") || normalizedUnit === "l" || normalizedUnit === "lt") {
    const pricePerMl = product.price / (quantity * 1000);
    return `${currency.format(pricePerMl)} por ml - ${currency.format(pricePerMl * 1000)} por litro`;
  }

  if (normalizedUnit.includes("mililitro") || normalizedUnit === "ml") {
    const pricePerMl = product.price / quantity;
    return `${currency.format(pricePerMl)} por ml - ${currency.format(pricePerMl * 1000)} por litro`;
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

function getCategoryAccent(categoryName) {
  const palette = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#64748b"];
  const index = String(categoryName || "")
    .split("")
    .reduce((total, letter) => total + letter.charCodeAt(0), 0) % palette.length;
  return palette[index];
}

function getCategoryStyle(categoryName) {
  return { "--category-accent": getCategoryAccent(categoryName) };
}

function getSparklinePoints(values, width = 116, height = 42) {
  const cleanValues = values.map(Number).filter((value) => !Number.isNaN(value));
  if (cleanValues.length === 0) {
    return "";
  }

  const chartValues = cleanValues.length === 1 ? [cleanValues[0], cleanValues[0]] : cleanValues;
  const min = Math.min(...chartValues);
  const max = Math.max(...chartValues);
  const span = max - min || 1;
  const lastIndex = chartValues.length - 1 || 1;

  return chartValues
    .map((value, index) => {
      const x = (index / lastIndex) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function getChartPoints(points, width = 320, height = 150) {
  const values = points.map((point) => Number(point.price)).filter((value) => !Number.isNaN(value));
  if (values.length === 0) {
    return "";
  }

  const chartPoints = points.length === 1 ? [points[0], points[0]] : points;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lastIndex = chartPoints.length - 1 || 1;

  return chartPoints
    .map((point, index) => {
      const x = (index / lastIndex) * width;
      const y = height - ((point.price - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function MerkyLogo({ size = 26 }) {
  return (
    <span className="merky-logo" style={{ "--logo-size": `${size}px` }} aria-hidden="true">
      M
    </span>
  );
}

function getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionStorageKey) || "null");
  } catch {
    localStorage.removeItem(sessionStorageKey);
    return null;
  }
}

async function api(path, options = {}) {
  const session = getStoredSession();
  const headers = {
    "Content-Type": "application/json",
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error("No se pudo completar la accion.");
  }

  return response.json();
}

function App() {
  const categoryTapRef = useRef({ id: null, at: 0 });
  const [session, setSession] = useState(() => getStoredSession());
  const [authMode, setAuthMode] = useState("login");
  const [loginUsername, setLoginUsername] = useState("Fernandoadmin");
  const [loginAccessCode, setLoginAccessCode] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [loginStatus, setLoginStatus] = useState("");
  const [categories, setCategories] = useState([]);
  const [catalogs, setCatalogs] = useState([]);
  const [activeCatalogId, setActiveCatalogId] = useState(null);
  const [products, setProducts] = useState([]);
  const [lists, setLists] = useState([]);
  const [activeListId, setActiveListId] = useState(null);
  const [activeView, setActiveView] = useState("catalog");
  const [theme, setTheme] = useState(() => localStorage.getItem("mercardo-theme") || "light");
  const [items, setItems] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [units, setUnits] = useState(fallbackUnits.map((name, index) => ({ id: `fallback-${index}`, name })));
  const [categoryDrafts, setCategoryDrafts] = useState({});
  const [inventoryDrafts, setInventoryDrafts] = useState({});
  const [minimumDrafts, setMinimumDrafts] = useState({});
  const [productDrafts, setProductDrafts] = useState({});
  const [brandDrafts, setBrandDrafts] = useState({});
  const [brandMenus, setBrandMenus] = useState({});
  const [nameDrafts, setNameDrafts] = useState({});
  const [itemPriceDrafts, setItemPriceDrafts] = useState({});
  const [priceDrafts, setPriceDrafts] = useState({});
  const [presentationQuantityDrafts, setPresentationQuantityDrafts] = useState({});
  const [unitDrafts, setUnitDrafts] = useState({});
  const [expandedCategories, setExpandedCategories] = useState({});
  const [productFormMenus, setProductFormMenus] = useState({});
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingProductId, setEditingProductId] = useState(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState(null);
  const [showCatalogCreator, setShowCatalogCreator] = useState(false);
  const [showCategoryCreator, setShowCategoryCreator] = useState(false);
  const [showUnitManager, setShowUnitManager] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [catalogName, setCatalogName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [listName, setListName] = useState("");
  const [query, setQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedTrendProductId, setSelectedTrendProductId] = useState(null);
  const [status, setStatus] = useState("Cargando datos...");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!session?.token) {
      setStatus("");
      return;
    }

    api("/bootstrap")
      .then((data) => {
        applyBootstrapData(data);
        setStatus("");
      })
      .catch(() => {
        localStorage.removeItem(sessionStorageKey);
        setSession(null);
        setStatus("");
        setLoginStatus("La sesion vencio o no tiene permiso.");
      });
  }, [session?.token]);

  function applyBootstrapData(data) {
    setCategories(data.categories || []);
    setCatalogs(data.catalogs || []);
    setActiveCatalogId(data.activeCatalogId ?? null);
    setProducts(data.products || []);
    setLists(data.lists || []);
    setActiveListId(data.activeListId ?? null);
    setItems(data.items || []);
    setPurchases(data.purchases || []);
    setPriceHistory(data.priceHistory || []);
    setInventory(data.inventory || []);
    setUnits(data.units?.length ? data.units : fallbackUnits.map((name, index) => ({ id: `fallback-${index}`, name })));
  }

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
  const activeCatalog = catalogs.find((catalog) => catalog.id === activeCatalogId);
  const filteredProducts = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) {
      return products;
    }

    return products.filter((product) =>
      `${product.name} ${product.brand || ""} ${product.category}`.toLowerCase().includes(text),
    );
  }, [products, query]);
  const groupedProducts = useMemo(() => groupByCategory(filteredProducts), [filteredProducts]);
  const visibleCatalogCategories = useMemo(() => {
    const hasSearch = query.trim().length > 0;
    if (!hasSearch) {
      return categories;
    }

    return categories.filter((category) => (groupedProducts[category.name] || []).length > 0);
  }, [categories, groupedProducts, query]);
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
        minQuantity: inventoryByProduct[product.id]?.minQuantity ?? 0,
        updatedAt: inventoryByProduct[product.id]?.updatedAt ?? null,
      })),
    [products, inventoryByProduct],
  );
  const groupedInventory = useMemo(() => groupByCategory(inventoryProducts), [inventoryProducts]);
  const lowStockProducts = useMemo(
    () => inventoryProducts.filter((product) => product.minQuantity > 0 && product.quantity <= product.minQuantity),
    [inventoryProducts],
  );
  const groupedListItems = useMemo(() => {
    const sortedItems = [...items].sort((first, second) => {
      const byCategory = first.category.localeCompare(second.category, "es", { sensitivity: "base" });
      if (byCategory !== 0) {
        return byCategory;
      }

      return first.name.localeCompare(second.name, "es", { sensitivity: "base" });
    });

    return sortedItems.reduce((groups, item) => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }

      groups[item.category].push(item);
      return groups;
    }, {});
  }, [items]);
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
  const priceChartEntries = useMemo(
    () =>
      filteredPriceHistory
        .filter((entry) => entry.oldPrice !== null)
        .slice(0, 8)
        .map((entry) => ({
          ...entry,
          difference: entry.newPrice - entry.oldPrice,
          percent: entry.oldPrice ? ((entry.newPrice - entry.oldPrice) / entry.oldPrice) * 100 : 0,
        })),
    [filteredPriceHistory],
  );
  const priceTrendCards = useMemo(() => {
    const grouped = filteredPriceHistory.reduce((groups, entry) => {
      const key = `${entry.productId}-${entry.name}-${entry.category}`;
      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(entry);
      return groups;
    }, {});

    return Object.values(grouped)
      .map((entries) => {
        const sortedEntries = [...entries].sort(
          (first, second) =>
            new Date(first.changedAt) - new Date(second.changedAt) || first.id - second.id,
        );
        const points = sortedEntries.flatMap((entry, index) => {
          const currentPoint = { price: entry.newPrice, changedAt: entry.changedAt, id: entry.id };
          if (index === 0 && entry.oldPrice !== null) {
            return [{ price: entry.oldPrice, changedAt: entry.changedAt, id: `${entry.id}-old` }, currentPoint];
          }

          return [currentPoint];
        });
        const values = points.map((point) => point.price);
        const firstEntry = sortedEntries[0];
        const lastEntry = sortedEntries[sortedEntries.length - 1];
        const initialPrice = values[0] ?? 0;
        const currentPrice = values[values.length - 1] ?? 0;
        const difference = currentPrice - initialPrice;
        const percent = initialPrice ? (difference / initialPrice) * 100 : 0;
        const chartPoints = getChartPoints(points);

        return {
          productId: firstEntry.productId,
          name: firstEntry.name,
          category: firstEntry.category,
          initialPrice,
          currentPrice,
          difference,
          percent,
          points: getSparklinePoints(values),
          chartPoints,
          chartPointList: chartPoints.split(" "),
          timeline: points,
          minPrice: Math.min(...values),
          maxPrice: Math.max(...values),
          count: values.length,
          changedAt: lastEntry.changedAt,
        };
      })
      .filter((entry) => entry.points)
      .sort((first, second) => first.name.localeCompare(second.name, "es", { sensitivity: "base" }))
      .slice(0, 12);
  }, [filteredPriceHistory]);
  const selectedTrend = useMemo(
    () => priceTrendCards.find((entry) => entry.productId === selectedTrendProductId) || null,
    [priceTrendCards, selectedTrendProductId],
  );
  const previousPricesByProduct = useMemo(
    () =>
      priceHistory.reduce((result, entry) => {
        if (entry.oldPrice !== null && result[entry.productId] === undefined) {
          result[entry.productId] = entry.oldPrice;
        }

        return result;
      }, {}),
    [priceHistory],
  );
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
  const canCompletePurchase = items.length > 0 && totals.checked === items.length;
  const averageListPrice = items.length ? totals.amount / items.length : 0;
  const stockedProducts = inventoryProducts.filter((product) => product.quantity > 0).length;
  const summary = useMemo(() => {
    const priceChanges = priceHistory
      .filter((entry) => entry.oldPrice !== null)
      .slice(0, 5)
      .map((entry) => ({
        ...entry,
        difference: entry.newPrice - entry.oldPrice,
      }));

    return {
      productCount: products.length,
      inventoryCount: inventoryProducts.filter((product) => product.quantity > 0).length,
      lowStockCount: lowStockProducts.length,
      pendingItems: items.length - totals.checked,
      estimatedListTotal: totals.amount,
      priceChanges,
    };
  }, [inventoryProducts, items.length, lowStockProducts.length, priceHistory, products.length, totals.amount, totals.checked]);

  function saveSession(data) {
    localStorage.setItem(sessionStorageKey, JSON.stringify({ token: data.token, user: data.user }));
    setSession({ token: data.token, user: data.user });
    setLoginAccessCode("");
    setLoginStatus("");
    setStatus("Cargando datos...");
  }

  async function submitAuth(event) {
    event.preventDefault();
    setLoginStatus(authMode === "register" ? "Creando tu espacio..." : "Validando acceso...");

    try {
      if (authMode === "register") {
        const data = await api("/register", {
          method: "POST",
          body: JSON.stringify({
            username: loginUsername.trim(),
            email: registerEmail.trim(),
            phone: registerPhone.trim(),
            password: loginAccessCode,
          }),
        });
        saveSession(data);
        return;
      }

      const data = await api("/session", {
        method: "POST",
        body: JSON.stringify({ username: loginUsername.trim(), password: loginAccessCode, accessCode: loginAccessCode }),
      });
      saveSession(data);
    } catch {
      setLoginStatus(authMode === "register" ? "No se pudo crear el usuario." : "Usuario o clave incorrectos.");
    }
  }

  function logout() {
    localStorage.removeItem(sessionStorageKey);
    setSession(null);
    setCategories([]);
    setCatalogs([]);
    setActiveCatalogId(null);
    setProducts([]);
    setLists([]);
    setItems([]);
    setInventory([]);
    setPriceHistory([]);
    setPurchases([]);
    setCatalogName("");
    setToast("Sesion cerrada");
  }

  async function createCatalog(event) {
    event.preventDefault();
    const name = catalogName.trim();
    if (!name) {
      return;
    }

    const data = await api("/catalogs", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    applyBootstrapData(data);
    setQuery("");
    setCatalogName("");
    setShowCatalogCreator(false);
    setEditingProductId(null);
    setToast(`${name} creado`);
  }

  async function switchCatalog(catalogId) {
    const nextCatalogId = Number(catalogId);
    if (!nextCatalogId || nextCatalogId === activeCatalogId) {
      return;
    }

    const data = await api("/catalogs/active", {
      method: "PATCH",
      body: JSON.stringify({ catalogId: nextCatalogId }),
    });
    applyBootstrapData(data);
    setQuery("");
    setEditingProductId(null);
    const catalog = data.catalogs?.find((item) => item.id === data.activeCatalogId);
    setToast(`${catalog?.name || "Catalogo"} activo`);
  }

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

  function updateCategoryDraft(categoryId, value) {
    setCategoryDrafts((current) => ({ ...current, [categoryId]: value }));
  }

  function handleCategoryNameClick(event, category) {
    event.stopPropagation();
    const now = Date.now();
    const lastTap = categoryTapRef.current;
    const isSecondTap = lastTap.id === category.id && now - lastTap.at < 480;

    updateCategoryDraft(category.id, category.name);
    setEditingCategoryId(category.id);
    setExpandedCategories((current) => ({ ...current, [category.id]: true }));

    if (isSecondTap) {
      setDeleteCategoryId((current) => (current === category.id ? null : category.id));
      categoryTapRef.current = { id: null, at: 0 };
      return;
    }

    categoryTapRef.current = { id: category.id, at: now };
  }

  async function saveCategoryName(category) {
    const name = (categoryDrafts[category.id] ?? category.name).trim();
    if (!name || name === category.name) {
      updateCategoryDraft(category.id, undefined);
      setEditingCategoryId(null);
      return;
    }

    const data = await api(`/categories/${category.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setCategories(data.categories);
    setProducts(data.products);
    setPriceHistory(data.priceHistory || priceHistory);
    setInventory(data.inventory || inventory);
    setItems((current) =>
      current.map((item) =>
        item.category === category.name ? { ...item, category: name } : item,
      ),
    );
    updateCategoryDraft(category.id, undefined);
    setEditingCategoryId(null);
    setToast(`${category.name} ahora es ${name}`);
  }

  async function deleteCategory(category) {
    const categoryProducts = products.filter((product) => product.categoryId === category.id);
    const shouldDelete = window.confirm(
      `Eliminar la categoria ${category.name} con ${categoryProducts.length} productos? Esta accion tambien quitara esos productos de listas, inventario e historial.`,
    );
    if (!shouldDelete) {
      return;
    }

    const data = await api(`/categories/${category.id}`, { method: "DELETE" });
    setCategories(data.categories);
    setProducts(data.products);
    setInventory(data.inventory || []);
    setPriceHistory(data.priceHistory || []);
    setLists(data.lists || lists);
    setActiveListId(data.activeListId ?? null);
    setItems(data.items || []);
    setExpandedCategories((current) => {
      const next = { ...current };
      delete next[category.id];
      return next;
    });
    setProductFormMenus((current) => {
      const next = { ...current };
      delete next[category.id];
      return next;
    });
    setCategoryDrafts((current) => {
      const next = { ...current };
      delete next[category.id];
      return next;
    });
    setEditingCategoryId(null);
    setDeleteCategoryId(null);
    setToast(`Categoria ${category.name} eliminada`);
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
    const brand = draft.brand.trim();
    const price = Number(draft.price);
    const unit = unitOptions.includes(draft.unit) ? draft.unit : unitOptions[0] || "unidad";
    const presentationQuantity = Number(draft.presentationQuantity);

    if (!name || !categoryId || Number.isNaN(price) || price < 0 || Number.isNaN(presentationQuantity) || presentationQuantity <= 0) {
      return;
    }

    const data = await api("/products", {
      method: "POST",
      body: JSON.stringify({ name, brand, price, categoryId, unit, presentationQuantity }),
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

  async function shareCurrentList() {
    const listLines = Object.entries(groupedListItems).flatMap(([categoryName, categoryItems]) => [
      categoryName,
      ...categoryItems.map((item) => {
        const checked = item.checked ? "[x]" : "[ ]";
        const brand = item.brand ? ` - ${item.brand}` : "";
        return `${checked} ${item.name}${brand} x${item.quantity}`;
      }),
      "",
    ]);
    const text = `${activeList?.name || "Mi lista de mercado"}\n\n${listLines.join("\n").trim()}`;

    if (navigator.share) {
      await navigator.share({ title: activeList?.name || "Mi lista de mercado", text });
      return;
    }

    await navigator.clipboard.writeText(text);
    setToast("Lista copiada para compartir");
  }

  async function completeCurrentPurchase() {
    if (!activeListId || !canCompletePurchase) {
      return;
    }

    const data = await api(`/lists/${activeListId}/complete`, { method: "POST" });
    setPurchases(data.purchases || []);
    setLists(data.lists || lists);
    setToast("Compra guardada en el registro");
  }

  async function clearCurrentList() {
    if (!activeListId || items.length === 0) {
      return;
    }

    const shouldClear = window.confirm("Limpiar esta lista para volver a usarla?");
    if (!shouldClear) {
      return;
    }

    const data = await api(`/lists/${activeListId}/clear`, { method: "POST" });
    setItems(data.items || []);
    setLists(data.lists || lists);
    setItemPriceDrafts({});
    setActiveView("catalog");
    setToast("Lista limpia y lista para reutilizar");
  }

  function exportBackup() {
    window.open(`${API_URL}/export`, "_blank", "noopener,noreferrer");
  }

  function updatePriceDraft(productId, value) {
    setPriceDrafts((current) => ({ ...current, [productId]: value }));
  }

  function updateItemPriceDraft(itemId, value) {
    setItemPriceDrafts((current) => ({ ...current, [itemId]: value }));
  }

  function updateNameDraft(productId, value) {
    setNameDrafts((current) => ({ ...current, [productId]: value }));
  }

  function updateBrandDraft(productId, value) {
    setBrandDrafts((current) => ({ ...current, [productId]: value }));
  }

  function toggleBrandMenu(productId) {
    setBrandMenus((current) => ({ ...current, [productId]: !current[productId] }));
  }

  async function saveProductName(product) {
    const name = (nameDrafts[product.id] ?? product.name).trim();
    if (!name || name === product.name) {
      updateNameDraft(product.id, undefined);
      return;
    }

    const data = await api(`/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setProducts(data.products);
    setInventory(data.inventory || inventory);
    setPriceHistory(data.priceHistory || priceHistory);
    setItems((current) =>
      current.map((item) =>
        item.productId === product.id ? { ...item, name } : item,
      ),
    );
    updateNameDraft(product.id, undefined);
    setToast(`${product.name} ahora es ${name}`);
  }

  async function saveProductBrand(product, nextBrand, nextPrice) {
    const brand = (nextBrand ?? brandDrafts[product.id] ?? product.brand ?? "").trim();
    const hasSavedPrice = nextPrice !== undefined && nextPrice !== null;
    if (brand === (product.brand || "") && !hasSavedPrice) {
      updateBrandDraft(product.id, undefined);
      return;
    }

    const data = await api(`/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify(hasSavedPrice ? { brand, price: nextPrice } : { brand }),
    });
    setProducts(data.products);
    setPriceHistory(data.priceHistory || priceHistory);
    setInventory(data.inventory || inventory);
    setItems((current) =>
      current.map((item) =>
        item.productId === product.id
          ? { ...item, brand, price: hasSavedPrice && !item.checked ? nextPrice : item.price }
          : item,
      ),
    );
    updateBrandDraft(product.id, undefined);
    setToast(brand ? `Marca de ${product.name}: ${brand}` : `Marca de ${product.name} borrada`);
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
        item.productId === product.id && !item.checked ? { ...item, price } : item,
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
    if (data.products) {
      setProducts(data.products);
    }
    if (data.priceHistory) {
      setPriceHistory(data.priceHistory);
    }
    if (updates.price !== undefined) {
      const item = items.find((current) => current.id === itemId);
      setToast(`Precio de ${item?.name || "producto"} guardado en el historial`);
    }
  }

  async function removeItem(itemId) {
    const data = await api(`/list-items/${itemId}`, { method: "DELETE" });
    setItems(data.items);
    setItemPriceDrafts((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  async function deleteProduct(product) {
    const shouldDelete = window.confirm(`Eliminar ${product.name} del catalogo e inventario?`);
    if (!shouldDelete) {
      return;
    }

    const data = await api(`/products/${product.id}`, { method: "DELETE" });
    setProducts(data.products);
    setInventory(data.inventory || []);
    setPriceHistory(data.priceHistory || []);
    setItems((current) => current.filter((item) => item.productId !== product.id));
    setInventoryDrafts((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setMinimumDrafts((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setPriceDrafts((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setNameDrafts((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setBrandDrafts((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setBrandMenus((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setPresentationQuantityDrafts((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setToast(`${product.name} eliminado`);
  }

  function updateInventoryDraft(productId, value) {
    setInventoryDrafts((current) => ({ ...current, [productId]: value }));
  }

  function updateMinimumDraft(productId, value) {
    setMinimumDrafts((current) => ({ ...current, [productId]: value }));
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

  async function saveMinimumInventory(product) {
    const value = minimumDrafts[product.id];
    if (value === undefined || value === "") {
      return;
    }

    const minQuantity = Number(value);
    if (Number.isNaN(minQuantity) || minQuantity < 0 || minQuantity === product.minQuantity) {
      updateMinimumDraft(product.id, undefined);
      return;
    }

    const data = await api(`/inventory/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({ minQuantity }),
    });
    setInventory(data.inventory);
    updateMinimumDraft(product.id, undefined);
    setToast(`Minimo de ${product.name} actualizado`);
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
    setNameDrafts((current) => ({ ...current, [product.id]: product.name }));
    setBrandDrafts((current) => ({ ...current, [product.id]: product.brand || "" }));
  }

  function formatHistoryDate(value) {
    const date = new Date(`${value}Z`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return dateFormatter.format(date);
  }

  if (!session?.token) {
    return (
      <main className="app mobile-app" data-theme={theme}>
        <section className="login-shell">
          <div className="login-card">
            <div className="brand-mark">
              <MerkyLogo size={26} />
            </div>
            <div className="login-title-block">
              <p className="eyebrow">Base protegida</p>
              <h1>Merky</h1>
              <span>Mercado, inventario y precios en un solo lugar.</span>
            </div>
            <div className="creator-signature" aria-label="Aplicacion creada por Fernando Rodriguez Bayona">
              <span>Creada por</span>
              <strong>Fernando Rodriguez Bayona</strong>
            </div>
            <div className="login-highlights" aria-label="Resumen de Merky">
              <article>
                <ShieldCheck size={17} aria-hidden="true" />
                <span>Privada</span>
              </article>
              <article>
                <BarChart3 size={17} aria-hidden="true" />
                <span>Precios</span>
              </article>
              <article>
                <House size={17} aria-hidden="true" />
                <span>Inventario</span>
              </article>
            </div>
            <form className="login-form" onSubmit={submitAuth}>
              <label>
                Usuario
                <input
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  autoComplete="username"
                />
              </label>
              {authMode === "register" ? (
                <>
                  <label>
                    Correo
                    <input
                      value={registerEmail}
                      onChange={(event) => setRegisterEmail(event.target.value)}
                      type="email"
                      autoComplete="email"
                      placeholder="correo@ejemplo.com"
                    />
                  </label>
                  <label>
                    Telefono
                    <input
                      value={registerPhone}
                      onChange={(event) => setRegisterPhone(event.target.value)}
                      type="tel"
                      autoComplete="tel"
                      placeholder="Numero de contacto"
                    />
                  </label>
                </>
              ) : null}
              <label>
                {authMode === "register" ? "Contrasena" : "Clave de acceso"}
                <input
                  value={loginAccessCode}
                  onChange={(event) => setLoginAccessCode(event.target.value)}
                  type="password"
                  autoComplete={authMode === "register" ? "new-password" : "current-password"}
                  placeholder={authMode === "register" ? "Minimo 6 caracteres" : "Clave privada"}
                />
              </label>
              <button className="primary-button" type="submit">
                {authMode === "register" ? "Crear mi Merky" : "Entrar"}
              </button>
            </form>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setAuthMode((current) => (current === "login" ? "register" : "login"));
                setLoginStatus("");
              }}
            >
              {authMode === "register" ? "Ya tengo usuario" : "Crear usuario nuevo"}
            </button>
            {loginStatus ? <div className="status-bar">{loginStatus}</div> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app mobile-app" data-theme={theme}>
      <section className="phone-shell">
        <header className="app-header">
          <div className="brand-row">
            <div className="brand-mark">
              <MerkyLogo size={24} />
            </div>
            <div>
              <p>Hola, {session.user?.username || "usuario"}</p>
              <h1>Merky</h1>
            </div>
            <div className="user-pill" title={session.user?.username || "usuario"}>
              <UserRound size={15} aria-hidden="true" />
              <span>{(session.user?.username || "U").slice(0, 1).toUpperCase()}</span>
            </div>
            <button
              className="theme-button"
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
            >
              {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
            </button>
            <button
              className="logout-button"
              type="button"
              onClick={logout}
            >
              Salir
            </button>
          </div>
          <div>
            <p className="eyebrow">Lista activa</p>
            <h2>{activeList?.name || "Sin lista"}</h2>
          </div>
          <div className="header-metrics" aria-label="Estado rapido de la lista">
            <article>
              <span>Total</span>
              <strong>{currency.format(totals.amount)}</strong>
            </article>
            <article>
              <span>Avance</span>
              <strong>{shoppingProgress}%</strong>
            </article>
            <article className={lowStockProducts.length ? "warning" : ""}>
              <span>Alertas</span>
              <strong>{lowStockProducts.length}</strong>
            </article>
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

          {activeView === "summary" ? (
            <section className="panel summary-panel">
              <div className="panel-title">
                <LayoutDashboard size={20} aria-hidden="true" />
                <h3>Resumen</h3>
              </div>

              <section className="summary-hero">
                <div
                  className="progress-ring"
                  style={{ "--progress": `${shoppingProgress}%` }}
                  aria-label={`Avance de compra ${shoppingProgress}%`}
                >
                  <strong>{shoppingProgress}%</strong>
                  <span>avance</span>
                </div>
                <div className="summary-hero-copy">
                  <p className="eyebrow">Lista activa</p>
                  <h2>{activeList?.name || "Sin lista"}</h2>
                  <span>{items.length ? `${totals.checked} comprados, ${items.length - totals.checked} pendientes` : "Sin productos pendientes"}</span>
                </div>
              </section>

              <div className="insight-strip" aria-label="Indicadores rapidos">
                <article>
                  <span>Promedio</span>
                  <strong>{currency.format(averageListPrice)}</strong>
                </article>
                <article>
                  <span>En casa</span>
                  <strong>{stockedProducts}</strong>
                </article>
                <article className={summary.lowStockCount ? "danger" : ""}>
                  <span>Alertas</span>
                  <strong>{summary.lowStockCount}</strong>
                </article>
              </div>

              <div className="summary-grid">
                <article>
                  <PackagePlus size={18} aria-hidden="true" />
                  <span>Productos</span>
                  <strong>{summary.productCount}</strong>
                </article>
                <article>
                  <ShoppingBasket size={18} aria-hidden="true" />
                  <span>Pendientes</span>
                  <strong>{summary.pendingItems}</strong>
                </article>
                <article>
                  <BadgeDollarSign size={18} aria-hidden="true" />
                  <span>Total lista</span>
                  <strong>{currency.format(summary.estimatedListTotal)}</strong>
                </article>
                <article className={summary.lowStockCount ? "warning" : ""}>
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>Baja existencia</span>
                  <strong>{summary.lowStockCount}</strong>
                </article>
              </div>

              <section className="summary-section">
                <div className="section-head">
                  <strong>Alertas de inventario</strong>
                  <span>{summary.lowStockCount}</span>
                </div>
                {lowStockProducts.length ? (
                  <div className="compact-list">
                    {lowStockProducts.slice(0, 6).map((product) => (
                      <article key={product.id}>
                        <div>
                          <strong>{product.name}</strong>
                          <span>{product.category}</span>
                        </div>
                        <span>{product.quantity} / min {product.minQuantity}</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="quiet-text">No hay productos por debajo del minimo.</p>
                )}
              </section>

              <section className="summary-section">
                <div className="section-head">
                  <strong>Cambios recientes</strong>
                  <span>{summary.priceChanges.length}</span>
                </div>
                {summary.priceChanges.length ? (
                  <div className="compact-list">
                    {summary.priceChanges.map((entry) => (
                      <article key={entry.id}>
                        <div>
                          <strong>{entry.name}</strong>
                          <span>{formatHistoryDate(entry.changedAt)}</span>
                        </div>
                        <span className={entry.difference >= 0 ? "up" : "down"}>
                          {entry.difference >= 0 ? "+" : ""}{currency.format(entry.difference)}
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="quiet-text">Aun no hay variaciones de precio.</p>
                )}
              </section>

              <section className="summary-section">
                <div className="section-head">
                  <strong>Compras realizadas</strong>
                  <span>{purchases.length}</span>
                </div>
                {purchases.length ? (
                  <div className="compact-list purchase-records">
                    {purchases.slice(0, 6).map((purchase) => (
                      <article key={purchase.id}>
                        <div>
                          <strong>{purchase.listName}</strong>
                          <span>{formatHistoryDate(purchase.completedAt)} - {purchase.itemCount} productos</span>
                        </div>
                        <span>{currency.format(purchase.total)}</span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="quiet-text">Cuando termines una lista, guardala como compra realizada.</p>
                )}
              </section>
            </section>
          ) : null}

          {activeView === "catalog" ? (
            <section className="panel catalog-panel">
              <div className="catalog-head">
                <div className="panel-title">
                  <PackagePlus size={20} aria-hidden="true" />
                  <div>
                    <h3>Catalogo</h3>
                    <p>{activeCatalog?.name || "Catalogo alkosto"}</p>
                  </div>
                </div>
                <section className="catalog-switcher" aria-label="Catalogos por almacen">
                  <label>
                    Almacen
                    <select
                      value={activeCatalogId || ""}
                      onChange={(event) => switchCatalog(event.target.value)}
                    >
                      {catalogs.map((catalog) => (
                        <option key={catalog.id} value={catalog.id}>
                          {catalog.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
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
                {visibleCatalogCategories.length === 0 ? (
                  <div className="empty-state compact-empty">
                    <Search size={34} aria-hidden="true" />
                    <strong>Sin resultados</strong>
                    <span>No hay productos que coincidan con tu busqueda.</span>
                  </div>
                ) : null}
                {visibleCatalogCategories.map((category) => {
                  const categoryProducts = groupedProducts[category.name] || [];
                  const draft = productDrafts[category.id] || emptyProductDraft;
                  const draftUnit = unitOptions.includes(draft.unit) ? draft.unit : unitOptions[0] || "unidad";
                  const isExpanded = expandedCategories[category.id] !== false;
                  const isProductFormOpen = Boolean(productFormMenus[category.id]);

                  return (
                    <article className="category-card" key={category.id} style={getCategoryStyle(category.name)}>
                      <button
                        className="category-card-head"
                        type="button"
                        onClick={() => toggleCategory(category.id)}
                        aria-expanded={isExpanded}
                      >
                        <div>
                          <h4
                            className="category-name-trigger"
                            onClick={(event) => handleCategoryNameClick(event, category)}
                          >
                            {category.name}
                          </h4>
                          <span>{categoryProducts.length} productos</span>
                        </div>
                        <ChevronDown className={isExpanded ? "chevron open" : "chevron"} size={20} aria-hidden="true" />
                      </button>
                      {isExpanded ? (
                        <>
                          {editingCategoryId === category.id ? (
                            <label className="category-name-editor">
                              Categoria
                              <input
                                value={categoryDrafts[category.id] ?? category.name}
                                onChange={(event) => updateCategoryDraft(category.id, event.target.value)}
                                onBlur={() => saveCategoryName(category)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                  if (event.key === "Escape") {
                                    updateCategoryDraft(category.id, undefined);
                                    setEditingCategoryId(null);
                                  }
                                }}
                                aria-label={`Cambiar nombre de categoria ${category.name}`}
                              />
                            </label>
                          ) : null}
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
                          {deleteCategoryId === category.id ? (
                            <button
                              className="category-delete-trigger"
                              type="button"
                              onClick={() => deleteCategory(category)}
                            >
                              <Trash2 size={17} aria-hidden="true" />
                              Eliminar categoria completa
                            </button>
                          ) : null}
                          {isProductFormOpen ? (
                            <form className="category-product-form" onSubmit={(event) => createProduct(event, category.id)}>
                              <input
                                value={draft.name}
                                onChange={(event) => updateProductDraft(category.id, { name: event.target.value })}
                                placeholder="Nuevo producto"
                                aria-label={`Nuevo producto en ${category.name}`}
                              />
                              <input
                                value={draft.brand}
                                onChange={(event) => updateProductDraft(category.id, { brand: event.target.value })}
                                placeholder="Marca"
                                aria-label={`Marca para ${category.name}`}
                              />
                              <input
                                value={draft.price}
                                onChange={(event) => updateProductDraft(category.id, { price: event.target.value })}
                                type="number"
                                min="0"
                                step="0.01"
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
                                      {product.brand ? <em>{product.brand}</em> : null}
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
                                        Nombre
                                        <input
                                          value={nameDrafts[product.id] ?? product.name}
                                          onChange={(event) => updateNameDraft(product.id, event.target.value)}
                                          onBlur={() => saveProductName(product)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          aria-label={`Cambiar nombre de ${product.name}`}
                                        />
                                      </label>
                                      <label className="price-editor">
                                        Marca
                                        <input
                                          value={brandDrafts[product.id] ?? product.brand ?? ""}
                                          onChange={(event) => updateBrandDraft(product.id, event.target.value)}
                                          onBlur={() => saveProductBrand(product)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          placeholder="Sin marca"
                                          aria-label={`Cambiar marca de ${product.name}`}
                                        />
                                      </label>
                                      <div className="brand-picker">
                                        <button
                                          className="brand-picker-trigger"
                                          type="button"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => toggleBrandMenu(product.id)}
                                          aria-expanded={Boolean(brandMenus[product.id])}
                                        >
                                          Marcas guardadas
                                          <ChevronDown className={brandMenus[product.id] ? "chevron open" : "chevron"} size={17} aria-hidden="true" />
                                        </button>
                                        {brandMenus[product.id] ? (
                                          <div className="brand-options">
                                            {product.brandPrices?.length ? (
                                              product.brandPrices.map((brand) => (
                                                <button
                                                  className={brand.name === product.brand ? "brand-option active" : "brand-option"}
                                                  type="button"
                                                  key={brand.name}
                                                  onMouseDown={(event) => event.preventDefault()}
                                                  onClick={() => saveProductBrand(product, brand.name, brand.price)}
                                                >
                                                  <span>{brand.name}</span>
                                                  {brand.price !== null && brand.price !== undefined ? <small>{currency.format(brand.price)}</small> : null}
                                                </button>
                                              ))
                                            ) : (
                                              <span>Sin marcas guardadas</span>
                                            )}
                                          </div>
                                        ) : null}
                                      </div>
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
                                          step="0.01"
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
                                      <button
                                        className="delete-product-button"
                                        type="button"
                                        onClick={() => deleteProduct(product)}
                                      >
                                        <Trash2 size={17} aria-hidden="true" />
                                        Eliminar producto
                                      </button>
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
                  onClick={() => setShowCatalogCreator((current) => !current)}
                  aria-expanded={showCatalogCreator}
                >
                  <span>
                    <Layers3 size={18} aria-hidden="true" />
                    Nuevo catalogo
                  </span>
                  <ChevronDown className={showCatalogCreator ? "chevron open" : "chevron"} size={19} aria-hidden="true" />
                </button>
                {showCatalogCreator ? (
                  <form className="mini-form catalog-create" onSubmit={createCatalog}>
                    <label>
                      Nombre
                      <div className="inline-form">
                        <input
                          value={catalogName}
                          onChange={(event) => setCatalogName(event.target.value)}
                          placeholder="Ej: Catalogo Exito"
                          aria-label="Nombre del nuevo catalogo"
                        />
                        <button className="primary-button square" type="submit" aria-label="Crear catalogo">
                          <Plus size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </label>
                    <span className="quiet-text">Se copiaran los productos de {activeCatalog?.name || "tu catalogo actual"} con precios en cero.</span>
                  </form>
                ) : null}
              </section>

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

              <section className="backup-card">
                <div>
                  <strong>Respaldo de datos</strong>
                  <span>Exporta productos, marcas, inventario, listas e historial.</span>
                </div>
                <button className="primary-button" type="button" onClick={exportBackup}>
                  <Download size={18} aria-hidden="true" />
                  Exportar
                </button>
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
                <button
                  className="share-list-button"
                  type="button"
                  onClick={shareCurrentList}
                  disabled={items.length === 0}
                >
                  <Share2 size={17} aria-hidden="true" />
                  Compartir
                </button>
                <button
                  className="share-list-button"
                  type="button"
                  onClick={() => setActiveView("shopping")}
                  disabled={items.length === 0}
                >
                  <Check size={17} aria-hidden="true" />
                  Comprar
                </button>
                <button
                  className="complete-purchase-button"
                  type="button"
                  onClick={completeCurrentPurchase}
                  disabled={!canCompletePurchase}
                >
                  Guardar compra
                </button>
                <button
                  className="clear-list-button"
                  type="button"
                  onClick={clearCurrentList}
                  disabled={items.length === 0 || (!canCompletePurchase && !activeList?.completedAt)}
                >
                  Limpiar
                </button>
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
                  {Object.entries(groupedListItems).map(([categoryName, categoryItems]) => (
                    <section className="list-category" key={categoryName} style={getCategoryStyle(categoryName)}>
                      <div className="list-category-head">
                        <strong>{categoryName}</strong>
                        <span>{categoryItems.filter((item) => item.checked).length} de {categoryItems.length}</span>
                      </div>
                      {categoryItems.map((item) => (
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
                            <span>{item.checked ? "Comprado" : [item.brand, item.category].filter(Boolean).join(" - ")}</span>
                          </div>
                          <input
                            className="quantity-input"
                            value={item.quantity}
                            onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
                            type="number"
                            min="1"
                            aria-label={`Cantidad de ${item.name}`}
                          />
                          <label className="list-price-editor">
                            Precio hoy
                            <input
                              value={itemPriceDrafts[item.id] ?? item.price}
                              onChange={(event) => updateItemPriceDraft(item.id, event.target.value)}
                              onBlur={() => {
                                const draftPrice = itemPriceDrafts[item.id];
                                if (draftPrice !== undefined && draftPrice !== "") {
                                  updateItem(item.id, { price: draftPrice });
                                  updateItemPriceDraft(item.id, undefined);
                                  return;
                                }

                                updateItemPriceDraft(item.id, undefined);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label={`Precio de hoy para ${item.name}`}
                            />
                          </label>
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
                    </section>
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
                    <article className="category-card" key={category.id} style={getCategoryStyle(category.name)}>
                      <div className="category-card-head static-head">
                        <div>
                          <h4>{category.name}</h4>
                          <span>{categoryInventory.filter((product) => product.quantity > 0).length} con existencia</span>
                        </div>
                      </div>
                      <div className="inventory-products">
                        {categoryInventory.map((product) => (
                          <div
                            className={product.minQuantity > 0 && product.quantity <= product.minQuantity ? "inventory-row low-stock" : "inventory-row"}
                            key={product.id}
                          >
                            <div className="inventory-product-info">
                              <strong>{product.name}</strong>
                              <span>
                                {[
                                  product.brand,
                                  product.minQuantity > 0 && product.quantity <= product.minQuantity ? "Baja existencia" : null,
                                ].filter(Boolean).join(" - ")}
                              </span>
                            </div>
                            <label className="inventory-editor">
                              Existencia
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
                              Minimo
                              <input
                                value={minimumDrafts[product.id] ?? product.minQuantity}
                                onChange={(event) => updateMinimumDraft(product.id, event.target.value)}
                                onBlur={() => saveMinimumInventory(product)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                                type="number"
                                min="0"
                                step="0.1"
                                aria-label={`Minimo en inventario de ${product.name}`}
                              />
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

          {activeView === "shopping" ? (
            <section className="panel shopping-mode-panel">
              <div className="shopping-mode-head">
                <div className="panel-title">
                  <ShoppingBasket size={20} aria-hidden="true" />
                  <div>
                    <h3>Modo compra</h3>
                    <p>{totals.checked} de {items.length} productos</p>
                  </div>
                </div>
                <button className="share-list-button" type="button" onClick={() => setActiveView("list")}>
                  Salir
                </button>
                <button
                  className="complete-purchase-button"
                  type="button"
                  onClick={completeCurrentPurchase}
                  disabled={!canCompletePurchase}
                >
                  Guardar
                </button>
                <button
                  className="clear-list-button"
                  type="button"
                  onClick={clearCurrentList}
                  disabled={items.length === 0 || (!canCompletePurchase && !activeList?.completedAt)}
                >
                  Limpiar
                </button>
              </div>

              <section className="shopping-progress compact" aria-label="Avance de compras">
                <div className="progress-head">
                  <span>Avance</span>
                  <strong>{shoppingProgress}%</strong>
                </div>
                <div className="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={shoppingProgress}>
                  <span style={{ width: `${shoppingProgress}%` }} />
                </div>
              </section>

              <div className="shopping-focus-strip" aria-label="Resumen de compra actual">
                <article>
                  <span>Total</span>
                  <strong>{currency.format(totals.amount)}</strong>
                </article>
                <article>
                  <span>Pendientes</span>
                  <strong>{items.length - totals.checked}</strong>
                </article>
                <article>
                  <span>Comprados</span>
                  <strong>{totals.checked}</strong>
                </article>
              </div>

              {items.length === 0 ? (
                <div className="empty-state">
                  <ShoppingBasket size={40} aria-hidden="true" />
                  <strong>Lista vacia</strong>
                  <span>Agrega productos desde el catalogo.</span>
                </div>
              ) : (
                <div className="shopping-category-list">
                  {Object.entries(groupedListItems).map(([categoryName, categoryItems]) => (
                    <section className="shopping-category" key={categoryName} style={getCategoryStyle(categoryName)}>
                      <div className="shopping-category-head">
                        <strong>{categoryName}</strong>
                        <span>{categoryItems.filter((item) => item.checked).length}/{categoryItems.length}</span>
                      </div>
                      {categoryItems.map((item) => (
                        <article className={item.checked ? "shopping-item checked" : "shopping-item"} key={item.id}>
                          <button
                            className={item.checked ? "check-button checked" : "check-button"}
                            type="button"
                            onClick={() => updateItem(item.id, { checked: !item.checked })}
                            aria-label={item.checked ? `${item.name} comprado` : `Marcar ${item.name} como comprado`}
                          >
                            <Check size={16} aria-hidden="true" />
                          </button>
                          <div className="shopping-item-main">
                            <strong>{item.name}</strong>
                            {item.brand ? <span>{item.brand}</span> : null}
                          </div>
                          <div className="shopping-previous-price">
                            <span>Anterior</span>
                            <strong>
                              {previousPricesByProduct[item.productId] !== undefined
                                ? currency.format(previousPricesByProduct[item.productId])
                                : "Sin anterior"}
                            </strong>
                          </div>
                          <label className="shopping-current-price">
                            Actual
                            <input
                              value={itemPriceDrafts[item.id] ?? item.price}
                              onChange={(event) => updateItemPriceDraft(item.id, event.target.value)}
                              onBlur={() => {
                                const draftPrice = itemPriceDrafts[item.id];
                                if (draftPrice !== undefined && draftPrice !== "") {
                                  updateItem(item.id, { price: draftPrice });
                                  updateItemPriceDraft(item.id, undefined);
                                  return;
                                }

                                updateItemPriceDraft(item.id, undefined);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label={`Precio actual de ${item.name}`}
                            />
                          </label>
                          <input
                            className="quantity-input shopping-quantity"
                            value={item.quantity}
                            onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
                            type="number"
                            min="1"
                            aria-label={`Cantidad de ${item.name}`}
                          />
                        </article>
                      ))}
                    </section>
                  ))}
                </div>
              )}
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

              {priceTrendCards.length ? (
                <section className="price-trends">
                  <div className="section-head">
                    <strong>Tendencia por producto</strong>
                    <span>{priceTrendCards.length}</span>
                  </div>
                  <div className="trend-grid">
                    {priceTrendCards.map((entry) => (
                      <button
                        className={selectedTrendProductId === entry.productId ? "trend-card active" : "trend-card"}
                        key={`${entry.productId}-${entry.name}`}
                        type="button"
                        onClick={() => setSelectedTrendProductId(entry.productId)}
                      >
                        <div className="trend-card-head">
                          <div>
                            <strong>{entry.name}</strong>
                            <span>{entry.category}</span>
                          </div>
                          <span className={entry.difference >= 0 ? "trend-badge up" : "trend-badge down"}>
                            {entry.difference >= 0 ? "+" : ""}{entry.percent.toFixed(1)}%
                          </span>
                        </div>
                        <svg className="sparkline" viewBox="0 0 116 42" role="img" aria-label={`Tendencia de precio de ${entry.name}`}>
                          <polyline points={entry.points} />
                        </svg>
                        <div className="trend-values">
                          <span>Inicio {currency.format(entry.initialPrice)}</span>
                          <strong>{currency.format(entry.currentPrice)}</strong>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {selectedTrend ? (
                <section className="trend-detail">
                  <div className="trend-detail-head">
                    <div>
                      <p className="eyebrow">Grafica completa</p>
                      <h3>{selectedTrend.name}</h3>
                      <span>{selectedTrend.category} - {selectedTrend.count} registros</span>
                    </div>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => setSelectedTrendProductId(null)}
                      aria-label="Cerrar grafica detallada"
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  </div>
                  <svg className="detail-chart" viewBox="0 0 320 150" role="img" aria-label={`Grafica completa de ${selectedTrend.name}`}>
                    <line x1="0" y1="150" x2="320" y2="150" />
                    <line x1="0" y1="0" x2="0" y2="150" />
                    <polyline points={selectedTrend.chartPoints} />
                    {selectedTrend.timeline.map((point, index) => {
                      const [x, y] = selectedTrend.chartPointList[index]?.split(",") || ["0", "150"];
                      return <circle key={point.id} cx={x} cy={y} r="4" />;
                    })}
                  </svg>
                  <div className="trend-detail-stats">
                    <article>
                      <span>Inicial</span>
                      <strong>{currency.format(selectedTrend.initialPrice)}</strong>
                    </article>
                    <article>
                      <span>Actual</span>
                      <strong>{currency.format(selectedTrend.currentPrice)}</strong>
                    </article>
                    <article>
                      <span>Minimo</span>
                      <strong>{currency.format(selectedTrend.minPrice)}</strong>
                    </article>
                    <article>
                      <span>Maximo</span>
                      <strong>{currency.format(selectedTrend.maxPrice)}</strong>
                    </article>
                  </div>
                  <div className="trend-timeline">
                    {selectedTrend.timeline.map((point) => (
                      <article key={point.id}>
                        <span>{formatHistoryDate(point.changedAt)}</span>
                        <strong>{currency.format(point.price)}</strong>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {priceChartEntries.length ? (
                <section className="price-chart">
                  <div className="section-head">
                    <strong>Variacion de precios</strong>
                    <BarChart3 size={18} aria-hidden="true" />
                  </div>
                  <div className="chart-bars">
                    {priceChartEntries.map((entry) => {
                      const width = Math.min(100, Math.max(8, Math.abs(entry.percent)));
                      return (
                        <article key={entry.id}>
                          <div>
                            <strong>{entry.name}</strong>
                            <span>{entry.oldPrice === null ? "Inicial" : currency.format(entry.oldPrice)} a {currency.format(entry.newPrice)}</span>
                          </div>
                          <div className="bar-track">
                            <span
                              className={entry.difference >= 0 ? "up" : "down"}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <strong className={entry.difference >= 0 ? "up" : "down"}>
                            {entry.difference >= 0 ? "+" : ""}{currency.format(entry.difference)}
                          </strong>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

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
            className={activeView === "summary" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("summary")}
          >
            <LayoutDashboard size={20} aria-hidden="true" />
            Resumen
          </button>
          <button
            className={activeView === "catalog" ? "active" : ""}
            type="button"
            onClick={() => setActiveView("catalog")}
          >
            <PackagePlus size={20} aria-hidden="true" />
            Catalogo
          </button>
          <button
            className={activeView === "list" || activeView === "shopping" ? "active" : ""}
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

