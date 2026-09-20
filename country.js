(() => {
  "use strict";

  const RAIL_COUNTRY_HELPER_VERSION = "2026-09-20-v45";
  const DEFAULT_COUNTRY = "jp";

  function requestedCode() {
    try {
      const q = new URLSearchParams(window.location.search).get("country");
      if (q && /^[a-z0-9_-]{2,12}$/i.test(q)) {
        return q.toLowerCase();
      }
    } catch (_) {}

    try {
      const saved = localStorage.getItem("rail_country");
      if (saved && /^[a-z0-9_-]{2,12}$/i.test(saved)) {
        return saved.toLowerCase();
      }
    } catch (_) {}

    return DEFAULT_COUNTRY;
  }

  function setCountryGlobals(country) {
    const code = String(country?.code || country || DEFAULT_COUNTRY).toLowerCase();

    window.RAIL_COUNTRY = code;
    window.RAIL_DATA_BASE =
      country?.data_path || `data/${code}`;

    window.RAIL_COUNTRY_INFO =
      typeof country === "object"
        ? country
        : {
            code,
            label: code === "jp" ? "日本 / Japan" : code.toUpperCase(),
            data_path: `data/${code}`
          };

    return code;
  }

  function rootTargetURL(country) {
    const path = country.app_path || "index.html";
    const url = new URL(path, document.baseURI);
    url.searchParams.set("country", country.code);
    return url;
  }

  function fallbackCountries() {
    return [
      {
        code: "jp",
        label: "日本 / Japan",
        name_en: "Japan",
        released: true,
        data_path: "data/jp",
        app_path: "index.html"
      }
    ];
  }

  function buildSelector(countries, currentCode) {
    const host = document.getElementById("countrySwitchHost");
    if (!host) return;

    const released = (countries || [])
      .filter(c => c && c.released === true && c.code);

    const list = released.length ? released : fallbackCountries();

    const select = document.createElement("select");
    select.id = "countrySwitch";
    select.setAttribute("aria-label", "Country / 国");

    for (const country of list) {
      const option = document.createElement("option");
      option.value = String(country.code).toLowerCase();
      option.textContent =
        country.label ||
        country.name_local ||
        country.name_en ||
        String(country.code).toUpperCase();

      option.selected =
        option.value === String(currentCode || DEFAULT_COUNTRY).toLowerCase();

      select.appendChild(option);
    }

    if (![...select.options].some(o => o.selected) && select.options.length) {
      select.options[0].selected = true;
    }

    select.addEventListener("change", () => {
      const next = list.find(
        c => String(c.code).toLowerCase() === select.value
      );
      if (!next) return;

      try {
        localStorage.setItem("rail_country", next.code);
      } catch (_) {}

      if ((next.app_path || "index.html") !== "index.html") {
        window.location.href = rootTargetURL(next).toString();
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("country", next.code);
      window.location.href = url.toString();
    });

    host.replaceChildren(select);
  }

  // Set a usable country immediately; app.js does not wait for registry loading.
  const initialCode = requestedCode();
  setCountryGlobals(initialCode);

  // Compatibility for any older frontend code that still calls it.
  window.RAIL_bootstrapCountry = async function() {
    return window.RAIL_COUNTRY_INFO;
  };

  async function initCountrySelector() {
    const host = document.getElementById("countrySwitchHost");
    if (!host) return;

    let registry = null;

    try {
      const response = await fetch(
        new URL("config/countries.json", document.baseURI),
        {cache: "no-store"}
      );

      if (response.ok) {
        registry = await response.json();
      }
    } catch (e) {
      console.warn("Country registry unavailable; using Japan fallback.", e);
    }

    const released = (registry?.countries || [])
      .filter(c => c && c.released === true && c.code);

    const countries = released.length
      ? released
      : fallbackCountries();

    let current = countries.find(
      c => String(c.code).toLowerCase() === initialCode
    );

    if (!current) {
      current = countries.find(
        c => c.code === registry?.default_country
      ) || countries[0];
    }

    setCountryGlobals(current);

    try {
      localStorage.setItem("rail_country", current.code);
    } catch (_) {}

    buildSelector(countries, current.code);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initCountrySelector,
      {once: true}
    );
  } else {
    initCountrySelector();
  }
})();
