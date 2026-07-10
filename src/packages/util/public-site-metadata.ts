/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { LOCALE } from "./i18n/locale";
import { DOCS_ENTRIES, docsPath, getDocsEntry } from "@cocalc/docs";
import {
  getPublicFeatureIndexPages,
  getPublicFeaturePage,
} from "./public-feature-pages";
import { SITE_NAME } from "./theme";

export interface PublicRouteMetadata {
  canonicalPath: string;
  description: string;
  faq?: PublicRouteMetadataFaq[];
  imagePath: string;
  // Set for pages that exist but should not be indexed by search engines
  // (e.g. docs entries restricted to admins or signed-in users); servers
  // should emit a robots noindex meta tag.
  noindex?: boolean;
  // Set when the path has the shape of a detail page but the slug does not
  // exist in the corresponding registry; servers should respond 404.
  notFound?: boolean;
  title: string;
}

export interface PublicRouteMetadataFaq {
  answer: string;
  question: string;
}

export interface PublicImageDimensions {
  height: number;
  width: number;
}

export interface PublicRouteMetadataConfig {
  cocalc_product?: string;
  dns?: string;
  is_launchpad?: boolean;
  logo_square?: string;
  site_name?: string;
}

export interface PublicRouteMetadataOptions {
  basePath?: string;
}

export interface PublicMetadataRoute {
  route?: any;
  section: string;
}

const DEFAULT_SOCIAL_IMAGE = "public/landing/home-hero.jpg";
const PRODUCT_SOCIAL_IMAGE = "public/landing/product-options.jpg";
const WORKFLOW_SOCIAL_IMAGE = "public/landing/project-workflows.jpg";
const FEATURE_SOCIAL_IMAGE = "public/landing/feature-map.jpg";

const PUBLIC_IMAGE_DIMENSIONS: Record<string, PublicImageDimensions> = {
  "/public/features/api-screenshot.png": { height: 1066, width: 1400 },
  "/public/features/chatgpt-fix-code.png": { height: 552, width: 747 },
  "/public/features/cocalc-jupyter2-20170508.png": {
    height: 908,
    width: 1605,
  },
  "/public/features/cocalc-octave-jupyter-20200511.png": {
    height: 672,
    width: 1065,
  },
  "/public/features/cocalc-r-jupyter.png": { height: 1013, width: 1866 },
  "/public/features/cocalc-shell-script-run.png": {
    height: 742,
    width: 1312,
  },
  "/public/features/frame-editor-python.png": { height: 779, width: 1599 },
  "/public/features/julia-jupyter.png": { height: 802, width: 1400 },
  "/public/features/latex-editor-main-20251003.png": {
    height: 1020,
    width: 1740,
  },
  "/public/features/sagemath-jupyter.png": { height: 858, width: 1508 },
  "/public/features/terminal.png": { height: 607, width: 1362 },
  "/public/features/whiteboard-sage.png": { height: 1734, width: 3024 },
  "/public/landing/feature-map.jpg": { height: 1024, width: 1536 },
  "/public/landing/home-hero.jpg": { height: 941, width: 1672 },
  "/public/landing/product-options.jpg": { height: 930, width: 1691 },
  "/public/landing/project-workflows.jpg": { height: 1024, width: 1536 },
};

export const PUBLIC_SITE_DESCRIPTION =
  "CoCalc is a shared project workspace for research, teaching, and technical teams, keeping collaboration, AI assistance, history, and recovery close to the work.";

const PRODUCT_SITEMAP_PATHS = [
  "products",
  "products/cocalc-plus",
  "products/cocalc-star",
  "products/cocalc-launchpad",
  "products/cocalc-rocket",
] as const;

const POLICY_SITEMAP_SLUGS = [
  "terms",
  "privacy",
  "dpa",
  "trust",
  "accessibility",
  "copyright",
  "ferpa",
] as const;

const POLICY_METADATA_TITLES: Record<
  (typeof POLICY_SITEMAP_SLUGS)[number],
  string
> = {
  accessibility: "Accessibility",
  copyright: "Copyright",
  dpa: "Data Processing Addendum",
  ferpa: "FERPA",
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  trust: "Trust and Security",
};

const TEAM_MEMBER_SITEMAP_SLUGS = [
  "william-stein",
  "blaec-bejarano",
  "harald-schilly",
  "andrey-novoseltsev",
] as const;

