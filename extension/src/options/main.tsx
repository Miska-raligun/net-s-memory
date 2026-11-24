import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";
import cardCss from "../ui/card.css?inline";
import optionsCss from "./options.css?inline";

for (const css of [cardCss, optionsCss]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
