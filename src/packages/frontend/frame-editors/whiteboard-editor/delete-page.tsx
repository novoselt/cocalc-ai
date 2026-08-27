import { Button, Popconfirm } from "antd";

import { Tooltip } from "@cocalc/frontend/components";
import { Icon } from "@cocalc/frontend/components/icon";
import { useFrameContext } from "./hooks";
import { COLORS } from "@cocalc/util/theme";

export default function DeletePage({ pageId }) {
  const { actions } = useFrameContext();
  return (
    <Tooltip title="Delete this page" placement="right" mouseEnterDelay={1}>
      <Popconfirm
        title={"Delete this page?"}
        onConfirm={(e) => {
          e?.stopPropagation();
          actions.deletePage(pageId);
        }}
        onCancel={(e) => {
          e?.stopPropagation();
        }}
      >
        <Button
          aria-label="Delete this page"
          type="text"
          size="small"
          icon={<Icon style={{ color: COLORS.FILE_ICON }} name="trash" />}
          onClick={(e) => {
            e?.stopPropagation();
          }}
        />
      </Popconfirm>
    </Tooltip>
  );
}
