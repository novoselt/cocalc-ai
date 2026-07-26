/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { join } from "path";
import * as fs from "fs";
import { isEqual } from "lodash";
import { Router, json } from "express";
// express-js cors plugin:
import cors from "cors";
import {
  parseDomain,
  fromUrl,
  ParseResultType,
  ParseResult,
} from "parse-domain";

import { get_server_settings } from "@cocalc/database/postgres/settings/server-settings";
import type { PostgreSQL } from "@cocalc/database/postgres/types";
import getAccountId from "@cocalc/server/auth/get-account";
import { analytics_cookie_name } from "@cocalc/util/misc";

import { setAnalyticsCookie } from "./analytics-cookie";
import { normalizeAnalyticsPostPayload } from "./analytics-payload";
import { recordAnalyticsData } from "./analytics-record";
import { getLogger } from "./logger";

// analytics-script.ts is compiled beside this file and copied into release
// bundles. It is small enough that runtime minification is not worthwhile.
export const analytics_js =
  "if (window.exports === undefined) { var exports={}; } \n" +
  fs.readFileSync(join(__dirname, "analytics-script.js"), "utf8");

function create_log(name) {
  return getLogger(`analytics.${name}`).debug;
}

/*
// base64 encoded PNG (white), 1x1 pixels
const _PNG_DATA =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
const PNG_1x1 = Buffer.from(_PNG_DATA, "base64");
*/

// could throw an error
function check_cors(
  origin: string | undefined,
  dns_parsed: ParseResult,
  dbg: Function,
): boolean {
  // no origin, e.g. when loaded as usual in a script tag
  if (origin == null) return true;

  // origin could be https://...
  const origin_parsed = parseDomain(fromUrl(origin));
  if (origin_parsed.type === ParseResultType.Reserved) {
    // This happens, e.g., when origin is https://localhost, which happens with cocalc-docker.
    return true;
  }
  // the configured DNS name is not ok
  if (dns_parsed.type !== ParseResultType.Listed) {
    dbg(`parsed DNS domain invalid: ${JSON.stringify(dns_parsed)}`);
    return false;
  }
  // now, we want dns_parsed and origin_parsed to be valid and listed
  if (origin_parsed.type === ParseResultType.Listed) {
    // most likely case: same domain as settings.DNS
    if (
      isEqual(origin_parsed.topLevelDomains, dns_parsed.topLevelDomains) &&
      origin_parsed.domain === dns_parsed.domain
    ) {
      return true;
    }
    // we also allow cocalc.ai and sagemath.com
    if (
      isEqual(origin_parsed.topLevelDomains, ["ai"]) &&
      origin_parsed.domain === "cocalc"
    ) {
      return true;
    }
    if (
      isEqual(origin_parsed.topLevelDomains, ["com"]) &&
      origin_parsed.domain === "sagemath"
    ) {
      return true;
    }
    // … as well as sagemath.org
    if (
      isEqual(origin_parsed.topLevelDomains, ["org"]) &&
      origin_parsed.domain === "sagemath"
    ) {
      return true;
    }
  }
  return false;
}

/*
cocalc analytics setup -- this is used in http_hub_server to setup the /analytics.js endpoint

this extracts tracking information about landing pages, measure campaign performance, etc.

1. it sends a static js file (which is included in a script tag) to a page
2. a unique ID is generated and stored in a cookie
3. the script (should) send back a POST request, telling us about
   the UTM params, referral, landing page, etc.

The query param "fqd" (fully qualified domain) can be set to true or false (default true)
It controls if the bounce back URL mentions the domain.
*/

import base_path from "@cocalc/backend/base-path";

