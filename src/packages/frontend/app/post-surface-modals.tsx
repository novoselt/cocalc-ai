/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { ImportPublicUrlModal } from "./import-public-url-modal";
import { OnboardingEmailPrompt } from "./onboarding-email-prompt";
import PopconfirmModal from "./popconfirm-modal";
import SettingsModal from "./settings-modal";

export function PostSurfaceModals() {
  return (
    <>
      <ImportPublicUrlModal />
      <PopconfirmModal />
      <SettingsModal />
      <OnboardingEmailPrompt />
    </>
  );
}
