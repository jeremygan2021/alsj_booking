import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
const root =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root"));
const RoleCards = lazy(() => import("./pages/RoleCards"));
root.render(
  /^\/role-cards\/?$/.test(location.pathname) ? (
    <Suspense fallback={<div className="boot">正在准备角色卡…</div>}>
      <RoleCards />
    </Suspense>
  ) : (
    <App />
  ),
);
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.root = root;
  });
}