function normalizeBasePath(basePath?: string): string {
  const trimmed = `${basePath ?? ""}`.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function publicPath(
  view: string,
  options?: PublicRouteMetadataOptions,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(view)) return view;
  const base = normalizeBasePath(options?.basePath);
  const normalized = view.replace(/^\/+/, "");
  return normalized ? `${base}/${normalized}` : `${base}/`;
}

function langPath(locale?: string): string {
  return locale ? publicPath(locale) : publicPath("lang");
}

function uniquePublicPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

export const PUBLIC_SITEMAP_PATHS = uniquePublicPaths([
  publicPath(""),
  publicPath("about"),
  publicPath("about/events"),
  publicPath("about/team"),
  ...TEAM_MEMBER_SITEMAP_SLUGS.map((slug) => publicPath(`about/team/${slug}`)),
  publicPath("docs"),
  publicPath("features"),
  ...getPublicFeatureIndexPages().map((page) =>
    publicPath(`features/${page.slug}`),
  ),
  publicPath("guides"),
  langPath(),
  ...LOCALE.map((locale) => langPath(locale)),
  publicPath("news"),
  publicPath("policies"),
  ...POLICY_SITEMAP_SLUGS.map((slug) => publicPath(`policies/${slug}`)),
  publicPath("pricing"),
  ...PRODUCT_SITEMAP_PATHS.map((path) => publicPath(path)),
  publicPath("rootfs"),
  publicPath("support"),
  publicPath("support/community"),
]);

function normalizePublicImagePath(imagePath: string): string {
  let path = imagePath;
  try {
    path = new URL(imagePath).pathname;
  } catch {
    // Keep relative paths as-is.
  }
  const publicIndex = path.indexOf("/public/");
  if (publicIndex !== -1) {
    return path.slice(publicIndex);
  }
  return `/${path.replace(/^\/+/, "")}`;
}

export function getPublicImageDimensions(
  imagePath: string,
): PublicImageDimensions | undefined {
  return PUBLIC_IMAGE_DIMENSIONS[normalizePublicImagePath(imagePath)];
}

function pageTitle(title: string, siteName: string): string {
  return title === siteName ? title : `${title} | ${siteName}`;
}

function hasCustomPublicLogo(config?: PublicRouteMetadataConfig): boolean {
  return !!config?.logo_square?.trim();
}

function usesDefaultLaunchpadPublicBrand(
  config?: PublicRouteMetadataConfig,
): boolean {
  return (
    !hasCustomPublicLogo(config) &&
    config?.site_name === "CoCalc Launchpad" &&
    (config.cocalc_product === "launchpad" || config.is_launchpad === true)
  );
}

function getPublicMarketingSiteName(
  config?: PublicRouteMetadataConfig,
): string {
  if (usesDefaultLaunchpadPublicBrand(config)) return SITE_NAME;
  return config?.site_name ?? SITE_NAME;
}

function routeParts(
  pathname: string,
  options?: PublicRouteMetadataOptions,
): string[] {
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const base = normalizeBasePath(options?.basePath).split("/").filter(Boolean);
  if (base.length === 0) return parts;
  return parts.slice(base.length);
}

// News URLs look like /news/<slugified-title>-<id>; mirror the parsing in
// @cocalc/frontend/public/news/routes.ts.
function parseNewsIdFromSlug(segment?: string): number | undefined {
  if (!segment) return;
  const value = Number(segment.split("-").pop());
  if (!Number.isInteger(value) || value < 0) return;
  return value;
}

function authRoute(parts: string[]): PublicMetadataRoute {
  if (parts[0] === "auth") {
    if (parts[1] === "sign-up") {
      return {
        route: { kind: "auth-form", view: "sign-up" },
        section: "auth",
      };
    }
    if (!parts[1] || parts[1] === "sign-in") {
      return {
        route: { kind: "auth-form", view: "sign-in" },
        section: "auth",
      };
    }
  }
  return { route: { kind: "auth-other" }, section: "auth" };
}

