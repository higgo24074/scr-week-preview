const STATUS = ["idea", "draft", "review", "scheduled", "published"];
const FORMATS = ["reel", "carousel", "static", "story", "thread", "short", "longform", "caption-only"];
const PILLARS = ["proof", "craft", "point of view", "people", "invite"];
const COMPOSE = {
  instagram: "https://www.instagram.com/",
  tiktok: "https://www.tiktok.com/upload",
  facebook: "https://www.facebook.com/",
  linkedin: "https://www.linkedin.com/feed/",
  x: (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
  threads: "https://www.threads.com/",
  youtube: "https://studio.youtube.com/",
};

let state = { brand: {}, channels: [], posts: [] };
let view = "preview";
let filter = "all";
let editingId = null;
let saveTimer = null;
let dirty = false;
let completingReview = false;
let reviewFlash = "";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function publicCopy(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/Â·/g, "-")
    .replace(/â€”|â€“|â€‘/g, "-")
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/[·•∙]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...");
}

function parseLocal(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a, b) {
  return a && b && startOfDay(a).getTime() === startOfDay(b).getTime();
}

function fmtDay(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function scheduleFor(post, channel) {
  const map = post.scheduledForByChannel;
  if (channel && map && map[channel]) return map[channel];
  return post.scheduledFor;
}

function scheduleSummary(post) {
  const chans = (post.channels || []).filter((id) => id === "instagram" || id === "facebook" || id === "tiktok");
  const list = (chans.length ? chans : ["instagram"]).map((ch) => channelName(ch) + " " + fmtTime(scheduleFor(post, ch)));
  return list.join(" - ");
}

function isOverdue(post) {
  const d = parseLocal(post.scheduledFor);
  if (!d || post.status === "published") return false;
  return d < new Date() && (post.status === "scheduled" || post.status === "review" || post.status === "draft");
}

function channelName(id) {
  return state.channels.find((c) => c.id === id)?.name || id;
}

async function loadState() {
  if (window.__DESK_STATIC__) {
    const res = await fetch("state.json" + (window.__DESK_BUILD__ ? "?v=" + window.__DESK_BUILD__ : ""), { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load the hosted Preview");
    state = await res.json();
    dirty = false;
    $("save-state").textContent = "Accept or Reject each post";
    $("save-state").className = "save-state ok";
    document.body.classList.add("static-preview");
    view = "preview";
    const neu = $("new-post");
    if (neu) neu.hidden = true;
    dropStaleReviewCache();
    mergeStoredReviews();
    isolateReviews();
    return;
  }
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load desk.json");
  state = await res.json();
  dirty = false;
  $("save-state").textContent = "Saved";
  $("save-state").className = "save-state ok";
  isolateReviews();
}

async function saveState() {
  if (window.__DESK_STATIC__) {
    $("save-state").textContent = "Accept or Reject each post";
    $("save-state").className = "save-state ok";
    return;
  }
  const res = await fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state, null, 2),
  });
  if (!res.ok) {
    $("save-state").textContent = "Save failed";
    $("save-state").className = "save-state dirty";
    return;
  }
  dirty = false;
  $("save-state").textContent = "Saved";
  $("save-state").className = "save-state ok";
}

function queueSave() {
  dirty = true;
  $("save-state").textContent = "Unsaved";
  $("save-state").className = "save-state dirty";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

function setView(next) {
  view = window.__DESK_STATIC__ ? "preview" : next;
  document.querySelectorAll(".nav button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  render();
}

function render() {
  $("clock").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const root = $("view");
  if (view === "preview") root.innerHTML = renderPreview();
  if (view === "today") root.innerHTML = renderToday();
  if (view === "calendar") root.innerHTML = renderCalendar();
  if (view === "queue") root.innerHTML = renderQueue();
  if (view === "channels") root.innerHTML = renderChannels();
  if (view === "brand") root.innerHTML = renderBrand();
  bindView();
}

function counts() {
  const posts = state.posts || [];
  return {
    review: posts.filter((p) => p.status === "review").length,
    overdue: posts.filter(isOverdue).length,
    today: posts.filter((p) => sameDay(parseLocal(p.scheduledFor), new Date()) && p.status !== "published").length,
    scheduled: posts.filter((p) => p.status === "scheduled").length,
  };
}

function weekPosts() {
  return (state.posts || [])
    .filter((p) => p.status === "draft" || p.status === "review")
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
}

function reviewRound() {
  const fromWeek = Number(state.approval?.week?.reviewRound);
  if (fromWeek) return fromWeek;
  return (state.posts || []).reduce((max, p) => Math.max(max, Number(p.review?.round) || 1), 1);
}

function reviewStorageKey() {
  return "scr-post-review-" + (state.approval?.week?.weekStart || "none") + "-r" + reviewRound();
}

function storedReviewIsStale(post, stored) {
  const round = Number(post.review?.round) || 1;
  const storedRound = Number(stored.round) || 1;
  if (storedRound < round) return true;
  if (!post.review?.appliedAt) return false;
  const applied = Date.parse(post.review.appliedAt);
  if (!applied) return false;
  const times = [stored.decidedAt];
  if (stored.channels && typeof stored.channels === "object") {
    Object.keys(stored.channels).forEach((k) => times.push(stored.channels[k] && stored.channels[k].decidedAt));
  }
  const latestStored = times.map((t) => Date.parse(t)).filter((n) => n).sort((a, b) => b - a)[0];
  return !latestStored || applied >= latestStored;
}

function dropStaleReviewCache() {
  if (!window.__DESK_STATIC__) return;
  forgetPreviewReviewsOnNewBuild();
  const keep = reviewStorageKey();
  const week = state.approval?.week?.weekStart || "";
  if (!week) return;
  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.indexOf("scr-post-review-" + week) === 0 && k !== keep) localStorage.removeItem(k);
    });
  } catch (e) {}
}

