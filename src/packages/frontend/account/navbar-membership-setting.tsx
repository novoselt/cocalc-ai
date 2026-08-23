/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { FormattedMessage } from "react-intl";

import { Switch } from "@cocalc/frontend/antd-bootstrap";
import {
  useAccountOtherSetting,
  useActions,
} from "@cocalc/frontend/app-framework";

export const HIDE_NAVBAR_MEMBERSHIP_SETTING = "hide_navbar_membership";

export function NavbarMembershipSetting() {
  const accountActions = useActions("account");
  const hidden =
    useAccountOtherSetting<boolean>(HIDE_NAVBAR_MEMBERSHIP_SETTING) ?? false;

  return (
    <Switch
      checked={hidden}
      onChange={(event) =>
        accountActions.set_other_settings(
          HIDE_NAVBAR_MEMBERSHIP_SETTING,
          event.target.checked,
        )
      }
    >
      <FormattedMessage
        id="account.other-settings.hide_navbar_membership"
        defaultMessage="<strong>Hide Membership Tier</strong> in navigation bar"
      />
    </Switch>
  );
}
