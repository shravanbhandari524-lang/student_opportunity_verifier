/**
 * tests/helpers/tool-result-schemas.js
 *
 * Authoritative, strict Zod validation schemas for all L2 tool result shapes.
 * Derived directly from ground-truth source code in lib/tools/ and lib/graph.js.
 *
 * Used to ensure mock tool results in tests cannot drift from real tool shapes.
 */

import { z } from "zod";

// Base ToolResult wrapper schemas
export function makeToolSuccessSchema(dataSchema) {
  return z
    .object({
      ok: z.literal(true),
      data: dataSchema,
      cached: z.boolean().optional(), // optional because caller mock or fresh execution may omit cached flag
      fetchedAt: z.string().optional(), // optional ISO timestamp added by cachedTool wrapper
    })
    .strict();
}

export const ToolFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string(),
        message: z.string().optional(),
      })
      .strict(),
    cached: z.boolean().optional(),
    fetchedAt: z.string().optional(),
  })
  .strict();

export function makeToolResultSchema(dataSchema) {
  return z.union([makeToolSuccessSchema(dataSchema), ToolFailureSchema]);
}

// 1. RDAP Lookup (lib/tools/domain.js:52)
export const RdapLookupDataSchema = z
  .object({
    domain: z.string(),
    found: z.boolean(),
    // Nullable: null when domain is unlisted or events array has no registration action
    registrationDate: z.string().nullable(),
    // Nullable: null when unlisted or events array has no expiration action
    expirationDate: z.string().nullable(),
    // Nullable: null when registrationDate is null
    ageDays: z.number().int().nonnegative().nullable(),
    // Nullable: null when unlisted or entities array has no registrar role
    registrar: z.string().nullable(),
    // Array of status strings (e.g. clientTransferProhibited), empty when not found
    status: z.array(z.string()),
    // Documented RDAP bootstrap URL (https://rdap.org/domain/<domain>)
    evidenceUrl: z.string(),
  })
  .strict();

export const RdapLookupResultSchema = makeToolResultSchema(RdapLookupDataSchema);

// 2. DNS Records (lib/tools/domain.js:184)
export const DnsRecordsDataSchema = z
  .object({
    domain: z.string(),
    a: z.array(z.string()),
    aaaa: z.array(z.string()),
    mx: z.array(z.string()),
    ns: z.array(z.string()),
    txt: z.array(z.string()),
  })
  .strict();

export const DnsRecordsResultSchema = makeToolResultSchema(DnsRecordsDataSchema);

// 3. SSL Info (lib/tools/domain.js:271)
export const SslInfoDataSchema = z
  .object({
    domain: z.string(),
    // Nullable: null when peer certificate lacks O or CN issuer attributes
    issuer: z.string().nullable(),
    // Nullable: null when peer certificate lacks subject CN
    subject: z.string().nullable(),
    validFrom: z.string(),
    validTo: z.string(),
    daysRemaining: z.number().int(),
    authorized: z.boolean(),
    // Nullable: null when TLS handshake authorization succeeds
    authError: z.string().nullable(),
  })
  .strict();

export const SslInfoResultSchema = makeToolResultSchema(SslInfoDataSchema);

// 4. Wayback Machine First Seen (lib/tools/domain.js:390)
export const WaybackFirstSeenDataSchema = z
  .object({
    domain: z.string(),
    found: z.boolean(),
    // Nullable: null when domain has no snapshots in Wayback archive
    firstSeen: z.string().nullable(),
    // Nullable: null when found is false
    evidenceUrl: z.string().nullable(),
  })
  .strict();

export const WaybackFirstSeenResultSchema = makeToolResultSchema(WaybackFirstSeenDataSchema);

// 5. Lookalike Check (lib/tools/lookalike.js:140 - pure code, returns fact object)
export const LookalikeCheckDataSchema = z
  .object({
    isMatch: z.boolean(),
    // Nullable: null when isMatch is false
    targetDomain: z.string().nullable(),
    // Nullable: null when isMatch is false
    targetName: z.string().nullable(),
    // Nullable: null when isMatch is false
    reason: z.string().nullable(),
    // Nullable: null when isMatch is false
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    // Nullable: null when isMatch is false
    method: z
      .enum([
        "edit_distance",
        "homoglyph_skeleton",
        "punycode_idn",
        "brand_token_affix",
        "tld_spoofing",
      ])
      .nullable(),
  })
  .strict();

// 6. URLhaus Threat Feed Lookup (lib/tools/urlhaus.js:53)
export const UrlhausDataSchema = z
  .object({
    listed: z.boolean(),
    // Nullable: null when unlisted
    threat: z.string().nullable(),
    // Nullable: null when unlisted
    urlStatus: z.string().nullable(),
    // Nullable: null when unlisted
    dateAdded: z.string().nullable(),
    tags: z.array(z.string()),
    // Nullable: null when unlisted
    reference: z.string().nullable(),
  })
  .strict();

export const UrlhausResultSchema = makeToolResultSchema(UrlhausDataSchema);

// 7. urlscan.io Public Search (lib/tools/urlscan.js:56)
export const UrlscanSearchDataSchema = z
  .object({
    total: z.number().int().nonnegative(),
    results: z.array(
      z
        .object({
          resultUrl: z.string(),
          // Nullable: null when task.time is absent
          scanDate: z.string().nullable(),
          // Nullable: null when page.domain is absent
          pageDomain: z.string().nullable(),
        })
        .strict()
    ),
  })
  .strict();

