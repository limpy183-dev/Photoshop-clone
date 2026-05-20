/*
 * strip-extension-hydration-attributes.js
 *
 * Some browser extensions (Bitdefender, ad-blockers, accessibility tools)
 * inject attributes like `bis_skin_checked` onto elements before React
 * hydrates. React then treats those attributes as a hydration mismatch
 * and warns / re-renders. We strip them on the document before React
 * runs and keep stripping for the first five seconds of the page load.
 *
 * This file is referenced from app/layout.tsx via <Script src="..." />
 * so the site can drop `'unsafe-inline'` from script-src in CSP without
 * losing the fix.
 */
(function () {
  var ATTRIBUTES = ["bis_skin_checked"];
  function strip(root) {
    if (!root || root.nodeType !== 1) return;
    for (var i = 0; i < ATTRIBUTES.length; i++) {
      var attr = ATTRIBUTES[i];
      if (root.hasAttribute && root.hasAttribute(attr)) root.removeAttribute(attr);
    }
    var selector = ATTRIBUTES.map(function (attr) {
      return "[" + attr + "]";
    }).join(",");
    if (root.querySelectorAll) {
      var matches = root.querySelectorAll(selector);
      for (var j = 0; j < matches.length; j++) {
        for (var k = 0; k < ATTRIBUTES.length; k++) {
          matches[j].removeAttribute(ATTRIBUTES[k]);
        }
      }
    }
  }
  strip(document.documentElement);
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === "attributes") {
        strip(mutation.target);
      } else {
        mutation.addedNodes.forEach(strip);
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ATTRIBUTES,
    childList: true,
    subtree: true,
  });
  window.addEventListener(
    "load",
    function () {
      window.setTimeout(function () {
        observer.disconnect();
      }, 5000);
    },
    { once: true },
  );
})();
