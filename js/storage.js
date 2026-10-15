/**
 * storage.js — trwałe preferencje użytkownika w localStorage.
 * Każdy odczyt/zapis jest opakowany w try/catch: Safari w trybie
 * prywatnym potrafi rzucić wyjątek przy zapisie, a wtedy aplikacja
 * ma dalej działać, tylko bez zapamiętywania.
 */

const Storage = (() => {
  const KEYS = {
    favorites: "srem-bus:favorites",
    recents: "srem-bus:recents",
    theme: "srem-bus:theme",
    favoriteRoutes: "srem-bus:fav-routes",
  };


  const MAX_RECENTS = 8;

  function safeGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Napraw polskie znaki zapisane wcześniej po błędnym odczycie UTF-8.
  // Przykład: „PiĹ‚sudskiego” → „Piłsudskiego”.
  function fixPolishEncoding(value) {
    if (typeof value !== "string") return value;
    const replacements = [
      ["Ĺ‚", "ł"], ["Ĺ", "Ł"], ["Ĺ„", "ń"], ["Ĺƒ", "Ń"],
      ["Ĺ›", "ś"], ["Ĺš", "Ś"], ["Ĺş", "ź"], ["Ĺą", "Ź"],
      ["ĹĽ", "ż"], ["Ĺť", "Ż"], ["Ä…", "ą"], ["Ä„", "Ą"],
      ["Ä‡", "ć"], ["Ä†", "Ć"], ["Ä™", "ę"], ["Ä˜", "Ę"],
      ["Ăł", "ó"], ["Ă“", "Ó"], ["Å‚", "ł"], ["Å", "Ł"],
      ["Å›", "ś"], ["Åš", "Ś"], ["Åº", "ź"], ["Å¹", "Ź"],
      ["Å¼", "ż"], ["Å»", "Ż"], ["Å„", "ń"], ["Åƒ", "Ń"],
    ];
    return replacements.reduce((text, [broken, corrected]) => text.split(broken).join(corrected), value);
  }

  function normalizeStringList(key) {
    const values = safeGet(key, []);
    if (!Array.isArray(values)) return [];
    const fixed = values.map(fixPolishEncoding);
    if (fixed.some((value, index) => value !== values[index])) safeSet(key, fixed);
    return fixed;
  }

  // ---- Ulubione trasy (Skąd → Dokąd) ----
  function getFavoriteRoutes() {
    const routes = safeGet(KEYS.favoriteRoutes, []);
    if (!Array.isArray(routes)) return [];
    let changed = false;
    const fixed = routes.map((route) => {
      if (!route || typeof route !== "object") return route;
      const from = fixPolishEncoding(route.from);
      const to = fixPolishEncoding(route.to);
      if (from === route.from && to === route.to) return route;
      changed = true;
      return { ...route, id: `${from}|${to}`, from, to };
    });
    if (changed) safeSet(KEYS.favoriteRoutes, fixed);
    return fixed;
  }

  function toggleFavoriteRoute(from, to) {
    const favs = getFavoriteRoutes();
    const routeId = `${from}|${to}`;
    const idx = favs.findIndex((r) => r.id === routeId);
    if (idx === -1) {
      favs.unshift({ id: routeId, from, to });
    } else {
      favs.splice(idx, 1);
    }
    safeSet(KEYS.favoriteRoutes, favs);
    return favs.some((r) => r.id === routeId);
  }

  // ---- Ulubione przystanki (lista nazw) ----

  function getFavorites() {
    return normalizeStringList(KEYS.favorites);
  }

  function isFavorite(stopName) {
    return getFavorites().includes(stopName);
  }

  function toggleFavorite(stopName) {
    const favs = getFavorites();
    const idx = favs.indexOf(stopName);
    if (idx === -1) {
      favs.unshift(stopName);
    } else {
      favs.splice(idx, 1);
    }
    safeSet(KEYS.favorites, favs);
    return favs.includes(stopName);
  }

  // ---- Ostatnio używane przystanki ----
  function getRecents() {
    return normalizeStringList(KEYS.recents);
  }

  function pushRecent(stopName) {
    let recents = getRecents().filter((n) => n !== stopName);
    recents.unshift(stopName);
    recents = recents.slice(0, MAX_RECENTS);
    safeSet(KEYS.recents, recents);
  }

  // ---- Motyw: 'system' | 'light' | 'dark' ----
  function getTheme() {
    return safeGet(KEYS.theme, "system");
  }

  function setTheme(theme) {
    safeSet(KEYS.theme, theme);
  }

  return {
    getFavorites,
    isFavorite,
    toggleFavorite,
    getFavoriteRoutes,
    toggleFavoriteRoute,
    getRecents,
    pushRecent,
    getTheme,
    setTheme,
  };

})();
