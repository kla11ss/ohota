import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "@fontsource/montserrat/cyrillic-300.css";
import "@fontsource/montserrat/cyrillic-400.css";
import "@fontsource/montserrat/cyrillic-500.css";
import "@fontsource/montserrat/cyrillic-600.css";
import "@fontsource/lora/cyrillic-400.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
