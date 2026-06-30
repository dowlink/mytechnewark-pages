/**
 * kb-stub-velo.js
 * Paste into: Wix Editor → Dev Mode → Page Code panel
 * Dynamic page: /kbarticles/{slug}  (KBArticles CMS collection)
 *
 * What this does:
 *  1. Gets the slug from the URL
 *  2. Queries the KBArticles collection for a matching item
 *  3. Populates page elements (title, tier, summary, tags, related articles)
 *  4. Starts a 5-second countdown then auto-redirects to ServiceNow (or Canvas)
 *  5. "Go Now" button navigates immediately; "Cancel" button stops the countdown
 *  6. Logs view + click-through events to KBAnalytics
 *
 * Page element IDs required in the Wix Editor:
 *   #articleTitle      Text element — article heading
 *   #tierBadge         Text element — tier label (How To / What's Possible / Best Practice)
 *   #categoryName      Text element — category name
 *   #articleSummary    Text element — summary paragraph
 *   #countdownNum      Text element — countdown number
 *   #redirectStatus    Box          — full countdown strip (visible by default)
 *   #progressBar       Box          — animated progress bar (set initial width 0% in editor)
 *   #ctaBtn            Button       — "View Full Article" → ServiceNow
 *   #cancelBtn         Button/Link  — "Stay on this page"
 *   #tagsRepeater      Repeater     — tag pills (optional; hide if no tags)
 *   #tagText           Text         — inside #tagsRepeater
 *   #relatedRepeater   Repeater     — related articles (optional)
 *   #relatedTitle      Text         — inside #relatedRepeater
 *   #relatedMeta       Text         — inside #relatedRepeater (tier · category)
 *   #relatedSection    Box          — wraps related section (hide if no related articles)
 */

import wixData from 'wix-data';
import wixLocation from 'wix-location';

// ── Config ────────────────────────────────────────────────────────────────────
const COUNTDOWN_SECONDS = 2;
const KB_BASE_URL       = 'https://rutgers.service-now.com/kb?id=kb_article_view&sysparm_article=';
const KB_INDEX_URL      = '/kbarticles';

// ── State ─────────────────────────────────────────────────────────────────────
let countdownInterval = null;
let destinationUrl    = null;
let cancelled         = false;

// ── Main ──────────────────────────────────────────────────────────────────────
$w.onReady(async function () {

  // 1. Extract slug from the URL path
  //    For /kbarticles/kb0019752, path = ['kbarticles', 'kb0019752']
  const pathSegments = wixLocation.path;
  const slug = pathSegments[pathSegments.length - 1];

  if (!slug) {
    wixLocation.to(KB_INDEX_URL);
    return;
  }

  // 2. Query the CMS
  let article;
  try {
    const result = await wixData.query('KBArticles')
      .eq('slug', slug)
      .limit(1)
      .find();

    if (!result.items.length) {
      console.warn('KBA not found for slug:', slug);
      wixLocation.to(KB_INDEX_URL);
      return;
    }
    article = result.items[0];
  } catch (err) {
    console.error('KBA query error:', err);
    wixLocation.to(KB_INDEX_URL);
    return;
  }

  // 3. Determine destination URL
  if (article.destinationType === 'canvas' && article.canvasUrl) {
    destinationUrl = article.canvasUrl;
  } else {
    destinationUrl = KB_BASE_URL + article.serviceNowArticleId;
  }

  // 4. Populate page elements (guard each with a try so missing elements don't break redirect)
  try { $w('#articleTitle').text    = article.title || ''; }      catch(e) {}
  try { $w('#tierBadge').text       = article.tier || ''; }        catch(e) {}
  try { $w('#categoryName').text    = article.categoryName || ''; } catch(e) {}
  try { $w('#articleSummary').text  = article.summary || ''; }     catch(e) {}
  try { $w('#countdownNum').text    = String(COUNTDOWN_SECONDS); }  catch(e) {}

  // Tags repeater
  try {
    if (article.tags && article.tags.length) {
      $w('#tagsRepeater').data = article.tags.map((tag, i) => ({ _id: String(i), tag }));
      $w('#tagsRepeater').onItemReady(($item, itemData) => {
        $item('#tagText').text = itemData.tag;
      });
    }
  } catch(e) {}

  // 5. Wire up buttons
  // CTA button opens ServiceNow in a new tab via native link (not JS popup)
  try {
    $w('#ctaBtn').link   = destinationUrl;
    $w('#ctaBtn').target = '_blank';
    $w('#ctaBtn').onClick(() => {
      clearInterval(countdownInterval);
      logClick(article);
      // navigation handled by .link / .target above
    });
  } catch(e) {}

  try {
    $w('#cancelBtn').onClick(() => {
      cancelled = true;
      clearInterval(countdownInterval);
      try { $w('#redirectStatus').hide(); } catch(e) {}
    });
  } catch(e) {}

  // 6. Log view
  logView(article);

  // 7. Start countdown AFTER a brief delay so the page has painted
  setTimeout(() => startCountdown(article), 300);

  // 8. Load related articles (same category, exclude current)
  loadRelated(article);
});

