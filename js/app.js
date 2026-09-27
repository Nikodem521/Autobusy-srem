/**
 * app.js — Profesjonalna wersja z modularną architekturą.
 * Rozwiązuje problemy z kierunkami, wyszukiwaniem i wydajnością.
 */

(() => {
  "use strict";

  // =====================================================================
  // 1. STATE - Centralne zarządzanie stanem aplikacji
  // =====================================================================
  const State = {
    route: {
      name: "home",
      param: null,
    },
    filters: {
      dayType: null,
      directionIdx: 0,
    },
    journey: {
      from: null,
      to: null,
      query: "",
    },
    ui: {
      theme: "system",
    },
    // Pobierz początkowe ustawienia
    init() {
      this.ui.theme = Storage.getTheme();
      const hash = location.hash || "#/";
      const parts = hash.replace(/^#\//, "").split("/").filter(Boolean);
      this.route.name = parts[0] || "home";
      this.route.param = parts[1] ? decodeURIComponent(parts[1]) : null;
    },
    setRoute(name, param = null) {
      this.route.name = name;
      this.route.param = param;
      location.hash = param ? `#/${name}/${encodeURIComponent(param)}` : `#/${name}`;
    },
  };

  // =====================================================================
  // 2. STORE - Zarządzanie danymi i indeksowaniem
  // =====================================================================
  const Store = (() => {
    const DATA = window.APP_DATA;
    let STOP_INDEX = new Map();

    function fold(str) {
      const MAP = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
      return str.toLowerCase().replace(/[ąćęłńóśźż]/g, (ch) => MAP[ch] || ch);
    }

    function buildStopIndex() {
      const index = new Map();
      DATA.lines.forEach((line) => {
        if (!line.hasSchedule) return;
        line.directions.forEach((dir, dirIdx) => {
          dir.stops.forEach((stop, stopIdx) => {
            const name = stop.name;
            if (!index.has(name)) index.set(name, []);
            index.get(name).push({
              lineId: line.id,
              lineName: line.name,
              dirIdx: dirIdx,
              dirLabel: dir.label,
              stopIdx: stopIdx,
              onRequest: /nż\.?$/i.test(name),
            });
          });
        });
      });
      return index;
    }

    STOP_INDEX = buildStopIndex();

    return {
      getLines: () => DATA.lines,
      getLineById: (id) => DATA.lines.find((l) => l.id === id),
      getStopOccurrences: (name) => STOP_INDEX.get(name) || [],
      getAllStopNames: () => Array.from(STOP_INDEX.keys()).sort((a, b) => a.localeCompare(b, "pl")),
      fold,
      getMeta: () => DATA.meta,
    };
  })();

  // =====================================================================
  // 3. SEARCH ENGINE - Inteligentne wyszukiwanie z wagami
  // =====================================================================
  const SearchEngine = {
    search(query) {
      if (!query || query.trim().length < 2) return [];
      const q = Store.fold(query.trim());
      const allNames = Store.getAllStopNames();

      const results = allNames
        .map((name) => {
          const foldedName = Store.fold(name);
          let score = 0;

          if (foldedName === q) score = 100;
          else if (foldedName.startsWith(q)) score = 50;
          else if (foldedName.includes(q)) score = 20;

          return { name, score };
        })
        .filter((res) => res.score > 0)
        .sort((a, b) => b.score - a.score);

      return results.map((res) => res.name);
    },
  };

  // =====================================================================
  // 4. CONNECTION ENGINE - Logika odjazdów i tras
  // =====================================================================
  const ConnectionEngine = {
    nextDeparture(lineId, dirIdx, stopIdx, dayType) {
      const line = Store.getLineById(lineId);
      if (!line) return null;
      const dir = line.directions[dirIdx];
      const schedule = dir.schedules[dayType];
      if (!schedule) return null;

      const nowMins = TimeUtils.nowMinutes();
      let best = null;

      schedule.trips.forEach((trip) => {
        const timeStr = trip.times[stopIdx];
        const mins = TimeUtils.toMinutes(timeStr);
        if (mins === null) return;

        if (mins >= nowMins && (best === null || mins < best.mins)) {
          best = { mins, raw: timeStr };
        }
      });
      return best;
    },

    findDirectConnections(fromName, toName) {
      const results = [];
      const lines = Store.getLines();

      lines.forEach((line) => {
        if (!line.hasSchedule) return;
        line.directions.forEach((dir, dirIdx) => {
          const fromIdxs = [];
          const toIdxs = [];

          dir.stops.forEach((s, i) => {
            if (s.name === fromName) fromIdxs.push(i);
            if (s.name === toName) toIdxs.push(i);
          });

          if (!fromIdxs.length || !toIdxs.length) return;

          Object.keys(dir.schedules).forEach((dayType) => {
            const schedule = dir.schedules[dayType];
            schedule.trips.forEach((trip) => {
              fromIdxs.forEach((fi) => {
                const depTime = trip.times[fi];
                if (depTime === null) return;

                // SZUKAMY TYLKO NAJBLIŻSZEGO PRZYSTANKU DOCELOWEGO PO WSIADANIU
                const ti = toIdxs.find(idx => idx > fi && trip.times[idx] !== null);

                if (ti !== undefined) {
                  results.push({
                    lineId: line.id,
                    lineName: line.name,
                    dirLabel: dir.label,
                    dayType,
                    dep: depTime,
                    arr: trip.times[ti],
                    isCircular: dir.label.toLowerCase().includes("okrężny"),
                  });
                }
              });
            });
          });
        });
      });
      return results;
    },
  };

  // =====================================================================
  // 5. UI COMPONENTS - Renderowanie fragmentów strony
  // =====================================================================
  const UI = {
    view: document.getElementById("view"),
    tabs: document.querySelectorAll(".tabbar button"),

    // Wspólne
    header(title, { back = false, fav = null } = {}) {
      return `
        <header class="topbar">
          ${back ? `<button class="icon-btn" data-action="back">${this.icons.back}</button>` : `<span class="topbar-spacer"></span>`}
          <h1>${this.escape(title)}</h1>
          ${fav !== null ? `<button class="icon-btn fav-btn ${fav ? "is-fav" : ""}" data-action="toggle-fav">${this.icons.heart(fav)}</button>` : `<span class="topbar-spacer"></span>`}
        </header>`;
    },

    icons: {
      back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      heart: (filled) => filled
        ? `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 21s-7.5-4.6-10-9.1C.4 8.6 2 5 5.6 5c2 0 3.4 1 4.4 2.4C11 6 12.4 5 14.4 5 18 5 19.6 8.6 22 11.9 19.5 16.4 12 21 12 21z"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><path d="M12 21s-7.5-4.6-10-9.1C.4 8.6 2 5 5.6 5c2 0 3.4 1 4.4 2.4C11 6 12.4 5 14.4 5 18 5 19.6 8.6 22 11.9 19.5 16.4 12 21 12 21z"/></svg>`,
      chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>`,
      close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>`,
      swap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path d="M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },

    escape(str) {
      return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    },

    dayTypeSwitcher(active, available) {
      const options = [
        { key: "workday", label: "Dni robocze" },
        { key: "saturday", label: "Sobota" },
      ].filter(o => available.includes(o.key));
      if (options.length < 2) return "";
      return `
        <div class="segmented" role="tablist">
          <span class="segmented-indicator"></span>
          ${options.map(o => `<button class="${o.key === active ? "is-active" : ""}" data-action="set-daytype" data-daytype="${o.key}">${o.label}</button>`).join("")}
        </div>`;
    },

    emptyState(title, body) {
      return `<div class="empty-state"><p class="empty-title">${this.escape(title)}</p><p class="empty-body">${this.escape(body)}</p></div>`;
    },

    // EKRANY
    renderHome() {
      const favs = Storage.getFavorites();
      const recents = Storage.getRecents().filter(n => !favs.includes(n));
      const favRoutes = Storage.getFavoriteRoutes();

      this.view.innerHTML = `
        <header class="topbar topbar--brand"><h1>Śremskie autobusy</h1></header>
        ${this.renderQuickAccess(favs, recents)}
        ${favRoutes.length ? this.renderFavoriteRoutes(favRoutes) : ""}
        <div class="section">
          <h2 class="section-title">Zaplanuj podróż</h2>
          <div id="journey-panel">${this.renderJourneyStep()}</div>
        </div>
        <div class="section">
          <button class="list-row list-row--link glass" data-action="go" data-href="#/lines">
            <span>Wszystkie linie</span><span class="chev">${this.icons.chevron}</span>
          </button>
        </div>`;
      this.wireJourneyInput();
    },

    renderQuickAccess(favs, recents) {
      if (!favs.length && !recents.length) return "";
      const sections = [];
      if (favs.length) sections.push(this.renderSection("Ulubione przystanki", favs.map(n => this.renderStopRow(n)).join("")));
      if (recents.length) sections.push(this.renderSection("Ostatnio sprawdzane", recents.map(n => this.renderStopRow(n)).join("")));
      return sections.join("");
    },

    renderFavoriteRoutes(routes) {
      return `
        <div class="section">
          <h2 class="section-title">Częste trasy</h2>
          <div class="list glass">
            ${routes.map(r => `
              <button class="list-row" data-action="use-fav-route" data-from="${this.escape(r.from)}" data-to="${this.escape(r.to)}">
                <span class="list-row-main">${this.escape(r.from)} → ${this.escape(r.to)}</span>
                <span class="chev">${this.icons.chevron}</span>
              </button>`).join("")}
          </div>
        </div>`;
    },

    renderJourneyStep() {
      if (!State.journey.from) return this.renderJourneyPicker("from", "Skąd jedziesz?");
      if (!State.journey.to) return this.renderJourneyChips() + this.renderJourneyPicker("to", "Dokąd jedziesz?");
      return this.renderJourneyChips() + this.renderConnections();
    },

    renderJourneyChips() {
      return `
        <div class="journey-chips">
          <button class="journey-chip" data-action="journey-edit" data-field="from">
            <span class="journey-chip-label">Skąd</span><span class="journey-chip-value">${this.escape(State.journey.from)}</span>
          </button>
          ${State.journey.to ? `
            <button class="journey-chip" data-action="journey-edit" data-field="to">
              <span class="journey-chip-label">Dokąd</span><span class="journey-chip-value">${this.escape(State.journey.to)}</span>
            </button>
            <button class="icon-btn journey-swap" data-action="swap-stops">${this.icons.swap}</button>` : ""}
        </div>`;
    },

    renderJourneyPicker(field, placeholder) {
      return `
        <div class="search-wrap glass">
          <span class="search-icon">${this.icons.search}</span>
          <input id="journey-input" type="text" inputmode="search" autocomplete="off" spellcheck="false"
                 placeholder="${placeholder}" value="${this.escape(State.journey.query)}" aria-label="${placeholder}">
          <button class="clear-btn ${State.journey.query ? "" : "is-hidden"}" data-action="clear-journey-input">${this.icons.close}</button>
        </div>
        <div id="journey-suggestions">${this.renderSuggestions(field)}</div>`;
    },

    renderSuggestions(field) {
      if (State.journey.query.trim().length < 2) return "";
      const matches = SearchEngine.search(State.journey.query);
      if (!matches.length) return this.emptyState(`Nie znaleziono „${this.escape(State.journey.query)}”`, "Sprawdź pisownię.");

      return this.renderSection(field === "from" ? "Wybierz przystanek początkowy" : "Wybierz przystanek docelowy",
        matches.map(n => `<button class="list-row" data-action="select-stop" data-field="${field}" data-name="${this.escape(n)}">
          <span class="list-row-main">${this.escape(n)}</span>
        </button>`).join("")
      );
    },

    renderConnections() {
      const from = State.journey.from;
      const to = State.journey.to;
      const today = TimeUtils.dayTypeForDate();

      // Jeśli jest niedziela/święto, od razu pokazujemy błąd i nie szukamy połączeń
      if (today === "unavailable") {
        return `<div class="banner">Rozkład nie obejmuje niedziel i świąt. Dzisiaj autobusy nie kursują.</div>` +
               this.emptyState("Brak kursów", "Wróć do wyszukiwania, aby sprawdzić inne dni.");
      }

      const conns = ConnectionEngine.findDirectConnections(from, to);
      const availableDayTypes = Array.from(new Set(conns.map(c => c.dayType)));

      if (!State.filters.dayType || !availableDayTypes.includes(State.filters.dayType)) {
        State.filters.dayType = availableDayTypes.includes(today) ? today : (availableDayTypes[0] || "workday");
      }

      const filtered = conns.filter(c => c.dayType === State.filters.dayType);
      const nowMins = TimeUtils.nowMinutes();

      const sorted = filtered
        .map(c => ({ c, mins: TimeUtils.toMinutes(c.dep) }))
        .sort((a, b) => a.mins - b.mins);

      const hero = sorted.find(x => x.mins !== null && x.mins >= nowMins);
      const isFavRoute = Storage.getFavoriteRoutes().some(r => r.from === from && r.to === to);

      return `
        ${this.dayTypeSwitcher(State.filters.dayType, availableDayTypes)}
        <div class="journey-fav-action" style="display: flex; justify-content: center; margin-bottom: 16px;">
          <button class="btn-secondary" style="border-radius: 999px; padding: 8px 16px; font-size: 13px;"
                  data-action="toggle-fav-route" data-from="${this.escape(from)}" data-to="${this.escape(to)}">
            ${isFavRoute ? "★ Usuń z częstych tras" : "☆ Dodaj do częstych tras"}
          </button>
        </div>
        ${conns.length === 0 ? this.emptyState("Brak połączeń", "Nie znaleziono bezpośredniego kursu między tymi przystankami.") :
          sorted.length === 0 ? this.emptyState("Brak kursów dziś", "Wybierz inny dzień.") : `
            ${hero ? this.renderConnHero(hero.c, hero.mins - nowMins) : ""}
            <div class="section">
              <h2 class="section-title">Wszystkie połączenia</h2>
              <div class="list glass">
                ${sorted.map(item => this.renderConnRow(item.c, item.mins, nowMins)).join("")}
              </div>
            </div>
        `}
      `;
    },

    renderConnHero(c, diff) {
      return `
        <button class="hero-card" data-action="go" data-href="#/line/${c.lineId}">
          <span class="hero-label">Najbliższe połączenie</span>
          <div class="hero-row">
            <span class="hero-line">${this.escape(c.lineName)}</span>
            <span class="hero-time">${c.dep} → ${c.arr}</span>
          </div>
          <div class="hero-row">
            <span class="hero-dir">${this.escape(c.dirLabel)}</span>
            <span class="hero-countdown">${TimeUtils.formatCountdown(diff)}</span>
          </div>
        </button>`;
    },

    renderConnRow(c, mins, nowMins) {
      const isPast = mins !== null && mins < nowMins;
      return `
        <button class="list-row list-row--stack ${isPast ? "is-muted" : ""} ${c.isCircular ? "conn-row--circular" : ""}" data-action="go" data-href="#/line/${c.lineId}">
          <div class="list-row-top">
            <span class="list-row-main">${this.escape(c.lineName)}</span>
            <span class="conn-times">${c.dep} → ${c.arr}</span>
          </div>
          <div class="list-row-sub">${this.escape(c.dirLabel)}</div>
        </button>`;
    },

    renderStop(name) {
      const occurrences = Store.getStopOccurrences(name);
      if (!occurrences.length) {
        this.view.innerHTML = this.header("Przystanek", { back: true }) + this.emptyState("Nie znaleziono", "Spróbuj wpisać nazwę ponownie.");
        return;
      }
      Storage.pushRecent(name);

      const today = TimeUtils.dayTypeForDate();
      const availableDayTypes = Array.from(new Set(occurrences.map(o => {
        const line = Store.getLineById(o.lineId);
        const dir = line.directions[o.dirIdx];
        return Object.keys(dir.schedules).join(",");
      }))).flatMap(s => s.split(","));

      if (!State.filters.dayType || !availableDayTypes.includes(State.filters.dayType)) {
        State.filters.dayType = availableDayTypes.includes(today) ? today : availableDayTypes[0];
      }

      const nowMins = TimeUtils.nowMinutes();

      const entries = occurrences.map(occ => {
        const line = Store.getLineById(occ.lineId);
        const dir = line.directions[occ.dirIdx];
        const schedule = dir.schedules[State.filters.dayType];

        let next = null;
        if (schedule) {
          schedule.trips.forEach(trip => {
            const t = trip.times[occ.stopIdx];
            const m = TimeUtils.toMinutes(t);
            if (m !== null && m >= nowMins && (next === null || m < next.mins)) {
              next = { mins: m, raw: t };
            }
          });
        }
        return { occ, line, dir, schedule, next };
      }).sort((a, b) => {
        if (a.next && b.next) return a.next.mins - b.next.mins;
        if (a.next) return -1;
        if (b.next) return 1;
        return a.line.name.localeCompare(b.line.name, "pl", { numeric: true });
      });

      const hero = entries.find(e => e.next);

      this.view.innerHTML = `
        ${this.header(name, { back: true, fav: Storage.isFavorite(name) })}
        ${today === "unavailable" ? `<div class="banner">Rozkład nie obejmuje niedziel i świąt.</div>` : ""}
        ${this.dayTypeSwitcher(State.filters.dayType, availableDayTypes)}
        ${hero ? this.renderHeroCard(hero) : (State.filters.dayType === today ? this.emptyState("Brak odjazdów dziś", "Sprawdź inny dzień.") : "")}
        <div class="section">
          <h2 class="section-title">Linie z tego przystanku</h2>
          <div class="list">
            ${entries.map(e => this.renderStopLineRow(e)).join("")}
          </div>
        </div>`;
    },

    renderHeroCard(e) {
      const diff = e.next.mins - TimeUtils.nowMinutes();
      return `
        <button class="hero-card" data-action="go" data-href="#/line/${e.occ.lineId}">
          <span class="hero-label">Najbliższy odjazd</span>
          <div class="hero-row">
            <span class="hero-line">${this.escape(e.line.name)}</span>
            <span class="hero-time">${e.next.raw}</span>
          </div>
          <div class="hero-row">
            <span class="hero-dir">${this.escape(e.occ.dirLabel)}</span>
            <span class="hero-countdown">${TimeUtils.formatCountdown(diff)}</span>
          </div>
        </button>`;
    },

    renderStopLineRow(e) {
      const times = e.schedule ? e.schedule.trips.map(t => t.times[e.occ.stopIdx]).filter(t => t !== null) : [];
      const nowMins = TimeUtils.nowMinutes();
      const chips = times.map(t => {
        const m = TimeUtils.toMinutes(t);
        const isPast = m !== null && m < nowMins;
        const isNext = e.next && t === e.next.raw;
        return `<span class="chip ${isPast ? "chip--past" : ""} ${isNext ? "chip--next" : ""}">${t}</span>`;
      }).join("");

      return `
        <button class="list-row list-row--stack" data-action="go" data-href="#/line/${e.occ.lineId}">
          <div class="list-row-top">
            <span class="list-row-main">${this.escape(e.line.name)}</span>
            ${e.occ.onRequest ? `<span class="tag">na żądanie</span>` : ""}
          </div>
          <div class="list-row-sub">${this.escape(e.occ.dirLabel)}</div>
          <div class="chip-row">${chips}</div>
        </button>`;
    },

    renderLine(id) {
      const line = Store.getLineById(id);
      if (!line) {
        this.view.innerHTML = this.header("Linia", { back: true }) + this.emptyState("Nie znaleziono", "");
        return;
      }
      if (!line.hasSchedule) {
        this.view.innerHTML = this.header(line.name, { back: true }) + this.emptyState("W przygotowaniu", "Dane zostaną uzupełnione wkrótce.");
        return;
      }

      if (State.filters.directionIdx >= line.directions.length) State.filters.directionIdx = 0;
      const dir = line.directions[State.filters.directionIdx];
      const today = TimeUtils.dayTypeForDate();
      const availableDayTypes = Object.keys(dir.schedules);

      if (!State.filters.dayType || !availableDayTypes.includes(State.filters.dayType)) {
        State.filters.dayType = availableDayTypes.includes(today) ? today : availableDayTypes[0];
      }

      const schedule = dir.schedules[State.filters.dayType];
      const nowMins = TimeUtils.nowMinutes();

      let nextTripIdx = -1;
      if (State.filters.dayType === today) {
        let bestStart = Infinity;
        schedule.trips.forEach((trip, i) => {
          const anyUpcoming = trip.times.some(t => {
            const m = TimeUtils.toMinutes(t);
            return m !== null && m >= nowMins;
          });
          if (anyUpcoming) {
            const firstReal = trip.times.find(t => t !== null);
            const mins = TimeUtils.toMinutes(firstReal);
            if (mins !== null && mins < bestStart) {
              bestStart = mins;
              nextTripIdx = i;
            }
          }
        });
      }

      const dirSwitcher = line.directions.length > 1
        ? `<div class="segmented" role="tablist">
             <span class="segmented-indicator"></span>
             ${line.directions.map((d, i) => `<button class="${i === State.filters.directionIdx ? "is-active" : ""}" data-action="set-dir" data-dir="${i}">${this.escape(d.label)}</button>`).join("")}
           </div>`
        : `<p class="route-label">${this.escape(dir.label)}</p>`;

      this.view.innerHTML = `
        ${this.header(line.name, { back: true })}
        ${today === "unavailable" ? `<div class="banner">Rozkład nie obejmuje niedziel i świąt.</div>` : ""}
        ${dirSwitcher}
        ${this.dayTypeSwitcher(State.filters.dayType, availableDayTypes)}
        <div class="table-scroll">
          <table class="timetable">
            <thead>
              <tr><th class="stopcol">Przystanek</th>
                ${schedule.trips.map((_, i) => `<th class="${i === nextTripIdx ? "is-next" : ""}">${i + 1}${schedule.trips[i].note ? "*" : ""}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${dir.stops.map((stop, stopIdx) => {
                const onReq = /nż\.?$/i.test(stop.name);
                return `
                <tr>
                  <th class="stopcol" scope="row">
                    <button class="stop-link" data-action="go" data-href="#/stop/${encodeURIComponent(stop.name)}">
                      ${this.escape(stop.name)}${onReq ? ` <span class="tag tag--sm">nż.</span>` : ""}
                    </button>
                  </th>
                  ${schedule.trips.map((trip, tripIdx) => {
                    const t = trip.times[stopIdx];
                    const mins = TimeUtils.toMinutes(t);
                    const isPast = State.filters.dayType === today && mins !== null && mins < nowMins;
                    const cls = [tripIdx === nextTripIdx ? "is-next" : "", isPast ? "is-past" : "", t === null ? "is-empty" : ""].filter(Boolean).join(" ");
                    return `<td class="${cls}">${t || "–"}</td>`;
                  }).join("")}
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        <p class="footnote">„–” oznacza brak obsługi przystanku w danym kursie.</p>
        ${schedule.trips.some(t => t.note) ? `<p class="footnote">${schedule.trips.map((t, i) => t.note ? `* kurs ${i + 1}: ${this.escape(t.note)}` : "").filter(Boolean).join("<br>")}</p>` : ""}`;
    },

    renderLines() {
      this.view.innerHTML = `
        ${this.header("Wszystkie linie")}
        <div class="section">
          <div class="list">
            ${Store.getLines().map(line => `
              <button class="list-row" data-action="go" data-href="#/line/${line.id}">
                <span class="list-row-main">${this.escape(line.name)}</span>
                ${line.hasSchedule ? `<span class="chev">${this.icons.chevron}</span>` : `<span class="tag">wkrótce</span>`}
              </button>`).join("")}
          </div>
        </div>`;
    },

    renderSettings() {
      const theme = Storage.getTheme();
      const meta = Store.getMeta();
      this.view.innerHTML = `
        ${this.header("Ustawienia")}
        <div class="section">
          <h2 class="section-title">Wygląd</h2>
          <div class="segmented segmented--full" role="tablist">
            <span class="segmented-indicator"></span>
            ${[{key:"system", label:"System"}, {key:"light", label:"Jasny"}, {key:"dark", label:"Ciemny"}]
              .map(o => `<button class="${o.key === theme ? "is-active" : ""}" data-action="set-theme" data-theme="${o.key}">${o.label}</button>`).join("")}
          </div>
        </div>
        <div class="section">
          <h2 class="section-title">O rozkładzie</h2>
          <div class="info-card">
            <div class="info-row"><span>Źródło</span><span>${this.escape(meta.source)}</span></div>
            <div class="info-row"><span>Ważny od</span><span>${meta.validFrom}</span></div>
            <div class="info-row"><span>Przygotowano</span><span>${meta.preparedAt}</span></div>
          </div>
          <p class="footnote">${this.escape(meta.note)}</p>
        </div>
        <div class="section">
          <button class="btn-secondary btn-full" data-action="clear-data">Wyczyść dane</button>
        </div>`;
    },

    renderSection(title, content) {
      return `<div class="section"><h2 class="section-title">${this.escape(title)}</h2><div class="list glass">${content}</div></div>`;
    },

    renderStopRow(name) {
      const isFav = Storage.isFavorite(name);
      return `
        <button class="list-row" data-action="go" data-href="#/stop/${encodeURIComponent(name)}">
          <span class="list-row-main">${this.escape(name)}</span>
          ${isFav ? `<span class="row-heart">${this.icons.heart(true)}</span>` : ""}
        </button>`;
    },

    wireJourneyInput() {
      const input = document.getElementById("journey-input");
      if (!input) return;
      const field = State.journey.from ? "to" : "from";
      input.addEventListener("input", (e) => {
        State.journey.query = e.target.value;
        const sugg = document.getElementById("journey-suggestions");
        if (sugg) sugg.innerHTML = this.renderSuggestions(field);
        const clearBtn = input.parentElement.querySelector(".clear-btn");
        if (clearBtn) clearBtn.classList.toggle("is-hidden", State.journey.query.length === 0);
      });
    },

    playTransition() {
      this.view.classList.remove("view-enter");
      void this.view.offsetWidth;
      this.view.classList.add("view-enter");
    },

    updateTabbar() {
      const map = { home: "home", lines: "lines", settings: "settings" };
      this.tabs.forEach(btn => {
        btn.classList.toggle("is-active", map[State.route.name] === btn.dataset.tab);
      });
      const indicator = document.querySelector(".tabbar-indicator");
      const activeBtn = document.querySelector(".tabbar button.is-active");
      if (indicator && activeBtn) {
        indicator.style.width = `${activeBtn.offsetWidth}px`;
        indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
      }
    },

    updateSegmented() {
      document.querySelectorAll(".segmented").forEach(seg => {
        const indicator = seg.querySelector(".segmented-indicator");
        const active = seg.querySelector("button.is-active");
        if (!indicator || !active) return;
        indicator.style.width = `${active.offsetWidth}px`;
        indicator.style.transform = `translateX(${active.offsetLeft}px)`;
      });
    },
  };

  // =====================================================================
  // 6. ROUTER & EVENT HANDLERS
  // =====================================================================
  function render() {
    const { name, param } = State.route;
    UI.updateTabbar();

    if (name === "home") UI.renderHome();
    else if (name === "stop") UI.renderStop(param);
    else if (name === "line") UI.renderLine(param);
    else if (name === "lines") UI.renderLines();
    else if (name === "settings") UI.renderSettings();
    else UI.renderHome();

    UI.playTransition();
    UI.updateSegmented();
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "go") {
      const href = el.dataset.href;
      const parts = href.replace(/^#\//, "").split("/").filter(Boolean);
      State.setRoute(parts[0], parts[1]);
      render();
    } else if (action === "back") {
      if (history.length > 1) history.back(); else State.setRoute("home"); render();
    } else if (action === "toggle-fav") {
      const name = State.route.param;
      const isFav = Storage.toggleFavorite(name);
      el.classList.toggle("is-fav", isFav);
      el.innerHTML = UI.icons.heart(isFav);
      showToast(isFav ? "Dodano do ulubionych" : "Usunięto z ulubionych");
    } else if (action === "set-daytype") {
      State.filters.dayType = el.dataset.daytype;
      render();
    } else if (action === "clear-journey-input") {
      State.journey.query = "";
      const input = document.getElementById("journey-input");
      if (input) input.value = "";
      el.classList.add("is-hidden");
      const sugg = document.getElementById("journey-suggestions");
      if (sugg) sugg.innerHTML = UI.renderSuggestions(State.journey.from ? "to" : "from");
    } else if (action === "select-stop") {
      State.journey.query = "";
      if (el.dataset.field === "from") {
        State.journey.from = el.dataset.name;
        State.journey.to = null;
      } else {
        State.journey.to = el.dataset.name;
      }
      render();
    } else if (action === "journey-edit") {
      State.journey.query = "";
      if (el.dataset.field === "from") {
        State.journey.from = null;
        State.journey.to = null;
      } else {
        State.journey.to = null;
      }
      render();
    } else if (action === "swap-stops") {
      const tmp = State.journey.from;
      State.journey.from = State.journey.to;
      State.journey.to = tmp;
      render();
    } else if (action === "set-dir") {
      State.filters.directionIdx = parseInt(el.dataset.dir, 10);
      render();
    } else if (action === "set-theme") {
      Storage.setTheme(el.dataset.theme);
      applyTheme();
      render();
    } else if (action === "clear-data") {
      if (confirm("Wyczyść wszystkie dane?")) { localStorage.clear(); render(); }
    } else if (action === "use-fav-route") {
      State.journey.from = el.dataset.from;
      State.journey.to = el.dataset.to;
      State.journey.query = "";
      render();
    } else if (action === "toggle-fav-route") {
      Storage.toggleFavoriteRoute(el.dataset.from, el.dataset.to);
      render();
    }
  });

  UI.tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = { home: "#/", lines: "#/lines", settings: "#/settings" }[btn.dataset.tab];
      location.hash = target;
    });
  });

  window.addEventListener("hashchange", () => {
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\//, "").split("/").filter(Boolean);
    State.route.name = parts[0] || "home";
    State.route.param = parts[1] ? decodeURIComponent(parts[1]) : null;
    render();
  });

  function showToast(text) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add("is-visible");
    setTimeout(() => toast.classList.remove("is-visible"), 3000);
  }

  function applyTheme() {
    const theme = Storage.getTheme();
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }

  // Start
  State.init();
  applyTheme();
  render();
  setInterval(render, 30000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
