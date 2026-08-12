/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { redux } from "@cocalc/frontend/app-framework";

import { MarkdownWidgetActions } from "./actions";
import * as info from "./info";
import { MarkdownWidgetStore, type MarkdownWidgetStoreState } from "./store";

export function init(): void {
  if (redux.hasActions(info.REDUX_NAME)) return;
  redux.createStore<MarkdownWidgetStoreState, MarkdownWidgetStore>(
    info.REDUX_NAME,
    MarkdownWidgetStore,
  );
  redux.createActions<MarkdownWidgetStoreState, MarkdownWidgetActions>(
    info.REDUX_NAME,
    MarkdownWidgetActions,
  );
}
