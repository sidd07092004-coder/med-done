
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fontUrl } from "./config";
import "./fonts.css";
import "./index.css";
import App from "./App.jsx";

document.documentElement.style.setProperty(
  "--font-dm-sans-bold-url",
  `url("${fontUrl("/static/fonts/dm-sans/DMSans-Bold.ttf")}")`
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
