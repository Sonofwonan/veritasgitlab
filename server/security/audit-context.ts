import type { Request } from "express";
import { digest } from "./crypto";

export type RequestAuditContext = {
  ipAddress: string | null;
  location: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  deviceType: string;
  os: string;
  browser: string;
  deviceSummary: string;
  userAgent: string | null;
  sessionPrefix: string | null;
  requestMethod: string | null;
  requestPath: string | null;
};

const SENSITIVE_METADATA_KEY = /password|passcode|secret|token|recovery|cookie|authorization|api.?key|pin|cvv|ssn|sin/i;

function firstHeader(req: Request, names: string[]): string | null {
  for (const name of names) {
    const raw = req.get(name);
    if (raw && raw.trim()) {
      return raw.split(",")[0].trim();
    }
  }
  return null;
}

export function normalizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let ip = raw.split(",")[0].trim();
  if (!ip) return null;
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") ip = "127.0.0.1";
  return ip.slice(0, 64);
}

function isPrivateIp(ip: string | null): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  const match = /^172\.(\d+)\./.exec(ip);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:");
}

export function parseUserAgent(uaRaw: string | undefined | null): {
  deviceType: string;
  os: string;
  browser: string;
  deviceSummary: string;
  userAgent: string | null;
} {
  const ua = (uaRaw || "").trim();
  if (!ua) {
    return {
      deviceType: "Unknown",
      os: "Unknown OS",
      browser: "Unknown Client",
      deviceSummary: "Unknown Client",
      userAgent: null,
    };
  }

  let os = "Unknown OS";
  if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Unknown Browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome|Chromium/i.test(ua)) browser = "Safari";
  else if (/curl|python-requests|node|undici|PostmanRuntime|Playwright/i.test(ua)) browser = "API / Automated";

  let deviceType = "Desktop";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    deviceType = "Tablet";
  } else if (/Mobile|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) {
    deviceType = "Mobile";
  } else if (browser === "API / Automated") {
    deviceType = "Automated Client";
  }

  const deviceSummary = os !== "Unknown OS"
    ? `${browser} on ${os} (${deviceType})`
    : `${browser} (${deviceType})`;

  return {
    deviceType,
    os,
    browser,
    deviceSummary,
    userAgent: ua.slice(0, 300),
  };
}

export function extractRequestAuditContext(req?: Request | null): RequestAuditContext {
  if (!req) {
    return {
      ipAddress: null,
      location: null,
      countryCode: null,
      region: null,
      city: null,
      deviceType: "System",
      os: "Server",
      browser: "Internal Process",
      deviceSummary: "System Process",
      userAgent: null,
      sessionPrefix: null,
      requestMethod: null,
      requestPath: null,
    };
  }

  const forwarded = firstHeader(req, ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"]);
  const ipAddress = normalizeIp(forwarded || req.ip || req.socket?.remoteAddress || null);
  const countryCode = firstHeader(req, [
    "cf-ipcountry",
    "x-vercel-ip-country",
    "x-appengine-country",
    "x-country-code",
    "x-geo-country",
  ]);
  const region = firstHeader(req, ["x-vercel-ip-country-region", "x-appengine-region", "x-geo-region"]);
  const city = firstHeader(req, ["cf-ipcity", "x-vercel-ip-city", "x-appengine-city", "x-geo-city"]);

  const parts = [city, region, countryCode].filter((part): part is string => Boolean(part && part !== "XX" && part !== "ZZ"));
  const location = parts.length > 0
    ? parts.join(", ").slice(0, 120)
    : isPrivateIp(ipAddress)
      ? "Private / Local Network"
      : ipAddress
        ? "External Network"
        : null;

  const parsedUa = parseUserAgent(req.get("user-agent"));
  const sessionPrefix = req.sessionID ? digest(req.sessionID).slice(0, 12) : null;

  return {
    ipAddress,
    location,
    countryCode: countryCode ? countryCode.slice(0, 16) : null,
    region: region ? region.slice(0, 64) : null,
    city: city ? city.slice(0, 64) : null,
    ...parsedUa,
    sessionPrefix,
    requestMethod: req.method ? req.method.slice(0, 12) : null,
    requestPath: req.path ? req.path.slice(0, 160) : null,
  };
}

export function sanitizeAuditMetadata(input?: Record<string, unknown> | null): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (SENSITIVE_METADATA_KEY.test(key)) continue;
    if (val === undefined) continue;
    if (val === null || typeof val === "number" || typeof val === "boolean") {
      clean[key] = val;
    } else if (typeof val === "string") {
      clean[key] = val.slice(0, 240);
    } else if (Array.isArray(val)) {
      clean[key] = val.slice(0, 12).map((item) => (typeof item === "string" ? item.slice(0, 120) : item));
    }
  }
  return clean;
}

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function formatComplianceAuditCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [
    "ID",
    "Timestamp",
    "Category",
    "Action",
    "Outcome",
    "Severity",
    "Actor Type",
    "Actor",
    "Target User ID",
    "Client Ref",
    "IP Address",
    "Location",
    "Device Summary",
    "Method",
    "Path",
    "Session Prefix",
    "Metadata",
  ];
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.id,
      row.createdAt,
      row.category,
      row.action,
      row.outcome,
      row.severity,
      row.actorType,
      row.actorLabel,
      row.targetUserId,
      row.targetClientRef,
      row.ipAddress,
      row.location,
      row.deviceSummary,
      row.requestMethod,
      row.requestPath,
      row.sessionPrefix,
      JSON.stringify(row.metadata ?? {}),
    ].map(escapeCsvCell).join(","));
  }
  return lines.join("\n");
}
