window.runAuditSmoke = async (start, end) => {
  const results = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const controls = () =>
    [...document.querySelectorAll("*")].filter((el) => {
      if (
        el.closest("ui-title-bar") ||
        el.disabled ||
        !el.getClientRects().length
      )
        return false;
      const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
      return (
        typeof el[key]?.onClick === "function" ||
        el.matches("button,a,input[type=checkbox],s-button")
      );
    });
  for (const route of window.auditRoutes.slice(start, end)) {
    const url = route.path.replace(":id", "rule-1");
    await window.auditMount(url);
    const count = controls().length;
    for (let index = 0; index < count; index++) {
      await window.auditMount(url);
      const el = controls()[index];
      if (!el) continue;
      const label = (
        el.innerText ||
        el.getAttribute("aria-label") ||
        el.title ||
        el.type ||
        el.tagName
      )
        .trim()
        .slice(0, 90);
      if (el.tagName === "A" && el.href && !el.href.startsWith(location.origin))
        continue;
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await wait(30);
      const errors = [...window.auditErrors];
      if (document.querySelector("[data-audit-error]"))
        errors.push("Route error after click");
      results.push({
        url,
        label,
        errors,
        destination: window.auditRouter.state.location.pathname,
        events: window.auditEvents,
      });
    }
  }
  window.auditSmokeResults = [...(window.auditSmokeResults || []), ...results];
  return {
    clicks: results.length,
    failures: results.filter((r) => r.errors.length),
  };
};
("Smoke helper ready");
