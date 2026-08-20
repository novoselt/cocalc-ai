/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Translation } from "vanilla-cookieconsent";

import {
  COMMUNICATION_SECTION_DESCRIPTION,
  COMMUNICATION_SECTION_TITLE,
  COOKIE_CATEGORIES,
} from "./categories";

// Stated in the banner itself rather than in the admin-configurable text, so
// that "Accept all" never opts a visitor into optional email without saying so.
export const ACCEPT_ALL_NOTICE =
  '"Accept all" also opts you in to optional onboarding help, product tips, and marketing emails. You can change that at any time in your account settings.';

function sectionFor(category: (typeof COOKIE_CATEGORIES)[number]) {
  return {
    title: category.label,
    description: category.description,
    linkedCategory: category.key,
  };
}

export function buildTranslation(
  descHtml: string,
  privacyUrl: string,
  termsUrl: string,
): Translation {
  const footerLinks = `<a href="${privacyUrl}" target="_blank" rel="noopener noreferrer">Privacy policy</a>\n<a href="${termsUrl}" target="_blank" rel="noopener noreferrer">Terms of service</a>`;
  const noticeHtml = `<p>${ACCEPT_ALL_NOTICE}</p>`;
  const consentHtml = `${descHtml}${noticeHtml}`;
  const prefsLead = `${consentHtml}\n<p style="margin-top: 0.75em; font-size: 0.9em;">${footerLinks.replace("\n", " · ")}</p>`;
  const cookieSections = COOKIE_CATEGORIES.filter(
    (category) => category.kind === "cookies",
  ).map(sectionFor);
  const communicationCategories = COOKIE_CATEGORIES.filter(
    (category) => category.kind === "communication",
  );
  const communicationSections =
    communicationCategories.length === 0
      ? []
      : [
          {
            title: COMMUNICATION_SECTION_TITLE,
            description: COMMUNICATION_SECTION_DESCRIPTION,
          },
          ...communicationCategories.map(sectionFor),
        ];

  return {
    consentModal: {
      title: "We value your privacy",
      description: consentHtml,
      acceptAllBtn: "Accept all",
      acceptNecessaryBtn: "Necessary only",
      showPreferencesBtn: "Manage preferences",
      footer: footerLinks,
    },
    preferencesModal: {
      title: "Privacy preferences",
      acceptAllBtn: "Accept all",
      acceptNecessaryBtn: "Necessary only",
      savePreferencesBtn: "Save preferences",
      closeIconLabel: "Close",
      sections: [
        { description: prefsLead },
        ...cookieSections,
        ...communicationSections,
      ],
    },
  };
}
