window.__WEEK_REVIEW__ = [{"title":"Stories: ST13 product - three frames","format":"story","id":"p-story-st13","channels":["instagram","facebook"]},{"title":"Reel/TikTok: ST13 is the casting tool","format":"reel","id":"p-reel-st13-cast","channels":["instagram","tiktok"]},{"title":"Stories: ST-Ci Titanium TZ guides","format":"story","id":"p-story-st-ci","channels":["instagram","facebook","tiktok"]},{"title":"ST12 - the all-rounder","format":"static","id":"p-st12-allrounder","channels":["facebook","instagram"]},{"title":"Official sponsors - Carp Team England","format":"static","id":"p-cte-sponsors","channels":["instagram","tiktok","facebook"]},{"title":"Invite: send catches to media@","format":"story","id":"p-invite-media-inbox","channels":["instagram","facebook"]}];
(function () {
  function paint() {
    if (document.querySelector(".review-box")) return;
    var main = document.getElementById("view");
    if (!main) return;
    var items = window.__WEEK_REVIEW__;
    if (!items || !items.length) return;
    var html = '<div class="banner preview-banner"><h2>Week Preview</h2><p>Accept or Reject under every Instagram, Facebook, and TikTok mock.</p></div>';
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      var kind = p.format === "story" ? "story" : "post";
      var chans = p.channels && p.channels.length ? p.channels : ["instagram"];
      html += '<section class="preview-slot"><header><h3 class="serif">' + String(p.title || "") + '</h3><p class="muted">' + kind + '</p></header>';
      for (var c = 0; c < chans.length; c++) {
        var ch = chans[c];
        var key = p.id + "::" + ch;
        html += '<div class="preview-item"><p class="phone-label">' + ch + ' ' + kind + '</p>';
        html += '<div class="review-box" data-review-for="' + key + '"><p class="review-box-title">Accept or Reject this ' + ch + ' ' + kind + '</p>';
        html += '<label>Suggested change</label><textarea data-changes="' + key + '" placeholder="Required if you reject. Paste the caption you want, or say what to change."></textarea>';
        html += '<div class="actions"><button type="button" class="primary" data-approve="' + key + '">Accept</button>';
        html += '<button type="button" class="ghost" data-reject="' + key + '">Reject</button></div></div></div>';
      }
      html += '</section>';
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