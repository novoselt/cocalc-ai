/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

function makeSafeIndentFold(indentFold) {
  return (cm, start) => {
    if (cm.getLine(start.line) == null) return;
    return indentFold(cm, start);
  };
}

module.exports = { makeSafeIndentFold };