function forgetPreviewReviewsOnNewBuild() {
  const build = window.__DESK_BUILD__ || "";
  if (!build) return;
  try {
    const last = localStorage.getItem("scr-preview-build");
    if (last && last !== build) {
      Object.keys(localStorage).forEach((k) => {
        if (k.indexOf("scr-post-review-") === 0) localStorage.removeItem(k);
      });
    }
    localStorage.setItem("scr-preview-build", build);
  } catch (e) {}
}

function mergeStoredReviews() {
  try {
    const raw = localStorage.getItem(reviewStorageKey());
    if (!raw) return;
    const map = JSON.parse(raw);
    weekPosts().forEach((p) => {
      if (!map[p.id]) return;
      const stored = map[p.id];
      if (storedReviewIsStale(p, stored)) return;
      p.review = { ...(p.review || {}), ...stored };
      if (stored.channels && typeof stored.channels === "object") {
        p.review.channels = JSON.parse(JSON.stringify(stored.channels));
      }
    });
  } catch (e) {}
}

function isolateReviews() {
  (state.posts || []).forEach((p) => {
    const src = p.review && typeof p.review === "object" ? p.review : {};
    const chans = {};
    const srcChans = src.channels && typeof src.channels === "object" ? src.channels : {};
    Object.keys(srcChans).forEach((k) => {
      const c = srcChans[k] || {};
      chans[k] = { decision: c.decision || null, changes: c.changes || "", decidedAt: c.decidedAt || null };
    });
    p.review = {
      decision: src.decision || null,
      changes: src.changes || "",
      round: Number(src.round) || 1,
      decidedAt: src.decidedAt || null,
      appliedAt: src.appliedAt || null,
      channels: chans,
    };
  });
}

function persistStoredReviews() {
  if (!window.__DESK_STATIC__) return;
  const map = {};
  weekPosts().forEach((p) => {
    if (p.review) map[p.id] = p.review;
  });
  localStorage.setItem(reviewStorageKey(), JSON.stringify(map));
}

function ensureReview(post) {
  if (!post.review) post.review = { decision: null, changes: "", round: 1, decidedAt: null, channels: {} };
  if (!post.review.channels || typeof post.review.channels !== "object") post.review.channels = {};
  return post.review;
}

function reviewChannels(post) {
  const list = (post.channels || []).filter((id) => id === "instagram" || id === "facebook" || id === "tiktok");
  return list.length ? list : ["instagram"];
}

function reviewKey(postId, channel) {
  return postId + "::" + channel;
}

function parseReviewKey(id) {
  const raw = String(id || "");
  const i = raw.indexOf("::");
  if (i < 0) return { postId: raw, channel: "" };
  return { postId: raw.slice(0, i), channel: raw.slice(i + 2) };
}

function ensureChannelReview(post, channel) {
  const root = ensureReview(post);
  if (!root.channels[channel]) root.channels[channel] = { decision: null, changes: "", decidedAt: null };
  return root.channels[channel];
}

function syncPostDecision(post) {
  const chans = reviewChannels(post);
  const revs = chans.map((ch) => ensureChannelReview(post, ch));
  if (revs.some((r) => r.decision !== "approved" && r.decision !== "rejected")) {
    post.review.decision = null;
    return;
  }
  const rejected = revs.filter((r) => r.decision === "rejected");
  if (rejected.length) {
    post.review.decision = "rejected";
    post.review.changes = rejected.map((r) => String(r.changes || "").trim()).filter(Boolean).join(" | ");
    post.review.decidedAt = new Date().toISOString();
  } else {
    post.review.decision = "approved";
    post.review.changes = "";
    post.review.decidedAt = new Date().toISOString();
  }
}

function reviewTargets() {
  const items = [];
  weekPosts().forEach((p) => {
    reviewChannels(p).forEach((ch) => items.push({ post: p, channel: ch }));
  });
  return items;
}

function reviewProgress() {
  const items = reviewTargets();
  const decided = items.filter(({ post, channel }) => {
    const d = post.review?.channels?.[channel]?.decision;
    return d === "approved" || d === "rejected";
  });
  return {
    total: items.length,
    decided: decided.length,
    approved: items.filter(({ post, channel }) => post.review?.channels?.[channel]?.decision === "approved").length,
    rejected: items.filter(({ post, channel }) => post.review?.channels?.[channel]?.decision === "rejected").length,
  };
}

function allPostsDecided() {
  const p = reviewProgress();
  return p.total > 0 && p.decided === p.total;
}

function reviewKind(post) {
  return post.format === "story" ? "story" : "post";
}

