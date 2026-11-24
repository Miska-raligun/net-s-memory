import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Archive } from "./Archive";
import cardCss from "../ui/card.css?inline";
import archiveCss from "./archive.css?inline";

for (const css of [cardCss, archiveCss]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Archive />
  </StrictMode>,
);
