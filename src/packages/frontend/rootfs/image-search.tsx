/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Input } from "antd";

interface RootfsImageSearchProps {
  loading: boolean;
  onChange: (value: string) => void;
  value: string;
}

export default function RootfsImageSearch({
  loading,
  onChange,
  value,
}: RootfsImageSearchProps) {
  return (
    <Input.Search
      allowClear
      aria-label="Search root filesystem images"
      aria-busy={loading}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Search by name, image, publisher, tag, or version"
      value={value}
    />
  );
}