export const UrlscanSearchResultSchema = makeToolResultSchema(UrlscanSearchDataSchema);

// 8. fetchPage Tool (lib/tools/fetchPage.js:339) / readPage dep
export const FetchPageDataSchema = z
  .object({
    finalUrl: z.string(),
    redirectChain: z.array(z.string()).optional(),
    title: z.string(),
    metaDescription: z.string(),
    text: z.string(),
    links: z.array(z.string()),
  })
  .strict();

export const FetchPageResultSchema = makeToolResultSchema(FetchPageDataSchema);

// 9. Web Search (Serper) (lib/tools/search.js:53)
export const SearchDataSchema = z
  .object({
    query: z.string(),
    total: z.number().int().nonnegative(),
    results: z.array(
      z
        .object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
          position: z.number().int().positive(),
        })
        .strict()
    ),
  })
  .strict();

export const SearchResultSchema = makeToolResultSchema(SearchDataSchema);

// 10. Scam Intelligence Graph Lookup (lib/graph.js:170)
export const GraphMatchSchema = z
  .object({
    matched: z.boolean(),
    // Present only when matched is true
    nodeId: z.number().int().optional(),
    kind: z.string().optional(),
    value: z.string().optional(),
    reportCount: z.number().int().nonnegative().optional(),
    connectedNodesCount: z.number().int().nonnegative().optional(),
  })
  .strict();

// 11. UPI Facts (lib/tools/payments.js:46)
export const UpiFactsSchema = z
  .object({
    valid: z.boolean(),
    raw: z.string(),
    normalized: z.string(),
    username: z.string(),
    handle: z.string(),
    isKnownPsp: z.boolean(),
    // Nullable: null when PSP handle is not in UPI_REGISTRY
    pspName: z.string().nullable(),
    // Nullable: null when bank is not in UPI_REGISTRY
    bankName: z.string().nullable(),
    looksLikePhone: z.boolean(),
  })
  .strict();

// 12. Phone Facts (lib/tools/payments.js:185)
export const PhoneFactsSchema = z
  .object({
    valid: z.boolean(),
    raw: z.string(),
    e164: z.string(),
    // Nullable: null when not parseable to a specific ISO country
    country: z.string().nullable(),
    // Nullable: null when not parseable to calling code
    countryCallingCode: z.string().nullable(),
    nationalNumber: z.string(),
    possible: z.boolean(),
    // Nullable: null when line type cannot be determined
    type: z.string().nullable(),
  })
  .strict();

// 13. Email Facts (lib/tools/payments.js:122)
export const EmailFactsSchema = z
  .object({
    valid: z.boolean(),
    raw: z.string(),
    normalized: z.string(),
    localPart: z.string(),
    domain: z.string(),
    isFreeProvider: z.boolean(),
    isEduOrGov: z.boolean(),
  })
  .strict();

/**
 * Registry mapping tool name to its validator schema.
 */
export const TOOL_SCHEMAS = {
  rdapLookup: RdapLookupResultSchema,
  dnsRecords: DnsRecordsResultSchema,
  sslInfo: SslInfoResultSchema,
  waybackFirstSeen: WaybackFirstSeenResultSchema,
  lookalikeCheck: LookalikeCheckDataSchema,
  urlhaus: UrlhausResultSchema,
  urlscanSearch: UrlscanSearchResultSchema,
  fetchPage: FetchPageResultSchema,
  readPage: FetchPageResultSchema,
  search: SearchResultSchema,
  graphLookup: GraphMatchSchema,
  lookup: GraphMatchSchema,
  upiFacts: UpiFactsSchema,
  phoneFacts: PhoneFactsSchema,
  emailFacts: EmailFactsSchema,
};

/**
 * Validates a mock or real tool result against its authoritative schema.
 * Throws a detailed ZodError if validation fails, preventing schema drift.
 *
 * @template T
 * @param {keyof typeof TOOL_SCHEMAS} toolName
 * @param {T} result
 * @returns {T} The validated result
 */
export function validateToolResult(toolName, result) {
  const schema = TOOL_SCHEMAS[toolName];
  if (!schema) {
    throw new Error(`No validation schema registered for tool: '${toolName}'`);
  }
  return schema.parse(result);
}

/**
 * Creates a schema-validated mock function that validates its returned value on every call.
 *
 * @param {keyof typeof TOOL_SCHEMAS} toolName
 * @param {Function} mockFn
 * @returns {Function}
 */
export function validatedMock(toolName, mockFn) {
  return async (...args) => {
    const res = await mockFn(...args);
    return validateToolResult(toolName, res);
  };
}

/**
 * Routes any tool mock (sync, async, or object) through its authoritative schema validator.
 * Ensures mocks cannot drift from real tool shapes.
 *
 * @template T
 * @param {keyof typeof TOOL_SCHEMAS} toolName
 * @param {T} mock
 * @returns {T}
 */
export function routeMock(toolName, mock) {
  if (typeof mock !== "function") {
    if (mock !== undefined && typeof mock === "object") {
      validateToolResult(toolName, mock);
    }
    return mock;
  }

  return (...args) => {
    const res = mock(...args);
    if (res && typeof res.then === "function") {
      return res.then((r) => {
        if (r !== undefined && typeof r === "object") {
          validateToolResult(toolName, r);
        }
        return r;
      });
    }
    if (res !== undefined && typeof res === "object") {
      validateToolResult(toolName, res);
    }
    return res;
  };
}
