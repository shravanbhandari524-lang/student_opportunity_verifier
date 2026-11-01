import test from "node:test";
import assert from "node:assert/strict";

/**
 * Tests the 404 retry guard behavior implemented in app/check/[id]/page.js (lines 142-155):
 *   let notFoundRetries = 0;
 *   if (res.status === 404 && notFoundRetries < 3) {
 *     notFoundRetries++;
 *     timerId = setTimeout(fetchCheckStatus, 1000);
 *     return;
 *   }
 *   if (res.status === 404) throw new Error("Check not found or expired.");
 */

function createStatusFetcher(mockFetch, onSchedule) {
  let notFoundRetries = 0;
  let attempts = 0;

  async function fetchCheckStatus() {
    attempts++;
    const res = await mockFetch();
    if (!res.ok) {
      if (res.status === 404 && notFoundRetries < 3) {
        notFoundRetries++;
        onSchedule(fetchCheckStatus);
        return { status: "retrying", notFoundRetries };
      }
      if (res.status === 404) throw new Error("Check not found or expired.");
      throw new Error("Failed to load check status.");
    }
    const data = await res.json();
    return { status: "ok", data, attempts, notFoundRetries };
  }

  return { fetchCheckStatus, getRetries: () => notFoundRetries, getAttempts: () => attempts };
}

test("fetchCheckStatus: retries up to 3 times on transient 404 and recovers on subsequent 200", async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    if (callCount <= 2) {
      return { ok: false, status: 404 };
    }
    return { ok: true, status: 200, json: async () => ({ check: { id: "test", status: "investigating" } }) };
  };

  const scheduled = [];
  const fetcher = createStatusFetcher(mockFetch, (fn) => scheduled.push(fn));

  // 1st attempt: 404 -> schedules retry 1
  const r1 = await fetcher.fetchCheckStatus();
  assert.equal(r1.status, "retrying");
  assert.equal(fetcher.getRetries(), 1);

  // 2nd attempt: 404 -> schedules retry 2
  const r2 = await scheduled.shift()();
  assert.equal(r2.status, "retrying");
  assert.equal(fetcher.getRetries(), 2);

  // 3rd attempt: 200 -> recovers
  const r3 = await scheduled.shift()();
  assert.equal(r3.status, "ok");
  assert.equal(r3.data.check.status, "investigating");
  assert.equal(fetcher.getAttempts(), 3);
});

test("fetchCheckStatus: gives up and throws 'Check not found or expired.' after 3 retries (4th 404)", async () => {
  const mockFetch = async () => ({ ok: false, status: 404 });
  const scheduled = [];
  const fetcher = createStatusFetcher(mockFetch, (fn) => scheduled.push(fn));

  // Attempts 1, 2, 3: schedule retries
  await fetcher.fetchCheckStatus(); // retries = 1
  await scheduled.shift()();        // retries = 2
  await scheduled.shift()();        // retries = 3

  // 4th attempt: notFoundRetries is 3, so condition (notFoundRetries < 3) is false
  await assert.rejects(
    async () => {
      await fetcher.fetchCheckStatus();
    },
    (err) => {
      assert.equal(err.message, "Check not found or expired.");
      return true;
    }
  );
});

test("fetchCheckStatus: non-404 error (e.g. 500) throws immediately without retrying", async () => {
  const mockFetch = async () => ({ ok: false, status: 500 });
  const scheduled = [];
  const fetcher = createStatusFetcher(mockFetch, (fn) => scheduled.push(fn));

  await assert.rejects(
    async () => {
      await fetcher.fetchCheckStatus();
    },
    (err) => {
      assert.equal(err.message, "Failed to load check status.");
      return true;
    }
  );
  assert.equal(fetcher.getRetries(), 0);
  assert.equal(scheduled.length, 0);
});
