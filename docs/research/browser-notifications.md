# Browser notifications, background tabs and Web Push

Research for the ticket "Do users hear about finished Generations after leaving the page, and how?". Gathered 2026-10-23 from browser compat data (MDN BCD), vendor blogs, the WHATWG Notifications spec, RFCs and Chromium/Gecko source. caniuse notes and the raw BCD files couldn't be downloaded through the research proxy, so BCD figures come from summaries of those files.

The studio's setup: a same-origin React SPA over HTTPS, no service worker and no web app manifest, one SSE stream per tab.

## Summary

- **Only desktop browsers show a notification straight from a page.** Chrome, Edge, Firefox and Safari on desktop support `new Notification()` without a service worker. Android Chrome throws and requires `ServiceWorkerRegistration.showNotification()`. iPhone and iPad Safari have no `Notification` in a normal tab; a Home Screen web app gets it only through a service worker.
- **Phones suspend background tabs quickly.** Android Chrome freezes background pages after about 5 minutes. iOS suspends JavaScript within seconds, and reports put SSE closing after about 20 s.
- **Desktop Chrome exempts notifying tabs from its Energy Saver freeze**, at least initially. Memory Saver can still discard an idle background tab outright.
- **A shared `tag` de-duplicates across tabs only in Chrome.** Safari ignores `tag`, and Firefox's cross-tab behaviour is unconfirmed. BroadcastChannel and Web Locks exist in every target browser, so tabs can elect one notifier themselves.
- **Permission prompts need a click in Firefox and Safari.** Chrome shows only a small address-bar chip without one.
- **Web Push always goes through the browser vendor's push service**: Google FCM, Mozilla Autopush or Apple. The content is encrypted, but the service sees timing, size, sender and IPs. It needs a service worker everywhere except Safari's Declarative Web Push, and on iPhone a Home Screen install.

## 1. `new Notification()` from a page

- **Desktop Chrome, Edge, Firefox and Safari**: supported (Chrome 20+, Edge 14+, Firefox 22+, Safari 7+). It needs a secure context, and Chrome blocks it in incognito (since 49). [bcd]
- **Android Chrome**: the constructor always throws a TypeError, with Chrome's message "Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead". Samsung Internet likewise allows notifications only through service workers. [chrome-notif] [bcd]
- **iOS and iPadOS Safari**:
  - In a tab, `Notification` doesn't exist.
  - In a Home Screen web app (16.4+), notifications can be sent only from a service worker. [bcd] [webkit-ios-push]
- **Firefox Android**: BCD marks it like desktop, but MDN says the constructor throws in nearly all mobile browsers. **Unconfirmed on a device.** [mdn-ctor]

## 2. Permission prompts

- **Firefox**: `requestPermission()` must come from a user gesture since 72 (Android 79). Without one, the promise rejects and only an address-bar icon appears. [ff72]
- **Safari**: a gesture has been required since 12.1 on macOS. On iOS the prompt must come from direct user interaction. [safari121] [webkit-ios-push]
- **Chrome**:
  - No hard gesture rule; without a gesture the prompt is a quiet chip by the padlock. [chrome-chip]
  - The quieter permission UI turns on for users who often deny, and for sites with very low acceptance rates. How it treats low-traffic sites is **unconfirmed**. [chrome-quiet]
  - Abusive-notification enforcement is driven by Search Console reports. [chrome-abusive]
  - Since October 2025, permission is auto-revoked from sites with low engagement and high notification volume. [chrome-revoke]
  - The January 2026 rate limits apply to the Push API only. [chrome-push-limits]

## 3. Background tabs and SSE

No primary source describes EventSource specifically in a hidden tab in any browser. The facts below are about timers, freezing and discarding.

- **Chrome desktop**:
  - Timers in hidden tabs run once per second, and once per minute after 5 minutes hidden plus 30 s silent. [chrome-timers]
  - Energy Saver (133+) freezes CPU-heavy tabs hidden and silent for over 5 minutes. Tabs with notification permission are opted out "initially". [chrome-freeze] [blink-freeze]
  - Memory Saver discards unused background tabs, which unloads the page. [chrome-memory]
- **Android Chrome**: pages are frozen after 5 minutes in the background (since M68). [blink-android-freeze]
- **Firefox**:
  - Desktop runs background timers at most once a second and unloads tabs under low memory. [mdn-timeout] [ff-unload]
  - Android's minimum timer interval is 15 minutes, and tabs may unload. [mdn-timeout]
- **Safari macOS**: throttles background tabs but doesn't suspend them; exact limits are **unconfirmed**. [webkit-162865]
- **iOS**: reports put SSE closing about 20 s after backgrounding, with no `error` event on return in iOS 18, and JavaScript suspended within about 3 s. These aren't official Apple figures. [apple-forum] [fem]

