window.__WEEK_REVIEW__ = [{"title":"Stories: ST13 product - three frames","format":"story","id":"p-story-st13"},{"title":"Reel/TikTok: ST13 is the casting tool","format":"reel","id":"p-reel-st13-cast"},{"title":"Stories: ST-Ci Titanium TZ guides","format":"story","id":"p-story-st-ci"},{"title":"ST12 - the all-rounder","format":"static","id":"p-st12-allrounder"},{"title":"Official sponsors - Carp Team England","format":"static","id":"p-cte-sponsors"},{"title":"Invite: send catches to media@","format":"story","id":"p-invite-media-inbox"}];
(function () {
  function paint() {
    if (document.querySelector(".review-box")) return;
    var main = document.getElementById("view");
    if (!main) return;
    var items = window.__WEEK_REVIEW__;
    if (!items || !items.length) return;
    var html = '<div class="banner preview-banner"><h2>Week Preview</h2><p>Accept or Reject each post or story. Scroll under every photo.</p></div>';
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      var kind = p.format === "story" ? "story" : "post";
      html += '<section class="preview-slot"><header><h3 class="serif">' + String(p.title || "") + '</h3><p class="muted">' + kind + '</p></header>';
      html += '<div class="review-box"><p class="review-box-title">Your decision on this ' + kind + '</p>';
      html += '<label>Suggested change</label><textarea data-changes="' + p.id + '" placeholder="Required if you reject. Paste the caption you want, or say what to change."></textarea>';
      html += '<div class="actions"><button type="button" class="primary" data-approve="' + p.id + '">Accept this ' + kind + '</button>';
      html += '<button type="button" class="ghost" data-reject="' + p.id + '">Reject this ' + kind + '</button></div></div></section>';
    }
    main.innerHTML = html;
  }
  var n = 0;
  var t = setInterval(function () {
    n += 1;
    if (document.querySelector(".review-box") || n > 16) { clearInterval(t); return; }
    paint();
  }, 500);
})();