export function getPublicMetadataRouteFromPath(
  pathname: string,
  _search?: string,
  options?: PublicRouteMetadataOptions,
): PublicMetadataRoute {
  const parts = routeParts(pathname, options);
  const section = parts[0];
  if (!section) return { section: "home" };
  if (section === "about") {
    if (parts[1] === "events") {
      return { route: { view: "about-events" }, section: "about" };
    }
    if (parts[1] === "team" && parts[2]) {
      return {
        route: { teamSlug: parts[2], view: "about-team-member" },
        section: "about",
      };
    }
    if (parts[1] === "team") {
      return { route: { view: "about-team" }, section: "about" };
    }
    return { route: { view: "about" }, section: "about" };
  }
  if (
    section === "auth" ||
    section === "invites" ||
    section === "redeem" ||
    section === "sso"
  ) {
    return authRoute(parts);
  }
  if (section === "docs") {
    if (parts[1] === "print") {
      return { route: { view: "docs-print" }, section: "docs" };
    }
    if (!parts[1]) {
      return { route: { view: "docs-index" }, section: "docs" };
    }
    return {
      route: { slug: parts.slice(1).join("/"), view: "docs-detail" },
      section: "docs",
    };
  }
  if (section === "features") {
    return {
      route: parts[1] ? { slug: parts[1], view: "detail" } : { view: "index" },
      section: "features",
    };
  }
  if (section === "guides") {
    if (!parts[1]) {
      return { route: { view: "index" }, section: "guides" };
    }
    return { section: "not-found" };
  }
  if (section === "news") {
    if (
      parts[1] &&
      parts[1] !== "rss.xml" &&
      parts[1] !== "feed.json" &&
      parseNewsIdFromSlug(parts[1]) != null
    ) {
      // Covers both /news/<slug>-<id> and /news/<slug>-<id>/<timestamp>;
      // the canonical for a history view is the current post.
      return {
        route: { newsSlug: parts[1], view: "news-detail" },
        section: "news",
      };
    }
    return { section: "news" };
  }
  if (section === "policies") {
    if (parts[1] === "imprint") {
      return { route: { view: "policies-imprint" }, section: "policies" };
    }
    if (parts[1] === "policies") {
      return { route: { view: "policies-custom" }, section: "policies" };
    }
    if (parts[1]) {
      return {
        route: { policySlug: parts[1], view: "policies-detail" },
        section: "policies",
      };
    }
    return { route: { view: "policies" }, section: "policies" };
  }
  if (section === "pricing") return { section: "pricing" };
  if (section === "products") {
    const detail = parts[1] ? `products-${parts[1]}` : "products";
    return { route: { view: detail }, section: "products" };
  }
  if (section === "rootfs") {
    if (parts[1] === "id" && parts[2]) {
      return {
        route: { imageId: parts[2], view: "image-id" },
        section: "rootfs",
      };
    }
    if (parts[1]) {
      return { route: { slug: parts[1], view: "slug" }, section: "rootfs" };
    }
    return { route: { view: "index" }, section: "rootfs" };
  }
  if (section === "support") {
    const view =
      parts[1] === "new" || parts[1] === "tickets" || parts[1] === "community"
        ? parts[1]
        : "index";
    return { route: { view }, section: "support" };
  }
  if (section === "lang") {
    if (parts[1] && LOCALE.includes(parts[1] as any)) {
      return { route: { locale: parts[1], view: "locale" }, section: "lang" };
    }
    return { route: { view: "index" }, section: "lang" };
  }
  if (LOCALE.includes(section as any)) {
    return { route: { locale: section, view: "locale" }, section: "lang" };
  }
  return { section: "not-found" };
}

function productRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  switch (route?.view) {
    case "products-cocalc-plus":
      return {
        canonicalPath: publicPath("products/cocalc-plus", options),
        description:
          "CoCalc Plus is the local, self-directed CoCalc path for evaluating the workspace model on a single machine before choosing hosted or shared deployment.",
        imagePath: publicPath(PRODUCT_SOCIAL_IMAGE, options),
        title: pageTitle("CoCalc Plus", siteName),
      };
    case "products-cocalc-star":
      return {
        canonicalPath: publicPath("products/cocalc-star", options),
        description:
          "CoCalc Star is the single-VM appliance path for a small shared CoCalc site on one public Ubuntu VM.",
        imagePath: publicPath(PRODUCT_SOCIAL_IMAGE, options),
        title: pageTitle("CoCalc Star", siteName),
      };
    case "products-cocalc-launchpad":
      return {
        canonicalPath: publicPath("products/cocalc-launchpad", options),
        description:
          "CoCalc Launchpad is the lightweight customer-operated private deployment path for pilots, labs, workshops, departments, and platform teams.",
        imagePath: publicPath(PRODUCT_SOCIAL_IMAGE, options),
        title: pageTitle("CoCalc Launchpad", siteName),
      };
    case "products-cocalc-rocket":
      return {
        canonicalPath: publicPath("products/cocalc-rocket", options),
        description:
          "CoCalc Rocket is the broader customer-operated private-cloud path for institutions and enterprises planning a larger CoCalc deployment.",
        imagePath: publicPath(PRODUCT_SOCIAL_IMAGE, options),
        title: pageTitle("CoCalc Rocket", siteName),
      };
    case "products":
    default:
      return {
        canonicalPath: publicPath("products", options),
        description:
          "Compare the five CoCalc product paths: hosted CoCalc.ai, local CoCalc Plus, single-VM CoCalc Star, CoCalc Launchpad, and CoCalc Rocket.",
        imagePath: publicPath(PRODUCT_SOCIAL_IMAGE, options),
        title: pageTitle("Ways to Run CoCalc", siteName),
      };
  }
}

function featureRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  const page = getPublicFeaturePage(route?.slug);
  if (route?.slug === "compare") {
    return {
      canonicalPath: publicPath("features/compare", options),
      description:
        "Compare CoCalc by workspace model across notebooks, terminals, files, documents, teaching workflows, AI agents, and deployment options.",
      imagePath: publicPath(FEATURE_SOCIAL_IMAGE, options),
      title: pageTitle("Compare CoCalc", siteName),
    };
  }
  if (route?.slug === "teaching") {
    return {
      canonicalPath: publicPath("features/teaching", options),
      description:
        "CoCalc teaching workflows help instructors run technical course projects with assignments, shared environments, collection, grading, and collaborative help.",
      imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
      title: pageTitle("Technical Courses and Labs", siteName),
    };
  }
  if (page) {
    return {
      canonicalPath: publicPath(`features/${page.slug}`, options),
      description: page.metadataSummary ?? page.summary,
      imagePath: publicPath(page.image ?? FEATURE_SOCIAL_IMAGE, options),
      title: pageTitle(page.metadataTitle ?? page.title, siteName),
    };
  }
  return {
    canonicalPath: publicPath("features", options),
    description:
      "Explore CoCalc features for collaborative notebooks, Linux terminals, technical documents, whiteboards, teaching workflows, automation, and AI agents.",
    imagePath: publicPath(FEATURE_SOCIAL_IMAGE, options),
    // A slug was given but no such feature page exists.
    notFound: !!route?.slug,
    title: pageTitle("CoCalc Features", siteName),
  };
}

function guidesRouteMetadata(
  _route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  return {
    canonicalPath: publicPath("guides", options),
    description:
      "Read CoCalc guides for project workflows, notebooks, teaching, automation, and deployment decisions.",
    imagePath: publicPath(FEATURE_SOCIAL_IMAGE, options),
    title: pageTitle("CoCalc Guides", siteName),
  };
}

function rootfsRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  if (route?.view === "slug" && route.slug) {
    return {
      canonicalPath: publicPath(`rootfs/${route.slug}`, options),
      description:
        "Details of a CoCalc runtime image for project environments, including software, versions, and deployment options.",
      imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
      title: pageTitle(`Runtime Image ${route.slug}`, siteName),
    };
  }
  if (route?.view === "image-id" && route.imageId) {
    return {
      canonicalPath: publicPath(`rootfs/id/${route.imageId}`, options),
      description:
        "Details of a CoCalc runtime image for project environments, including software, versions, and deployment options.",
      imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
      title: pageTitle("CoCalc Runtime Image", siteName),
    };
  }
  return {
    canonicalPath: publicPath("rootfs", options),
    description:
      "Explore CoCalc runtime images for project environments, including images for notebooks, terminals, teaching workflows, and self-hosted deployments.",
    imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
    title: pageTitle("CoCalc Runtime Images", siteName),
  };
}

function newsRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  if (
    (route?.view === "news-detail" || route?.view === "news-history") &&
    route.newsSlug
  ) {
    // The slug is the slugified post title followed by the numeric id, so a
    // readable approximation of the title can be recovered from it.
    const words = route.newsSlug.split("-");
    words.pop();
    const slugTitle = words.join(" ").trim();
    const title = slugTitle
      ? slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1)
      : `${siteName} News`;
    return {
      canonicalPath: publicPath(`news/${route.newsSlug}`, options),
      description:
        "Read a CoCalc news post with product updates, release notes, or public announcements.",
      imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
      title: pageTitle(title, siteName),
    };
  }
  return {
    canonicalPath: publicPath("news", options),
    description:
      "Read CoCalc news, product updates, release notes, and public announcements.",
    imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
    title: pageTitle(`${siteName} News`, siteName),
  };
}

function aboutRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  switch (route?.view) {
    case "about-events":
      return {
        canonicalPath: publicPath("about/events", options),
        description:
          "Find public CoCalc events, talks, workshops, and community appearances.",
        imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
        title: pageTitle(`${siteName} Events`, siteName),
      };
    case "about-team":
      return {
        canonicalPath: publicPath("about/team", options),
        description:
          "Meet the SageMath, Inc. team building CoCalc for collaborative technical work.",
        imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
        title: pageTitle(`${siteName} Team`, siteName),
      };
    case "about-team-member":
      return {
        canonicalPath: publicPath(`about/team/${route.teamSlug}`, options),
        description:
          "Meet a member of the SageMath, Inc. team building CoCalc.",
        imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
        notFound: !(TEAM_MEMBER_SITEMAP_SLUGS as readonly string[]).includes(
          route.teamSlug,
        ),
        title: pageTitle(`${siteName} Team`, siteName),
      };
    case "about":
    default:
      return {
        canonicalPath: publicPath("about", options),
        description:
          "Learn about the people and company behind CoCalc, the collaborative computing platform from SageMath, Inc.",
        imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
        title: pageTitle(`About ${siteName}`, siteName),
      };
  }
}

function policiesRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  if (route?.view === "policies-detail" && route.policySlug) {
    const title =
      POLICY_METADATA_TITLES[
        route.policySlug as keyof typeof POLICY_METADATA_TITLES
      ];
    return {
      canonicalPath: publicPath(`policies/${route.policySlug}`, options),
      description:
        "Review CoCalc public policy information, terms, privacy details, trust resources, and compliance commitments.",
      imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
      notFound: title == null,
      title: pageTitle(`${siteName} ${title ?? "Policy"}`, siteName),
    };
  }
  return {
    canonicalPath: publicPath("policies", options),
    description:
      "Review CoCalc public policies, terms, privacy information, and trust resources.",
    imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
    title: pageTitle(`${siteName} Policies`, siteName),
  };
}

function langRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  if (route?.view === "locale" && route.locale) {
    return {
      canonicalPath: publicPath(route.locale, options),
      description:
        "Read a localized overview of CoCalc, the collaborative workspace for technical teams, teaching, and research.",
      imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
      title: pageTitle(`${siteName} ${route.locale}`, siteName),
    };
  }
  return {
    canonicalPath: publicPath("lang", options),
    description:
      "Choose a localized CoCalc overview for public product discovery and evaluation.",
    imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
    title: pageTitle(`${siteName} Languages`, siteName),
  };
}

function normalizedPublicHost(host?: string): string {
  return `${host ?? ""}`.trim().replace(/:\d+$/, "").toLowerCase();
}

function docsRouteMetadata(
  route: PublicMetadataRoute["route"],
  config: PublicRouteMetadataConfig | undefined,
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  const siteProfile =
    normalizedPublicHost(config?.dns) === "cocalc.ai" ? "cocalc-ai" : undefined;
  const entry =
    route?.view === "docs-detail"
      ? getDocsEntry(route.slug, { siteProfile })
      : undefined;
  if (entry) {
    return {
      canonicalPath: publicPath(docsPath(entry.slug), options),
      description: entry.summary,
      imagePath: publicPath(FEATURE_SOCIAL_IMAGE, options),
      title: pageTitle(`${entry.title} - Documentation`, siteName),
    };
  }
  if (route?.view === "docs-detail" && route.slug) {
    // Not publicly visible for this site. If the entry exists in the registry
    // at all (e.g. admin- or signed-in-only docs, or another site profile),
    // it must still serve 200 for entitled users — the client enforces the
    // actual visibility — but crawlers should not index it. Only slugs that
    // exist nowhere in the registry are a real 404.
    const exists = DOCS_ENTRIES.some((entry) => entry.slug === route.slug);
    return {
      canonicalPath: publicPath(docsPath(route.slug), options),
      description:
        "Read CoCalc documentation for projects, files, notebooks, terminals, teaching, account management, and administration.",
      imagePath: publicPath(FEATURE_SOCIAL_IMAGE, options),
      noindex: exists || undefined,
      notFound: !exists,
      title: pageTitle("CoCalc Documentation", siteName),
    };
  }
  return {
    canonicalPath: publicPath("docs", options),
    description:
      "Browse CoCalc documentation for projects, files, notebooks, terminals, teaching, account management, and administration.",
    imagePath: publicPath(FEATURE_SOCIAL_IMAGE, options),
    title: pageTitle("CoCalc Documentation", siteName),
  };
}

function authRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  if (route?.kind === "auth-form" && route.view === "sign-up") {
    return {
      canonicalPath: publicPath("auth/sign-up", options),
      description:
        "Create a CoCalc account to start hosted projects on CoCalc.ai, explore product paths, and evaluate what fits your team.",
      imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
      title: pageTitle(`Create your ${siteName} account`, siteName),
    };
  }
  if (route?.kind === "auth-form" && route.view === "sign-in") {
    return {
      canonicalPath: publicPath("auth/sign-in", options),
      description:
        "Sign in to CoCalc to open projects, manage your account, and continue work in your collaborative workspace.",
      imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
      title: pageTitle(`Sign in to ${siteName}`, siteName),
    };
  }
  return {
    canonicalPath: publicPath("auth/sign-in", options),
    description:
      "Use your CoCalc account to access projects, collaborators, billing, support, and deployment tools.",
    imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
    title: pageTitle(siteName, siteName),
  };
}

function supportRouteMetadata(
  route: PublicMetadataRoute["route"],
  siteName: string,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  switch (route?.view) {
    case "new":
      return {
        canonicalPath: publicPath("support/new", options),
        description:
          "Contact CoCalc about pricing, deployment, product paths, or an existing account or project issue.",
        imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
        title: pageTitle(`Contact ${siteName} Support`, siteName),
      };
    case "community":
      return {
        canonicalPath: publicPath("support/community", options),
        description:
          "Find CoCalc community channels, documentation, and public support resources.",
        imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
        title: pageTitle(`${siteName} Community Support`, siteName),
      };
    case "tickets":
      return {
        canonicalPath: publicPath("support/tickets", options),
        description:
          "Review recent CoCalc support tickets when ticket access is available for your account.",
        imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
        title: pageTitle(`${siteName} Support Tickets`, siteName),
      };
    case "index":
    default:
      return {
        canonicalPath: publicPath("support", options),
        description:
          "Use CoCalc support to choose a product path, discuss pricing or deployment, or get help with an account or project.",
        imagePath: publicPath(WORKFLOW_SOCIAL_IMAGE, options),
        title: pageTitle(`${siteName} Support`, siteName),
      };
  }
}

export function getPublicRouteMetadata(
  route: PublicMetadataRoute,
  config?: PublicRouteMetadataConfig,
  options?: PublicRouteMetadataOptions,
): PublicRouteMetadata {
  const siteName = getPublicMarketingSiteName(config);
  switch (route.section) {
    case "home":
      return {
        canonicalPath: publicPath("", options),
        description: PUBLIC_SITE_DESCRIPTION,
        imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
        title: siteName,
      };
    case "products":
      return productRouteMetadata(route.route, siteName, options);
    case "rootfs":
      return rootfsRouteMetadata(route.route, siteName, options);
    case "pricing":
      return {
        canonicalPath: publicPath("pricing", options),
        description:
          "Review CoCalc.ai hosted plans, site licensing, quotes, team seats, and buying paths for hosted, local, single-VM, and customer-operated deployment options.",
        imagePath: publicPath(PRODUCT_SOCIAL_IMAGE, options),
        title: pageTitle("CoCalc.ai Pricing and Licensing", siteName),
      };
    case "features":
      return featureRouteMetadata(route.route, siteName, options);
    case "support":
      return supportRouteMetadata(route.route, siteName, options);
    case "auth":
      return authRouteMetadata(route.route, siteName, options);
    case "guides":
      return guidesRouteMetadata(route.route, siteName, options);
    case "docs":
      return docsRouteMetadata(route.route, config, siteName, options);
    case "about":
      return aboutRouteMetadata(route.route, siteName, options);
    case "news":
      return newsRouteMetadata(route.route, siteName, options);
    case "policies":
      return policiesRouteMetadata(route.route, siteName, options);
    case "lang":
      return langRouteMetadata(route.route, siteName, options);
    default:
      return {
        canonicalPath: publicPath("", options),
        description: PUBLIC_SITE_DESCRIPTION,
        imagePath: publicPath(DEFAULT_SOCIAL_IMAGE, options),
        notFound: route.section === "not-found" || undefined,
        title: siteName,
      };
  }
}
