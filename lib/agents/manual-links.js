/**
 * lib/agents/manual-links.js
 *
 * Curated list of official government portals for manual verification.
 * Registries without a free public API (MCA, GST, National Scholarship Portal listing)
 * are provided as manual verification links.
 *
 * NOTE: Each URL uses the root or main public page of each official site.
 * Each URL must be re-verified before the demo. Do not invent deep links.
 */

export const MANUAL_LINKS = Object.freeze([
  Object.freeze({
    id: "mca_company_search",
    label: "Ministry of Corporate Affairs (MCA) Portal",
    url: "https://www.mca.gov.in",
  }),
  Object.freeze({
    id: "gst_taxpayer_search",
    label: "GST Portal",
    url: "https://www.gst.gov.in",
  }),
  Object.freeze({
    id: "national_scholarship_portal",
    label: "National Scholarship Portal (NSP)",
    url: "https://scholarships.gov.in",
  }),
  Object.freeze({
    id: "pib_fact_check",
    label: "PIB Fact Check Portal",
    url: "https://factcheck.pib.gov.in",
  }),
]);

/**
 * Retrieves a manual link definition by its ID.
 *
 * @param {string} id
 * @returns {{ id: string, label: string, url: string } | undefined}
 */
export function getManualLink(id) {
  return MANUAL_LINKS.find((link) => link.id === id);
}

export default MANUAL_LINKS;
