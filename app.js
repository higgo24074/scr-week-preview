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

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

function fmtTime(iso) {
  const d = parseLocal(iso);
  if (!d) return "Unscheduled";
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
    const res = await fetch("state.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load the hosted Preview");
    state = await res.json();
    dirty = false;
    $("save-state").textContent = "Reply APPROVE by SMS";
    $("save-state").className = "save-state ok";
    document.body.classList.add("static-preview");
    const neu = $("new-post");
    if (neu) neu.hidden = true;
    return;
  }
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load desk.json");
  state = await res.json();
  dirty = false;
  $("save-state").textContent = "Saved";
  $("save-state").className = "save-state ok";
}

async function saveState() {
  if (window.__DESK_STATIC__) {
    $("save-state").textContent = "Reply APPROVE or REJECT by SMS";
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
  view = next;
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

function assetUrl(path) {
  if (!path) return "";
  const rel = String(path).replace(/\\/g, "/").replace(/^\/+/, "");
  if (window.__DESK_STATIC__) return rel;
  return "/" + rel;
}

function captionFor(post, channel) {
  return ((post.variants && post.variants[channel]) || post.body || "").trim();
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
    text: (lines[i] || "").replace(/^Frame\s+\d+\s*:\s*/i, "") || post.title,
  }));
}

function igFeed(post) {
  const cap = captionFor(post, "instagram");
  const src = assetUrl((post.assets && post.assets[0]) || "");
  const handle = handleFor("instagram") || "@south_coast_rods";
  return `<div class="device ig">
    <div class="device-bar">Instagram</div>
    <div class="ig-screen">
      <div class="ig-head"><span class="ig-avatar"></span><div><strong>${esc(handle)}</strong><div class="tiny">${esc(fmtTime(post.scheduledFor))}</div></div></div>
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
    <div class="fb-head"><span class="ig-avatar"></span><div><strong>${esc(handle)}</strong><div class="tiny">${esc(fmtTime(post.scheduledFor))} · Facebook</div></div></div>
    <p class="fb-copy">${esc(cap)}</p>
    <div class="fb-media ${post.format === "story" || post.format === "reel" ? "tall" : ""}"><img src="${esc(src)}" alt="" /></div>
    <div class="fb-actions">Like · Comment · Share</div>
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
  return `
    <div class="banner preview-banner">
      <div>
        <h2>Week of ${esc(week.weekStart || "—")} — as it will look</h2>
        <p>These are the planned Instagram, Facebook and TikTok posts from the real OneDrive shots and captions. Look through them, then ${window.__DESK_STATIC__ ? "reply APPROVE or REJECT by SMS" : "approve or reject the week"}. Test mode is ${state.testMode ? "on (nothing uploads)" : "off"}.</p>
        <p class="tiny">SMS status: ${esc(status)}${week.smsSentAt ? " · texts already sent to Graham and Stuart" : ""}</p>
      </div>
      <div class="actions">
        ${
          window.__DESK_STATIC__
            ? `<p class="tiny">This page stays up with the PC off. Reply <strong>APPROVE</strong> or <strong>REJECT</strong> by text.</p>`
            : `<button class="primary" id="approve-week" ${status === "approved" ? "disabled" : ""}>Approve week</button>
        <button class="ghost" id="reject-week">Reject week</button>`
        }
      </div>
    </div>
    ${
      posts.length
        ? posts
            .map((p) => {
              const channels = (p.channels || []).filter((id) => id === "instagram" || id === "facebook" || id === "tiktok");
              return `<section class="preview-slot">
                <header>
                  <h3 class="serif">${esc(p.title)}</h3>
                  <p class="muted">${esc(fmtTime(p.scheduledFor))} · ${esc(p.format)} · ${esc(p.pillar)}</p>
                  ${p.mediaNotes ? `<p class="tiny">${esc(p.mediaNotes)}</p>` : ""}
                </header>
                <div class="phones">${channels.map((ch) => `<div><p class="phone-label">${esc(channelName(ch))}</p>${mockFor(p, ch)}</div>`).join("")}</div>
              </section>`;
            })
            .join("")
        : `<p class="muted">No draft posts in this week pack.</p>`
    }
  `;
}

function approveWeek() {
  if (window.__DESK_STATIC__) {
    window.alert("Reply APPROVE by SMS to Graham or Stuart's text.");
    return;
  }
  if (!state.approval) state.approval = {};
  if (!state.approval.week) state.approval.week = {};
  state.approval.week.status = "approved";
  state.approval.week.signOff = { who: "desk", when: new Date().toISOString(), decision: "approve" };
  state.approval.week.notes = "Approved from Social Desk preview after seeing the posts as they will look on IG / Facebook / TikTok.";
  if (!state.testMode) {
    weekPosts().forEach((p) => {
      p.status = "scheduled";
    });
  }
  queueSave();
  render();
}

function rejectWeek() {
  if (window.__DESK_STATIC__) {
    window.alert("Reply REJECT by SMS and say what to change.");
    return;
  }
  const notes = window.prompt("REJECT — what should change?");
  if (notes == null) return;
  if (!state.approval) state.approval = {};
  if (!state.approval.week) state.approval.week = {};
  state.approval.week.status = "rejected";
  state.approval.week.signOff = { who: "desk", when: new Date().toISOString(), decision: "reject", notes };
  state.approval.week.notes = notes;
  queueSave();
  render();
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
      <div class="tiny">${esc(fmtTime(p.scheduledFor))}</div>
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

function bindView() {
  const approve = $("approve-week");
  const reject = $("reject-week");
  if (approve) approve.addEventListener("click", approveWeek);
  if (reject) reject.addEventListener("click", rejectWeek);
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