## 4. Several tabs

- **The spec**: a notification replaces any existing one with the same origin and tag, whichever document created it. `renotify` only controls re-alerting and needs a tag. [whatwg]
- **Chrome**: confirmed in source. A page notification's id is built from origin and tag only, so a second tab with the same tag replaces the first. [chromium-src]
- **Firefox**: supports `tag` (26+); cross-tab replacement is **unconfirmed**.
- **Safari**: `tag` can be set but has no effect, and the WebKit bug is still open. [bcd] [webkit-258922]
- **`renotify`**: Chrome only (50+). [bcd]
- **Coordination APIs**: BroadcastChannel (Chrome 54, Firefox 38, Safari 15.4) and Web Locks (Chrome 69, Firefox 96, Safari 15.4), with mobile matching desktop. [mdn-bc] [mdn-locks]

## 5. Web Push, for comparison

- **Push services**:
  - Chrome uses Firebase Cloud Messaging. [chrome-interop]
  - Firefox uses Mozilla Autopush; Firefox Android also routes through FCM. [autopush] [ff-push]
  - Safari uses Apple's push service (macOS Ventura+).
- **What the push service sees**: the content is encrypted (RFC 8291), but the service sees which server talks to which browser, timing, length (unless padded), the HTTP headers including TTL, Urgency and Topic, the VAPID sender identity, and IP addresses. [rfc8291] [rfc8030]
- **iOS**: push needs a Home Screen install (16.4+). Since iOS 26, any site added to the Home Screen opens as a web app without a manifest. [webkit-wwdc25] [heise]
- **Service worker**: required, except for Safari's Declarative Web Push (iOS 18.4, macOS 15.5). Chrome hasn't shipped it. [mdn-push] [webkit-declarative]

## 6. Notification images and cookies

- **Spec**: `icon` and `image` are fetched with credentials included. [whatwg]
- **Browsers**:
  - Chrome sends cookies; Firefox does too, except in private browsing. [chromium-src] [gecko-alert]
  - Safari ignores `icon`.
  - Neither Firefox nor Safari supports `image`. [bcd]

## Sources

- [bcd] https://github.com/mdn/browser-compat-data/blob/main/api/Notification.json
- [chrome-notif] https://developer.chrome.com/blog/notifying-you-of-changes-to-notifications
- [mdn-ctor] https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification
- [webkit-ios-push] https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- [ff72] https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/
- [safari121] https://developer.apple.com/tutorials/data/documentation/safari-release-notes/safari-12_1-release-notes.md
- [chrome-chip] https://developer.chrome.com/blog/permissions-chip
- [chrome-quiet] https://blog.chromium.org/2020/01/introducing-quieter-permission-ui-for.html
- [chrome-abusive] https://blog.chromium.org/2020/05/protecting-chrome-users-from-abusive.html
- [chrome-revoke] https://blog.google/chromium/automatic-notification-permission/
- [chrome-push-limits] https://developer.chrome.com/blog/web-push-rate-limits
- [chrome-timers] https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- [chrome-freeze] https://developer.chrome.com/blog/freezing-on-energy-saver
- [blink-freeze] https://groups.google.com/a/chromium.org/g/blink-dev/c/OVoSqEhtpNI
- [chrome-memory] https://developer.chrome.com/blog/memory-and-energy-saver-mode
- [blink-android-freeze] https://groups.google.com/a/chromium.org/g/blink-dev/c/NOhYFW0rifw
- [mdn-timeout] https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
- [ff-unload] https://firefox-source-docs.mozilla.org/browser/tabunloader/
- [webkit-162865] https://bugs.webkit.org/show_bug.cgi?id=162865
- [apple-forum] https://developer.apple.com/forums/thread/765183
- [fem] https://frontendmasters.com/courses/background-javascript/observing-mobile-background-javascript
- [whatwg] https://notifications.spec.whatwg.org/
- [chromium-src] Chromium `notification_id_generator.cc`, `notification.cc`, `notification_resources_loader.cc`
- [webkit-258922] https://bugs.webkit.org/show_bug.cgi?id=258922
- [mdn-bc] https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- [mdn-locks] https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- [chrome-interop] https://developer.chrome.com/blog/web-push-interop-wins
- [autopush] https://autopush.readthedocs.io/
- [ff-push] https://firefox-source-docs.mozilla.org/dom/push/index.html
- [rfc8291] https://www.rfc-editor.org/rfc/rfc8291
- [rfc8030] https://www.rfc-editor.org/rfc/rfc8030
- [webkit-wwdc25] https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- [heise] https://heise.de/-10749652
- [mdn-push] https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- [webkit-declarative] https://webkit.org/?p=16535
- [gecko-alert] https://github.com/mozilla/gecko-dev/blob/master/toolkit/components/alerts/AlertNotification.cpp
