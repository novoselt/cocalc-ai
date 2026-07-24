import {
  Button,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Switch,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import { currency } from "@cocalc/util/misc";
import ShowError from "@cocalc/frontend/components/error";
import { Icon } from "@cocalc/frontend/components/icon";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import {
  AUTOBALANCE_RANGES,
  AUTOBALANCE_DEFAULTS,
  ensureAutoBalanceValid,
  type AutoBalance,
  type AutoBalanceConfig,
} from "@cocalc/util/db-schema/accounts";
import { setAutoBalance } from "@cocalc/frontend/purchases/api";

const { Text } = Typography;

interface Props {
  style?;
}

export function getAutoBalanceConfig(
  autoBalance?: Partial<AutoBalance> | null,
): AutoBalanceConfig {
  return {
    trigger: autoBalance?.trigger ?? AUTOBALANCE_DEFAULTS.trigger,
    amount: autoBalance?.amount ?? AUTOBALANCE_DEFAULTS.amount,
    max_day: autoBalance?.max_day ?? AUTOBALANCE_DEFAULTS.max_day,
    max_week: autoBalance?.max_week ?? AUTOBALANCE_DEFAULTS.max_week,
    max_month: autoBalance?.max_month ?? AUTOBALANCE_DEFAULTS.max_month,
    period: autoBalance?.period ?? AUTOBALANCE_DEFAULTS.period,
    enabled: autoBalance?.enabled ?? false,
  };
}

function getPeriodLimit(autoBalance: AutoBalanceConfig): number {
  if (autoBalance.period === "day") {
    return autoBalance.max_day;
  }
  if (autoBalance.period === "month") {
    return autoBalance.max_month;
  }
  return autoBalance.max_week;
}

export function describeAutoBalance(autoBalance: AutoBalanceConfig): string {
  return `When account credit falls below ${currency(
    autoBalance.trigger,
  )}, add at least ${currency(
    autoBalance.amount,
  )}, with a maximum of ${currency(getPeriodLimit(autoBalance))} per ${
    autoBalance.period
  }.`;
}

export default function AutoBalance({ style }: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const autoBalance = useTypedRedux("account", "auto_balance")?.toJS();
  const stripeEnabled = !!useTypedRedux("customize", "stripe_enabled");
  const value = getAutoBalanceConfig(autoBalance);
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  if (!stripeEnabled) {
    return null;
  }

  const enabled = autoBalance?.enabled === true;
  const targetEnabled = !enabled;
  const confirmation = targetEnabled
    ? "CoCalc will automatically charge your default card according to the strategy shown below."
    : "CoCalc will stop adding account credit automatically. Paid services may stop when the available credit is depleted.";

  const updateEnabled = async () => {
    try {
      setSaving(true);
      setError("");
      await runFreshAuthAction(async () => {
        await setAutoBalance({ ...value, enabled: targetEnabled });
      });
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space
      direction="vertical"
      size="small"
      style={{ width: "100%", ...style }}
    >
      <Space align="center" wrap>
        <Popconfirm
          title={`${targetEnabled ? "Enable" : "Disable"} automatic deposits?`}
          description={confirmation}
          onConfirm={updateEnabled}
          okText={targetEnabled ? "Enable" : "Disable"}
          cancelText="Cancel"
          styles={{ root: { maxWidth: "360px" } }}
        >
          <Switch
            aria-label="Automatic deposits"
            checked={enabled}
            loading={saving}
          />
        </Popconfirm>
        <Text>Automatic deposits are {enabled ? "enabled" : "disabled"}.</Text>
      </Space>
      <Space align="center" wrap>
        <span>
          <Text strong>Strategy:</Text> {describeAutoBalance(value)}
        </span>
        <Button icon={<Icon name="edit" />} onClick={() => setOpen(true)}>
          Edit settings
        </Button>
      </Space>
      <ShowError error={error} setError={setError} />
      {open && <AutoBalanceModal onClose={() => setOpen(false)} />}
      <FreshAuthModal {...freshAuthModalProps} />
    </Space>
  );
}

export function AutoBalanceModal({ onClose }) {
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const autoBalance = useTypedRedux("account", "auto_balance")?.toJS();
  const [value, setValue] = useState<AutoBalanceConfig | null>(null);
  const [form] = Form.useForm();
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  useEffect(() => {
    const next = getAutoBalanceConfig(autoBalance);
    setValue(next);
    form.setFieldsValue(next);
  }, [
    autoBalance?.trigger,
    autoBalance?.amount,
    autoBalance?.max_day,
    autoBalance?.max_week,
    autoBalance?.max_month,
    autoBalance?.period,
    autoBalance?.enabled,
    form,
  ]);

  const initialValue = getAutoBalanceConfig(autoBalance);
  const changed =
    initialValue.trigger !== value?.trigger ||
    initialValue.amount !== value?.amount ||
    initialValue.max_day !== value?.max_day ||
    initialValue.max_week !== value?.max_week ||
    initialValue.max_month !== value?.max_month ||
    initialValue.period !== value?.period;

  const save = async (): Promise<boolean> => {
    if (!changed) {
      return true;
    }
    if (value == null) {
      return false;
    }
    try {
      ensureAutoBalanceValid(value);
      setSaving(true);
      setError("");
      return await runFreshAuthAction(async () => {
        await setAutoBalance(value);
      });
    } catch (err) {
      setError(`${err}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (value == null) {
    return null;
  }

  return (
    <Modal
      width={520}
      open
      title="Automatic deposit settings"
      okText="Save changes"
      cancelText="Cancel"
      okButtonProps={{ disabled: !changed }}
      onOk={async () => {
        if (await save()) {
          onClose();
        }
      }}
      onCancel={onClose}
      confirmLoading={saving}
    >
      <Form
        form={form}
        colon={false}
        labelCol={{ span: 12 }}
        wrapperCol={{ span: 12 }}
        style={{ marginTop: "20px" }}
        onValuesChange={(_, newValue) => setValue({ ...value, ...newValue })}
        initialValues={value}
      >
        <Form.Item label="If the balance goes below" name="trigger">
          <InputNumber
            prefix="$"
            min={AUTOBALANCE_RANGES.trigger[0]}
            max={AUTOBALANCE_RANGES.trigger[1]}
          />
        </Form.Item>
        <Form.Item label="Deposit automatically" name="amount">
          <InputNumber
            prefix="$"
            min={AUTOBALANCE_RANGES.amount[0]}
            max={AUTOBALANCE_RANGES.amount[1]}
          />
        </Form.Item>
        {value.period === "day" && (
          <Form.Item label="But no more than" name="max_day">
            <InputNumber
              step={10}
              prefix="$"
              min={AUTOBALANCE_RANGES.max_day[0]}
              max={AUTOBALANCE_RANGES.max_day[1]}
            />
          </Form.Item>
        )}
        {value.period === "week" && (
          <Form.Item label="But no more than" name="max_week">
            <InputNumber
              step={25}
              prefix="$"
              min={AUTOBALANCE_RANGES.max_week[0]}
              max={AUTOBALANCE_RANGES.max_week[1]}
            />
          </Form.Item>
        )}
        {value.period === "month" && (
          <Form.Item label="But no more than" name="max_month">
            <InputNumber
              step={100}
              prefix="$"
              min={AUTOBALANCE_RANGES.max_month[0]}
              max={AUTOBALANCE_RANGES.max_month[1]}
            />
          </Form.Item>
        )}
        <Form.Item label="During one" name="period">
          <Radio.Group
            options={[
              { label: "Day", value: "day" },
              { label: "Week", value: "week" },
              { label: "Month", value: "month" },
            ]}
            optionType="button"
            buttonStyle="solid"
          />
        </Form.Item>
      </Form>
      <ShowError error={error} setError={setError} />
      <FreshAuthModal {...freshAuthModalProps} />
    </Modal>
  );
}
