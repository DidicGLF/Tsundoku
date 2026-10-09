import "@fontsource-variable/newsreader";
import "@fontsource-variable/hanken-grotesk";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

// Sur le web, demande au navigateur de ne pas effacer la base locale quand il manque de place (refus silencieux possible).
void navigator.storage?.persist?.().catch(() => undefined);
