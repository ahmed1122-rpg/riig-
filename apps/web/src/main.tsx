import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import {
  installClientTelemetry,
  reportReactError,
} from "./app/clientTelemetry";
import "./styles/main.css";

installClientTelemetry();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary onError={reportReactError}>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