function reviewBoxHtml(post, channel) {
  const rev = ensureChannelReview(post, channel);
  const kind = reviewKind(post);
  const label = channelName(channel) + " " + kind;
  const key = reviewKey(post.id, channel);
  const decided = rev.decision === "approved" || rev.decision === "rejected";
  const locked = allPostsDecided();
  const boxClass = rev.decision === "approved" ? "accepted" : rev.decision === "rejected" ? "turned-down" : "";
  const status =
    rev.decision === "approved"
      ? "Accepted - this " + label + " only"
      : rev.decision === "rejected"
        ? "Rejected - this " + label + " only. Waiting for every other item."
        : "This Accept or Reject applies only to this " + label + ".";
  const slotId = "changes-" + esc(post.id) + "-" + esc(channel);
  return `<div class="review-box ${boxClass}" data-review-for="${esc(key)}">
    <p class="review-box-title">Accept or Reject this ${esc(label)}</p>
    <p class="tiny"><strong>${esc(publicCopy(post.title))}</strong></p>
    <p class="tiny">${esc(status)}</p>
    <label for="${slotId}">Suggested change</label>
    <textarea id="${slotId}" data-changes="${esc(key)}" ${locked ? "disabled" : ""} placeholder="Required if you reject. Paste the caption you want, or say what to change.">${esc(rev.changes || "")}</textarea>
    <div class="actions">
      <button type="button" class="primary" data-approve="${esc(key)}" ${locked || rev.decision === "approved" ? "disabled" : ""}>Accept</button>
      <button type="button" class="ghost" data-reject="${esc(key)}" ${locked || rev.decision === "rejected" ? "disabled" : ""}>Reject</button>
      ${
        decided
          ? `<span class="pill ${rev.decision === "approved" ? "accepted" : "turned-down"}">${esc(rev.decision)}</span>`
          : ""
      }
    </div>
  </div>`;
}

function assetUrl(path) {
  if (!path) return "";
  const rel = String(path).replace(/\\/g, "/").replace(/^\/+/, "");
  if (window.__DESK_STATIC__) return rel;
  return "/" + rel;
}

function captionFor(post, channel) {
  return publicCopy(((post.variants && post.variants[channel]) || post.body || "").trim());
}

function handleFor(channel) {
  const c = (state.channels || []).find((x) => x.id === channel);
  return (c && c.handle) || "";
}

function storyFrames(post, channel) {
  const assets = post.assets && post.assets.length ? post.assets : [""];
  const lines = captionFor(post, channel)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^Frame\s+\d/i.test(l));
  return assets.map((src, i) => ({
    src: assetUrl(src),
    text: publicCopy((lines[i] || "").replace(/^Frame\s+\d+\s*:\s*/i, "") || post.title),
  }));
}

function igFeed(post) {
  const cap = captionFor(post, "instagram");
  const src = assetUrl((post.assets && post.assets[0]) || "");
  const handle = handleFor("instagram") || "@south_coast_rods";
  return `<div class="device ig">
    <div class="device-bar">Instagram</div>
    <div class="ig-screen">
      <div class="ig-head"><span class="ig-avatar"></span><div><strong>${esc(handle)}</strong><div class="tiny">${esc(fmtTime(scheduleFor(post, "instagram")))}</div></div></div>
      <div class="ig-media feed"><img src="${esc(src)}" alt="" />${post.format === "reel" ? `<span class="play">▶</span>` : ""}</div>
      <div class="ig-icons">♡ 💬 ➤ <span class="ig-bookmark">Bookmark</span></div>
      <div class="ig-caption"><strong>${esc(handle)}</strong> ${esc(cap)}</div>
    </div>
  </div>`;
}

function igStory(post) {
  const frames = storyFrames(post, "instagram");
  const handle = handleFor("instagram") || "@south_coast_rods";
  const id = esc(post.id);
  return `<div class="device ig story-phone" data-story="${id}">
    <div class="device-bar">Instagram story</div>
    <div class="story-screen" data-story-stage="${id}">
      <div class="story-pips">${frames.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
      <div class="story-head"><span class="ig-avatar"></span> ${esc(handle)}</div>
      ${frames
        .map(
          (f, i) =>
            `<figure class="story-frame ${i === 0 ? "on" : ""}"><img src="${esc(f.src)}" alt="" /><figcaption>${esc(f.text)}</figcaption></figure>`
        )
        .join("")}
      <p class="tiny story-hint">Tap the photo to see the next frame</p>
    </div>
  </div>`;
}

function igReel(post) {
  const cap = captionFor(post, "instagram");
  const src = assetUrl((post.assets && post.assets[0]) || "");
  const handle = handleFor("instagram") || "@south_coast_rods";
  return `<div class="device ig dark">
    <div class="device-bar">Instagram reel</div>
    <div class="reel-screen">
      <img src="${esc(src)}" alt="" />
      <span class="play">▶</span>
      <div class="reel-meta"><strong>${esc(handle)}</strong><p>${esc(cap)}</p></div>
    </div>
  </div>`;
}

function fbPost(post) {
  const cap = captionFor(post, "facebook");
  const src = assetUrl((post.assets && post.assets[0]) || "");
  const handle = handleFor("facebook") || "southcoastrods";
  return `<div class="fb-card">
    <div class="fb-head"><span class="ig-avatar"></span><div><strong>${esc(handle)}</strong><div class="tiny">${esc(fmtTime(scheduleFor(post, "facebook")))} - Facebook</div></div></div>
    <p class="fb-copy">${esc(cap)}</p>
    <div class="fb-media ${post.format === "story" || post.format === "reel" ? "tall" : ""}"><img src="${esc(src)}" alt="" /></div>
    <div class="fb-actions">Like - Comment - Share</div>
  </div>`;
}