// ── Countdown ─────────────────────────────────────────────────────────────────
function startCountdown(article) {
  if (cancelled) return;

  let secondsLeft = COUNTDOWN_SECONDS;
  const totalMs   = COUNTDOWN_SECONDS * 1000;
  const startTime = Date.now();

  // Animate progress bar width from 0% → 100%
  try {
    $w('#progressBar').style.width = '0%';
  } catch(e) {}

  countdownInterval = setInterval(() => {
    if (cancelled) { clearInterval(countdownInterval); return; }

    secondsLeft -= 1;
    try { $w('#countdownNum').text = String(Math.max(secondsLeft, 0)); } catch(e) {}

    const elapsed  = Date.now() - startTime;
    const progress = Math.min((elapsed / totalMs) * 100, 100);
    try { $w('#progressBar').style.width = progress + '%'; } catch(e) {}

    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
      if (!cancelled) {
        logClick(article);
        wixLocation.to(destinationUrl); // same tab — browser blocks new-tab from timer
      }
    }
  }, 1000);
}

// ── Related Articles ──────────────────────────────────────────────────────────
async function loadRelated(article) {
  try {
    const result = await wixData.query('KBArticles')
      .eq('categoryName', article.categoryName)
      .ne('_id', article._id)
      .limit(3)
      .find();

    if (!result.items.length) {
      $w('#relatedSection').hide();
      return;
    }

    $w('#relatedRepeater').data = result.items;
    $w('#relatedRepeater').onItemReady(($item, itemData) => {
      try { $item('#relatedTitle').text = itemData.title || ''; } catch(e) {}
      try { $item('#relatedMeta').text  = (itemData.tier || '') + ' · ' + (itemData.categoryName || ''); } catch(e) {}
      $item('#relatedTitle').onClick(() => {
        wixLocation.to('/kbarticles/' + itemData.slug);
      });
    });
  } catch(e) {
    try { $w('#relatedSection').hide(); } catch(e2) {}
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────
async function logView(article) {
  try {
    await wixData.insert('KBAnalytics', {
      articleId:    article._id,
      articleTitle: article.title,
      articleSlug:  article.slug,
      category:     article.categoryName,
      tier:         article.tier,
      eventType:    'view',
      timestamp:    new Date()
    });
  } catch(e) { console.warn('KBAnalytics view log failed:', e); }
}

async function logClick(article) {
  try {
    await wixData.insert('KBAnalytics', {
      articleId:    article._id,
      articleTitle: article.title,
      articleSlug:  article.slug,
      category:     article.categoryName,
      tier:         article.tier,
      eventType:    'clickthrough',
      timestamp:    new Date()
    });
  } catch(e) { console.warn('KBAnalytics click log failed:', e); }
}
