import { normalizeUrl, isSameDomain, shouldSkipUrl } from './urlUtils.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PASSWORD_REGEX = /\b(password|pass|pwd)\b/i;
const OTP_REGEX = /\b(otp|one[-_ ]?time[-_ ]?pass|verification[-_ ]?code)\b/i;
const UPI_REGEX = /\b(upi|vpa|bhim|gpay|paytm|phonepe)\b/i;
const PAYMENT_REGEX = /\b(card|credit|debit|cvv|expiry|bank|account[-_ ]?no|ifsc|payment|checkout)\b/i;

/**
 * Scrolls the page incrementally until height stops growing or maxScrolls is reached.
 *
 * @param {import('playwright').Page} page
 * @param {number} [maxScrolls=5]
 * @param {number} [delayMs=200]
 */
export async function scrollPage(page, maxScrolls = 5, delayMs = 200) {
  try {
    let lastHeight = 0;
    for (let i = 0; i < maxScrolls; i++) {
      const currentHeight = await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight || 800);
        return document.documentElement.scrollHeight || document.body.scrollHeight;
      });
      await sleep(delayMs);
      if (currentHeight === lastHeight) {
        break;
      }
      lastHeight = currentHeight;
    }
  } catch {
    // Best effort, ignore if page closed or frame detached
  }
}

/**
 * Extracts page title, meta description, visible content text, links,
 * and form definitions for security analysis.
 *
 * @param {import('playwright').Page} page
 * @param {string} currentUrl
 * @param {string} startUrl
 */
export async function extractPageData(page, currentUrl, startUrl) {
  const evaluated = await page.evaluate(() => {
    const title = (document.title || '').trim();

    const descMeta =
      document.querySelector('meta[name="description"]') ||
      document.querySelector('meta[property="og:description"]');
    const description = (descMeta ? descMeta.getAttribute('content') : '') || '';

    const getTexts = (selector) =>
      Array.from(document.querySelectorAll(selector))
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 0);

    const headings = {
      h1: getTexts('h1'),
      h2: getTexts('h2'),
      h3: getTexts('h3')
    };

    // Extract visible text capped at 20,000 characters
    const contentRoot = document.querySelector('main') || document.querySelector('article') || document.body;
    let text = '';
    if (contentRoot) {
      const clone = contentRoot.cloneNode(true);
      const elementsToRemove = clone.querySelectorAll('script, style, noscript, svg, canvas, nav, header, footer');
      elementsToRemove.forEach((el) => el.remove());
      text = (clone.innerText || clone.textContent || '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
    }
    if (text.length > 20000) {
      text = text.slice(0, 20000);
    }

    // Extract raw links
    const rawLinks = Array.from(document.querySelectorAll('a[href]')).map((a) => {
      const href = a.getAttribute('href') || '';
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      const rawText = (a.textContent || '').trim().toLowerCase();
      const ariaLabel = (a.getAttribute('aria-label') || '').toLowerCase();

      const isRelNext = rel.split(/\s+/).includes('next');
      const isNextText =
        rawText === 'next' ||
        rawText === '>' ||
        rawText === '»' ||
        rawText === '›' ||
        rawText === 'next page' ||
        ariaLabel.includes('next');
      const isPageNum = /^\d+$/.test(rawText);

      return {
        href,
        isPagination: isRelNext || isNextText || isPageNum
      };
    }).filter((item) => item.href.trim().length > 0);

    // Extract visible forms for security metadata analysis
    const rawForms = [];
    document.querySelectorAll('form').forEach((form, idx) => {
      const selector = form.id ? `form#${form.id}` : `form:nth-of-type(${idx + 1})`;
      const method = (form.getAttribute('method') || 'GET').toUpperCase();
      const action = form.getAttribute('action') || '';

      const fields = [];
      form.querySelectorAll('input, select, textarea').forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : 'text')).toLowerCase();
        if (type === 'hidden') return;

        const name = el.getAttribute('name') || el.id || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const required = el.hasAttribute('required');

        let label = '';
        if (el.id) {
          const labelEl = document.querySelector(`label[for="${el.id}"]`);
          if (labelEl) label = labelEl.textContent.trim();
        }
        if (!label) {
          const parentLabel = el.closest('label');
          if (parentLabel) label = parentLabel.textContent.trim();
        }
        if (!label && el.hasAttribute('aria-label')) {
          label = el.getAttribute('aria-label');
        }

        fields.push({
          name,
          type,
          label,
          placeholder,
          required
        });
      });

      if (fields.length > 0) {
        rawForms.push({
          selector,
          method,
          action,
          fields
        });
      }
    });

    return { title, description: description.trim(), headings, text, rawLinks, rawForms };
  });

  const internalSet = new Set();
  const externalSet = new Set();
  const paginationSet = new Set();

  for (const item of evaluated.rawLinks) {
    const normalized = normalizeUrl(item.href, currentUrl);
    if (!normalized) continue;
    if (shouldSkipUrl(normalized)) continue;

    if (isSameDomain(normalized, startUrl)) {
      internalSet.add(normalized);
      if (item.isPagination) {
        paginationSet.add(normalized);
      }
    } else {
      externalSet.add(normalized);
    }
  }

  // Parse form security flags
  const forms = (evaluated.rawForms || []).map((f) => {
    let actionHost = '';
    try {
      if (f.action) {
        actionHost = new URL(f.action, currentUrl).hostname;
      } else {
        actionHost = new URL(currentUrl).hostname;
      }
    } catch {
      actionHost = '';
    }

    const fieldTypes = f.fields.map((fld) => fld.type);
    const allFieldNames = f.fields.map((fld) => `${fld.name} ${fld.label} ${fld.placeholder}`).join(' ');

    const hasPassword = f.fields.some((fld) => fld.type === 'password') || PASSWORD_REGEX.test(allFieldNames);
    const hasOtp = OTP_REGEX.test(allFieldNames);
    const hasUpi = UPI_REGEX.test(allFieldNames);
    const hasPayment = PAYMENT_REGEX.test(allFieldNames);

    return {
      actionHost,
      method: f.method,
      fieldTypes,
      hasPassword,
      hasOtp,
      hasUpi,
      hasPayment
    };
  });

  return {
    title: evaluated.title,
    description: evaluated.description,
    headings: evaluated.headings,
    text: evaluated.text,
    links: {
      internal: Array.from(internalSet),
      external: Array.from(externalSet)
    },
    forms,
    paginationLinks: paginationSet
  };
}
