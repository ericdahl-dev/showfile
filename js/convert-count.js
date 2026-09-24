// ─── Conversion counter ────────────────────────────────────────────────────
// The one thing the converter page ever sends anywhere: "a conversion
// happened, from this desk to that one". No filename, no channel names, no
// scene content, no file — the scene itself is still read, converted and
// handed back entirely inside the browser, and this does not change that.
// The FAQ on /convert says so in those words; if this file ever starts
// sending more, that answer has to change with it.
//
// The visitor id is a random uuid kept in localStorage purely so the count
// can say "people" as well as "runs". It is not an account, it is not derived
// from anything about the machine, and it is not joined to anything else on
// the site. If storage is blocked the conversion is still counted, just
// without contributing to the people number.
//
// Everything here is fire-and-forget and wrapped: a counter that can break a
// conversion is worse than no counter.

const ENDPOINT = 'https://tbjjkvkuunklijaiicvh.supabase.co/rest/v1/rpc/record_conversion';
const ANON_KEY = 'sb_publishable_35L2m0yW4pElt_DwJpNoyw_2fIspEMo';
const STORE_KEY = 'sbp.convert.visitor';

function visitorId() {
  try {
    let v = localStorage.getItem(STORE_KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(STORE_KEY, v);
    }
    return v;
  } catch {
    return null;                      // private window, blocked storage — fine
  }
}

// event is 'converted' (pressed Convert) or 'downloaded' (took the file).
export function countConversion(event, from, to) {
  if (!from || !to) return;
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON_KEY,
        authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ p_event: event, p_from: from, p_to: to, p_visitor: visitorId() }),
      keepalive: true,                // survives the tab closing after download
    }).catch(() => {});
  } catch {
    /* counting is never worth an error in the console */
  }
}
