window.runTargetedAudit = async () => {
  const results = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const text = (element) => element.textContent.replace(/\s+/g, " ").trim();
  const findText = (value, selector = "button,div,label") => {
    const found = [...document.querySelectorAll(selector)]
      .filter((el) => !el.closest("ui-title-bar"))
      .reverse()
      .find((el) => text(el) === value);
    if (!found) throw new Error(`Missing text: ${value}`);
    return found;
  };
  const click = async (element) => {
    assert(element, "Missing control");
    element.click();
    await wait(50);
  };
  const fill = async (element, value) => {
    assert(element, "Missing input");
    const proto =
      element.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
    element.dispatchEvent(
      new Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
    await wait(30);
  };
  const test = async (name, run) => {
    try {
      await run();
      assert(!window.auditErrors.length, window.auditErrors.join("; "));
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    }
  };
  for (const section of ["search", "collections"]) {
    await test(`${section}: pin filters apply and cancelled edits do not change results`, async () => {
      await window.auditMount(`/app/${section}/pinning`);
      await click(document.querySelector('[aria-label="Filter rules"]'));
      await click(findText("+ Add filter", "button"));
      const selects = document.querySelectorAll(".filter-modal-card select");
      assert(
        selects[1].options[0].value ===
          (section === "search" ? "Search Queries" : "Collections"),
        "Wrong target filter field",
      );
      await fill(selects[1], "Item name");
      await fill(
        document.querySelector(".filter-modal-card input[type=text]"),
        "Summer",
      );
      await click(findText("OK", "button"));
      assert(
        document.querySelectorAll("tbody tr").length === 1,
        "Filter did not reduce rows",
      );
      assert(
        document.querySelector("tbody").textContent.includes("Summer dresses"),
        "Wrong filtered row",
      );
      await click(document.querySelector('[aria-label="Filter rules"]'));
      await fill(
        document.querySelector(".filter-modal-card input[type=text]"),
        "Winter",
      );
      await click(findText("CANCEL", "button"));
      assert(
        document.querySelector("tbody").textContent.includes("Summer dresses"),
        "Cancel changed applied filters",
      );
    });
    await test(`${section}: Search button submits a product search`, async () => {
      await window.auditMount(`/app/${section}/pinning/rule-1`);
      await wait(650);
      window.auditEvents = [];
      await click(findText("Search", "button"));
      assert(
        window.auditEvents.some((e) => e.values?.intent === "search"),
        "Search button did not submit",
      );
    });
    await test(`${section}: merchandising dates can be selected and cancelled`, async () => {
      await window.auditMount(`/app/${section}/merchandising`);
      await click(findText("Create rule"));
      await click(
        findText(
          section === "search" ? "Create a New Rule" : "Create manual rule",
        ),
      );
      const dateLabel = [...document.querySelectorAll("label")].find((el) =>
        text(el).startsWith("Date range"),
      );
      await click(dateLabel?.querySelector("input"));
      const dateTrigger = [...document.querySelectorAll("div")]
        .reverse()
        .find((el) => /^\d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2}$/.test(text(el)));
      await click(dateTrigger);
      await fill(
        document.querySelector('input[aria-label="Start date"]'),
        "2026-10-01",
      );
      await fill(
        document.querySelector('input[aria-label="End date"]'),
        "2026-10-31",
      );
      await click(findText("Select", "button"));
      assert(
        findText("2026-10-01 - 2026-10-31", "div"),
        "Selected range was not applied",
      );
      await click(findText("2026-10-01 - 2026-10-31", "div"));
      await fill(
        document.querySelector('input[aria-label="Start date"]'),
        "2026-10-15",
      );
      await click(findText("Cancel", "[role=dialog] button"));
      assert(
        findText("2026-10-01 - 2026-10-31", "div"),
        "Cancelling changed the date range",
      );
    });
  }
  await test("Search merchandising exports the selected rule, with search scope", async () => {
    await window.auditMount("/app/search/merchandising");
    await click([...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('Summer dresses')).querySelector('input[type=checkbox]'));
    await click(findText("Export", "button"));
    let blob;
    const original = URL.createObjectURL;
    URL.createObjectURL = (value) => {
      blob = value;
      return original(value);
    };
    const prevent = (e) => {
      if (e.target.closest("a[download]")) e.preventDefault();
    };
    document.addEventListener("click", prevent, true);
    try {
      await click(findText("OK", "button"));
      assert(blob, "No export file created");
      const csv = await blob.text();
      assert(csv.includes("Summer dresses"), "Selected rule missing from CSV");
      assert(
        csv.includes("FALSE"),
        "Search rule incorrectly exported as a collection rule",
      );
    } finally {
      URL.createObjectURL = original;
      document.removeEventListener("click", prevent, true);
    }
  });
  await test("All searches is retained when opening the new pin editor", async () => {
    await window.auditMount("/app/search/pinning/new?applyToAll=true");
    const label = [...document.querySelectorAll("label")].find(
      (el) => text(el) === "Apply to all searches",
    );
    assert(
      label?.querySelector("input")?.checked,
      "All searches checkbox was not enabled",
    );
  });
  await test("Search-pin CSV export includes scope and every search query", async () => {
    await window.auditMount("/app/search/pinning");
    await click([...document.querySelectorAll('tbody tr')].find(row => row.textContent.includes('dress') && !row.textContent.includes('coat')).querySelector('input[type=checkbox]'));
    await click(findText("Export", "button"));
    let blob;
    const original = URL.createObjectURL;
    URL.createObjectURL = (value) => {
      blob = value;
      return original(value);
    };
    const prevent = (e) => {
      if (e.target.closest("a[download]")) e.preventDefault();
    };
    document.addEventListener("click", prevent, true);
    try {
      await click(findText("OK", "button"));
      assert(blob, "No CSV created");
      const csv = await blob.text();
      assert(
        csv.includes("SearchQueries") && csv.includes("ApplyToAll"),
        "Scope columns missing",
      );
      assert(csv.includes("dress"), "Query missing from CSV");
    } finally {
      URL.createObjectURL = original;
      document.removeEventListener("click", prevent, true);
    }
  });
  await test("Merged Values opens the add dialog from the renamed button", async () => {
    await window.auditMount("/app/filters/merged-value");
    await click(findText("Add merge value", "button"));
    assert(
      document.querySelectorAll("input").length > 1,
      "Add merge value did not open its dialog",
    );
  });
  window.auditTargetedResults = results;
  return results;
};
("Targeted tests ready");
