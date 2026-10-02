import { useMemo, useState } from "react";
import type { ReadingStatus } from "@tsundoku/types";

const demoBooks = [
  {
    id: "demo-1",
    title: "Le Nom du vent",
    author: "Patrick Rothfuss",
    status: "READING" as ReadingStatus,
    progress: 42,
    cover: "https://covers.openlibrary.org/b/isbn/9782290038889-M.jpg",
  },
  {
    id: "demo-2",
    title: "Dune",
    author: "Frank Herbert",
    status: "TO_READ" as ReadingStatus,
    progress: 0,
    cover: "https://covers.openlibrary.org/b/isbn/9782266320485-M.jpg",
  },
];

export function App() {
  const [active, setActive] = useState("Accueil");

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Bonjour";
    if (hour < 18) return "Bon après-midi";
    return "Bonsoir";
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <strong>Tsundoku</strong>
            <span>V2</span>
          </div>
        </div>

        <nav>
          {["Accueil", "Bibliothèque", "Favoris", "Listes", "Statistiques", "Paramètres"].map(
            (item) => (
              <button
                className={active === item ? "nav-item active" : "nav-item"}
                key={item}
                onClick={() => setActive(item)}
              >
                {item}
              </button>
            )
          )}
        </nav>

        <div className="sync-status">
          <span className="sync-dot" />
          <div>
            <strong>Synchronisé</strong>
            <small>Stockage local actif</small>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Ma bibliothèque</span>
            <h1>{greeting} 👋</h1>
          </div>
          <button className="primary-button">+ Ajouter un livre</button>
        </header>

        <section className="hero">
          <div>
            <span className="eyebrow">Lecture en cours</span>
            <h2>Quelques pages de plus ?</h2>
            <p>Continue ta lecture là où tu t'étais arrêté.</p>
          </div>
          <div className="hero-decoration">📚</div>
        </section>

        <section className="section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Ta sélection</span>
              <h2>Continuer la lecture</h2>
            </div>
            <button className="text-button">Voir tout</button>
          </div>

          <div className="book-grid">
            {demoBooks.map((book) => (
              <article className="book-card" key={book.id}>
                <img src={book.cover} alt={`Couverture de ${book.title}`} />
                <div className="book-info">
                  <span className="status">{book.status === "READING" ? "En cours" : "À lire"}</span>
                  <h3>{book.title}</h3>
                  <p>{book.author}</p>
                  {book.status === "READING" && (
                    <div className="progress">
                      <div className="progress-track">
                        <div className="progress-value" style={{ width: `${book.progress}%` }} />
                      </div>
                      <span>{book.progress}%</span>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
