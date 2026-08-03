/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
The alternating media/text layout (the "2 to 1" split) that the classic
cocalc.com /features/* landing pages used, restyled with the public design
tokens. Media comes from the assets package (/public/features/...), so pages
pass plain file names via `image` / `video`. All media below the fold is lazy:
images use loading="lazy" and videos use preload="metadata".
*/

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

import { Col, Flex, Row, Typography } from "antd";

import { type IconName } from "@cocalc/frontend/components/icon";
import {
  PUBLIC_COLORS,
  PUBLIC_ELEVATION,
  PUBLIC_RADIUS,
  PUBLIC_TYPE,
} from "@cocalc/frontend/public/theme";
import { IconBadge } from "./feature-visuals";
import { featureAsset } from "./page-components";

const { Paragraph, Title } = Typography;

const MEDIA_STYLE: CSSProperties = {
  background: PUBLIC_COLORS.surface,
  border: `1px solid ${PUBLIC_COLORS.border}`,
  borderRadius: PUBLIC_RADIUS.media,
  boxShadow: PUBLIC_ELEVATION.media,
  display: "block",
  height: "auto",
  width: "100%",
};

// Simple click-to-zoom for screenshots: clicking the image opens a
// viewport-filling overlay; clicking again (or Escape) closes it.
export function ZoomableImage({
  alt,
  priority,
  src,
}: {
  alt: string;
  priority?: boolean;
  src: string;
}) {
  const [zoomed, setZoomed] = useState<boolean>(false);
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);
  return (
    <>
      <img
        alt={alt}
        decoding="async"
        fetchPriority={priority ? "high" : undefined}
        loading={priority ? "eager" : "lazy"}
        onClick={() => setZoomed(true)}
        src={src}
        style={{ ...MEDIA_STYLE, cursor: "zoom-in" }}
        title="Click to enlarge"
      />
      {zoomed && (
        <div
          aria-label={alt !== "" ? alt : "Enlarged screenshot"}
          onClick={() => setZoomed(false)}
          role="dialog"
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.85)",
            cursor: "zoom-out",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            padding: 24,
            position: "fixed",
            zIndex: 2000,
          }}
        >
          <img
            alt={alt}
            src={src}
            style={{
              borderRadius: PUBLIC_RADIUS.media,
              maxHeight: "100%",
              maxWidth: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      )}
    </>
  );
}

const TEXT_COL_STYLE: CSSProperties = {
  alignContent: "start",
  display: "flex",
  flexDirection: "column",
  justifyContent: "start",
};

// Vertical air around each section — with the page-level gap this yields
// ~120px between adjacent sections, the rhythm of a modern landing page.
const SECTION_STYLE: CSSProperties = {
  padding: "44px 0",
  width: "100%",
};

function videoType(file: string): string | undefined {
  if (file.endsWith(".mp4")) return "video/mp4";
  if (file.endsWith(".webm")) return "video/webm";
  return undefined;
}

interface FeatureInfoProps {
  accent?: string;
  alt?: string;
  anchor: string;
  caption?: ReactNode;
  children: ReactNode;
  icon?: IconName;
  // file name inside /public/features/ (assets package), e.g. "terminal.png"
  image?: string;
  // custom media node; used instead of image/video when given
  imageComponent?: ReactNode;
  title: ReactNode;
  // video file names inside /public/features/; include an .mp4 so the video
  // also plays on iOS
  video?: string[];
}

export function FeatureInfo({
  accent = PUBLIC_COLORS.brand,
  alt,
  anchor,
  caption,
  children,
  icon,
  image,
  imageComponent,
  title,
  video,
}: FeatureInfoProps) {
  let media: ReactNode = null;
  if (imageComponent != null) {
    media = imageComponent;
  } else if (image != null) {
    media = <ZoomableImage alt={alt ?? ""} src={featureAsset(image)} />;
  } else if (video != null && video.length > 0) {
    media = (
      <video
        aria-label={alt}
        controls
        loop
        muted
        playsInline
        preload="metadata"
        style={MEDIA_STYLE}
      >
        {video.map((file) => (
          <source key={file} src={featureAsset(file)} type={videoType(file)} />
        ))}
      </video>
    );
  }

  const head = (
    <Flex align="center" gap={14}>
      {icon != null && (
        <span aria-hidden="true" style={{ flex: "0 0 auto" }}>
          <IconBadge accent={accent} icon={icon} size="md" />
        </span>
      )}
      <Title id={anchor} level={3} style={{ margin: 0, scrollMarginTop: 90 }}>
        {title}
      </Title>
    </Flex>
  );

  if (media == null) {
    return (
      <section className="cocalc-feature-info" style={SECTION_STYLE}>
        <div style={{ margin: "0 auto", maxWidth: 780 }}>
          {head}
          <div style={{ marginTop: 18 }}>{children}</div>
        </div>
      </section>
    );
  }

  const mediaWithCaption = (
    <>
      {media}
      {caption != null && (
        <Paragraph
          style={{
            color: PUBLIC_COLORS.mutedText,
            fontSize: PUBLIC_TYPE.caption,
            margin: "12px auto 0",
            maxWidth: 640,
            textAlign: "center",
          }}
        >
          {caption}
        </Paragraph>
      )}
    </>
  );

  // One split for every section — 9/15 of the 24-col grid is 37.5%/62.5%,
  // i.e. essentially the golden ratio. A uniform division keeps the text
  // column edge aligned while scrolling down a page.
  const [textSpan, mediaSpan] = [9, 15];

  // Consistent layout everywhere: text on the left, media on the right; when
  // the columns stack on narrow viewports, the text comes first.
  return (
    <section className="cocalc-feature-info" style={SECTION_STYLE}>
      <Row align="top" gutter={[48, 32]}>
        <Col key="text" lg={textSpan} xs={24} style={TEXT_COL_STYLE}>
          {head}
          <div style={{ marginTop: 18 }}>{children}</div>
        </Col>
        <Col key="media" lg={mediaSpan} xs={24}>
          {mediaWithCaption}
        </Col>
      </Row>
    </section>
  );
}

export function FeatureInfoHeading({
  anchor,
  children,
  description,
}: {
  anchor?: string;
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section
      className="cocalc-feature-info-heading"
      style={{ padding: "36px 0 12px", textAlign: "center" }}
    >
      <Title
        id={anchor}
        level={2}
        style={{
          color: PUBLIC_COLORS.heading,
          margin: "0 auto",
          maxWidth: 860,
          scrollMarginTop: 90,
        }}
      >
        {children}
      </Title>
      {description != null && (
        <Paragraph
          style={{
            color: PUBLIC_COLORS.mutedText,
            fontSize: PUBLIC_TYPE.lead,
            margin: "16px auto 0",
            maxWidth: 720,
          }}
        >
          {description}
        </Paragraph>
      )}
    </section>
  );
}
