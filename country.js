(() => {
  "use strict";

  const DEFAULT_COUNTRY = "jp";

  function requestedCountry() {
    try {
      const q = new URLSearchParams(window.location.search).get("country");
      if (q && /^[a-z0-9_-]{2,12}$/i.test(q)) return q.toLowerCase();
    } catch (_) {}
    return DEFAULT_COUNTRY;
  }

  function setCountryGlobals(code) {
    const country = String(code || DEFAULT_COUNTRY).toLowerCase();
    window.RAIL_COUNTRY = country;
    window.RAIL_DATA_BASE = `data/${country}`;
    window.RAIL_dataURL = function(name) {
      return new URL(
        `data/${country}/${name}`,
        document.baseURI
      ).href;
    };
    return country;
  }

  // Synchronous and cannot block app.js.
  const initialCountry = setCountryGlobals(requestedCountry());

  // Compatibility with earlier app.js builds.
  window.RAIL_bootstrapCountry = async function() {
    return {
      code: window.RAIL_COUNTRY || initialCountry,
      data_path: window.RAIL_DATA_BASE || `data/${initialCountry}`
    };
  };

  function buildSelector(countries) {
    const host = document.getElementById("countrySwitchHost");
    if (!host) return;

    const released = (countries || []).filter(
      c => c && c.released === true && c.code
    );

    if (released.length <= 1) {
      host.hidden = true;
      return;
    }

    const current = window.RAIL_COUNTRY || DEFAULT_COUNTRY;
    const select = document.createElement("select");
    select.id = "countrySwitch";
    select.setAttribute("aria-label", "Country / 国");

    for (const c of released) {
      const option = document.createElement("option");
      option.value = String(c.code).toLowerCase();
      option.textContent = c.label || c.name_en || c.code;
      option.selected = option.value === current;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("country", select.value);
      window.location.href = url.toString();
    });

    host.replaceChildren(select);
    host.hidden = false;
  }

  // Optional registry lookup. Failure is harmless.
  async function loadRegistryForSelector() {
    try {
      const url = new URL("config/countries.json", document.baseURI);
      const r = await fetch(url, {cache: "no-store"});
      if (!r.ok) return;
      const registry = await r.json();
      window.RAIL_COUNTRIES = registry.countries || [];
      buildSelector(window.RAIL_COUNTRIES);
    } catch (e) {
      console.warn("Country registry unavailable; using Japan directly.", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      loadRegistryForSelector,
      {once: true}
    );
  } else {
    loadRegistryForSelector();
  }
})();
