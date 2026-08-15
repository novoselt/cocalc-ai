/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { createRoot } from "react-dom/client";
import { UltraliteApp } from "./ultralite/app";
import "./ultralite.css";

const container = document.getElementById("cocalc-ultralite-root");
if (container == null) throw new Error("CoCalc Ultralite root is missing.");
createRoot(container).render(<UltraliteApp />);
