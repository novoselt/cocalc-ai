/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// Shared so server-side consent enforcement cannot drift from the banner.
// Revision 3 added the optional marketing email consent section, so every
// existing consent must be collected again.
export const COOKIE_CONSENT_REVISION = 3;