export async function initAnalytics(
  router: Router,
  database: PostgreSQL,
): Promise<void> {
  const dbg = create_log("analytics_js/cors");

  // we only get the DNS once at startup – i.e. hub restart required upon changing DNS!
  const settings = await get_server_settings();
  const DNS = settings.dns;
  const dns_parsed = parseDomain(DNS);
  const pii_retention = settings.pii_retention;

  if (
    dns_parsed.type !== ParseResultType.Listed &&
    dns_parsed.type !== ParseResultType.Reserved
  ) {
    dbg(
      `WARNING: the configured domain name ${DNS} cannot be parsed properly. ` +
        `Please fix it in Admin → Site Settings!\n` +
        `dns_parsed="${JSON.stringify(dns_parsed)}}"`,
    );
  }

  // CORS-setup: allow access from other trusted (!) domains
  const analytics_cors = {
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "*"],
    origin: function (origin, cb) {
      dbg(`check origin='${origin}'`);
      try {
        if (check_cors(origin, dns_parsed, dbg)) {
          cb(null, true);
        } else {
          cb(`origin="${origin}" is not allowed`, false);
        }
      } catch (e) {
        cb(e);
        return;
      }
    },
  };

  // process POST body data
  // https://expressjs.com/en/api.html#express.json
  router.use("/analytics.js", json());

  router.get("/analytics.js", cors(analytics_cors), function (req, res) {
    res.header("Content-Type", "text/javascript");

    // in case user was already here, do not send it again.
    // only the first hit is interesting.
    dbg(
      `/analytics.js GET analytics_cookie='${req.cookies[analytics_cookie_name]}'`,
    );

    const existingToken = req.cookies[analytics_cookie_name];
    let analyticsToken = existingToken;
    if (!existingToken) {
      // No analytics cookie is set, so we set one.
      // We always set this despite any issues with parsing or
      // or whether or not we are actually using the analytics.js
      // script, since it's *also* useful to have this cookie set
      // for other purposes, e.g., logging.
      analyticsToken = setAnalyticsCookie(res);
    }

    // also, don't write a script if the DNS is not valid
    if (existingToken || dns_parsed.type !== ParseResultType.Listed) {
      // cache for 6 hours -- max-age has unit seconds
      res.header(
        "Cache-Control",
        `private, max-age=${6 * 60 * 60}, must-revalidate`,
      );
      res.write("// NOOP");
      res.end();
      return;
    }

    // write response script
    // this only runs once, hence no caching
    res.header("Cache-Control", "no-cache, no-store");

    const DOMAIN = `${dns_parsed.domain}.${dns_parsed.topLevelDomains.join(
      ".",
    )}`;
    res.write(`var NAME = '${analytics_cookie_name}';\n`);
    res.write(`var ID = '${analyticsToken}';\n`);
    res.write(`var DOMAIN = '${DOMAIN}';\n`);
    //  BASE_PATH
    if (req.query.fqd === "false") {
      res.write(`var PREFIX = '${base_path}';\n`);
    } else {
      const prefix = `//${DOMAIN}${base_path}`;
      res.write(`var PREFIX = '${prefix}';\n\n`);
    }
    res.write(analytics_js);
    return res.end();
  });

  /*
  // tracking image: this is a 100% experimental idea and not used
  router.get(
    "/analytics.js/track.png",
    cors(analytics_cors),
    function (req, res) {
      // in case user was already here, do not set a cookie
      if (!req.cookies[analytics_cookie_name]) {
        setAnalyticsCookie(res); // ,DNS);
      }
      res.header("Content-Type", "image/png");
      res.header("Content-Length", `${PNG_1x1.length}`);
      return res.end(PNG_1x1);
    }
  );
  */

  router.post("/analytics.js", cors(analytics_cors), async function (req, res) {
    // check if token is in the cookie (see above)
    // if not, ignore it
    const token = req.cookies[analytics_cookie_name];
    dbg(`/analytics.js POST token='${token}'`);
    try {
      if (!token) {
        res.end();
        return;
      }
      if (req.body?.account_link === true) {
        const account_id = await getAccountId(req);
        if (account_id) {
          await recordAnalyticsData({
            database,
            piiRetention: pii_retention,
            record: { accountId: account_id },
            token,
          });
        }
      } else {
        // e.g. {"utm":{"source":"asdfasdf"},"landing":"https://cocalc.ai/..."}
        // ATTN key/values could be malicious.
        const payload = normalizeAnalyticsPostPayload(req.body);
        if (payload != null && Object.keys(payload).length > 0) {
          await recordAnalyticsData({
            database,
            piiRetention: pii_retention,
            record: { data: payload },
            token,
          });
        }
      }
    } catch (err) {
      dbg("analytics POST failed", err);
    }
    res.end();
  });

  // additionally, custom content types require a preflight cors check
  router.options("/analytics.js", cors(analytics_cors));
}