function tiktokPost(post) {
  const cap = captionFor(post, "tiktok");
  const src = assetUrl((post.assets && post.assets[0]) || "");
  const handle = handleFor("tiktok") || "@south_coast_rods";
  return `<div class="device tt">
    <div class="device-bar">TikTok</div>
    <div class="tt-screen">
      <img src="${esc(src)}" alt="" />
      <span class="play">▶</span>
      <div class="tt-rail">♡<br>💬<br>➤<br>＋</div>
      <div class="tt-meta"><strong>${esc(handle)}</strong><p>${esc(cap)}</p></div>
    </div>
  </div>`;
}

function mockFor(post, channel) {
  if (channel === "facebook") return fbPost(post);
  if (channel === "tiktok") return tiktokPost(post);
  if (post.format === "story") return igStory(post);
  if (post.format === "reel" || post.format === "short") return igReel(post);
  return igFeed(post);
}

function renderPreview() {
  const week = state.approval?.week || {};
  const posts = weekPosts();
  const status = week.status || "none";
  const progress = reviewProgress();
  const remaining = Math.max(0, progress.total - progress.decided);
  return `
    <div class="banner preview-banner">
      <div>
        <h2>Week of ${esc(week.weekStart || "-")} - as it will look</h2>
        <p>Accept or Reject sits under every Instagram, Facebook, and TikTok mock. Rejecting one does not change the others. A follow-up text is sent only after every item has a decision, and only if something was rejected.</p>
        <p class="review-progress">${progress.decided} of ${progress.total} decided${remaining ? " - " + remaining + " left" : " - all decided"}</p>
        ${reviewFlash ? `<p class="tiny">${esc(reviewFlash)}</p>` : ""}
        <p class="tiny">SMS status: ${esc(status)}${week.smsSentAt ? " - texts already sent to Graham and Stuart" : ""} - test mode ${state.testMode ? "on (nothing uploads)" : "off"}</p>
      </div>
    </div>
    ${
      posts.length
        ? posts
            .map((p) => {
              const shown = reviewChannels(p);
              return `<section class="preview-slot" data-post-id="${esc(p.id)}">
                <header>
                  <h3 class="serif">${esc(publicCopy(p.title))}</h3>
                  <p class="muted">${esc(p.format)} - ${esc(p.pillar)}</p>
                  <p class="tiny">${esc(scheduleSummary(p))}</p>
                  ${p.mediaNotes ? `<p class="tiny">${esc(publicCopy(p.mediaNotes))}</p>` : ""}
                  ${p.requestedChanges ? `<p class="tiny">Last requested change: ${esc(p.requestedChanges)}</p>` : ""}
                </header>
                ${shown
                  .map(
                    (ch) => `<div class="preview-item" data-review-item="${esc(reviewKey(p.id, ch))}">
                  <p class="phone-label">${esc(channelName(ch))} ${p.format === "story" ? "story" : "post"} - ${esc(fmtTime(scheduleFor(p, ch)))}</p>
                  ${mockFor(p, ch)}
                  ${reviewBoxHtml(p, ch)}
                </div>`
                  )
                  .join("")}
              </section>`;
            })
            .join("")
        : `<p class="muted">No draft posts in this week pack.</p>`
    }
  `;
}

