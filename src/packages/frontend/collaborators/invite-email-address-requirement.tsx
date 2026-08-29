/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Checkbox, Typography } from "antd";
import { FormattedMessage } from "react-intl";

const { Text } = Typography;

export function InviteEmailAddressRequirement({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (required: boolean) => void | Promise<void>;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <Checkbox
        checked={checked}
        onChange={(event) => void onChange(event.target.checked)}
      >
        <Text strong>
          <FormattedMessage
            id="collaborators.email_invitation.require_email_match.label"
            defaultMessage="Require acceptance using the invited email address"
          />
        </Text>
      </Checkbox>
      <div style={{ marginLeft: 24, marginTop: 4 }}>
        <Text type="secondary">
          <FormattedMessage
            id="collaborators.email_invitation.require_email_match.help"
            defaultMessage="The signed-in account must use the exact verified email address that received the invitation."
          />
        </Text>
      </div>
    </div>
  );
}
