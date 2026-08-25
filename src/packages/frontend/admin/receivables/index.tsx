/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ReceivableOrderDetail } from "./detail";
import { ReceivableOrderCreate } from "./create";
import { ReceivablesQueue } from "./queue";

export function ReceivablesAdmin({
  onBack,
  onCreateOrder,
  onOpenCustomer,
  onOpenOrder,
  orderId,
  creating = false,
}: {
  onBack: () => void;
  onCreateOrder: () => void;
  onOpenCustomer?: (id: string) => void;
  onOpenOrder: (id: string) => void;
  orderId?: string;
  creating?: boolean;
}) {
  if (creating) {
    return <ReceivableOrderCreate onBack={onBack} onCreated={onOpenOrder} />;
  }
  if (orderId) {
    return (
      <ReceivableOrderDetail
        id={orderId}
        onBack={onBack}
        onOpenCustomer={onOpenCustomer}
      />
    );
  }
  return (
    <ReceivablesQueue onCreateOrder={onCreateOrder} onOpenOrder={onOpenOrder} />
  );
}
