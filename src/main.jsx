import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root"));
root.render(<App />);
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.root = root;
  });
}
