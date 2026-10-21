(function (config) {
  var preference = config.preference;
  var fromServer = preference === "consumer" || preference === "legacy";
  try {
    if (fromServer) localStorage.setItem("factory:frontend", preference);
    else preference = localStorage.getItem("factory:frontend");
  } catch {}

  function consumerPath(pathname) {
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    pathname = pathname.replace(/\/+$/, "") || "/";
    return (
      pathname !== "/reset" &&
      (Object.prototype.hasOwnProperty.call(config.consumerPages, pathname) ||
        Object.prototype.hasOwnProperty.call(config.consumerAliases, pathname) ||
        pathname.indexOf("/pricing/") === 0)
    );
  }

  // The legacy SPA also uses this rule before client navigation, so leaving
  // administration for a user page cannot bypass server interface selection.
  window.factoryShouldUseConsumer = function (href) {
    if (!config.consumerAvailable) return false;
    var choice = preference;
    try {
      var match = document.cookie.match(/(?:^|;\s*)factory_frontend=(consumer|legacy)(?:;|$)/);
      if (match) choice = match[1];
    } catch {}
    if (choice === "legacy") return false;
    try {
      var target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin || !consumerPath(target.pathname)) return false;
      if (["/sign-in", "/sign-up", "/login", "/register"].indexOf(target.pathname) >= 0) {
        var next = target.searchParams.get("next") || target.searchParams.get("redirect");
        if (next && next[0] === "/" && next[1] !== "/") {
          var destination = new URL(next, window.location.origin);
          if (destination.origin === window.location.origin && !consumerPath(destination.pathname))
            return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  };
  if (fromServer || (preference !== "consumer" && preference !== "legacy")) return;

  // This cookie stores only an interface choice. It never grants API access.
  try {
    document.cookie =
      "factory_frontend=" +
      preference +
      "; Path=/; Max-Age=31536000; SameSite=Lax" +
      (window.location.protocol === "https:" ? "; Secure" : "");
    if (
      document.cookie
        .split(";")
        .map(function (part) {
          return part.trim();
        })
        .indexOf("factory_frontend=" + preference) < 0
    )
      return;
  } catch {
    return;
  }

  var script = document.currentScript;
  var current = script && script.getAttribute("data-frontend");
  var pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  // Callback and management URLs must finish in their original application.
  // A fallback caused by a disabled or missing build must preserve the choice.
  if (
    !config.consumerAvailable ||
    current === preference ||
    !consumerPath(pathname) ||
    (preference === "consumer" &&
      !window.factoryShouldUseConsumer(pathname + window.location.search))
  )
    return;

  var query = new URLSearchParams(window.location.search);
  var loginTarget = null;
  if (["/login", "/register", "/sign-in", "/sign-up"].indexOf(pathname) >= 0) {
    var rawTarget = query.get("next") || query.get("redirect");
    if (rawTarget && rawTarget[0] === "/" && rawTarget[1] !== "/" && !/[\\\r\n]/.test(rawTarget)) {
      try {
        var destination = new URL(rawTarget, window.location.origin);
        if (destination.origin === window.location.origin) loginTarget = destination;
      } catch {}
    }
  }
  var allowed = [
    "tab",
    "page",
    "page_size",
    "q",
    "search",
    "keyword",
    "model",
    "group",
    "status",
    "type",
    "show_history",
    "coupon_code",
    "redemption_code",
    "request_id",
    "requestId",
    "from",
    "pay",
    "batch",
  ];
  Array.from(query.keys()).forEach(function (key) {
    if (allowed.indexOf(key) < 0) query.delete(key);
  });
  if (loginTarget) {
    Array.from(loginTarget.searchParams.keys()).forEach(function (key) {
      if (allowed.indexOf(key) < 0) loginTarget.searchParams.delete(key);
    });
    loginTarget.hash = "";
    query.set("next", loginTarget.pathname + loginTarget.search);
  }
  var search = query.toString();
  var fragment = window.location.hash;
  if (/[=&?]/.test(fragment)) fragment = "";
  // Read-back above proves cookies work; the next request carries the choice,
  // so it cannot enter this correction branch a second time.
  window.location.replace(pathname + (search ? "?" + search : "") + fragment);
})(/* factory frontend config */);
