(() => {
  "use strict";

  const STORAGE_KEY = "tsundoku-data";
  const STATUS_LABELS = { "to-read": "À lire", reading: "En cours", done: "Terminé" };

  // ---------- Storage ----------

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { version: 1, authors: {}, settings: { googleBooksApiKey: "" } };
      const parsed = JSON.parse(raw);
      if (!parsed.authors) parsed.authors = {};
      if (!parsed.settings) parsed.settings = { googleBooksApiKey: "" };
      return parsed;
    } catch (e) {
      console.error("Lecture des données impossible, réinitialisation.", e);
      return { version: 1, authors: {}, settings: { googleBooksApiKey: "" } };
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  let data = loadData();

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

  function coverSrc(coverId) {
    if (coverId) return `https://covers.openlibrary.org/b/id/${coverId}-S.jpg`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="58">' +
      '<rect width="40" height="58" rx="4" fill="#c9bda6"/>' +
      '<text x="20" y="34" font-size="20" text-anchor="middle" fill="#fff">📖</text></svg>'
    );
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

  function renderHomeView() {
    const authors = Object.values(data.authors).sort((a, b) =>
      a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
    );

    if (authors.length === 0) {
      app.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML =
        '<div class="big">📚</div><p>Aucun auteur suivi pour l\'instant.<br>Utilisez la recherche en haut pour en ajouter un.</p>';
      app.appendChild(empty);
      return;
    }

    app.innerHTML = '<div class="section-title">Mes auteurs</div>';
    const grid = document.createElement("div");
    grid.className = "author-grid";
    const tpl = document.getElementById("tpl-author-card");

    for (const author of authors) {
      const stats = authorStats(author);
      const node = tpl.content.cloneNode(true);
      const card = node.querySelector(".author-card");
      card.href = `#/author/${encodeURIComponent(author.key)}`;
      node.querySelector(".author-card-name").textContent = author.name;
      node.querySelector(".author-card-stats").textContent =
        stats.total === 0
          ? "Aucun roman"
          : `${stats.owned}/${stats.total} possédés · ${stats.done}/${stats.total} lus`;
      const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
      node.querySelector(".progress-bar").style.width = pct + "%";
      grid.appendChild(node);
    }
    app.appendChild(grid);
  }

  // ---------- Settings view ----------

  function renderSettingsView() {
    app.innerHTML = `
      <a class="back-link" href="#/">← Retour</a>
      <div class="section-title">Réglages</div>
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

    document.getElementById("settings-form").addEventListener("submit", (e) => {
      e.preventDefault();
      data.settings.googleBooksApiKey = input.value.trim();
      saveData();
      toast("Réglages enregistrés");
    });

    document.getElementById("btn-clear-key").addEventListener("click", () => {
      input.value = "";
      data.settings.googleBooksApiKey = "";
      saveData();
      toast("Clé retirée");
    });
  }

  // ---------- Author view ----------

  let activeFilter = "all";
  let groupBySeries = false;

  function renderAuthorView(authorKey) {
    activeFilter = "all";
    groupBySeries = false;
    const author = data.authors[authorKey];

    app.innerHTML = "";

    const header = document.createElement("div");
    header.className = "author-header";
    header.innerHTML = `
      <a class="back-link" href="#/">← Retour</a>
      <h1></h1>
    `;
    header.querySelector("h1").textContent = author.name;
    app.appendChild(header);

    const actions = document.createElement("div");
    actions.className = "author-actions";
    actions.innerHTML = `
      <button type="button" class="btn" id="btn-refresh">🔄 Actualiser la liste</button>
      <button type="button" class="btn btn-danger" id="btn-delete-author">🗑 Supprimer cet auteur</button>
    `;
    app.appendChild(actions);

    const pills = document.createElement("div");
    pills.className = "filter-pills";
    pills.innerHTML = `
      <button type="button" class="pill active" data-filter="all">Tous</button>
      <button type="button" class="pill" data-filter="owned">Possédés</button>
      <button type="button" class="pill" data-filter="to-read">À lire</button>
      <button type="button" class="pill" data-filter="reading">En cours</button>
      <button type="button" class="pill" data-filter="done">Terminé</button>
    `;
    app.appendChild(pills);

    const groupToggle = document.createElement("div");
    groupToggle.className = "filter-pills";
    groupToggle.innerHTML = `
      <button type="button" class="pill active" data-group="list">Liste</button>
      <button type="button" class="pill" data-group="series">Par série</button>
    `;
    app.appendChild(groupToggle);

    const list = document.createElement("div");
    list.className = "book-list";
    list.id = "book-list";
    app.appendChild(list);

    renderBookList(authorKey);

    actions.querySelector("#btn-refresh").addEventListener("click", () => refreshAuthorWorks(authorKey));
    actions.querySelector("#btn-delete-author").addEventListener("click", () => deleteAuthor(authorKey));

    pills.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      activeFilter = btn.dataset.filter;
      pills.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p === btn));
      renderBookList(authorKey);
    });

    groupToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      groupBySeries = btn.dataset.group === "series";
      groupToggle.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p === btn));
      renderBookList(authorKey);
    });

    list.addEventListener("change", (e) => handleBookFieldChange(e, authorKey));
    list.addEventListener("input", (e) => handleBookFieldInput(e, authorKey));
    list.addEventListener("click", (e) => handleBookListClick(e, authorKey));
  }

  function filteredBooks(author) {
    let books = Object.values(author.books || {});
    if (activeFilter === "owned") books = books.filter((b) => b.owned);
    else if (["to-read", "reading", "done"].includes(activeFilter))
      books = books.filter((b) => b.status === activeFilter);
    return books.sort((a, b) => {
      if (a.year && b.year && a.year !== b.year) return a.year.localeCompare(b.year);
      if (a.year && !b.year) return -1;
      if (!a.year && b.year) return 1;
      return a.title.localeCompare(b.title, "fr", { sensitivity: "base" });
    });
  }

  function renderBookList(authorKey) {
    const author = data.authors[authorKey];
    const list = document.getElementById("book-list");
    list.innerHTML = "";
    const books = filteredBooks(author);

    if (books.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = Object.keys(author.books || {}).length
        ? "<p>Aucun roman ne correspond à ce filtre.</p>"
        : "<p>Aucun roman trouvé pour cet auteur.</p>";
      list.appendChild(empty);
      return;
    }

    if (!groupBySeries) {
      for (const book of books) list.appendChild(buildBookRow(book, author.name));
      return;
    }

    const groups = new Map();
    for (const book of books) {
      const name = (book.series || "").trim() || "Sans série";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(book);
    }
    const names = [...groups.keys()].sort((a, b) => {
      if (a === "Sans série") return 1;
      if (b === "Sans série") return -1;
      return a.localeCompare(b, "fr", { sensitivity: "base" });
    });

    for (const name of names) {
      const heading = document.createElement("div");
      heading.className = "series-heading";
      heading.textContent = `${name} (${groups.get(name).length})`;
      list.appendChild(heading);
      for (const book of groups.get(name)) list.appendChild(buildBookRow(book, author.name));
    }
  }

  function buildBookRow(book, authorName) {
    const tpl = document.getElementById("tpl-book-row");
    const node = tpl.content.cloneNode(true);
    const row = node.querySelector(".book-row");
    row.dataset.workKey = book.key;
    node.querySelector(".book-cover").src = coverSrc(book.coverId);
    node.querySelector(".book-title").textContent = book.titleFr || book.title;
    const yearBits = [book.year || "Année inconnue"];
    if (book.editions) yearBits.push(`${book.editions} édition${book.editions > 1 ? "s" : ""}`);
    node.querySelector(".book-year").textContent = yearBits.join(" · ");
    node.querySelector(".f-owned").checked = book.owned;
    node.querySelector(".f-status").value = book.status;
    node.querySelector(".f-series").value = book.series || "";
    node.querySelector(".f-review").value = book.review || "";
    setStars(node.querySelector(".stars"), book.rating);
    updateBadges(node, book);
    renderSynopsis(node.querySelector(".synopsis"), book);
    renderTitleHint(node.querySelector(".title-original"), book);
    row.addEventListener("toggle", () => {
      if (row.open && book.synopsis === undefined) loadBookDetails(book, authorName, row);
    });
    return row;
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
    if (book.titleFr) {
      el.textContent = `Titre Open Library : ${book.title}`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  async function loadBookDetails(book, authorName, row) {
    const synopsisEl = row.querySelector(".synopsis");
    synopsisEl.textContent = "";
    synopsisEl.className = "synopsis loading";

    let gb = null;
    try {
      gb = await fetchGoogleBooksFr(book.title, authorName);
    } catch (err) {
      console.warn("Google Books indisponible", err);
    }

    const applyResult = () => {
      if (gb && gb.title && normalizeTitle(gb.title) !== normalizeTitle(book.title)) {
        book.titleFr = gb.title;
        row.querySelector(".book-title").textContent = book.titleFr;
        renderTitleHint(row.querySelector(".title-original"), book);
      }
      saveData();
      renderSynopsis(synopsisEl, book);
    };

    if (gb && gb.description) {
      book.synopsis = gb.description;
      applyResult();
      return;
    }

    try {
      const res = await fetch(`https://openlibrary.org${book.key}.json`);
      if (!res.ok) throw new Error("Résumé indisponible");
      const json = await res.json();
      const desc = json.description;
      book.synopsis = typeof desc === "string" ? desc : desc && desc.value ? desc.value : "";
      applyResult();
    } catch (err) {
      console.error(err);
      synopsisEl.textContent = "Résumé indisponible (hors ligne ?)";
      synopsisEl.className = "synopsis";
    }
  }

  function updateBadges(scope, book) {
    const statusBadge = scope.querySelector(".badge-status");
    statusBadge.textContent = STATUS_LABELS[book.status];
    statusBadge.dataset.status = book.status;
    const ownedBadge = scope.querySelector(".badge-owned");
    ownedBadge.hidden = !book.owned;
  }

  function setStars(starsEl, rating) {
    starsEl.dataset.rating = rating || 0;
    starsEl.querySelectorAll(".star").forEach((s) => {
      s.classList.toggle("on", Number(s.dataset.value) <= (rating || 0));
    });
  }

  function handleBookFieldChange(e, authorKey) {
    const row = e.target.closest(".book-row");
    if (!row) return;
    const book = data.authors[authorKey].books[row.dataset.workKey];
    if (!book) return;

    if (e.target.classList.contains("f-owned")) {
      book.owned = e.target.checked;
      updateBadges(row, book);
      saveData();
    } else if (e.target.classList.contains("f-status")) {
      book.status = e.target.value;
      updateBadges(row, book);
      saveData();
    }
  }

  const debouncedFields = { "f-review": "review", "f-series": "series" };
  const inputTimers = new WeakMap();
  function handleBookFieldInput(e, authorKey) {
    const prop = Object.keys(debouncedFields).find((cls) => e.target.classList.contains(cls));
    if (!prop) return;
    const row = e.target.closest(".book-row");
    const book = data.authors[authorKey].books[row.dataset.workKey];
    if (!book) return;
    clearTimeout(inputTimers.get(e.target));
    const value = e.target.value;
    inputTimers.set(
      e.target,
      setTimeout(() => {
        book[debouncedFields[prop]] = value;
        saveData();
      }, 400)
    );
  }

  function handleBookListClick(e, authorKey) {
    const row = e.target.closest(".book-row");
    if (!row) return;
    const book = data.authors[authorKey].books[row.dataset.workKey];
    if (!book) return;

    const star = e.target.closest(".star");
    if (star) {
      e.preventDefault();
      const value = Number(star.dataset.value);
      book.rating = book.rating === value ? null : value;
      setStars(row.querySelector(".stars"), book.rating);
      saveData();
      return;
    }

    if (e.target.closest(".star-clear")) {
      e.preventDefault();
      book.rating = null;
      setStars(row.querySelector(".stars"), null);
      saveData();
      return;
    }

    if (e.target.closest(".btn-remove-book")) {
      e.preventDefault();
      if (confirm(`Retirer « ${book.title} » de votre liste ?`)) {
        delete data.authors[authorKey].books[row.dataset.workKey];
        saveData();
        renderBookList(authorKey);
      }
    }
  }

  async function refreshAuthorWorks(authorKey) {
    const author = data.authors[authorKey];
    toast("Actualisation…");
    try {
      const works = await fetchAuthorWorks(authorKey);
      let added = 0;
      for (const w of works) {
        if (!author.books[w.key]) {
          author.books[w.key] = newBookEntry(w);
          added++;
        }
      }
      saveData();
      renderBookList(authorKey);
      toast(added ? `${added} nouveau(x) roman(s) ajouté(s)` : "Aucun nouveau roman");
    } catch (err) {
      console.error(err);
      toast("Échec de l'actualisation (hors ligne ?)");
    }
  }

  function deleteAuthor(authorKey) {
    const author = data.authors[authorKey];
    if (!confirm(`Supprimer « ${author.name} » et toutes les données associées ?`)) return;
    delete data.authors[authorKey];
    saveData();
    navigate("#/");
  }

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
        const already = !!data.authors[doc.key];
        btn.innerHTML = `
          <div class="sr-name">${escapeHtml(doc.name)}${already ? " ✓ suivi" : ""}</div>
          <div class="sr-sub">${doc.work_count || 0} œuvre(s)${doc.top_work ? " · ex : " + escapeHtml(doc.top_work) : ""}</div>
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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function selectAuthor(doc) {
    searchInput.value = "";
    searchResults.hidden = true;
    searchResults.innerHTML = "";

    if (data.authors[doc.key]) {
      navigate(`#/author/${encodeURIComponent(doc.key)}`);
      return;
    }

    toast("Récupération des romans…");
    try {
      const works = await fetchAuthorWorks(doc.key);
      const books = {};
      for (const w of works) books[w.key] = newBookEntry(w);
      data.authors[doc.key] = { key: doc.key, name: doc.name, addedAt: new Date().toISOString(), books };
      saveData();
      navigate(`#/author/${encodeURIComponent(doc.key)}`);
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
