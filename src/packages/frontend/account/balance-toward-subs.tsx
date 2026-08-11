import { Space, Switch, Typography } from "antd";
import { redux, useTypedRedux } from "@cocalc/frontend/app-framework";
import {
  USE_BALANCE_TOWARD_SUBSCRIPTIONS,
  USE_BALANCE_TOWARD_SUBSCRIPTIONS_DEFAULT,
  USE_BALANCE_TOWARD_TEAM_LICENSES,
  USE_BALANCE_TOWARD_TEAM_LICENSES_DEFAULT,
} from "@cocalc/util/db-schema/accounts";

const { Text } = Typography;

interface UseBalanceForRenewalsProps {
  defaultValue: boolean;
  enabledDescription?: string;
  settingKey: string;
}

export function UseBalanceForRenewals({
  defaultValue,
  enabledDescription = "Renewals use your account balance only when it covers the full renewal amount; otherwise CoCalc charges your payment method in full.",
  settingKey,
}: UseBalanceForRenewalsProps) {
  const storedSetting = useTypedRedux("account", "other_settings")?.get(
    settingKey,
  );
  const checked = storedSetting ?? defaultValue;

  return (
    <Space vertical>
      <Space>
        <Switch
          aria-label="Use account balance for renewals"
          checked={checked}
          onChange={(value) => {
            const actions = redux.getActions("account");
            actions.set_other_settings(settingKey, value);
          }}
        />
        <Text>Use account balance for renewals</Text>
      </Space>
      <Text>
        {checked ? enabledDescription : "Renewals charge your payment method."}
      </Text>
    </Space>
  );
}

export function UseBalance() {
  return (
    <UseBalanceForRenewals
      defaultValue={USE_BALANCE_TOWARD_SUBSCRIPTIONS_DEFAULT}
      enabledDescription="Renewals use your available account balance first and charge your payment method only for the remainder. If you have an open pay-as-you-go purchase, CoCalc preserves your balance and charges the payment method in full unless the balance covers the entire renewal."
      settingKey={USE_BALANCE_TOWARD_SUBSCRIPTIONS}
    />
  );
}

export function UseTeamLicenseBalance() {
  return (
    <UseBalanceForRenewals
      defaultValue={USE_BALANCE_TOWARD_TEAM_LICENSES_DEFAULT}
      settingKey={USE_BALANCE_TOWARD_TEAM_LICENSES}
    />
  );
}
