(() => {
  "use strict";

  const STORAGE_KEY = "tsundoku-data";
  const STATUS_LABELS = { "to-read": "À lire", reading: "En cours", done: "Terminé" };

  // Open Library sometimes catalogs the same real author under several
  // distinct author records (different OL id, different partial
  // bibliography). We track authors by a slug of their name instead of by
  // OL id, so adding a second search result for an already-tracked author
  // merges its books in rather than creating a duplicate entry.
  function authorSlug(name) {
    return (name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Libraries and bookshops shelve fiction by the author's surname, not
  // their given name \u2014 "Eddings, David" under E, not D. We keep the name
  // as fetched (e.g. "David Eddings") for display, but sort and index by
  // its last word.
  function authorSurname(name) {
    const parts = (name || "").trim().split(/\s+/);
    return parts[parts.length - 1] || "";
  }

  function librarySortKey(name) {
    const parts = (name || "").trim().split(/\s+/);
    if (parts.length < 2) return name || "";
    return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`;
  }

  function surnameInitial(name) {
    const s = authorSurname(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return s ? s[0].toUpperCase() : "#";
  }

  // ---------- Storage ----------

  function migrateAuthors(authors) {
    const migrated = {};
    for (const old of Object.values(authors || {})) {
      if (!old || !old.name) continue;
      const slug = authorSlug(old.name);
      const olKeys = old.olKeys || (old.key ? [old.key] : []);
      if (!migrated[slug]) {
        migrated[slug] = {
          key: slug,
          name: old.name,
          olKeys: [...olKeys],
          addedAt: old.addedAt || new Date().toISOString(),
          books: { ...(old.books || {}) },
        };
      } else {
        const target = migrated[slug];
        for (const k of olKeys) if (!target.olKeys.includes(k)) target.olKeys.push(k);
        for (const [bk, bv] of Object.entries(old.books || {})) if (!target.books[bk]) target.books[bk] = bv;
      }
    }
    return migrated;
  }

  function defaultSettings() {
    return { googleBooksApiKey: "", autoBackup: true, lastAutoBackup: null };
  }

  function emptyData() {
    return { version: 1, authors: {}, settings: defaultSettings() };
  }

  // Shared by loading from localStorage and by restoring an imported backup
  // file, so an older/partial JSON shape gets the same defaulting either way.
  function normalizeData(parsed) {
    if (!parsed || typeof parsed !== "object" || !parsed.authors || typeof parsed.authors !== "object") {
      throw new Error("Format de données invalide");
    }
    parsed.authors = migrateAuthors(parsed.authors);
    parsed.settings = { ...defaultSettings(), ...(parsed.settings || {}) };
    if (!parsed.version) parsed.version = 1;
    return parsed;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyData();
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      console.error("Lecture des données impossible, réinitialisation.", e);
      return emptyData();
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      // Safari in private/incognito mode (and a full storage quota) makes
      // localStorage.setItem throw instead of failing silently — without
      // this, nothing would warn the user that nothing is being saved.
      console.error("Échec de la sauvegarde", err);
      toast("Impossible d'enregistrer (navigation privée ou stockage plein ?)");
    }
  }

  let data = loadData();

  // Browser storage (localStorage) can be wiped by the browser itself — a
  // "clear data on close" privacy setting, switching devices, reinstalling
  // the browser. A downloaded backup file lives in the phone's own Fichiers/
  // Downloads storage instead, which none of that touches.
  function exportData(auto) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tsundoku-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(auto ? "Sauvegarde automatique téléchargée" : "Sauvegarde téléchargée");
  }

  // Downloads a fresh backup on its own, at most once a day, whenever the
  // app is opened — the closest thing to "automatic" a static site without
  // a server can offer (nothing runs while the app isn't open).
  const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  function maybeAutoBackup() {
    if (!data.settings.autoBackup) return;
    if (Object.keys(data.authors).length === 0) return;
    const last = data.settings.lastAutoBackup;
    if (last && Date.now() - new Date(last).getTime() < AUTO_BACKUP_INTERVAL_MS) return;
    exportData(true);
    data.settings.lastAutoBackup = new Date().toISOString();
    saveData();
  }

  function importDataFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = normalizeData(JSON.parse(reader.result));
      } catch (err) {
        console.error(err);
        toast("Fichier de sauvegarde invalide");
        return;
      }
      const authorCount = Object.keys(parsed.authors).length;
      if (!confirm(`Remplacer votre bibliothèque actuelle par cette sauvegarde (${authorCount} auteur(s)) ? Cette action est irréversible.`)) {
        return;
      }
      data = parsed;
      saveData();
      location.hash = "#/";
      renderHomeView();
      toast("Bibliothèque restaurée");
    };
    reader.onerror = () => toast("Impossible de lire le fichier");
    reader.readAsText(file);
  }

  // ---------- Open Library API ----------

  async function searchAuthors(query) {
    const url = `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=8`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Recherche indisponible");
    const json = await res.json();
    return json.docs || [];
  }

  async function fetchAuthorWorks(authorKey) {
    // search.json merges editions/translations into one record per work (unlike
    // /authors/{id}/works.json, which lists every translated edition as its own
    // near-duplicate entry) — much cleaner starting list to curate.
    // language=fre keeps only works that have at least one French edition.
    const fields = "key,title,first_publish_year,cover_i,edition_count";
    const url = `https://openlibrary.org/search.json?author_key=${encodeURIComponent(authorKey)}&language=fre&limit=500&fields=${fields}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Impossible de récupérer les romans");
    const json = await res.json();
    return (json.docs || []).filter((w) => w.title && w.key);
  }

  // Google Books requires an API key for any request (anonymous calls get a
  // 0 daily quota). Used only as an opt-in complement: when a key is set in
  // Réglages, we try it first for a French title/synopsis before falling
  // back to Open Library's (usually English) description.
  async function fetchGoogleBooksFr(title, authorName) {
    const key = data.settings.googleBooksApiKey;
    if (!key) return null;
    const q = `intitle:${title} inauthor:${authorName}`;
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=fr&maxResults=1&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const info = json.items && json.items[0] && json.items[0].volumeInfo;
    return info || null;
  }

  function normalizeTitle(t) {
    return (t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  // ---------- Cover art ----------
  // Real Open Library cover when we have one; otherwise a generated
  // "library catalog" placeholder card so the grid never shows a broken image.

  // Same four spine colors as the app icon's stack of books.
  const PALETTES = [
    { from: "#2F4D72", to: "#1E3350", rule: "#EFE5D2" },
    { from: "#405B47", to: "#2A3F30", rule: "#EFE5D2" },
    { from: "#C34A2E", to: "#8E3220", rule: "#EFE5D2" },
    { from: "#C7A06C", to: "#9C7A4A", rule: "#242C3D" },
  ];

  function paletteFor(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return PALETTES[h % PALETTES.length];
  }

  function wrapTitle(title, max) {
    const words = title.split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = (cur + " " + w).trim();
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 5);
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function displayTitle(book) {
    return book.customTitle || book.titleFr || book.title;
  }

  function placeholderCover(book) {
    const p = paletteFor(book.key);
    const lines = wrapTitle(displayTitle(book), 11);
    const tspans = lines.map((l, i) => `<tspan x="20" dy="${i === 0 ? 0 : 25}">${escapeXml(l)}</tspan>`).join("");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/>` +
      `</linearGradient></defs>` +
      `<rect width="200" height="300" fill="url(#g)"/>` +
      `<rect x="13" y="13" width="174" height="274" fill="none" stroke="${p.rule}" stroke-width="1.4" opacity=".55"/>` +
      `<text x="20" y="52" font-family="Georgia,serif" font-size="19" font-weight="600" fill="${p.rule}">${tspans}</text>` +
      `</svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function coverSrc(book, size) {
    if (book.coverId) return `https://covers.openlibrary.org/b/id/${book.coverId}-${size || "M"}.jpg`;
    return placeholderCover(book);
  }

  // ---------- Helpers ----------

  function newBookEntry(work) {
    return {
      key: work.key,
      title: work.title,
      year: work.first_publish_year ? String(work.first_publish_year) : "",
      coverId: work.cover_i || null,
      editions: work.edition_count || null,
      owned: false,
      status: "to-read",
      series: "",
      customTitle: "",
      rating: null,
      review: "",
    };
  }

  function authorStats(author) {
    const books = Object.values(author.books || {});
    const total = books.length;
    const owned = books.filter((b) => b.owned).length;
    const done = books.filter((b) => b.status === "done").length;
    return { total, owned, done };
  }

  function sortBooksByYear(books) {
    return books.slice().sort((a, b) => {
      if (a.year && b.year && a.year !== b.year) return a.year.localeCompare(b.year);
      if (a.year && !b.year) return -1;
      if (!a.year && b.year) return 1;
      return displayTitle(a).localeCompare(displayTitle(b), "fr", { sensitivity: "base" });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  let toastTimer = null;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ---------- Router ----------

  const app = document.getElementById("app");

  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, "");
    if (!hash) return { view: "home" };
    if (hash === "reglages") return { view: "settings" };
    const m = hash.match(/^author\/(.+)$/);
    if (m) return { view: "author", key: decodeURIComponent(m[1]) };
    return { view: "home" };
  }

  function navigate(hash) {
    location.hash = hash;
  }

  window.addEventListener("hashchange", render);

  function render() {
    closeDetail();
    const route = currentRoute();
    if (route.view === "author" && data.authors[route.key]) {
      renderAuthorView(route.key);
    } else if (route.view === "settings") {
      renderSettingsView();
    } else {
      renderHomeView();
    }
  }

  // ---------- Home view ----------

  let onlyMissingHome = false;

  function renderHomeView() {
    currentAuthorKey = null;
    const authors = Object.values(data.authors).sort((a, b) =>
      librarySortKey(a.name).localeCompare(librarySortKey(b.name), "fr", { sensitivity: "base" })
    );

    app.innerHTML = "";

    if (authors.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        '<div class="big">📚</div><p>Aucun auteur suivi pour l\'instant.<br>Utilisez la recherche en haut pour en ajouter un.</p>';
      app.appendChild(empty);
      return;
    }

    const layout = document.createElement("div");
    layout.className = "library-layout";

    const main = document.createElement("div");
    main.className = "library-main";

    const rail = document.createElement("div");
    rail.className = "rail";
    rail.innerHTML = `<button type="button" class="chip${onlyMissingHome ? " active" : ""}" id="only-missing-chip">Afficher seulement ce qu'il me manque</button>`;
    rail.querySelector("#only-missing-chip").addEventListener("click", (e) => {
      onlyMissingHome = !onlyMissingHome;
      e.currentTarget.classList.toggle("active", onlyMissingHome);
      renderHomeView();
    });
    main.appendChild(rail);

    for (const author of authors) main.appendChild(buildLibrarySection(author));

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-author-banner";
    addBtn.innerHTML = '<span class="ghost-plus">+</span>Rechercher un nouvel auteur';
    addBtn.addEventListener("click", () => searchInput.focus());
    main.appendChild(addBtn);

    layout.appendChild(main);

    // Libraries shelve by surname — jump straight to a letter, same as a
    // bookshop's shelf-end labels, instead of scrolling past everything.
    if (authors.length >= 5) {
      const present = new Set(authors.map((a) => surnameInitial(a.name)));
      const nav = document.createElement("nav");
      nav.className = "az-index";
      nav.setAttribute("aria-label", "Aller à la lettre");
      for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const has = present.has(letter);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = letter;
        btn.disabled = !has;
        if (has) {
          btn.addEventListener("click", () => {
            const target = document.querySelector(`.library-section[data-letter="${letter}"]`);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
        nav.appendChild(btn);
      }
      layout.appendChild(nav);
    }

    app.appendChild(layout);

    // Silently check for new releases from authors we haven't checked
    // recently, and drop them into the page without disturbing the reader.
    for (const author of authors) {
      if (!isStale(author)) continue;
      mergeAuthorWorks(author)
        .then((added) => {
          if (added > 0 && currentRoute().view === "home") {
            const old = document.querySelector(`.library-section[data-author="${author.key}"]`);
            if (old) old.replaceWith(buildLibrarySection(author));
            toast(`${added} nouveau(x) roman(s) détecté(s) pour ${author.name}`);
          }
        })
        .catch(() => {});
    }

    maybeAutoBackup();
  }

  function buildLibrarySection(author) {
    const stats = authorStats(author);

    const section = document.createElement("section");
    section.className = "library-section";
    section.dataset.author = author.key;
    section.dataset.letter = surnameInitial(author.name);

    const head = document.createElement("div");
    head.className = "library-section-head";
    const link = document.createElement("a");
    link.className = "library-section-title";
    link.href = `#/author/${encodeURIComponent(author.key)}`;
    link.textContent = author.name;
    head.appendChild(link);
    const statsWrap = document.createElement("div");
    statsWrap.className = "author-stats";
    statsWrap.innerHTML = `
      <div class="astat"><b>${stats.owned}/${stats.total}</b><br>possédés</div>
      <div class="astat"><b>${stats.done}/${stats.total}</b><br>terminés</div>
    `;
    head.appendChild(statsWrap);
    section.appendChild(head);

    let books = sortBooksByYear(Object.values(author.books || {}));
    if (onlyMissingHome) books = books.filter((b) => !b.owned);

    if (books.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = onlyMissingHome && stats.total > 0
        ? "<p>Vous possédez déjà tous les romans suivis de cet auteur 🎉</p>"
        : "<p>Aucun roman trouvé pour cet auteur.</p>";
      section.appendChild(empty);
    } else {
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const b of books) grid.appendChild(buildBookCard(b, author));
      section.appendChild(grid);
    }

    return section;
  }

  // ---------- Settings view ----------

  function renderSettingsView() {
    currentAuthorKey = null;
    app.innerHTML = `
      <div class="crumbs"><a href="#/">Bibliothèque</a><span>›</span><span>Réglages</span></div>
      <div class="section-title">Réglages</div>

      <p class="d-label">Sauvegarde</p>
      <p class="settings-help">
        Vos données ne vivent que dans ce navigateur — un réglage « effacer les données à la
        fermeture », un changement de téléphone ou de navigateur peut les faire disparaître.
        Exportez régulièrement un fichier de sauvegarde (il est enregistré dans vos fichiers/
        téléchargements, à l'abri de ça) pour pouvoir tout restaurer en cas de besoin.
      </p>
      <div class="author-actions">
        <button type="button" class="btn btn-primary" id="btn-export">📤 Exporter ma bibliothèque</button>
        <button type="button" class="btn" id="btn-import">📥 Importer une sauvegarde</button>
        <input type="file" id="import-file" accept="application/json" hidden>
      </div>
      <label class="owned-toggle" style="margin-top:12px">
        <input type="checkbox" id="auto-backup-toggle">
        Télécharger automatiquement une sauvegarde à l'ouverture de l'app (au plus une fois par jour)
      </label>

      <p class="d-label" style="margin-top:28px">Google Books (optionnel)</p>
      <p class="settings-help">
        Optionnel : ajoutez une clé API Google Books pour obtenir automatiquement le titre et le
        résumé en français d'un roman quand Open Library ne les a pas (son résumé est souvent en
        anglais). Sans clé, l'appli continue de fonctionner normalement, juste avec les résumés
        d'Open Library.<br><br>
        Pour en obtenir une gratuitement : ouvrez
        <a href="https://console.cloud.google.com/apis/library/books.googleapis.com" target="_blank" rel="noopener">console.cloud.google.com → API Books</a>,
        cliquez sur « Activer », puis créez une clé dans « Identifiants ».
      </p>
      <form class="settings-form" id="settings-form">
        <label for="gb-key">Clé API Google Books</label>
        <input type="text" id="gb-key" placeholder="AIza…" autocomplete="off">
        <div class="author-actions">
          <button type="submit" class="btn btn-primary">Enregistrer</button>
          <button type="button" class="btn" id="btn-clear-key">Retirer la clé</button>
        </div>
      </form>
    `;

    const input = document.getElementById("gb-key");
    input.value = data.settings.googleBooksApiKey || "";

    // Auto-save like every other field in the app, so leaving the page
    // without clicking "Enregistrer" doesn't silently lose the key.
    let keyTimer = null;
    input.addEventListener("input", () => {
      clearTimeout(keyTimer);
      const value = input.value.trim();
      keyTimer = setTimeout(() => {
        data.settings.googleBooksApiKey = value;
        saveData();
      }, 400);
    });

    document.getElementById("settings-form").addEventListener("submit", (e) => {
      e.preventDefault();
      clearTimeout(keyTimer);
      data.settings.googleBooksApiKey = input.value.trim();
      saveData();
      toast("Réglages enregistrés");
    });

    document.getElementById("btn-clear-key").addEventListener("click", () => {
      clearTimeout(keyTimer);
      input.value = "";
      data.settings.googleBooksApiKey = "";
      saveData();
      toast("Clé retirée");
    });

    document.getElementById("btn-export").addEventListener("click", () => exportData(false));
    const importFile = document.getElementById("import-file");
    document.getElementById("btn-import").addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", () => {
      if (importFile.files[0]) importDataFromFile(importFile.files[0]);
      importFile.value = "";
    });

    const autoBackupToggle = document.getElementById("auto-backup-toggle");
    autoBackupToggle.checked = data.settings.autoBackup;
    autoBackupToggle.addEventListener("change", () => {
      data.settings.autoBackup = autoBackupToggle.checked;
      saveData();
    });
  }

  // ---------- Author view ----------

  let currentAuthorKey = null;
  let groupMode = "none";
  let onlyOwned = false;
  let sortBy = "year";
  let withinQuery = "";

  function renderAuthorView(authorKey) {
    currentAuthorKey = authorKey;
    groupMode = "none";
    onlyOwned = false;
    sortBy = "year";
    withinQuery = "";
    const author = data.authors[authorKey];

    app.innerHTML = `
      <div class="crumbs"><a href="#/">Bibliothèque</a><span>›</span><span id="crumb-author"></span></div>
      <div class="author-head">
        <h2 id="author-name"></h2>
        <div class="author-stats">
          <div class="astat"><b id="stat-owned"></b><br>possédés</div>
          <div class="astat"><b id="stat-done"></b><br>terminés</div>
          <div class="astat"><b id="stat-total"></b><br>au catalogue</div>
        </div>
      </div>
      <div class="author-actions">
        <button type="button" class="btn" id="btn-refresh">🔄 Actualiser la liste</button>
        <button type="button" class="btn btn-danger" id="btn-delete-author">🗑 Supprimer cet auteur</button>
      </div>
      <div class="rail">
        <div class="rail-group">
          <span class="rail-label">Ranger par</span>
          <div class="seg" id="group-seg">
            <button type="button" class="active" data-group="none">Grille</button>
            <button type="button" data-group="series">Série</button>
            <button type="button" data-group="status">Statut</button>
            <button type="button" data-group="possession">Possession</button>
          </div>
        </div>
        <div class="rail-group">
          <button type="button" class="chip" id="owned-chip">Possédés uniquement</button>
          <select class="sortsel" id="sort-sel">
            <option value="year">Trier : année</option>
            <option value="title">Trier : titre</option>
            <option value="rating">Trier : note</option>
          </select>
          <input type="text" class="rail-search" id="within-search" placeholder="Filtrer un titre…">
        </div>
      </div>
      <div id="book-area"></div>
    `;

    document.getElementById("author-name").textContent = author.name;
    document.getElementById("crumb-author").textContent = author.name;

    renderBookArea(author);

    document.getElementById("btn-refresh").addEventListener("click", () => refreshAuthorWorks(authorKey));
    document.getElementById("btn-delete-author").addEventListener("click", () => deleteAuthor(authorKey));

    document.getElementById("group-seg").addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      groupMode = btn.dataset.group;
      document.querySelectorAll("#group-seg button").forEach((b) => b.classList.toggle("active", b === btn));
      renderBookArea(author);
    });
    document.getElementById("owned-chip").addEventListener("click", (e) => {
      onlyOwned = !onlyOwned;
      e.currentTarget.classList.toggle("active", onlyOwned);
      renderBookArea(author);
    });
    document.getElementById("sort-sel").addEventListener("change", (e) => {
      sortBy = e.target.value;
      renderBookArea(author);
    });
    document.getElementById("within-search").addEventListener("input", (e) => {
      withinQuery = e.target.value;
      renderBookArea(author);
    });

    if (isStale(author)) {
      mergeAuthorWorks(author)
        .then((added) => {
          if (added > 0 && currentAuthorKey === authorKey) {
            renderBookArea(author);
            toast(`${added} nouveau(x) roman(s) détecté(s)`);
          }
        })
        .catch(() => {});
    }
  }

  function filteredSortedBooks(author) {
    let books = Object.values(author.books || {});
    if (onlyOwned) books = books.filter((b) => b.owned);
    if (withinQuery) {
      const q = withinQuery.toLowerCase();
      books = books.filter((b) => displayTitle(b).toLowerCase().includes(q) || b.title.toLowerCase().includes(q));
    }
    if (sortBy === "rating") {
      books = books.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === "title") {
      books = books.slice().sort((a, b) => displayTitle(a).localeCompare(displayTitle(b), "fr", { sensitivity: "base" }));
    } else {
      books = sortBooksByYear(books);
    }
    return books;
  }

  function renderBookArea(author) {
    const stats = authorStats(author);
    document.getElementById("stat-owned").textContent = stats.owned + "/" + stats.total;
    document.getElementById("stat-done").textContent = stats.done + "/" + stats.total;
    document.getElementById("stat-total").textContent = stats.total;

    const area = document.getElementById("book-area");
    const books = filteredSortedBooks(author);

    if (books.length === 0) {
      area.innerHTML = Object.keys(author.books || {}).length
        ? '<div class="empty-state"><p>Aucun roman ne correspond à ces filtres.</p></div>'
        : '<div class="empty-state"><p>Aucun roman trouvé pour cet auteur.</p></div>';
      return;
    }

    area.innerHTML = "";

    if (groupMode === "none") {
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const b of books) grid.appendChild(buildBookCard(b, author));
      area.appendChild(grid);
      return;
    }

    const keyFn =
      groupMode === "series"
        ? (b) => (b.series || "").trim() || "Sans série"
        : groupMode === "possession"
        ? (b) => (b.owned ? "Possédés" : "Pas encore possédés")
        : (b) => STATUS_LABELS[b.status];
    const order =
      groupMode === "status"
        ? ["À lire", "En cours", "Terminé"]
        : groupMode === "possession"
        ? ["Possédés", "Pas encore possédés"]
        : null;
    const groups = new Map();
    for (const b of books) {
      const k = keyFn(b);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    let names = [...groups.keys()];
    names.sort(
      order
        ? (x, y) => order.indexOf(x) - order.indexOf(y)
        : (x, y) => (x === "Sans série" ? 1 : y === "Sans série" ? -1 : x.localeCompare(y, "fr", { sensitivity: "base" }))
    );

    for (const name of names) {
      const heading = document.createElement("div");
      heading.className = "group-heading";
      heading.innerHTML = `${escapeHtml(name)} <span>${groups.get(name).length}</span>`;
      area.appendChild(heading);
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const b of groups.get(name)) grid.appendChild(buildBookCard(b, author));
      area.appendChild(grid);
    }
  }

  function buildBookCard(book, author) {
    const tpl = document.getElementById("tpl-book-card");
    const node = tpl.content.cloneNode(true);
    const btn = node.querySelector(".card");
    node.querySelector(".card-cover img").src = coverSrc(book, "M");
    node.querySelector(".ribbon").hidden = !book.owned;
    const stamp = node.querySelector(".stamp");
    stamp.textContent = STATUS_LABELS[book.status];
    stamp.dataset.status = book.status;
    node.querySelector(".card-title").textContent = displayTitle(book);
    const metaBits = [book.year || "Année inconnue"];
    if (book.editions) metaBits.push(`${book.editions} éd.`);
    node.querySelector(".card-meta").textContent = metaBits.join(" · ");
    node.querySelector(".card-stars").innerHTML = [1, 2, 3, 4, 5]
      .map((v) => `<span class="${v <= (book.rating || 0) ? "on" : ""}">★</span>`)
      .join("");
    btn.addEventListener("click", () => openDetail(book.key, author.key));
    return btn;
  }

  // How long a author's list is trusted before we silently re-check Open
  // Library for new releases (see renderHomeView / renderAuthorView).
  const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

  function isStale(author) {
    if (!author.lastChecked) return true;
    return Date.now() - new Date(author.lastChecked).getTime() > REFRESH_INTERVAL_MS;
  }

  // An author can have several OL ids (Open Library sometimes splits one
  // real author into multiple records) — check all of them and merge in
  // anything new. Shared by the manual "Actualiser" button and the silent
  // background check.
  async function mergeAuthorWorks(author) {
    const results = await Promise.all(author.olKeys.map((k) => fetchAuthorWorks(k).catch(() => [])));
    let added = 0;
    for (const works of results) {
      for (const w of works) {
        if (!author.books[w.key]) {
          author.books[w.key] = newBookEntry(w);
          added++;
        }
      }
    }
    author.lastChecked = new Date().toISOString();
    saveData();
    return added;
  }

  function refreshAuthorWorks(authorKey) {
    const author = data.authors[authorKey];
    toast("Actualisation…");
    mergeAuthorWorks(author)
      .then((added) => {
        renderBookArea(author);
        toast(added ? `${added} nouveau(x) roman(s) ajouté(s)` : "Aucun nouveau roman");
      })
      .catch((err) => {
        console.error(err);
        toast("Échec de l'actualisation (hors ligne ?)");
      });
  }

  function deleteAuthor(authorKey) {
    const author = data.authors[authorKey];
    if (!confirm(`Supprimer « ${author.name} » et toutes les données associées ?`)) return;
    delete data.authors[authorKey];
    saveData();
    navigate("#/");
  }

  // ---------- Detail panel ----------

  const detailPanel = document.getElementById("detail");
  const backdropEl = document.getElementById("backdrop");
  let detailAuthorKey = null;
  let detailBookKey = null;

  function currentDetailBook() {
    if (!detailAuthorKey || !detailBookKey) return null;
    const author = data.authors[detailAuthorKey];
    return author ? author.books[detailBookKey] : null;
  }

  function openDetail(bookKey, authorKey) {
    detailAuthorKey = authorKey;
    detailBookKey = bookKey;
    const book = currentDetailBook();
    if (!book) return;

    const coverWrap = document.getElementById("detail-cover");
    coverWrap.innerHTML = "";
    const img = document.createElement("img");
    img.src = coverSrc(book, "L");
    img.alt = "";
    coverWrap.appendChild(img);

    document.getElementById("detail-series-label").textContent = book.series ? book.series.trim() : "Roman indépendant";
    document.getElementById("detail-title").textContent = displayTitle(book);
    renderTitleHint(document.getElementById("detail-original"), book);
    document.getElementById("detail-meta").textContent =
      (book.year || "Année inconnue") + (book.owned ? " · dans ma bibliothèque" : " · pas encore possédé");
    const titleField = document.getElementById("detail-title-field");
    titleField.value = book.customTitle || "";
    titleField.placeholder = book.titleFr || book.title;
    document.getElementById("detail-title-reset").hidden = !book.customTitle;
    document.getElementById("detail-series-field").value = book.series || "";
    document.getElementById("detail-review").value = book.review || "";
    document.getElementById("detail-owned").checked = !!book.owned;
    document.querySelectorAll(".stamp-btn").forEach((s) => s.classList.toggle("active", s.dataset.status === book.status));
    document.querySelectorAll("#detail-stars button").forEach((s) => s.classList.toggle("on", Number(s.dataset.value) <= (book.rating || 0)));
    renderSynopsis(document.getElementById("detail-synopsis"), book);
    renderIsbn(book);
    if (book.synopsis === undefined || book.isbn === undefined) loadBookDetails(book, data.authors[authorKey].name);

    detailPanel.classList.add("open");
    detailPanel.setAttribute("aria-hidden", "false");
    backdropEl.classList.add("open");
  }

  function closeDetail() {
    detailAuthorKey = null;
    detailBookKey = null;
    detailPanel.classList.remove("open");
    detailPanel.setAttribute("aria-hidden", "true");
    backdropEl.classList.remove("open");
    if (currentAuthorKey && data.authors[currentAuthorKey] && document.getElementById("book-area")) {
      renderBookArea(data.authors[currentAuthorKey]);
    }
  }

  function renderSynopsis(el, book) {
    if (book.synopsis === undefined) {
      el.textContent = "";
      el.className = "synopsis";
    } else if (book.synopsis === "") {
      el.textContent = "";
      el.className = "synopsis empty";
    } else {
      el.textContent = book.synopsis;
      el.className = "synopsis";
    }
  }

  function renderTitleHint(el, book) {
    if (displayTitle(book) !== book.title) {
      el.textContent = `Titre Open Library : ${book.title}`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function renderIsbn(book) {
    const row = document.getElementById("detail-isbn-row");
    const span = document.getElementById("detail-isbn");
    if (book.isbn) {
      span.textContent = book.isbn;
      row.hidden = false;
    } else {
      row.hidden = true;
    }
  }

  async function loadBookDetails(book, authorName) {
    const synEl = document.getElementById("detail-synopsis");
    synEl.textContent = "";
    synEl.className = "synopsis loading";

    let gb = null;
    try {
      gb = await fetchGoogleBooksFr(book.title, authorName);
    } catch (err) {
      console.warn("Google Books indisponible", err);
    }

    if (gb && gb.industryIdentifiers) {
      const isbn13 = gb.industryIdentifiers.find((i) => i.type === "ISBN_13");
      const isbn10 = gb.industryIdentifiers.find((i) => i.type === "ISBN_10");
      if (isbn13 || isbn10) book.isbn = (isbn13 || isbn10).identifier;
    }

    const applyTitleAndSynopsis = () => {
      if (gb && gb.title && normalizeTitle(gb.title) !== normalizeTitle(book.title)) {
        book.titleFr = gb.title;
        if (detailBookKey === book.key) {
          document.getElementById("detail-title").textContent = displayTitle(book);
          document.getElementById("detail-title-field").placeholder = book.titleFr || book.title;
          renderTitleHint(document.getElementById("detail-original"), book);
        }
      }
      if (detailBookKey === book.key) renderSynopsis(synEl, book);
    };

    if (gb && gb.description) {
      book.synopsis = gb.description;
      applyTitleAndSynopsis();
    } else {
      try {
        const res = await fetch(`https://openlibrary.org${book.key}.json`);
        if (!res.ok) throw new Error("Résumé indisponible");
        const json = await res.json();
        const desc = json.description;
        book.synopsis = typeof desc === "string" ? desc : desc && desc.value ? desc.value : "";
        applyTitleAndSynopsis();
      } catch (err) {
        console.error(err);
        if (detailBookKey === book.key) {
          synEl.textContent = "Résumé indisponible (hors ligne ?)";
          synEl.className = "synopsis";
        }
      }
    }

    if (book.isbn === undefined) {
      try {
        const res = await fetch(`https://openlibrary.org${book.key}/editions.json?limit=50`);
        if (res.ok) {
          const json = await res.json();
          const entries = json.entries || [];
          const isbnOf = (ed) => (ed.isbn_13 && ed.isbn_13[0]) || (ed.isbn_10 && ed.isbn_10[0]) || "";
          const isFrench = (ed) => (ed.languages || []).some((l) => l.key === "/languages/fre");
          // Prefer a French edition's ISBN (matches what the reader could actually order), else any.
          book.isbn = entries.filter(isFrench).map(isbnOf).find(Boolean) || entries.map(isbnOf).find(Boolean) || "";
        }
      } catch (err) {
        console.warn("ISBN indisponible", err);
      }
    }

    saveData();
    if (detailBookKey === book.key) renderIsbn(book);
  }

  document.querySelectorAll(".stamp-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const book = currentDetailBook();
      if (!book) return;
      book.status = btn.dataset.status;
      document.querySelectorAll(".stamp-btn").forEach((s) => s.classList.toggle("active", s === btn));
      saveData();
    });
  });

  document.querySelectorAll("#detail-stars button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const book = currentDetailBook();
      if (!book) return;
      const v = Number(btn.dataset.value);
      book.rating = book.rating === v ? null : v;
      document.querySelectorAll("#detail-stars button").forEach((s) => s.classList.toggle("on", Number(s.dataset.value) <= (book.rating || 0)));
      saveData();
    });
  });

  document.getElementById("detail-owned").addEventListener("change", (e) => {
    const book = currentDetailBook();
    if (!book) return;
    book.owned = e.target.checked;
    saveData();
  });

  let titleTimer = null;
  document.getElementById("detail-title-field").addEventListener("input", (e) => {
    const book = currentDetailBook();
    if (!book) return;
    clearTimeout(titleTimer);
    const value = e.target.value;
    const effective = value.trim() || book.titleFr || book.title;
    document.getElementById("detail-title").textContent = effective;
    document.getElementById("detail-title-reset").hidden = !value.trim();
    const original = document.getElementById("detail-original");
    if (effective !== book.title) {
      original.textContent = `Titre Open Library : ${book.title}`;
      original.hidden = false;
    } else {
      original.hidden = true;
    }
    titleTimer = setTimeout(() => {
      book.customTitle = value.trim();
      saveData();
    }, 400);
  });

  document.getElementById("detail-title-reset").addEventListener("click", () => {
    const book = currentDetailBook();
    if (!book) return;
    clearTimeout(titleTimer);
    book.customTitle = "";
    document.getElementById("detail-title-field").value = "";
    document.getElementById("detail-title").textContent = book.titleFr || book.title;
    document.getElementById("detail-title-reset").hidden = true;
    renderTitleHint(document.getElementById("detail-original"), book);
    saveData();
  });

  let seriesTimer = null;
  document.getElementById("detail-series-field").addEventListener("input", (e) => {
    const book = currentDetailBook();
    if (!book) return;
    clearTimeout(seriesTimer);
    const value = e.target.value;
    seriesTimer = setTimeout(() => {
      book.series = value;
      saveData();
    }, 400);
  });

  let reviewTimer = null;
  document.getElementById("detail-review").addEventListener("input", (e) => {
    const book = currentDetailBook();
    if (!book) return;
    clearTimeout(reviewTimer);
    const value = e.target.value;
    reviewTimer = setTimeout(() => {
      book.review = value;
      saveData();
    }, 400);
  });

  document.getElementById("detail-isbn-copy").addEventListener("click", async () => {
    const book = currentDetailBook();
    if (!book || !book.isbn) return;
    try {
      await navigator.clipboard.writeText(book.isbn);
      toast("ISBN copié");
    } catch (err) {
      console.warn("Copie impossible", err);
      toast("Impossible de copier");
    }
  });

  document.getElementById("detail-remove").addEventListener("click", () => {
    const book = currentDetailBook();
    if (!book) return;
    if (confirm(`Retirer « ${book.title} » de votre liste ?`)) {
      delete data.authors[detailAuthorKey].books[detailBookKey];
      saveData();
      closeDetail();
    }
  });

  document.getElementById("detail-close").addEventListener("click", closeDetail);
  backdropEl.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && detailPanel.classList.contains("open")) closeDetail();
  });

  // ---------- Author search ----------

  const searchInput = document.getElementById("author-search");
  const searchResults = document.getElementById("search-results");
  let searchTimer = null;
  let searchSeq = 0;

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    clearTimeout(searchTimer);
    if (!query) {
      searchResults.hidden = true;
      searchResults.innerHTML = "";
      return;
    }
    searchTimer = setTimeout(() => runAuthorSearch(query), 350);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) {
      searchResults.hidden = true;
    }
  });

  async function runAuthorSearch(query) {
    const seq = ++searchSeq;
    searchResults.hidden = false;
    searchResults.innerHTML = '<div class="search-result-loading">Recherche…</div>';
    try {
      const docs = await searchAuthors(query);
      if (seq !== searchSeq) return;
      if (docs.length === 0) {
        searchResults.innerHTML = '<div class="search-result-empty">Aucun auteur trouvé.</div>';
        return;
      }
      searchResults.innerHTML = "";
      for (const doc of docs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "search-result-item";
        const existingAuthor = data.authors[authorSlug(doc.name)];
        const fullyMerged = !!(existingAuthor && existingAuthor.olKeys.includes(doc.key));
        const partiallyMerged = !!existingAuthor && !fullyMerged;
        let badge = "";
        if (fullyMerged) badge = " ✓ suivi";
        else if (partiallyMerged) badge = " · auteur déjà suivi, clic pour compléter";
        btn.innerHTML = `
          <span>
            <span class="sr-name">${escapeHtml(doc.name)}${badge}</span><br>
            <span class="sr-sub">${doc.work_count || 0} œuvre(s)${doc.top_work ? " · ex : " + escapeHtml(doc.top_work) : ""}</span>
          </span>
        `;
        btn.addEventListener("click", () => selectAuthor(doc));
        searchResults.appendChild(btn);
      }
    } catch (err) {
      if (seq !== searchSeq) return;
      console.error(err);
      searchResults.innerHTML = '<div class="search-result-empty">Recherche indisponible (hors ligne ?)</div>';
    }
  }

  // Open Library sometimes splits one real author into several identically
  // named records, each holding only part of their bibliography (seen with
  // both David Eddings and Maxime Chattam). Find the other records sharing
  // this exact name so adding one author pulls in all of them at once,
  // instead of leaving the reader to notice and click each one.
  async function findDuplicateAuthorKeys(doc) {
    try {
      const candidates = await searchAuthors(doc.name);
      return candidates.filter((c) => c.name === doc.name && c.key !== doc.key).map((c) => c.key);
    } catch (err) {
      console.warn("Recherche de fiches en double impossible", err);
      return [];
    }
  }

  async function selectAuthor(doc) {
    searchInput.value = "";
    searchResults.hidden = true;
    searchResults.innerHTML = "";

    const slug = authorSlug(doc.name);
    const existing = data.authors[slug];

    if (existing && existing.olKeys.includes(doc.key)) {
      // This exact Open Library record is already tracked — nothing to fetch.
      navigate(`#/author/${encodeURIComponent(slug)}`);
      return;
    }

    toast(existing ? "Recherche de nouveaux romans…" : "Récupération des romans…");
    try {
      const duplicateKeys = await findDuplicateAuthorKeys(doc);
      const target = existing || { key: slug, name: doc.name, olKeys: [], addedAt: new Date().toISOString(), books: {} };
      const keysToFetch = [doc.key, ...duplicateKeys].filter((k) => !target.olKeys.includes(k));

      const resultsPerKey = await Promise.all(keysToFetch.map((k) => fetchAuthorWorks(k).catch(() => [])));
      let added = 0;
      keysToFetch.forEach((k, i) => {
        target.olKeys.push(k);
        for (const w of resultsPerKey[i]) {
          if (!target.books[w.key]) {
            target.books[w.key] = newBookEntry(w);
            added++;
          }
        }
      });
      target.lastChecked = new Date().toISOString();
      data.authors[slug] = target;
      saveData();
      navigate(`#/author/${encodeURIComponent(slug)}`);
      if (existing) toast(added ? `${added} nouveau(x) roman(s) ajouté(s) à ${target.name}` : `Aucun roman de plus pour ${target.name}`);
    } catch (err) {
      console.error(err);
      toast("Impossible de récupérer les romans (hors ligne ?)");
    }
  }

  // ---------- Init ----------

  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker non enregistré", e));
    });
  }
})();