function applyReviewInstruction(text, notes) {
  let out = String(text || "");
  const parts = String(notes || "")
    .trim()
    .split(/(?<=\.)\s+(?=(Add|Change|Remove|On #|Swap|Use |Take |Put |Cut |Delete))/i)
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter(Boolean);
  parts.forEach((part) => {
    let m = part.match(/^change\s+(.+?)\s+to\s+(.+)$/i);
    if (m) {
      const to = m[2].trim();
      if (/^something more/i.test(to)) return;
      const from = m[1].trim();
      out = out.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), to);
      return;
    }
    m = part.match(/^add\s+(#[A-Za-z0-9_]+)$/i);
    if (m) {
      if (!out.includes(m[1])) out = /#/.test(out) ? out.trimEnd() + " " + m[1] : out.trimEnd() + "\n\n" + m[1];
      return;
    }
    m = part.match(/^add\s+(.+?)\s+to the front of\s+(.+)$/i);
    if (m) {
      let prefix = m[1].trim();
      const t = prefix.match(/^(\d+)\s*T$/i);
      if (t) prefix = t[1] + "T";
      out = out.replace(new RegExp(m[2].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), prefix + " " + m[2].trim());
      return;
    }
    m = part.match(/^add\s+(.+?)\s+to\s+(.+)$/i);
    if (m) {
      const insert = m[1].trim();
      const anchor = m[2].trim();
      const bits = anchor.match(/^(\S+)\s+(.+)$/);
      if (bits) out = out.replace(new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), bits[1] + " " + insert + " " + bits[2]);
      return;
    }
    m = part.match(/^remove\s+(.+)$/i);
    if (m) {
      out = out.replace(new RegExp(m[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "");
      out = out.replace(/,\s*,/g, ",").replace(/[ \t]{2,}/g, " ");
      return;
    }
    m = part.match(/^on\s+(#[A-Za-z0-9_]+)/i);
    if (m) {
      const tag = m[1];
      const model = tag.match(/^#southcoastrods(.+)$/i);
      if (model) out = out.split(tag).join("#southcoastrods #" + model[1]);
    }
  });
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\b(\w+)\s+\1\b/gi, "$1").trimEnd();
}

function looksLikeFullCaption(notes) {
  const s = String(notes || "").trim();
  if (!s) return false;
  if (/^(add|change|remove|on #|swap|use |take |put |cut |delete)/i.test(s)) return false;
  return /^Frame\s+\d/i.test(s) || (s.length >= 80 && /#/.test(s));
}

function applyRejectedCopy(post) {
  ensureReview(post);
  const rejectedNotes = [];
  reviewChannels(post).forEach((ch) => {
    const rev = ensureChannelReview(post, ch);
    if (rev.decision !== "rejected") return;
    const notes = String(rev.changes || "").trim();
    if (!notes) return;
    rejectedNotes.push(channelName(ch) + ": " + notes);
    const current = captionFor(post, ch);
    if (!post.variants) post.variants = {};
    if (looksLikeFullCaption(notes)) post.variants[ch] = notes;
    else {
      const updated = applyReviewInstruction(current, notes);
      if (updated && updated !== current) post.variants[ch] = updated;
    }
    rev.decision = null;
    rev.changes = "";
    rev.decidedAt = null;
  });
  const notes = rejectedNotes.join(" | ") || String(post.review.changes || "").trim();
  if (notes) {
    post.requestedChanges = notes;
    post.approvalNotes = "Rejected change: " + notes;
  }
  post.review.decision = null;
  post.review.changes = "";
  post.review.appliedAt = new Date().toISOString();
  post.review.round = (Number(post.review.round) || 1) + 1;
}

function reviewSmsBody(rejected) {
  const weekStart = state.approval?.week?.weekStart || "";
  const lines = [`SCR REVIEW ${weekStart}`];
  reviewTargets().forEach(({ post, channel }) => {
    const rev = ensureChannelReview(post, channel);
    const d = rev.decision === "rejected" ? "REJECT" : "APPROVE";
    const extra = d === "REJECT" ? " " + String(rev.changes || "").replace(/\s+/g, " ").trim() : "";
    lines.push(`${reviewKey(post.id, channel)} ${d}${extra}`.trim());
  });
  return lines.join("\n").slice(0, 1400);
}

function openReviewSms(rejected) {
  const phone = (state.approval && state.approval.smsReplyTo) || "";
  const body = reviewSmsBody(rejected);
  const ask = rejected.length
    ? "All posts decided. Send one text so the desk can apply any rejects, then only then send you a new Preview?"
    : "All posts accepted. Send one text so the desk can record it? You will not get another Preview text.";
  if (!phone) {
    window.alert(ask + "\n\n" + body);
    return;
  }
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const href = ios ? `sms:${phone}&body=${encodeURIComponent(body)}` : `sms:${phone}?body=${encodeURIComponent(body)}`;
  if (window.confirm(ask)) window.location.href = href;
}

function approveWeekFromPosts() {
  if (!state.approval) state.approval = {};
  if (!state.approval.week) state.approval.week = {};
  state.approval.week.status = "approved";
  state.approval.week.signOff = { who: "preview", when: new Date().toISOString(), decision: "approve" };
  state.approval.week.notes = "Every post/story accepted in Preview.";
  state.approval.week.sendSmsAfterRevision = false;
  if (!state.testMode) {
    weekPosts().forEach((p) => {
      p.status = "scheduled";
    });
  }
}

async function maybeCompleteReview() {
  if (completingReview || !allPostsDecided()) return;
  completingReview = true;
  try {
    const rejected = weekPosts().filter((p) => p.review && p.review.decision === "rejected");
    if (!rejected.length) {
      approveWeekFromPosts();
      persistStoredReviews();
      reviewFlash = "Every post accepted. No follow-up text.";
      if (window.__DESK_STATIC__) openReviewSms([]);
      else await saveStateNow();
      render();
      return;
    }
    if (window.__DESK_STATIC__) {
      persistStoredReviews();
      reviewFlash = "All posts decided. Send the one review text so changes can be applied, then a new Preview SMS goes out.";
      openReviewSms(rejected);
      render();
      return;
    }
    rejected.forEach(applyRejectedCopy);
    if (!state.approval) state.approval = {};
    if (!state.approval.week) state.approval.week = {};
    state.approval.week.status = "awaiting";
    state.approval.week.sendSmsAfterRevision = true;
    state.approval.week.signOff = { who: "preview", when: new Date().toISOString(), decision: "reject", notes: rejected.map((p) => p.id).join(", ") };
    state.approval.week.notes = "Per-post review: " + rejected.length + " rejected and revised. Follow-up SMS after every post was decided.";
    persistStoredReviews();
    await saveStateNow();
    try {
      await fetch("/api/review/complete", { method: "POST" });
      reviewFlash = "Changes applied. A follow-up Preview text is queued for Graham and Stuart.";
    } catch (e) {
      reviewFlash = "Changes applied. Start the Windows task SCR Preview SMS so the follow-up text goes out.";
    }
    render();
  } finally {
    completingReview = false;
  }
}

async function saveStateNow() {
  clearTimeout(saveTimer);
  await saveState();
}

async function decidePost(id, decision, sourceEl) {
  const parsed = parseReviewKey(id);
  const post = weekPosts().find((p) => p.id === parsed.postId);
  if (!post) return;
  const channel = parsed.channel || reviewChannels(post)[0];
  let changes = "";
  if (sourceEl) {
    const root = sourceEl.closest(".review-box");
    const box = root && root.querySelector("[data-changes]");
    if (box && box.getAttribute("data-changes") === reviewKey(post.id, channel)) changes = String(box.value || "").trim();
  }
  const rev = ensureChannelReview(post, channel);
  if (!changes) changes = String(rev.changes || "").trim();
  if (decision === "rejected" && !changes) {
    window.alert("Write a suggested change in the box before rejecting this item.");
    return;
  }
  rev.decision = decision;
  rev.changes = changes;
  rev.decidedAt = new Date().toISOString();
  syncPostDecision(post);
  persistStoredReviews();
  if (!window.__DESK_STATIC__) queueSave();
  render();
  await maybeCompleteReview();
}

function approveWeek() {
  window.alert("Use Accept or Reject on each post. A follow-up text is only sent after every post has a decision.");
}

function rejectWeek() {
  window.alert("Use Reject on the post you want changed, and write the change in its box.");
}

function advanceStory(root) {
  const frames = [...root.querySelectorAll(".story-frame")];
  if (!frames.length) return;
  const i = frames.findIndex((f) => f.classList.contains("on"));
  const next = (i + 1) % frames.length;
  frames.forEach((f, n) => f.classList.toggle("on", n === next));
  root.querySelectorAll(".story-pips i").forEach((p, n) => p.classList.toggle("on", n === next));
}

function renderToday() {
  const c = counts();
  const todayPosts = (state.posts || [])
    .filter((p) => sameDay(parseLocal(p.scheduledFor), new Date()) || p.status === "review" || isOverdue(p))
    .sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  const brandName = state.brand?.name || "Your Brand";
  return `
    <div class="banner">
      <h2>${esc(brandName)}</h2>
      <p>${esc(state.brand?.tagline || "Open Brand and replace the starter kit, then tell the agent to plan the week.")}</p>
    </div>
    <div class="grid stats">
      <div class="stat"><h3>Needs review</h3><strong>${c.review}</strong></div>
      <div class="stat"><h3>Due today</h3><strong>${c.today}</strong></div>
      <div class="stat"><h3>Overdue</h3><strong>${c.overdue}</strong></div>
      <div class="stat"><h3>Scheduled</h3><strong>${c.scheduled}</strong></div>
    </div>
    <h2 class="serif" style="margin:28px 0 12px">On the desk</h2>
    <div class="grid">${todayPosts.length ? todayPosts.map(postRow).join("") : `<p class="muted">Nothing due. Plan the week from chat, or create a post.</p>`}</div>
  `;
}

function weekDays() {
  const start = startOfDay(new Date());
  const day = start.getDay();
  start.setDate(start.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function renderCalendar() {
  const days = weekDays();
  return `
    <h2 class="serif">This week</h2>
    <p class="muted">Click a post to edit. Empty days are a gap — fill them from chat or New post.</p>
    <div class="grid week">
      ${days
        .map((d) => {
          const items = (state.posts || []).filter((p) => sameDay(parseLocal(p.scheduledFor), d));
          return `<section class="day ${sameDay(d, new Date()) ? "today" : ""}">
            <h3>${esc(fmtDay(d))}</h3>
            ${items.map((p) => `<button class="chip" data-edit="${esc(p.id)}"><span class="pill ${esc(p.status)}">${esc(p.status)}</span><br>${esc(p.title)}</button>`).join("") || `<p class="tiny">Open</p>`}
          </section>`;
        })
        .join("")}
    </div>
  `;
}

function renderQueue() {
  const posts = (state.posts || []).filter((p) => filter === "all" || p.status === filter || (filter === "overdue" && isOverdue(p)));
  const sorted = [...posts].sort((a, b) => String(a.scheduledFor).localeCompare(String(b.scheduledFor)));
  return `
    <div class="filters">
      ${["all", ...STATUS, "overdue"].map((s) => `<button class="ghost ${filter === s ? "active" : ""}" data-filter="${s}">${s}</button>`).join("")}
    </div>
    <div class="grid">${sorted.length ? sorted.map(postRow).join("") : `<p class="muted">No posts in this filter.</p>`}</div>
  `;
}

function postRow(p) {
  const overdue = isOverdue(p);
  return `<article class="post-row" data-edit="${esc(p.id)}">
    <div>
      <span class="pill ${esc(p.status)}">${esc(p.status)}</span>
      ${overdue ? `<span class="pill overdue">overdue</span>` : ""}
      <div class="tiny">${esc(scheduleSummary(p))}</div>
    </div>
    <div>
      <h3>${esc(p.title)}</h3>
      <p class="muted">${esc(p.format)} · ${esc(p.pillar)} · ${(p.channels || []).map(channelName).join(", ")}</p>
      <p>${esc((p.body || "").split("\n")[0])}</p>
    </div>
    <div class="actions" onclick="event.stopPropagation()">
      <button class="ghost" data-edit="${esc(p.id)}">Open</button>
      ${p.status !== "published" ? `<button class="ghost" data-advance="${esc(p.id)}">${p.status === "scheduled" ? "Mark published" : "Advance"}</button>` : ""}
    </div>
  </article>`;
}

function renderChannels() {
  return `<div class="grid cards">${(state.channels || [])
    .map((c) => {
      const upcoming = (state.posts || []).filter((p) => (p.channels || []).includes(c.id) && p.status !== "published").length;
      return `<article class="channel ${c.status === "paused" ? "quiet" : ""}">
        <h3>${esc(c.name)}</h3>
        <p class="muted">${esc(c.handle || "Handle not set")}</p>
        <p><span class="pill">${esc(c.status)}</span><span class="pill">${esc(c.cadence)}</span></p>
        <p class="tiny">Best times: ${(c.bestTimes || []).join(", ") || "—"}</p>
        <p>${esc(c.notes || "")}</p>
        <p class="tiny">${upcoming} in queue</p>
      </article>`;
    })
    .join("")}</div>
    <p class="muted" style="margin-top:16px">Edit handles and cadence in <code>data/desk.json</code> or ask the agent to pause a channel.</p>`;
}

function renderBrand() {
  const b = state.brand || {};
  return `
    <div class="grid two">
      <form id="brand-form" class="card">
        <label>Brand name</label>
        <input name="name" value="${esc(b.name || "")}" />
        <label>One-liner</label>
        <textarea name="tagline">${esc(b.tagline || "")}</textarea>
        <label>Website</label>
        <input name="website" value="${esc(b.website || "")}" />
        <label>Default hashtags (comma separated)</label>
        <input name="hashtags" value="${esc((b.hashtags || []).join(", "))}" />
        <label>CTAs (one per line)</label>
        <textarea name="ctas">${esc((b.ctas || []).join("\n"))}</textarea>
        <button class="primary" type="submit">Save brand</button>
      </form>
      <div>
        <div class="card">
          <h3>Voice lives in files</h3>
          <p>The agent reads <code>brand/voice.md</code>, <code>brand/pillars.md</code>, and <code>brand/visual.md</code> every session. Put the real tone there — this panel is only the short kit used by the desk.</p>
        </div>
      </div>
    </div>
  `;
}

function handleReviewClick(e) {
  const approve = e.target.closest("[data-approve]");
  const reject = e.target.closest("[data-reject]");
  const btn = approve || reject;
  if (!btn || btn.hasAttribute("disabled")) return;
  const box = btn.closest("[data-review-for]");
  const id = (box && box.getAttribute("data-review-for")) || btn.getAttribute(approve ? "data-approve" : "data-reject");
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  decidePost(id, approve ? "approved" : "rejected", btn);
}

function handleReviewInput(e) {
  const el = e.target.closest("[data-changes]");
  if (!el) return;
  const parsed = parseReviewKey(el.getAttribute("data-changes"));
  const post = weekPosts().find((p) => p.id === parsed.postId);
  if (!post) return;
  const channel = parsed.channel || reviewChannels(post)[0];
  ensureChannelReview(post, channel).changes = el.value;
  persistStoredReviews();
}

function bindView() {
  const approve = $("approve-week");
  const reject = $("reject-week");
  if (approve) approve.addEventListener("click", approveWeek);
  if (reject) reject.addEventListener("click", rejectWeek);
  const root = $("view");
  if (root && root.dataset.reviewClicks !== "1") {
    root.dataset.reviewClicks = "1";
    root.addEventListener("click", handleReviewClick);
    root.addEventListener("input", handleReviewInput);
  }
  document.querySelectorAll(".story-phone").forEach((phone) => {
    phone.addEventListener("click", () => advanceStory(phone));
  });
  document.querySelectorAll("[data-edit]").forEach((el) => el.addEventListener("click", () => openPost(el.dataset.edit)));
  document.querySelectorAll("[data-filter]").forEach((el) =>
    el.addEventListener("click", () => {
      filter = el.dataset.filter;
      render();
    })
  );
  document.querySelectorAll("[data-advance]").forEach((el) => el.addEventListener("click", () => advancePost(el.dataset.advance)));
  const brandForm = $("brand-form");
  if (brandForm) {
    brandForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(brandForm);
      state.brand = {
        ...state.brand,
        name: fd.get("name"),
        tagline: fd.get("tagline"),
        website: fd.get("website"),
        hashtags: String(fd.get("hashtags") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        ctas: String(fd.get("ctas") || "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      queueSave();
    });
  }
}

function advancePost(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return;
  const i = STATUS.indexOf(post.status);
  post.status = STATUS[Math.min(i + 1, STATUS.length - 1)];
  queueSave();
  render();
}

function openPost(id) {
  editingId = id || null;
  const post = id ? state.posts.find((p) => p.id === id) : emptyPost();
  $("drawer").hidden = false;
  $("backdrop").hidden = false;
  $("post-form").innerHTML = `
    <div class="drawer-head">
      <h2>${id ? "Edit post" : "New post"}</h2>
      <button type="button" class="ghost" id="close-drawer">Close</button>
    </div>
    <label>Title</label>
    <input name="title" required value="${esc(post.title)}" />
    <label>Status</label>
    <select name="status">${STATUS.map((s) => `<option ${post.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <label>Format</label>
    <select name="format">${FORMATS.map((s) => `<option ${post.format === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <label>Pillar</label>
    <select name="pillar">${PILLARS.map((s) => `<option ${post.pillar === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <label>Schedule</label>
    <input name="scheduledFor" type="datetime-local" value="${toLocalInput(post.scheduledFor)}" />
    <label>Channels</label>
    <div class="checks">${(state.channels || [])
      .map(
        (c) =>
          `<label><input type="checkbox" name="channels" value="${esc(c.id)}" ${(post.channels || []).includes(c.id) ? "checked" : ""} /> ${esc(c.name)}</label>`
      )
      .join("")}</div>
    <label>Canonical copy</label>
    <textarea name="body">${esc(post.body)}</textarea>
    <label>Hashtags</label>
    <input name="hashtags" value="${esc((post.hashtags || []).join(" "))}" />
    <label>CTA</label>
    <input name="cta" value="${esc(post.cta || "")}" />
    <label>Media notes</label>
    <textarea name="mediaNotes">${esc(post.mediaNotes || "")}</textarea>
    <label>Approval notes</label>
    <textarea name="approvalNotes">${esc(post.approvalNotes || "")}</textarea>
    ${(state.channels || [])
      .map(
        (c) =>
          `<label>${esc(c.name)} variant</label><textarea name="variant-${esc(c.id)}">${esc((post.variants || {})[c.id] || "")}</textarea>`
      )
      .join("")}
    <div class="actions">
      <button class="primary" type="submit">Save post</button>
      ${id ? `<button class="ghost" type="button" id="copy-caption">Copy caption</button>` : ""}
      ${id ? `<button class="ghost" type="button" id="open-network">Open first network</button>` : ""}
      ${id ? `<button class="ghost" type="button" id="delete-post">Delete</button>` : ""}
    </div>
  `;
  $("close-drawer").onclick = closeDrawer;
  $("backdrop").onclick = closeDrawer;
  if ($("copy-caption")) $("copy-caption").onclick = () => copyCaption(post);
  if ($("open-network")) $("open-network").onclick = () => openNetwork(post);
  if ($("delete-post")) $("delete-post").onclick = () => deletePost(post.id);
}

function emptyPost() {
  return {
    id: "",
    title: "",
    pillar: "craft",
    format: "reel",
    status: "draft",
    scheduledFor: "",
    channels: ["instagram"],
    body: "",
    variants: {},
    hashtags: [],
    cta: "",
    mediaNotes: "",
    approvalNotes: "",
  };
}

function toLocalInput(iso) {
  const d = parseLocal(iso);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return "";
  return value.length === 16 ? `${value}:00` : value;
}

function closeDrawer() {
  $("drawer").hidden = true;
  $("backdrop").hidden = true;
  editingId = null;
}

function readForm(form) {
  const fd = new FormData(form);
  const channels = fd.getAll("channels");
  const variants = {};
  channels.forEach((cid) => {
    const v = fd.get(`variant-${cid}`);
    if (v) variants[cid] = String(v);
  });
  return {
    title: String(fd.get("title") || "").trim(),
    status: String(fd.get("status")),
    format: String(fd.get("format")),
    pillar: String(fd.get("pillar")),
    scheduledFor: fromLocalInput(String(fd.get("scheduledFor") || "")),
    channels,
    body: String(fd.get("body") || ""),
    hashtags: String(fd.get("hashtags") || "")
      .split(/[\s,]+/)
      .filter(Boolean),
    cta: String(fd.get("cta") || ""),
    mediaNotes: String(fd.get("mediaNotes") || ""),
    approvalNotes: String(fd.get("approvalNotes") || ""),
    variants,
  };
}

async function copyCaption(post) {
  const first = post.channels?.[0];
  const text = [(post.variants && first && post.variants[first]) || post.body, (post.hashtags || []).join(" ")].filter(Boolean).join("\n\n");
  await navigator.clipboard.writeText(text);
  $("save-state").textContent = "Caption copied";
}

function openNetwork(post) {
  const first = post.channels?.[0];
  if (!first) return;
  const text = (post.variants && post.variants[first]) || post.body || "";
  const dest = COMPOSE[first];
  const url = typeof dest === "function" ? dest(text) : dest;
  if (url) window.open(url, "_blank", "noopener");
}

function deletePost(id) {
  if (!confirm("Delete this post from the desk?")) return;
  state.posts = state.posts.filter((p) => p.id !== id);
  queueSave();
  closeDrawer();
  render();
}

$("post-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = readForm(e.target);
  if (!data.title) return;
  if (editingId) {
    const i = state.posts.findIndex((p) => p.id === editingId);
    state.posts[i] = { ...state.posts[i], ...data, id: editingId };
  } else {
    state.posts.push({ ...data, id: `p-${Date.now()}` });
  }
  queueSave();
  closeDrawer();
  render();
});

document.querySelectorAll(".nav button[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
$("new-post").addEventListener("click", () => openPost(null));

async function boot() {
  await loadState();
  render();
  if (window.__DESK_STATIC__) return;
  setInterval(async () => {
    if (dirty) return;
    const before = JSON.stringify(state);
    await loadState();
    if (JSON.stringify(state) !== before) render();
  }, 4000);
}

boot().catch((err) => {
  $("view").innerHTML = `<div class="banner"><h2>Desk needs the local server</h2><p>${esc(err.message)}. Double-click <code>Start Social Desk.bat</code>.</p></div>`;
});
